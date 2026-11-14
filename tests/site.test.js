'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

test('matcher data is inlined in the page and parses (no runtime fetch needed)', () => {
  for (const id of ['data-skills', 'data-titles', 'data-gaps']) {
    const m = html.match(new RegExp('<script type="application/json" id="' + id + '">([\\s\\S]*?)</script>'));
    assert.ok(m, id + ' block');
    JSON.parse(m[1]);
  }
  assert.ok(!/fetch\(/.test(appJs), 'app.js must not fetch');
  assert.ok(!/<\/script/i.test(html.match(/id="data-skills">([\s\S]*?)<\/script>/)[1]));
});

test('inlined data matches data/*.json (build is up to date)', () => {
  for (const n of ['skills', 'titles', 'gaps']) {
    const m = html.match(new RegExp('id="data-' + n + '">([\\s\\S]*?)</script>'));
    const inline = JSON.parse(m[1]);
    const file = JSON.parse(fs.readFileSync(path.join(root, 'data', n + '.json'), 'utf8'));
    assert.deepEqual(inline, file, n + ' differs: run node tools/build.mjs');
  }
});

test('hero: no subtitle repeating the name, tagline and email under the name, no email under the CTAs', () => {
  assert.ok(!/Benjamin Lawson, MBA/.test(html.split('<main>')[0]));
  const hero = html.split('<main>')[0];
  assert.match(hero, /<h1>Ben Lawson<\/h1>\s*<p class="subtitle">People Capability, L&amp;D, and AI Enablement<\/p>\s*<p class="contact-line"><a href="mailto:benhlawson@gmail.com">benhlawson@gmail.com<\/a>/);
  assert.ok(!/class="email-line"/.test(html));
  assert.match(hero, /Omaha area \(Fremont, NE\)/);
  assert.match(hero, /id="request-resume-btn"/);
});

test('contact is email and LinkedIn only: no phone number or street address', () => {
  assert.ok(!/402[-. )]*926[-. ]*1521/.test(html));
  assert.ok(!/\b\d{3}[-. ]\d{3}[-. ]\d{4}\b/.test(html));
  assert.match(html, /https:\/\/www\.linkedin\.com\/in\/benhlawson/);
});

test('request resume form has the four fields, a hidden honeypot, and client-side validation', () => {
  for (const f of ['rr-name', 'rr-email', 'rr-company', 'rr-title']) assert.match(html, new RegExp('id="' + f + '"[^>]*required'));
  assert.match(html, /name="website"[^>]*tabindex="-1"/);
  assert.match(html, /<div class="hp" aria-hidden="true">/);
  const js = fs.readFileSync(path.join(root, 'resume-request.js'), 'utf8');
  assert.match(js, /EMAIL_RE/);
  assert.match(js, /\/api\/request-resume/);
});

test('no secrets or Apps Script URL in the repo files that ship to the browser', () => {
  const blob = html + appJs + fs.readFileSync(path.join(root, 'resume-request.js'), 'utf8');
  assert.ok(!/script\.google\.com|AKfycb/.test(blob));
});

// --- /api/request-resume ---
const handler = require('../api/request-resume.js');
let n = 0;
function call(body, { method = 'POST', headers = {}, env = {} } = {}) {
  const saved = { u: process.env.APPS_SCRIPT_URL, s: process.env.APPS_SCRIPT_SECRET };
  if ('url' in env) process.env.APPS_SCRIPT_URL = env.url; else delete process.env.APPS_SCRIPT_URL;
  if ('secret' in env) process.env.APPS_SCRIPT_SECRET = env.secret; else delete process.env.APPS_SCRIPT_SECRET;
  const req = { method, headers: { host: 'site.test', 'x-forwarded-for': '203.0.113.' + (++n % 250), ...headers }, body, socket: {} };
  const out = { status: 0, headers: {}, body: '' };
  const res = { setHeader: (k, v) => { out.headers[k] = v; }, set statusCode(v) { out.status = v; }, end: (b) => { out.body = b; } };
  return handler(req, res).then(() => {
    if (saved.u === undefined) delete process.env.APPS_SCRIPT_URL; else process.env.APPS_SCRIPT_URL = saved.u;
    if (saved.s === undefined) delete process.env.APPS_SCRIPT_SECRET; else process.env.APPS_SCRIPT_SECRET = saved.s;
    return { status: out.status, json: JSON.parse(out.body), headers: out.headers };
  });
}
const good = () => ({ name: 'Pat Recruiter', email: 'pat' + (++n) + '@acme.com', company: 'Acme', jobTitle: 'L&D Manager', website: '' });
const cfg = { url: 'https://script.google.com/macros/s/TEST/exec', secret: 'unit-test-secret' };

test('api: only POST', async () => {
  const r = await call({}, { method: 'GET' });
  assert.equal(r.status, 405);
});
test('api: honeypot gets a quiet 200 and nothing is forwarded', async () => {
  let called = false; const f = global.fetch; global.fetch = async () => { called = true; return { ok: true, json: async () => ({ ok: true }) }; };
  const r = await call({ ...good(), website: 'http://spam' }, { env: cfg });
  global.fetch = f;
  assert.equal(r.status, 200); assert.equal(called, false);
});
test('api: invalid input is a 400 with field errors', async () => {
  const r = await call({ ...good(), email: 'nope', name: '' }, { env: cfg });
  assert.equal(r.status, 400); assert.equal(r.json.errors.email, 'invalid'); assert.equal(r.json.errors.name, 'required');
});
test('api: missing env vars give a 503 not_configured and never forward', async () => {
  let called = false; const f = global.fetch; global.fetch = async () => { called = true; };
  const r = await call(good());
  global.fetch = f;
  assert.equal(r.status, 503); assert.equal(r.json.error, 'not_configured'); assert.equal(called, false);
});
test('api: cross-origin POST is refused', async () => {
  const r = await call(good(), { env: cfg, headers: { origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
});
test('api: success forwards fields plus the secret to the Apps Script URL', async () => {
  let seen; const f = global.fetch;
  global.fetch = async (url, opts) => { seen = { url, body: JSON.parse(opts.body), method: opts.method }; return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
  const g = good();
  const r = await call(g, { env: cfg, headers: { origin: 'https://site.test' } });
  global.fetch = f;
  assert.equal(r.status, 200); assert.equal(r.json.ok, true);
  assert.equal(seen.url, cfg.url); assert.equal(seen.method, 'POST');
  assert.equal(seen.body.token, 'unit-test-secret'); assert.equal(seen.body.email, g.email); assert.ok(!('website' in seen.body));
  assert.ok(!JSON.stringify(r.json).includes('unit-test-secret'));
});
test('api: upstream failure is a 502 and does not leak details', async () => {
  const f = global.fetch; global.fetch = async () => ({ ok: false, status: 500, json: async () => ({ ok: false, error: 'unauthorized' }) });
  const r = await call(good(), { env: cfg });
  global.fetch = f;
  assert.equal(r.status, 502); assert.deepEqual(r.json, { ok: false, error: 'upstream_error' });
});
test('api: same email more than twice in the window is rate limited', async () => {
  const f = global.fetch; global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
  const g = { ...good(), email: 'repeat@acme.com' };
  const a = await call(g, { env: cfg }); const b = await call(g, { env: cfg }); const c = await call(g, { env: cfg });
  global.fetch = f;
  assert.deepEqual([a.status, b.status, c.status], [200, 200, 429]);
});

test('apps script: notifies Ben only, with noReply, and checks the token from Script Properties', () => {
  const gs = fs.readFileSync(path.join(root, 'apps-script', 'Code.gs'), 'utf8');
  assert.match(gs, /NOTIFY_TO = 'benhlawson@gmail.com'/);
  assert.match(gs, /noReply: true/);
  assert.match(gs, /getProperty\('SHARED_SECRET'\)/);
  assert.match(gs, /getRange\('B1'\)/, 'falls back to Config!B1');
  assert.match(gs, /hideSheet\(\)/, 'keeps the Config tab hidden');
  assert.ok(!/[0-9a-f]{64}/.test(gs), 'no secret-looking value in the script');
  assert.match(gs, /'Resume request from ' \+ clean\.name \+ ' at ' \+ clean\.company \+ ', ' \+ clean\.jobTitle/);
  assert.ok(!/to: *clean\.email/.test(gs));
});

test('hero stat boxes: the four credentials, no 7+ years box, honest framing, tooltips wired', () => {
  const hero = html.split('<main>')[0];
  const stats = [...hero.matchAll(/<button type="button" class="stat" aria-describedby="(tip-\d)"><strong>([^<]+)<\/strong><span class="stat-label">([^<]+)<\/span>/g)].map((m) => ({ tip: m[1], value: m[2], label: m[3] }));
  assert.deepEqual(stats.map((s) => [s.value, s.label]), [
    ['xAI', 'Trained and evaluated Grok'],
    ['25%', 'Turnover drop from exit data'],
    ['28 leaders', 'Leadership program designed'],
    ['200+', 'ERG members served'],
  ]);
  for (const s of stats) assert.ok(s.label.split(' ').length <= 5, s.label + ' stays short');
  assert.ok(!/>7\+</.test(hero) && !/years in HR and L&amp;D/.test(hero));
  for (const s of stats) assert.match(hero, new RegExp('<span class="tip" id="' + s.tip + '" role="tooltip">'));
  const tips = [...hero.matchAll(/role="tooltip">([^<]+)</g)].map((m) => m[1]);
  assert.equal(tips.length, 4);
  assert.match(tips[0], /Trained and evaluated Grok, reviewed other trainers&#39;? ?work|reviewed other trainers/);
  assert.match(tips[1], /about 5,000 employees/);
  assert.match(tips[1], /helped drive a 25% drop in branch turnover/);
  assert.ok(!/cut turnover|cut branch turnover|reduced turnover by 25/i.test(hero));
  assert.match(tips[2], /a leadership development program for 28 leaders at Airbus/);
  assert.ok(!/Agile|Leadership Development Program/.test(hero));
  assert.match(tips[3], /Geo chair of the Omaha Aspire ERG, leading a team of 4 serving 200\+ members/);
});
