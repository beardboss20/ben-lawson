'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createMatcher, splitRequirements, extractYears } = require('../matcher.js');

const read = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', n + '.json'), 'utf8'));
const data = { skills: read('skills'), titles: read('titles'), gaps: read('gaps') };
const m = createMatcher(data);
const one = (q) => m.check(q).items[0];

// --- data integrity ---
test('every skill has evidence, synonyms, a valid category and honest years', () => {
  const cats = new Set(data.skills.categories.map((c) => c.id));
  const ids = new Set();
  for (const s of data.skills.skills) {
    assert.ok(!ids.has(s.id), 'duplicate id ' + s.id); ids.add(s.id);
    assert.ok(cats.has(s.category), s.id + ' category');
    assert.ok(s.evidence.length >= 1, s.id + ' evidence');
    assert.ok(s.synonyms.length >= 1, s.id + ' synonyms');
    for (const e of s.evidence) assert.ok(['resume', 'confirmed'].includes(e.source), s.id + ' source');
    assert.ok(s.years === null || typeof s.years === 'number');
  }
  for (const t of data.titles.titles) for (const id of t.core) assert.ok(ids.has(id), t.id + ' -> ' + id);
});

test('no claim of 8+ years or a capitalized program name anywhere in the data', () => {
  const profile = read('profile'); delete profile.examples; // examples are recruiter-style queries, not claims
  const blob = JSON.stringify(data) + JSON.stringify(profile);
  assert.ok(!/\b(8|eight)\s*\+?\s*(plus\s*)?years/i.test(blob.replace(/Asked for/g, '')));
  assert.ok(!/Leadership Development Program/.test(blob), 'program name must stay lowercase');
  assert.ok(!/\bAgile (leadership|program)/i.test(blob));
});

// --- parsing ---
test('splits commas, new lines and bullets, but not commas inside parentheses', () => {
  assert.deepEqual(splitRequirements('HRIS, Power BI\n- change management\n\u2022 L&D (training, learning)'), ['HRIS', 'Power BI', 'change management', 'L&D (training, learning)']);
});
test('parses years in digits and words', () => {
  assert.equal(extractYears('8+ years HR').years, 8);
  assert.equal(extractYears('seven plus years of HR').years, 7);
  assert.equal(extractYears('5-7 yrs L&D').years, 5);
});

// --- ~15+ sample queries, including the tricky ones ---
const yes = (q) => test('YES: ' + q, () => { const r = one(q); assert.equal(r.verdict, 'yes', q + ' -> ' + r.note); assert.ok(r.headline === 'YES'); assert.ok(r.evidence.length >= 1, 'has proof'); });
const no = (q, re) => test('NOT YET: ' + q, () => { const r = one(q); assert.equal(r.verdict, 'no', q); assert.equal(r.headline, 'NOT YET'); if (re) assert.match(r.note, re); assert.ok(r.note.length > 10, 'has a note'); });

yes('HRIS');                      // synonym: Workday, people systems
yes('Workday');
yes('people systems');
yes('L&D');
yes('learning programs');         // L&D synonym
yes('instructional design');
yes('Articulate 360');
yes('change management');
yes('Power BI dashboards');
yes('generative AI');
yes('ERG leadership');
yes('OFAC sanctions');
yes('exit survey');
yes('5 years of L&D experience');  // 5 <= 7+
yes('seven plus years');
yes('L&D Manager');               // title -> skill set
yes('AI enablement');             // title -> skill set
yes('Instructional Designer');
no('8+ years HR', /8\+ years.*7\+ years/);   // tricky: years above 7+
no('10 years of L&D', /10\+ years/);
yes('LMS admin');                 // confirmed by Ben
yes('LMS administrator');
yes('Cornerstone');
yes('course uploads and enrollments');
yes('learning platform admin');
yes('prompt engineering');        // confirmed by Ben
yes('prompting');
yes('LLM prompts');
yes('generative AI prompts');
yes('3 years of LMS administration experience'.replace('3 years of ', ''));
no('HRIS admin', /HRIS/);          // tricky: HRIS yes, HRIS admin still NOT YET
no('Workday HCM', /HRIS|HCM/);
no('SQL', /SQL/);
no('SHRM-CP', /SHRM|ATD/);
no('HR Business Partner', /Not yet/);        // generalist role: gaps listed
no('Director of Learning', /director/);
no('VP of People', /director level or above/);
no('Salesforce admin');
no('3 years Power BI', /doesn.t say how many years/);
no('5 years of generative AI', /about 2 years/);

test('HRIS result is honest about scope and does not contradict LMS admin', () => {
  const r = one('HRIS');
  const caveat = r.evidence.map((e) => e.caveat).filter(Boolean).join(' ');
  assert.match(caveat, /Core HRIS or HCM administration isn.t claimed/);
  assert.ok(!/doesn.t claim (LMS|HRIS administration)/i.test(caveat));
});
test('LMS admin and prompt engineering are YES with a Confirmed by Ben line plus related resume proof', () => {
  const lms = one('LMS admin');
  assert.ok(lms.evidence.some((e) => e.source === 'confirmed'));
  assert.ok(lms.evidence.some((e) => e.source === 'resume' && /Workday Learning & Cornerstone/.test(e.text)));
  const pe = one('prompt engineering');
  assert.ok(pe.evidence.some((e) => e.source === 'confirmed'));
  assert.ok(pe.evidence.some((e) => e.source === 'resume' && /Grok/.test(e.text)));
});
test('LMS admin and prompt engineering are no longer listed as gaps', () => {
  const blob = JSON.stringify(data.gaps).toLowerCase();
  assert.ok(!/lms admin/.test(blob) && !/prompt engineering/.test(blob));
});
test('LMS admin with years but no stated years is NOT YET, with the honest note', () => {
  assert.match(one('5 years LMS admin').note, /doesn.t say how many years/);
});
test('HRIS administration is a NOT YET even though HRIS matches', () => {
  assert.equal(one('HRIS administration').verdict, 'no');
});
test('summary line counts matches', () => {
  const r = m.check('HRIS, L&D, SQL, 8+ years HR, change management, LMS admin, Power BI, AI enablement');
  assert.equal(r.total, 8);
  assert.equal(r.yes, 6);
  assert.equal(r.summary, '6 of 8 matched');
});
test('empty input gives no results; long input is capped', () => {
  assert.equal(m.check('   ').total, 0);
  assert.ok(m.check(Array.from({ length: 80 }, (_, i) => 'item ' + i).join(', ')).total <= 30);
});
test('title with years above 7 is NOT YET', () => {
  assert.equal(one('10+ years L&D Manager').verdict, 'no');
});
test('qualification search and category filter', () => {
  assert.ok(m.searchSkills('power bi').some((s) => s.id === 'power-bi'));
  assert.ok(m.searchSkills('', 'risk').every((s) => s.category === 'risk'));
  assert.equal(m.searchSkills('zzzzqqq').length, 0);
});

// --- Airbus learning operations bullet (resume change, Nov 2026) ---
const AIRBUS_OPS = "Defined Airbus's US learning operations framework as part of a three-person SME team, setting standards for learning intake, needs assessment, assignment governance, annual calendars, and SCORM content structure.";
const OPS_SKILLS = ['learning-ops', 'learning-ops-framework', 'learning-intake', 'needs-assessment', 'assignment-governance', 'learning-calendar', 'scorm', 'sme'];

test('Airbus ops bullet: exact text on the site and no leftover "founding members" wording anywhere', () => {
  const profile = read('profile');
  const airbus = profile.experience.find((e) => /Airbus/.test(e.org));
  assert.ok(airbus.bullets.includes(AIRBUS_OPS));
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(html.includes('<li>' + AIRBUS_OPS + '</li>'), "'Airbus's' must appear exactly as written");
  assert.ok(!/founding members|org-wide standards|enterprise learning operations|request and approval rights/i.test(html));
});

test('Airbus ops bullet: every new skill quotes it as resume evidence', () => {
  for (const id of OPS_SKILLS) {
    const s = data.skills.skills.find((x) => x.id === id);
    assert.ok(s, id + ' exists');
    assert.ok(s.evidence.some((e) => e.source === 'resume' && e.text === AIRBUS_OPS), id + ' quotes the bullet');
  }
});

test('Airbus ops bullet: SCORM, needs assessment, learning operations (and friends) are YES', () => {
  for (const q of ['SCORM', 'needs assessment', 'learning operations', 'learning ops', 'L&D operations', 'learning operations framework', 'learning governance', 'learning standards',
    'learning intake', 'intake process', 'training request intake', 'TNA', 'training needs analysis', 'needs analysis', 'assignment governance', 'training assignment governance', 'LMS assignment rules',
    'annual learning calendar', 'training calendar', 'learning calendar planning', 'SCORM content', 'e-learning standards', 'content structure', 'SME', 'subject matter expert']) {
    assert.equal(one(q).verdict, 'yes', q);
  }
});

test('Airbus ops bullet: titles. Specialist is YES; Manager is YES with the direct-reports note; Director stays NOT YET', () => {
  assert.equal(one('Learning Operations Specialist').verdict, 'yes');
  const mgr = one('L&D Operations Manager');
  assert.equal(mgr.verdict, 'yes');
  assert.match(mgr.note, /Managing direct reports/);
  assert.equal(one('Learning Operations Manager').verdict, 'yes');
  assert.equal(one('Director of Learning Operations').verdict, 'no');
});

test('Airbus ops bullet: no overclaiming. Authoring SCORM or other tools stays NOT YET, and the SCORM caveat is honest', () => {
  assert.equal(one('author SCORM courses in Storyline').verdict, 'no');
  assert.equal(one('Storyline').verdict, 'no');
  const scorm = data.skills.skills.find((s) => s.id === 'scorm');
  assert.match(scorm.caveat, /does not say he authored SCORM courses/);
  assert.ok(!/authored|built SCORM|SCORM courses (in|with)/i.test(JSON.stringify(scorm.evidence)));
  const gapIds = new Set(data.gaps.gaps.map((g) => g.id));
  for (const id of ['scorm', 'needs-assessment', 'learning-ops']) assert.ok(!gapIds.has(id), id + ' must not be listed as a gap');
});
