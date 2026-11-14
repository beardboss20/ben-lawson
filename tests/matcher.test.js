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
no('LMS admin', /LMS administrator/);        // tricky: has LMS, not admin
no('LMS administration experience', /administrator/);
no('SQL', /SQL/);
no('SHRM-CP', /SHRM|ATD/);
no('HR Business Partner', /Not yet/);        // generalist role: gaps listed
no('Director of Learning', /director/);
no('VP of People', /director level or above/);
no('Salesforce admin');
no('3 years Power BI', /doesn.t say how many years/);
no('5 years of generative AI', /about 2 years/);

test('HRIS result is honest about scope', () => {
  const r = one('HRIS');
  assert.ok(r.evidence.some((e) => e.caveat && /doesn.t claim HRIS administration/.test(e.caveat)));
});
test('HRIS administration is a NOT YET even though HRIS matches', () => {
  assert.equal(one('HRIS administration').verdict, 'no');
});
test('summary line counts matches', () => {
  const r = m.check('HRIS, L&D, SQL, 8+ years HR, change management, LMS admin, Power BI, AI enablement');
  assert.equal(r.total, 8);
  assert.equal(r.yes, 5);
  assert.equal(r.summary, '5 of 8 matched');
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
