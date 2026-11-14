// Builds index.html from index.template.html + data/profile.json.
// Usage: node tools/build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = JSON.parse(readFileSync(join(root, 'data/profile.json'), 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const li = (n, s) => ' '.repeat(n) + s;
const highlights = p.highlights.map((h, i) => li(8, `<li class="stat-item"><button type="button" class="stat" aria-describedby="tip-${i + 1}"><strong>${esc(h.stat)}</strong><span class="stat-label">${esc(h.label)}</span><span class="stat-i" aria-hidden="true">i</span></button><span class="tip" id="tip-${i + 1}" role="tooltip">${esc(h.details)}</span></li>`)).join('\n');
const timeline = p.experience.map((e) => {
  const bullets = e.bullets.map((b) => li(14, `<li>${esc(b)}</li>`)).join('\n');
  return li(10, '<li class="job">') + '\n' +
    li(12, `<div class="job-head"><h3>${esc(e.title)}</h3><p class="org">${esc(e.org)}</p><p class="dates">${esc(e.dates)}</p>${e.badge ? `<p class="badge">${esc(e.badge)}</p>` : ''}</div>`) + '\n' +
    li(12, '<ul>') + '\n' + bullets + '\n' + li(12, '</ul>') + '\n' + li(10, '</li>');
}).join('\n');
const education = p.education.map((e) => li(10, `<li><strong>${esc(e.name)}</strong><span>${esc(e.org)}</span></li>`)).join('\n');
const examples = p.examples.map((x) => li(12, `<button type="button" class="chip example" data-text="${esc(x)}">${esc(x.split(',').slice(0, 3).join(',').trim())}&hellip;</button>`)).join('\n');
// Data is inlined into the page so the matcher needs no runtime fetch.
// '<' is escaped so the JSON can never close its script tag.
const inline = (name) => JSON.stringify(JSON.parse(readFileSync(join(root, 'data', name + '.json'), 'utf8'))).replace(/</g, '\\u003c');
const map = {
  DATA_SKILLS: inline('skills'), DATA_TITLES: inline('titles'), DATA_GAPS: inline('gaps'),
  TAGLINE: esc(p.tagline), FULLNAME: esc(p.fullName), LOCATION: esc(p.location), SUMMARY: esc(p.summary),
  EMAIL: esc(p.contact.email), LINKEDIN: esc(p.contact.linkedin),
  HIGHLIGHTS: highlights, TIMELINE: timeline, EDUCATION: education, EXAMPLES: examples,
};
let html = readFileSync(join(root, 'index.template.html'), 'utf8');
html = html.replace(/\{\{([A-Z_]+)\}\}/g, (_, k) => { if (!(k in map)) throw new Error('Missing ' + k); return map[k]; });
writeFileSync(join(root, 'index.html'), html);
console.log('index.html written');
