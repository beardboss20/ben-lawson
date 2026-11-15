'use strict';
/**
 * POST /api/request-resume : the site's only API.
 * Validates input, checks the honeypot, rate-limits (basic), then forwards to a
 * Google Apps Script web app that logs the request in Ben's Sheet and emails him.
 *
 * Env vars (set in Vercel, never in the repo):
 *   APPS_SCRIPT_URL     the web app URL ending in /exec
 *   APPS_SCRIPT_SECRET  the shared secret (also stored in the script's SHARED_SECRET property)
 */
const crypto = require('node:crypto');

const LIMITS = { name: 100, email: 160, company: 120, jobTitle: 140 };
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/;
const MAX_BODY_BYTES = 4000;
const RATE = { windowMs: 10 * 60 * 1000, perIp: 3, perEmail: 2, globalPerHour: 40 };
const UPSTREAM_TIMEOUT_MS = 25000; // Apps Script cold starts can take 10s+; keep in step with maxDuration in vercel.json

// Basic best-effort rate limit. Memory is per serverless instance, so this slows bursts,
// it is not a hard guarantee. The Apps Script side re-validates everything.
const hits = new Map();
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
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function validate(input) {
  const clean = {}; const errors = {};
  for (const k of Object.keys(LIMITS)) {
    const v = String(input[k] == null ? '' : input[k]).replace(/\s+/g, ' ').trim();
    if (!v) errors[k] = 'required';
    else if (v.length > LIMITS[k]) errors[k] = 'too_long';
    else if (/[\u0000-\u001f<>]/.test(v)) errors[k] = 'bad_characters';
    else if (k === 'email' && !EMAIL_RE.test(v)) errors[k] = 'invalid';
    clean[k] = v;
  }
  return { clean, errors, ok: Object.keys(errors).length === 0 };
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > MAX_BODY_BYTES) throw new Error('too_large'); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { ok: false, error: 'method_not_allowed' }); }

  // Same-origin only: the browser sends Origin on POST.
  const origin = req.headers.origin;
  if (origin) {
    let host = '';
    try { host = new URL(origin).host; } catch (e) { /* ignore */ }
    if (host !== req.headers.host) return send(res, 403, { ok: false, error: 'forbidden' });
  }

  let input;
  try { input = await readJson(req); } catch (e) { return send(res, 400, { ok: false, error: 'bad_request' }); }
  if (!input || typeof input !== 'object') return send(res, 400, { ok: false, error: 'bad_request' });

  // Honeypot: bots fill the hidden field. Pretend it worked, send nothing.
  if (input.website) return send(res, 200, { ok: true });

  const { clean, errors, ok } = validate(input);
  if (!ok) return send(res, 400, { ok: false, error: 'invalid', errors });

  const url = process.env.APPS_SCRIPT_URL;
  const secret = process.env.APPS_SCRIPT_SECRET;
  if (!url || !secret) {
    console.error('request-resume: APPS_SCRIPT_URL or APPS_SCRIPT_SECRET is not set');
    return send(res, 503, { ok: false, error: 'not_configured' });
  }

  const now = Date.now();
  const ip = String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || '').trim();
  if (tooMany('ip:' + hash(ip), RATE.perIp, RATE.windowMs, now) ||
      tooMany('em:' + hash(clean.email.toLowerCase()), RATE.perEmail, RATE.windowMs, now) ||
      tooMany('global', RATE.globalPerHour, 60 * 60 * 1000, now)) {
    return send(res, 429, { ok: false, error: 'rate_limited' });
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids a CORS preflight; Apps Script parses the body itself
      body: JSON.stringify({ token: secret, ...clean }),
      redirect: 'follow',
      signal: ctrl.signal,
    });
    const out = await r.json().catch(() => null);
    if (r.ok && out && out.ok === true) return send(res, 200, { ok: true });
    console.error('request-resume: upstream rejected', r.status, out && out.error);
    return send(res, 502, { ok: false, error: 'upstream_error' });
  } catch (e) {
    console.error('request-resume: upstream failed', e && e.name);
    return send(res, 502, { ok: false, error: 'upstream_error' });
  } finally {
    clearTimeout(timer);
  }
};

module.exports.validate = validate; // for tests
