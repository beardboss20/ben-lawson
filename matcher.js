/*
 * Ben Lawson - requirement matcher.
 * Browser-only, no network, no AI. Keyword and phrase matching against
 * data/skills.json, data/titles.json and data/gaps.json.
 * Works in the browser (global `BenMatcher`) and in Node (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BenMatcher = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20 };
  var FILLER = new Set(['experience', 'of', 'in', 'with', 'minimum', 'at', 'least', 'required', 'preferred', 'plus', 'working', 'proven', 'track', 'record', 'strong', 'demonstrated', 'background', 'the', 'a', 'an', 'and', 'or', 'work', 'professional', 'hands', 'on', 'knowledge', 'understanding', 'proficiency', 'skill', 'ability', 'using', 'within', 'as', 'for', 'to', 'good', 'excellent', 'solid', 'years', 'year', 'yr', 'yrs', 'relevant', 'related', 'practical', 'prior', 'previous', 'extensive', 'deep', 'expertise', 'expert', 'familiarity', 'must', 'have', 'nice', 'bonus']);
  var SENIORITY = /\b(director|vp|vice president|head of|chief|svp|evp|avp)\b/i;
  var MAX_REQUIREMENTS = 30;
  var MAX_LENGTH = 160;

  function stem(t) {
    if (t.length > 3 && t.charAt(t.length - 1) === 's' && !/(ss|us|is)$/.test(t)) return t.slice(0, -1);
    return t;
  }

  function tokenize(s) {
    var x = String(s).toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[\u2019']/g, '')
      .replace(/[^a-z0-9+#\s]/g, ' ');
    return x.split(/\s+/).filter(Boolean).map(stem);
  }

  function splitRequirements(text) {
    var cleaned = String(text || '').replace(/\r/g, '\n');
    var parts = [];
    var buf = '';
    var depth = 0;
    for (var i = 0; i < cleaned.length; i++) {
      var ch = cleaned.charAt(i);
      if (ch === '(') depth++;
      if (ch === ')' && depth > 0) depth--;
      if (depth === 0 && (ch === ',' || ch === ';' || ch === '\n' || ch === '\u2022' || ch === '\u00b7' || ch === '|')) {
        parts.push(buf); buf = '';
      } else buf += ch;
    }
    parts.push(buf);
    var seen = new Set();
    var out = [];
    parts.forEach(function (p) {
      var t = p.replace(/^[\s\-*\u2013\u2014\u25aa\u25cf\u2022\d.)]+(?=[A-Za-z(])/, '').replace(/\s+/g, ' ').trim();
      if (/^\d+\+?\s*(years?|yrs?)/i.test(p.trim())) t = p.replace(/\s+/g, ' ').trim();
      if (!t || t.length < 2) return;
      if (t.length > MAX_LENGTH) t = t.slice(0, MAX_LENGTH).trim();
      var key = t.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(t);
    });
    return out.slice(0, MAX_REQUIREMENTS);
  }

  function extractYears(raw) {
    var s = String(raw).replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty)\b(?=\s*(?:\+|plus|-|to|\s)\s*\+?\s*(?:\d+\s*)?(?:years?|yrs?))/gi, function (w) { return String(NUMBER_WORDS[w.toLowerCase()]); });
    var re = /(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|\u2013|to)\s*(\d{1,2})\s*\+?\s*)?(?:years?|yrs?)\b/i;
    var m = re.exec(s);
    if (!m) return { years: null, rest: raw };
    var n = parseInt(m[1], 10);
    var rest = (s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
    return { years: n, rest: rest };
  }

  function createMatcher(data) {
    var skills = data.skills.skills;
    var categories = data.skills.categories;
    var titles = data.titles.titles;
    var gaps = data.gaps.gaps;
    var skillById = {};
    skills.forEach(function (s) { skillById[s.id] = s; });
    var gapById = {};
    gaps.forEach(function (g) { gapById[g.id] = g; });
    var catById = {};
    categories.forEach(function (c) { catById[c.id] = c; });

    var entries = [];
    function addTerms(kind, obj, terms) {
      var seen = new Set();
      terms.forEach(function (t) {
        var toks = tokenize(t);
        if (!toks.length) return;
        var key = toks.join(' ');
        if (seen.has(key)) return;
        seen.add(key);
        entries.push({ kind: kind, id: obj.id, tokens: toks });
      });
    }
    skills.forEach(function (s) { addTerms('skill', s, [s.name].concat(s.synonyms || [])); });
    titles.forEach(function (t) { addTerms('title', t, [t.name].concat(t.aliases || [])); });
    gaps.forEach(function (g) { addTerms('gap', g, [g.name].concat(g.synonyms || [])); });
    var KIND_RANK = { gap: 0, title: 1, skill: 2 };

    function findSpans(tokens) {
      var cands = [];
      entries.forEach(function (e) {
        var n = e.tokens.length;
        for (var i = 0; i + n <= tokens.length; i++) {
          var ok = true;
          for (var j = 0; j < n; j++) { if (tokens[i + j] !== e.tokens[j]) { ok = false; break; } }
          if (ok) cands.push({ kind: e.kind, id: e.id, start: i, end: i + n, len: n });
        }
      });
      cands.sort(function (a, b) { return b.len - a.len || KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.start - b.start; });
      var used = new Array(tokens.length).fill(false);
      var accepted = [];
      cands.forEach(function (c) {
        for (var i = c.start; i < c.end; i++) if (used[i]) return;
        for (var k = c.start; k < c.end; k++) used[k] = true;
        accepted.push(c);
      });
      accepted.sort(function (a, b) { return a.start - b.start; });
      return { accepted: accepted, used: used };
    }

    function evidenceFor(skill) {
      return skill.evidence.map(function (e) { return { skill: skill.name, text: e.text, source: e.source, caveat: skill.caveat || null }; });
    }
    function uniqueById(list) {
      var seen = {};
      return list.filter(function (x) { if (seen[x]) return false; seen[x] = true; return true; });
    }

    function yearsLabel(skillIds) {
      var best = null;
      skillIds.forEach(function (id) {
        var s = skillById[id];
        if (s && typeof s.years === 'number' && (best === null || s.years > best.years)) best = s;
      });
      return best;
    }

    function evaluateTitle(title) {
      var have = title.core.map(function (id) { return skillById[id]; }).filter(Boolean);
      var missing = (title.gaps || []).map(function (id) { return gapById[id]; }).filter(Boolean);
      var total = have.length + missing.length;
      var threshold = typeof title.threshold === 'number' ? title.threshold : 0.75;
      var ratio = total ? have.length / total : 0;
      return { title: title, have: have, missing: missing, total: total, ratio: ratio, pass: ratio >= threshold };
    }

    function checkOne(raw) {
      var yr = extractYears(raw);
      var tokens = tokenize(yr.rest);
      var spans = findSpans(tokens.length ? tokens : tokenize(raw));
      if (!tokens.length) { spans = { accepted: [], used: [] }; }
      var accepted = spans.accepted;
      var gapHits = uniqueById(accepted.filter(function (a) { return a.kind === 'gap'; }).map(function (a) { return a.id; }));
      var titleHits = uniqueById(accepted.filter(function (a) { return a.kind === 'title'; }).map(function (a) { return a.id; }));
      var skillHits = uniqueById(accepted.filter(function (a) { return a.kind === 'skill'; }).map(function (a) { return a.id; }));

      // A years-only requirement ("8+ years experience") means overall HR experience.
      var meaningful = tokens.filter(function (t) { return !FILLER.has(t); });
      var generic = false;
      if (yr.years !== null && !accepted.length && meaningful.length === 0) { skillHits = ['hr-experience']; generic = true; }
      if (yr.years !== null && !accepted.length && !generic && /\b(hr|human resources)\b/i.test(yr.rest)) { skillHits = ['hr-experience']; }

      var item = { input: raw, verdict: 'no', headline: 'NOT YET', note: '', evidence: [], breakdown: null, matchedSkills: [], years: yr.years };

      // 1) Known gaps always win: be honest.
      if (gapHits.length) {
        var gnotes = gapHits.map(function (id) { return gapById[id].note; });
        item.note = gnotes.join(' ');
        var related = skillHits.map(function (id) { return skillById[id]; }).filter(Boolean);
        if (related.length) {
          item.note += ' What he does have here: ' + related.map(function (s) { return s.name; }).join(', ') + '.';
          item.evidence = [].concat.apply([], related.slice(0, 2).map(evidenceFor)).slice(0, 2);
        }
        item.gaps = gapHits;
        return item;
      }

      // 1b) Director level and above: be honest about level, whatever the skills.
      if (SENIORITY.test(raw)) {
        var sk = skillHits.map(function (id) { return skillById[id]; }).filter(Boolean);
        var tt = titleHits.length ? evaluateTitle(titles.filter(function (t) { return t.id === titleHits[0]; })[0]) : null;
        item.note = 'Ben\u2019s roles so far have been specialist and product owner level, not director level or above.';
        if (tt) item.note = 'Ben\u2019s skills line up with ' + tt.title.name + ' work (' + tt.have.length + ' of ' + tt.total + ' areas). ' + item.note;
        else if (sk.length) item.note += ' The skills here are ones he has: ' + sk.map(function (s) { return s.name; }).join(', ') + '.';
        item.matchedSkills = skillHits.slice();
        return item;
      }

      // 2) Job titles: score the skill set that title usually needs.
      if (titleHits.length) {
        var evals = titleHits.map(function (id) { return evaluateTitle(titles.filter(function (t) { return t.id === id; })[0]); });
        var allPass = evals.every(function (e) { return e.pass; });
        var top = evals[0];
        item.breakdown = evals.map(function (e) {
          return { title: e.title.name, haveCount: e.have.length, total: e.total, have: e.have.map(function (s) { return s.name; }), missing: e.missing.map(function (g) { return { name: g.name, note: g.note }; }) };
        });
        item.matchedSkills = uniqueById([].concat.apply([], evals.map(function (e) { return e.have.map(function (s) { return s.id; }); })));
        if (SENIORITY.test(raw)) {
          item.verdict = 'no';
          item.note = 'Ben\u2019s skills line up with ' + top.title.name + ' work (' + top.have.length + ' of ' + top.total + ' areas), but his roles so far have been specialist and product owner level, not director level or above.';
          return item;
        }
        if (yr.years !== null) {
          var yl = yearsLabel(item.matchedSkills);
          if (yl && yr.years > yl.years) {
            item.note = 'Asked for ' + yr.years + '+ years. Ben has ' + (yl.yearsLabel || (yl.years + ' years')) + ' of HR and L&D experience, so he\u2019s not there on years yet.';
            return item;
          }
        }
        var allComplete = evals.every(function (e) { return e.pass && e.missing.length === 0; });
        var missNames = top.missing.map(function (g) { return g.name; });
        var covers = 'Ben covers ' + top.have.length + ' of ' + top.total + ' areas this role usually needs.';
        var titleNote = top.title.note ? ' ' + top.title.note : '';
        if (allComplete) {
          item.verdict = 'yes';
          item.headline = 'YES';
          item.note = covers + titleNote;
        } else if (allPass) {
          item.verdict = 'partial';
          item.headline = 'YES, BUT';
          item.note = 'Yes, but not yet: ' + missNames.join('; ') + '. ' + covers + titleNote;
        } else {
          item.verdict = 'no';
          item.headline = 'NOT YET';
          item.note = covers + ' Not yet: ' + missNames.join('; ') + '.' + titleNote;
        }
        item.evidence = [].concat.apply([], top.have.slice(0, 3).map(function (s) { return evidenceFor(s).slice(0, 1); }));
        return item;
      }

      // 3) Plain skills.
      if (skillHits.length) {
        var matched = skillHits.map(function (id) { return skillById[id]; });
        item.matchedSkills = skillHits.slice();
        var ev = [].concat.apply([], matched.map(evidenceFor));
        if (yr.years !== null) {
          var best = yearsLabel(skillHits);
          if (best) {
            if (yr.years <= best.years) {
              item.verdict = 'yes'; item.headline = 'YES';
              item.note = 'Asked for ' + yr.years + '+ years. Ben has ' + (best.yearsLabel || (best.years + ' years')) + (best.id === 'hr-experience' ? ' of HR experience.' : ' in ' + best.name + '.');
              item.evidence = evidenceFor(best).slice(0, 2);
            } else {
              item.verdict = 'no'; item.headline = 'NOT YET';
              item.note = 'Asked for ' + yr.years + '+ years. Ben has ' + (best.yearsLabel || (best.years + ' years')) + (best.id === 'hr-experience' ? ' of HR experience' : ' in ' + best.name) + ', so he\u2019s not quite there on years yet.';
              item.evidence = evidenceFor(best).slice(0, 2);
            }
          } else {
            item.verdict = 'no'; item.headline = 'NOT YET';
            item.note = 'Ben has ' + matched[0].name + ' experience, but his resume doesn\u2019t say how many years. Ask him directly about the ' + yr.years + '+ years.';
            item.evidence = ev.slice(0, 2);
          }
          return item;
        }
        item.verdict = 'yes'; item.headline = 'YES';
        item.evidence = ev.slice(0, 3);
        item.note = '';
        return item;
      }

      item.note = yr.years !== null
        ? 'That years requirement didn\u2019t match a skill on Ben\u2019s resume. Try naming the skill, such as \u201c5 years L&D\u201d.'
        : 'That one isn\u2019t on Ben\u2019s resume yet, or the wording didn\u2019t match. Try different words, or just ask him.';
      return item;
    }

    function check(text) {
      var reqs = splitRequirements(text);
      var items = reqs.map(checkOne);
      var yes = items.filter(function (i) { return i.verdict === 'yes'; }).length;
      var partial = items.filter(function (i) { return i.verdict === 'partial'; }).length;
      var total = items.length;
      var matched = yes + partial;
      var summary = '';
      if (total) {
        summary = matched + ' of ' + total + ' matched';
        if (partial) summary += ', ' + partial + ' with gap' + (partial === 1 ? '' : 's');
      }
      var tone = '';
      var overall = 'no';
      if (total) {
        if (yes === total) {
          tone = 'Everything you listed is on Ben\u2019s resume.';
          overall = 'yes';
        } else if (matched === total && partial) {
          tone = partial === 1
            ? 'A strong match, with a gap noted below.'
            : 'A strong match, with gaps noted below.';
          overall = 'partial';
        } else if (matched === 0) {
          tone = 'None of these are on Ben\u2019s resume yet. Ben would still like to hear about the role.';
          overall = 'no';
        } else {
          tone = 'A strong start. The NOT YET items are explained below, and Ben is glad to talk through any of them.';
          overall = 'no';
        }
      }
      return { items: items, yes: yes, partial: partial, total: total, summary: summary, tone: tone, overall: overall };
    }

    function searchSkills(query, categoryId) {
      var qt = tokenize(query || '');
      return skills.filter(function (s) {
        if (categoryId && categoryId !== 'all' && s.category !== categoryId) return false;
        if (!qt.length) return true;
        var blob = tokenize([s.name, (catById[s.category] || {}).name || ''].concat(s.synonyms || [], s.evidence.map(function (e) { return e.text; })).join(' '));
        var set = new Set(blob);
        return qt.every(function (t) { return set.has(t); });
      });
    }

    return { check: check, checkOne: checkOne, splitRequirements: splitRequirements, searchSkills: searchSkills, tokenize: tokenize, extractYears: extractYears, skills: skills, categories: categories };
  }

  return { createMatcher: createMatcher, splitRequirements: splitRequirements, tokenize: tokenize, extractYears: extractYears };
});
