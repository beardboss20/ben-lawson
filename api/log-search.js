'use strict';
/**
 * POST /api/log-search : anonymous search logging.
 * The browser sends what a visitor typed into the matcher or the qualifications search, plus the
 * outcome. This function forwards it to the Apps Script web app (type 'search'), which adds one
 * row to the "Searches" tab. It never emails anyone.
 *
 * Privacy: no IP address, name, email or user agent is stored or forwarded. The IP is used only,
 * hashed, as an in-memory rate-limit key and is never written anywhere.
 *
 * Env vars (same as /api/request-resume): APPS_SCRIPT_URL, APPS_SCRIPT_SECRET.
 * The browser treats this as fire-and-forget, so every failure here is silent for the visitor.
 */
const crypto = require('node:crypto');

const QUERY_MAX = 200;
const MAX_BODY_BYTES = 4000;
const RATE = { windowMs: 10 * 60 * 1000, perIp: 40, globalPerHour: 600 };
const UPSTREAM_TIMEOUT_MS = 25000;

const hits = new Map(); // in-memory, per serverless instance: best effort only
function tooMany(key, limit, windowMs, now) {
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) { hits.set(key, arr); return true; }
  arr.push(now); hits.set(key, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
  return false;
}
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 24);

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  if (body === undefined) return res.end();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') { if (req.body.length > MAX_BODY_BYTES) throw new Error('too_large'); return JSON.parse(req.body || '{}'); }
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > MAX_BODY_BYTES) throw new Error('too_large'); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

// Control characters out, whitespace collapsed, length capped. Formula escaping is done by the
// Apps Script when it writes the cell (a leading ' for = + - @), the same as for resume requests.
function text(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
const int = (v) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 0 && n <= 9999 ? n : 0; };

function validate(input) {
  if (!input || typeof input !== 'object') return null;
  const box = input.box === 'matcher' || input.box === 'qualifications' ? input.box : null;
  const query = text(input.query, QUERY_MAX);
  const result = input.result === 'YES' || input.result === 'NOT YET' ? input.result : null;
  if (!box || !query || !result) return null;
  const unmet = (Array.isArray(input.unmet) ? input.unmet : []).slice(0, 10).map((u) => text(u, 80)).filter(Boolean).join('; ').slice(0, 300);
  const referrer = /^[a-z0-9.-]{1,100}$/i.test(String(input.referrer || '')) ? String(input.referrer).toLowerCase() : '';
  return { box, query, result, matched: int(input.matched), total: int(input.total), unmet, source: input.source === 'example' ? 'example' : 'typed', referrer };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { ok: false }); }

  const origin = req.headers.origin;
  if (origin) {
    let host = '';
    try { host = new URL(origin).host; } catch (e) { /* ignore */ }
    if (host !== req.headers.host) return send(res, 403, { ok: false });
  }

  let input;
  try { input = await readJson(req); } catch (e) { return send(res, 400, { ok: false }); }
  const clean = validate(input);
  if (!clean) return send(res, 400, { ok: false });

  const url = process.env.APPS_SCRIPT_URL;
  const secret = process.env.APPS_SCRIPT_SECRET;
  if (!url || !secret) return send(res, 503, { ok: false });

  const now = Date.now();
  const ip = String((req.headers['x-forwarded-for'] || '').split(',')[0] || (req.socket && req.socket.remoteAddress) || '').trim();
  if (tooMany('ip:' + hash(ip), RATE.perIp, RATE.windowMs, now) || tooMany('global', RATE.globalPerHour, 60 * 60 * 1000, now)) {
    return send(res, 429, { ok: false });
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: secret, type: 'search', ...clean }),
      redirect: 'follow',
      signal: ctrl.signal,
    });
    const out = await r.json().catch(() => null);
    if (r.ok && out && out.ok === true) return send(res, 204);
    console.error('log-search: upstream rejected', r.status, out && out.error); // never logs the query
    return send(res, 502, { ok: false });
  } catch (e) {
    console.error('log-search: upstream failed', e && e.name);
    return send(res, 502, { ok: false });
  } finally {
    clearTimeout(timer);
  }
};

module.exports.validate = validate; // for tests
