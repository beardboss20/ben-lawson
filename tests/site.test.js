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
    ['28 leaders', 'Leaders upskilled'],
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
  assert.match(tips[2], /^Project managed a leadership development program at Airbus that upskilled 28 leaders\.$/);
  assert.ok(!/designed|ran a/i.test(tips[2] + stats[2].label), 'box 3 must not claim designed/ran');
  assert.ok(!/Agile|Leadership Development Program/.test(hero));
  assert.match(tips[3], /Geo chair of the Omaha Aspire ERG, leading a team of 4 serving 200\+ members/);
});

test('resume v5: the Airbus programs bullet no longer claims a count of 7', () => {
  const all = html + JSON.stringify(read5());
  assert.ok(!/facilitated 7 programs/.test(all));
  assert.match(html, /Designed and facilitated programs and workshops on AI enablement and upskilling, mentorship, and presentation skills, for groups of 3 to 60\./);
});
function read5() { return ['skills', 'titles', 'gaps', 'profile'].map((n) => JSON.parse(fs.readFileSync(path.join(root, 'data', n + '.json'), 'utf8'))); }

test('example chips: label on its own line, all chips grouped underneath', () => {
  assert.match(html, /<p class="examples-label" id="examples-label">Try an example:<\/p>\s*<div class="example-chips" role="group" aria-labelledby="examples-label">/);
  assert.equal((html.match(/class="chip example"/g) || []).length, 4);
  assert.match(fs.readFileSync(path.join(root, 'styles.css'), 'utf8'), /\.example-chips \{[^}]*flex-direction: column/);
});

test('suggested searches (placeholder and example chips) do not include a years count', () => {
  const ph = html.match(/id="req-input"[^>]*placeholder="([^"]+)"/);
  assert.ok(ph, 'textarea placeholder');
  const chips = [...html.matchAll(/class="chip example" data-text="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(chips.length, 4);
  const years = /\b(?:\d+\+?|(?:one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty)(?:\s+plus)?)\s+years?\b/i;
  assert.ok(!years.test(ph[1].replace(/&amp;/g, '&')), 'placeholder has a years count: ' + ph[1]);
  for (const t of chips) {
    const plain = t.replace(/&amp;/g, '&');
    assert.ok(!years.test(plain), 'example chip has a years count: ' + plain);
  }
});

test('timeline: circles and line share one x variable; line starts and ends at circle centers', () => {
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  assert.match(css, /\.timeline \{[^}]*--tl-x: \d+px/);
  assert.match(css, /\.job::before \{[^}]*left: var\(--tl-x\)[^}]*transform: translateX\(-50%\)/);
  assert.match(css, /\.job::after \{[^}]*left: var\(--tl-x\)[^}]*transform: translateX\(-50%\)[^}]*top: var\(--tl-center\)/);
  assert.match(css, /\.job:last-child::after \{ display: none; \}/);
  assert.ok(!/\.timeline \{[^}]*border-left/.test(css), 'no container border line sticking out above the first circle');
});

test('Airbus leadership bullet: past tense everywhere (deliberate, Ben-approved difference from the resume PDF)', () => {
  const bullet = 'Project managed a leadership development program, coordinating cross-functional teams and external facilitators to upskill 28 leaders.';
  assert.ok(html.includes(bullet));
  const blob = ['skills', 'profile'].map((n) => fs.readFileSync(path.join(root, 'data', n + '.json'), 'utf8')).join('\n');
  assert.ok(!/Project manage a leadership/.test(html + blob), 'no stale present-tense copy');
  assert.equal((JSON.parse(fs.readFileSync(path.join(root, 'data', 'skills.json'), 'utf8')).skills.flatMap((s) => s.evidence).filter((e) => e.text === bullet)).length, 3);
});

test('layout: every section shares the same outer container; only long text has a reading width', () => {
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  assert.ok(!/narrow/.test(html) && !/\.narrow/.test(css), 'no narrower per-section container');
  const wraps = [...html.matchAll(/<div class="([^"]*\bwrap\b[^"]*)"/g)].map((m) => m[1]);
  assert.ok(wraps.length >= 5 && wraps.every((c) => c.split(' ').filter((x) => x !== 'hero-grid').join(' ') === 'wrap'), wraps.join('|'));
  assert.match(css, /\.lede \{[^}]*max-width: 75ch/);
  assert.match(css, /\.job ul \{[^}]*max-width: 75ch/);
});

// ---- Visitor count, search logging, cold-start fix ----
const vm = require('node:vm');

function loadAppsScript() {
  const rows = { Requests: [], Searches: null }; const mails = []; const calls = [];
  const mkSheet = (name) => ({ appendRow: (r) => { rows[name].push(r); }, setFrozenRows() {}, getRange: () => ({ getValue: () => 'SHARED_SECRET' }), isSheetHidden: () => true, hideSheet() {} });
  const sheets = { Requests: mkSheet('Requests') };
  const ss = { getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => { calls.push('insert:' + n); rows[n] = []; sheets[n] = mkSheet(n); return sheets[n]; }, getUrl: () => 'https://sheet' };
  const ctx = {
    console, JSON, Math, Date, String, Number, Array, isFinite, RegExp, Object, Error,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'test-secret' }) },
    Utilities: { formatDate: () => '2026-11-14 12:00:00' },
    MailApp: { sendEmail: (m) => mails.push(m) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType: () => ({ getContent: () => s }) }) },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'apps-script', 'Code.gs'), 'utf8'), ctx);
  const post = (obj) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(obj) } }).getContent());
  const plain = (x) => JSON.parse(JSON.stringify(x));
  return { post, mails, calls: { get length() { return calls.length; }, list: () => plain(calls) }, get rows() { return plain(rows); } };
}

test('Apps Script: type search adds a Searches row, escapes formulas, never emails', () => {
  const a = loadAppsScript();
  const r = a.post({ token: 'test-secret', type: 'search', box: 'matcher', query: '=HYPERLINK("x")  L&D\nManager', result: 'NOT YET', matched: 2, total: 3, unmet: ['+cmd', '15+ years HR'], source: 'example', referrer: 'LinkedIn.com' });
  assert.deepEqual(r, { ok: true });
  assert.equal(a.mails.length, 0, 'searches must not email');
  assert.equal(a.rows.Requests.length, 0);
  assert.deepEqual(a.calls.list(), ['insert:Searches']);
  const [headers, row] = a.rows.Searches;
  assert.deepEqual(headers, ['Timestamp (America/Chicago)', 'Box', 'Query', 'Result', 'Matched', 'Of', 'Not yet items', 'Input', 'Referrer']);
  assert.equal(row[2], "'=HYPERLINK(\"x\") L&D Manager");
  assert.equal(row[6], "'+cmd; 15+ years HR");
  assert.deepEqual([row[1], row[3], row[4], row[5], row[7], row[8]], ['matcher', 'NOT YET', 2, 3, 'example', 'linkedin.com']);
  assert.equal(row.length, 9, 'no ip, user agent, name or email columns');
});

test('Apps Script: search rejects bad token and bad fields; caps the query at 200', () => {
  const a = loadAppsScript();
  assert.deepEqual(a.post({ token: 'nope', type: 'search', box: 'matcher', query: 'x', result: 'YES' }), { ok: false, error: 'unauthorized' });
  assert.equal(a.post({ token: 'test-secret', type: 'search', box: 'other', query: 'x', result: 'YES' }).ok, false);
  assert.equal(a.post({ token: 'test-secret', type: 'search', box: 'matcher', query: '   ', result: 'YES' }).ok, false);
  assert.equal(a.post({ token: 'test-secret', type: 'search', box: 'qualifications', query: 'a'.repeat(500), result: 'YES', matched: 1, total: 50, referrer: 'bad domain!' }).ok, true);
  const row = a.rows.Searches[1];
  assert.equal(row[2].length, 200);
  assert.equal(row[8], '', 'invalid referrer is dropped');
});

test('Apps Script: resume requests still add a Requests row and email Ben exactly as before', () => {
  const a = loadAppsScript();
  const r = a.post({ token: 'test-secret', name: 'Pat Recruiter', email: 'pat@example.com', company: 'Acme', jobTitle: 'L&D Manager' });
  assert.deepEqual(r, { ok: true });
  assert.equal(a.rows.Requests.length, 1);
  assert.deepEqual(a.rows.Requests[0].slice(1), ['Pat Recruiter', 'pat@example.com', 'Acme', 'L&D Manager', 'New', '']);
  assert.equal(a.mails.length, 1);
  assert.equal(a.mails.length, 1);
  assert.equal(a.mails[0].to, 'benhlawson@gmail.com');
  assert.equal(a.mails[0].subject, 'Resume request from Pat Recruiter at Acme, L&D Manager');
  assert.equal(a.rows.Searches, null);
});

test('/api/log-search: validation keeps only anonymous fields and caps the query', () => {
  const { validate } = require(path.join(root, 'api', 'log-search.js'));
  const ok = validate({ box: 'matcher', query: '  ' + 'x'.repeat(300), result: 'YES', matched: 3, total: 3, unmet: [], source: 'typed', referrer: 'Google.com', ip: '1.2.3.4', name: 'N', email: 'e@x.com', userAgent: 'UA' });
  assert.deepEqual(Object.keys(ok).sort(), ['box', 'matched', 'query', 'referrer', 'result', 'source', 'total', 'unmet']);
  assert.equal(ok.query.length, 200);
  assert.equal(ok.referrer, 'google.com');
  for (const bad of [null, {}, { box: 'x', query: 'a', result: 'YES' }, { box: 'matcher', query: '', result: 'YES' }, { box: 'matcher', query: 'a', result: 'MAYBE' }]) assert.equal(validate(bad), null);
  assert.equal(validate({ box: 'matcher', query: 'L&D Manager', result: 'YES, BUT', matched: 1, total: 1 }).result, 'YES, BUT');
  assert.equal(validate({ box: 'matcher', query: 'a\u0000b\n\tc', result: 'NOT YET', unmet: ['u'.repeat(200)] }).unmet.length, 80);
});

function fakeRes() { const r = { headers: {}, statusCode: 0, body: undefined, setHeader(k, v) { r.headers[k] = v; }, end(b) { r.body = b; } }; return r; }
async function callLog(body, { headers = {}, method = 'POST' } = {}) {
  const handler = require(path.join(root, 'api', 'log-search.js'));
  const res = fakeRes();
  await handler({ method, headers: { host: 'x.test', ...headers }, body, socket: { remoteAddress: '9.9.9.9' } }, res);
  return res;
}

test('/api/log-search: forwards type search with the secret; fails silently without storing IP or UA', async () => {
  process.env.APPS_SCRIPT_URL = 'https://script.example/exec'; process.env.APPS_SCRIPT_SECRET = 's3cret-test';
  const realFetch = global.fetch; let sent;
  global.fetch = async (url, init) => { sent = { url, init }; return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
  try {
    const res = await callLog({ box: 'qualifications', query: 'Power BI', result: 'YES', matched: 2, total: 50, referrer: '' }, { headers: { origin: 'https://x.test', 'user-agent': 'Mozilla/5.0 secret-ua', 'x-forwarded-for': '203.0.113.7' } });
    assert.equal(res.statusCode, 204);
    const payload = JSON.parse(sent.init.body);
    assert.equal(payload.type, 'search'); assert.equal(payload.token, 's3cret-test'); assert.equal(payload.query, 'Power BI');
    const flat = JSON.stringify(payload) + JSON.stringify(sent.init.headers);
    assert.ok(!/203\.0\.113\.7|secret-ua|Mozilla/.test(flat), 'no IP or user agent forwarded');
    global.fetch = async () => { throw Object.assign(new Error('boom'), { name: 'AbortError' }); };
    const bad = await callLog({ box: 'matcher', query: 'x1', result: 'YES' });
    assert.equal(bad.statusCode, 502); // the browser ignores this: fire-and-forget
    assert.equal((await callLog({ box: 'matcher', query: 'x1', result: 'YES' }, { headers: { origin: 'https://evil.test' } })).statusCode, 403);
    assert.equal((await callLog({}, { method: 'GET' })).statusCode, 405);
    assert.equal((await callLog({ query: '' })).statusCode, 400);
    delete process.env.APPS_SCRIPT_SECRET;
    assert.equal((await callLog({ box: 'matcher', query: 'x1', result: 'YES' })).statusCode, 503);
  } finally { global.fetch = realFetch; }
});

test('/api/log-search: per-IP in-memory rate limit', async () => {
  process.env.APPS_SCRIPT_URL = 'https://script.example/exec'; process.env.APPS_SCRIPT_SECRET = 'x';
  const realFetch = global.fetch; global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
  try {
    const handler = require(path.join(root, 'api', 'log-search.js'));
    let limited = 0;
    for (let i = 0; i < 60; i++) {
      const res = fakeRes();
      await handler({ method: 'POST', headers: { host: 'x.test', 'x-forwarded-for': '198.51.100.9' }, body: { box: 'matcher', query: 'q' + i, result: 'YES' }, socket: {} }, res);
      if (res.statusCode === 429) limited++;
    }
    assert.ok(limited >= 15, 'limited ' + limited);
  } finally { global.fetch = realFetch; }
});

test('cold-start fix: 25s upstream timeout and 30s maxDuration for both endpoints', () => {
  const vj = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.ok(vj.functions['api/*.js'].maxDuration >= 30);
  for (const f of ['request-resume.js', 'log-search.js']) {
    const src = fs.readFileSync(path.join(root, 'api', f), 'utf8');
    assert.match(src, /UPSTREAM_TIMEOUT_MS = 25000/);
    assert.ok(!/abort\(\), 9000/.test(src));
  }
});

test('Web Analytics: first-party script tag, and the CSP already allows it and its beacon', () => {
  assert.match(html, /<script defer src="\/_vercel\/insights\/script\.js"><\/script>/);
  const vj = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const csp = vj.headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value;
  assert.match(csp, /script-src 'self'(;|$)/); // /_vercel/insights/script.js is same-origin
  assert.match(csp, /connect-src 'self'(;|$)/); // the beacon posts to /_vercel/insights/view on this origin
  assert.ok(!/unsafe-inline|unsafe-eval|https?:\/\//.test(csp.replace(/frame-ancestors[^;]*/, '')), 'CSP stays strict');
  assert.ok(!/\bwindow\.va\b|<script>[^<]/.test(html.split('<body')[1] || ''), 'no inline script needed');
});

test('privacy: honest copy about logging, no stale "nothing is sent" claims', () => {
  assert.match(html, /Searches on this page are logged anonymously to help Ben improve it\./);
  assert.ok(!/Nothing you type is sent anywhere|entirely in your browser|No analytics, no cookies/.test(html));
  assert.match(html, /Vercel Web Analytics, which sets no cookies/);
  assert.ok(html.indexOf('privacy-note') < html.indexOf('id="experience"'), 'note sits in the matcher section');
});

test('client logging: debounced, anonymous, never breaks the UI', () => {
  const src = fs.readFileSync(path.join(root, 'search-log.js'), 'utf8');
  assert.match(src, /sendBeacon/);
  assert.match(src, /DEBOUNCE_MS = 1500/);
  assert.match(src, /QUERY_MAX = 200/);
  assert.ok(!/userAgent|navigator\.language|localStorage|document\.cookie/.test(src), 'no fingerprinting or storage');
  assert.match(html, /<script src="\/search-log\.js"><\/script>\s*<script src="\/app\.js"><\/script>/);
  assert.match(appJs, /logSearch\('log'/); assert.match(appJs, /logSearch\('schedule'/);
  assert.ok(!/fetch\(/.test(appJs), 'app.js itself still does not fetch');
});

test('matcher lede explains YES, YES, BUT, and NOT YET', () => {
  assert.match(html, /striped green/);
  assert.match(html, /YES, BUT/);
  assert.match(html, /NOT YET/);
});

test('YES, BUT uses diagonal green stripes on the badge and card, with readable contrast', () => {
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  assert.match(css, /\.status\.partial \{[^}]*repeating-linear-gradient\(135deg/);
  assert.match(css, /\.result\.partial[^{]*\{[^}]*repeating-linear-gradient\(135deg/);
  assert.match(css, /--partial-stripe/);
  assert.match(css, /\.status\.partial \{[^}]*color: var\(--yes-ink\)/);
});

