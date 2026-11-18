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

const YEARS_IN_SUGGESTION = /\b(?:\d+\+?|(?:one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty)(?:\s+plus)?)\s+years?\b/i;

test('example searches have no years counts and each one is a full YES', () => {
  const examples = read('profile').examples;
  assert.equal(examples.length, 4);
  for (const q of examples) {
    assert.ok(!YEARS_IN_SUGGESTION.test(q), 'example should not suggest a years count: ' + q);
    const r = m.check(q);
    assert.equal(r.partial, 0, q + ' should not be YES, BUT: ' + r.summary);
    assert.equal(r.yes, r.total, q + ' -> ' + r.summary);
    assert.ok(r.items.every((i) => i.verdict === 'yes' && i.headline === 'YES'), q);
  }
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
yes('L&D Specialist');            // fully covered title
yes('AI workshops');              // skill, not the AI Enablement Lead title
yes('instructional design');
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
  assert.equal(r.yes, 5);
  assert.equal(r.partial, 1);
  assert.equal(r.summary, '6 of 8 matched, 1 with gap');
  assert.equal(r.overall, 'no');
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

test('Airbus ops bullet: titles. Specialist is YES; Manager is YES, BUT with the direct-reports note; Director stays NOT YET', () => {
  assert.equal(one('Learning Operations Specialist').verdict, 'yes');
  const mgr = one('L&D Operations Manager');
  assert.equal(mgr.verdict, 'partial');
  assert.equal(mgr.headline, 'YES, BUT');
  assert.match(mgr.note, /Yes, but not yet: Managing direct reports/);
  assert.equal(one('Learning Operations Manager').verdict, 'partial');
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

// --- Recruiter search synonyms (Nov 2026; engagement survey analysis confirmed by Ben) ---
yes('xAI');
yes('RLHF');
yes('reinforcement learning from human feedback');
yes('human-in-the-loop');
yes('HITL');
yes('annotation');
yes('data annotation');
yes('RLHF Specialist');
yes('Aerospace');
yes('exit interviews');
yes('qualitative analysis');
yes('quantitative analysis');
yes('sentiment analysis');
yes('data storytelling');
yes('KPI tracking');
yes('reskilling');
yes('workforce development specialist');
yes('workforce development partner');
yes('workforce development');
yes('Employee engagement');
yes('engagement survey');
yes('employee engagement survey');
yes('employee engagement survey analysis');
yes('biannual engagement survey');
yes('bi-annual engagement survey');
no('ADDIE');
no('red-teaming');
no('SAM');
no('defense');
no('talent acquisition', /talent acquisition|Recruiting/);
no('responsible AI', /governance|Responsible/);
no('AI governance', /governance/);

test('xAI / RLHF searches show Grok training evidence', () => {
  for (const q of ['xAI', 'RLHF', 'human-in-the-loop', 'HITL', 'data annotation']) {
    const r = one(q);
    assert.equal(r.verdict, 'yes', q);
    assert.ok(r.matchedSkills.includes('ai-evaluation'), q + ' -> ' + r.matchedSkills);
    assert.ok(r.evidence.some((e) => /Grok/.test(e.text)), q + ' should quote Grok training');
  }
  const title = one('RLHF Specialist');
  assert.equal(title.verdict, 'yes');
  assert.ok(title.breakdown || title.matchedSkills.includes('ai-evaluation'));
});

test('aerospace matches HR experience via Airbus, and defense stays unmatched', () => {
  const r = one('aerospace');
  assert.equal(r.verdict, 'yes');
  assert.ok(r.matchedSkills.includes('hr-experience'));
  assert.ok(r.evidence.some((e) => /Airbus/.test(e.text)));
  assert.equal(one('defense').verdict, 'no');
  assert.equal(one('Defense').verdict, 'no');
});

test('engagement survey searches match the engagement skill with confirmed-by-Ben evidence, not just generic survey design', () => {
  for (const q of ['Employee engagement', 'engagement survey', 'employee engagement survey', 'employee engagement survey analysis', 'biannual engagement survey', 'bi-annual engagement survey', 'bi annual engagement survey']) {
    const r = one(q);
    assert.equal(r.verdict, 'yes', q);
    assert.ok(r.matchedSkills.includes('engagement-survey'), q + ' -> ' + r.matchedSkills);
  }
  const r = one('Employee engagement');
  assert.ok(r.evidence.some((e) => e.source === 'confirmed' && e.text === 'Analyzed the bi-annual employee engagement survey at Bank of the West.'));
  const skill = data.skills.skills.find((s) => s.id === 'engagement-survey');
  assert.ok(skill);
  assert.equal(skill.category, 'analytics');
  assert.ok(skill.evidence.every((e) => e.source === 'confirmed'));
  assert.ok(!skill.evidence.some((e) => e.source === 'resume'));
});

// --- Turnover modeling is a gap; Gemini Enterprise rollout is YES, department-scoped (Nov 2026) ---
yes('turnover');
yes('turnover reduction');
yes('retention');
yes('attrition');
no('turnover modeling', /predictive turnover models/);
no('turnover model', /predictive turnover models/);
no('turnover modelling', /predictive turnover models/);
no('attrition modeling', /predictive turnover models/);
no('predictive attrition', /predictive turnover models/);
yes('Gemini Enterprise');
yes('Gemini Enterprise rollout');

test('turnover and retention stay YES, but predictive modeling phrases are NOT YET with the honest note', () => {
  for (const q of ['turnover', 'turnover reduction', 'retention', 'employee retention']) {
    assert.equal(one(q).verdict, 'yes', q);
    assert.ok(one(q).matchedSkills.includes('retention-turnover'), q);
  }
  for (const q of ['turnover modeling', 'turnover model', 'attrition modeling', 'predictive attrition']) {
    const r = one(q);
    assert.equal(r.verdict, 'no', q);
    assert.equal(r.headline, 'NOT YET');
    assert.match(r.note, /hasn't built predictive turnover models/);
    assert.match(r.note, /contributed to turnover reduction/);
  }
  const gap = data.gaps.gaps.find((g) => g.id === 'turnover-modeling');
  assert.ok(gap);
  assert.ok(!/entire org|company-wide|org-wide/.test(gap.note));
});

test('Gemini Enterprise is YES with department-scoped confirmed evidence, not an org-wide claim', () => {
  for (const q of ['Gemini Enterprise', 'Gemini Enterprise rollout']) {
    const r = one(q);
    assert.equal(r.verdict, 'yes', q);
    assert.ok(r.matchedSkills.includes('ai-enablement'), q + ' -> ' + r.matchedSkills);
    assert.ok(r.evidence.some((e) => e.source === 'confirmed' && e.text === 'Gemini Ambassador at Airbus, helping roll out Gemini Enterprise in his department and team, including a hands-on workshop.'), q);
    assert.ok(!r.evidence.some((e) => /entire org|company-wide|org-wide|whole (company|organization|org)/i.test(e.text)), q);
  }
  const skill = data.skills.skills.find((s) => s.id === 'ai-enablement');
  assert.ok(skill.synonyms.includes('gemini enterprise') && skill.synonyms.includes('gemini enterprise rollout'));
  assert.ok(!skill.evidence.some((e) => /entire org|company-wide|org-wide|whole (company|organization|org)/i.test(e.text)));
  assert.equal(one('Gemini').verdict, 'yes');
});

// --- Plain "analytics" and related people-analytics synonyms (Nov 2026) ---
yes('analytics');
yes('data analytics');
yes('hr analytics');
yes('data analysis');
yes('analytical skills');
yes('reporting and analytics');
no('predictive analytics', /predictive analytics|statistical modeling/);
no('web analytics', /domain-specific analytics|people analytics/);
no('marketing analytics', /domain-specific analytics|people analytics/);
yes('learning analytics');
yes('training analytics');
yes('learning measurement');
yes('survey analytics');

test('plain analytics is people analytics YES, with Power BI and survey evidence, and domain analytics stay NOT YET', () => {
  for (const q of ['analytics', 'Analytics', 'data analytics', 'analytical skills', 'reporting and analytics', 'survey analytics', 'hr analytics', 'workforce analytics', 'retention analytics']) {
    const r = one(q);
    assert.equal(r.verdict, 'yes', q);
    assert.ok(r.matchedSkills.includes('people-analytics'), q + ' -> ' + r.matchedSkills);
  }
  const r = one('analytics');
  assert.ok(r.evidence.some((e) => /People Analytics & Retention Insights/.test(e.text) || /retention reporting/.test(e.text) || /Power BI retention dashboards/.test(e.text)));
  const da = one('data analysis');
  assert.equal(da.verdict, 'yes');
  assert.ok(da.matchedSkills.includes('people-analytics'), 'data analysis -> ' + da.matchedSkills);
  for (const q of ['predictive analytics', 'turnover modeling', 'web analytics', 'marketing analytics', 'business analytics', 'product analytics', 'customer analytics', 'digital analytics', 'finance analytics', 'financial analytics', 'advanced analytics', 'self-service analytics', 'sales analytics', 'supply chain analytics', 'operations analytics', 'risk analytics', 'healthcare analytics', 'social media analytics', 'google analytics']) {
    assert.equal(one(q).verdict, 'no', q + ' should stay NOT YET, got ' + one(q).note);
  }
  assert.equal(one('turnover').verdict, 'yes');
  assert.equal(one('HR analytics').verdict, 'yes');
  const paTitle = one('people analytics');
  assert.equal(paTitle.verdict, 'partial');
  assert.equal(paTitle.headline, 'YES, BUT');
});

test('learning analytics and training analytics are YES on evaluating learning impact, not the domain-analytics gap', () => {
  for (const q of ['learning analytics', 'training analytics', 'learning measurement']) {
    const r = one(q);
    assert.equal(r.verdict, 'yes', q);
    assert.ok(r.matchedSkills.includes('learning-evaluation'), q + ' -> ' + r.matchedSkills);
    assert.ok(r.evidence.some((e) => /Evaluating Learning Impact/.test(e.text)), q);
  }
  const gap = data.gaps.gaps.find((g) => g.id === 'other-analytics');
  assert.ok(gap);
  assert.ok(!gap.synonyms.includes('learning analytics'));
  assert.ok(!gap.synonyms.includes('training analytics'));
});

// --- Title-only YES, BUT (partial) status (Nov 2026) ---
test('L&D Manager is YES, BUT: passes the threshold but is missing direct reports', () => {
  const r = one('L&D Manager');
  assert.equal(r.verdict, 'partial');
  assert.equal(r.headline, 'YES, BUT');
  assert.match(r.note, /^Yes, but not yet: Managing direct reports\./);
  assert.match(r.note, /Ben covers 11 of 12 areas this role usually needs/);
  assert.match(r.note, /specialist and product owner/);
  assert.ok(r.evidence.length >= 1);
});

test('a fully covered title is solid YES, and a below-threshold title stays NOT YET', () => {
  const yesTitle = one('L&D Specialist');
  assert.equal(yesTitle.verdict, 'yes');
  assert.equal(yesTitle.headline, 'YES');
  assert.match(yesTitle.note, /Ben covers 9 of 9 areas this role usually needs/);
  assert.ok(!/Yes, but not yet/.test(yesTitle.note));
  const noTitle = one('HR Business Partner');
  assert.equal(noTitle.verdict, 'no');
  assert.equal(noTitle.headline, 'NOT YET');
  assert.match(noTitle.note, /Ben covers 8 of 11 areas this role usually needs/);
  assert.ok(!/^Yes, but not yet/.test(noTitle.note));
});

test('single skills stay binary YES or NOT YET, never YES, BUT', () => {
  assert.equal(one('HRIS').verdict, 'yes');
  assert.equal(one('AI workshops').verdict, 'yes');
  assert.equal(one('SQL').verdict, 'no');
  assert.equal(one('analytics').verdict, 'yes');
  assert.notEqual(one('HRIS').verdict, 'partial');
  assert.notEqual(one('SQL').verdict, 'partial');
});

test('a list of only YES, BUT titles gets a striped overall summary, and mixed lists stay honest', () => {
  const allPartial = m.check('L&D Manager');
  assert.equal(allPartial.yes, 0);
  assert.equal(allPartial.partial, 1);
  assert.equal(allPartial.overall, 'partial');
  assert.equal(allPartial.summary, '1 of 1 matched, 1 with gap');
  assert.match(allPartial.tone, /gap noted below/);
  const mixed = m.check('L&D Specialist, L&D Manager');
  assert.equal(mixed.yes, 1);
  assert.equal(mixed.partial, 1);
  assert.equal(mixed.overall, 'partial');
  assert.equal(mixed.summary, '2 of 2 matched, 1 with gap');
  const withNo = m.check('L&D Manager, SQL');
  assert.equal(withNo.partial, 1);
  assert.equal(withNo.overall, 'no');
  assert.match(withNo.summary, /2 of 2 matched, 1 with gap|1 of 2 matched, 1 with gap/);
  // SQL is no, L&D Manager is partial: matched = 1 of 2
  assert.equal(withNo.summary, '1 of 2 matched, 1 with gap');
  assert.equal(withNo.tone.startsWith('A strong start'), true);
});
