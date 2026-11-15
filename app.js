(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var matcher = null;
  var activeCat = 'all';

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  // Portrait: show the photo only if it actually loads, else keep the BL monogram.
  (function portrait() {
    var img = $('portrait-img');
    var box = $('portrait');
    if (!img || !box) return;
    function ok() { if (img.naturalWidth > 0) box.classList.add('has-photo'); }
    if (img.complete) ok(); else img.addEventListener('load', ok);
  })();

  // Data is inlined in the page (see tools/build.mjs), so there is no runtime fetch.
  function readData(id) {
    var node = $(id);
    if (!node) throw new Error('Missing data block ' + id);
    return JSON.parse(node.textContent);
  }

  function renderProof(parent, e) {
    var p = el('p', 'proof');
    var q = el('q', null, e.text);
    p.appendChild(q);
    p.appendChild(el('span', 'src', e.source === 'resume' ? 'From Ben\u2019s resume' : 'Confirmed by Ben'));
    parent.appendChild(p);
  }

  function renderResult(item) {
    var li = el('li', 'result ' + item.verdict);
    var head = el('div', 'result-head');
    var st = el('span', 'status ' + item.verdict, (item.verdict === 'yes' ? '\u2713 ' : '\u2717 ') + item.headline);
    head.appendChild(st);
    head.appendChild(el('span', 'req', item.input));
    li.appendChild(head);
    if (item.note) li.appendChild(el('p', 'note', item.note));
    var seenCaveat = {};
    (item.evidence || []).forEach(function (e) {
      renderProof(li, e);
      if (e.caveat && !seenCaveat[e.caveat]) { seenCaveat[e.caveat] = 1; li.appendChild(el('p', 'caveat', 'Good to know: ' + e.caveat)); }
    });
    if (item.breakdown) {
      item.breakdown.forEach(function (b) {
        var d = el('details', 'breakdown');
        d.appendChild(el('summary', null, 'See the ' + b.haveCount + ' of ' + b.total + ' areas for ' + b.title));
        var ul = el('ul');
        b.have.forEach(function (n) { ul.appendChild(el('li', null, '\u2713 ' + n)); });
        b.missing.forEach(function (m) { ul.appendChild(el('li', null, '\u2717 Not yet: ' + m.name)); });
        d.appendChild(ul);
        li.appendChild(d);
      });
    }
    return li;
  }

  function logSearch(fn, entry) {
    try { if (window.BenSearchLog) window.BenSearchLog[fn](entry); } catch (e) { /* logging must never break the page */ }
  }

  function runCheck(source) {
    var out = $('results');
    out.textContent = '';
    var text = $('req-input').value;
    var res = matcher.check(text);
    if (!res.total) {
      out.appendChild(el('p', 'note', 'Type or paste at least one job title or requirement above.'));
      return;
    }
    var bar = el('div', 'summary-bar');
    bar.setAttribute('role', 'status');
    bar.appendChild(el('p', 'big', res.summary));
    bar.appendChild(el('p', null, res.tone));
    out.appendChild(bar);
    var ul = el('ul', 'result-list');
    res.items.forEach(function (i) { ul.appendChild(renderResult(i)); });
    out.appendChild(ul);
    bar.setAttribute('tabindex', '-1');
    bar.scrollIntoView({ block: 'nearest' });
    logSearch('log', {
      box: 'matcher', query: text, source: source,
      result: res.yes === res.total ? 'YES' : 'NOT YET', matched: res.yes, total: res.total,
      unmet: res.items.filter(function (i) { return i.verdict !== 'yes'; }).map(function (i) { return i.input; })
    });
  }

  function renderQuals() {
    var q = $('qual-search').value;
    var list = matcher.searchSkills(q, activeCat);
    var ul = $('qual-list');
    ul.textContent = '';
    var cats = {};
    matcher.categories.forEach(function (c) { cats[c.id] = c.name; });
    list.forEach(function (s) {
      var li = el('li', 'qual');
      li.appendChild(el('h3', null, s.name));
      li.appendChild(el('p', 'cat', cats[s.category] || ''));
      if (s.years) li.appendChild(el('p', 'years', (s.yearsLabel || (s.years + ' years'))));
      s.evidence.slice(0, 2).forEach(function (e) { renderProof(li, e); });
      if (s.caveat) li.appendChild(el('p', 'caveat', 'Good to know: ' + s.caveat));
      ul.appendChild(li);
    });
    $('qual-count').textContent = 'Showing ' + list.length + ' of ' + matcher.skills.length + ' qualifications';
    return list.length;
  }

  function renderChips() {
    var box = $('qual-chips');
    box.textContent = '';
    var all = [{ id: 'all', name: 'All' }].concat(matcher.categories);
    all.forEach(function (c) {
      var b = el('button', 'chip', c.name);
      b.type = 'button';
      b.setAttribute('aria-pressed', c.id === activeCat ? 'true' : 'false');
      b.addEventListener('click', function () {
        activeCat = c.id;
        Array.prototype.forEach.call(box.children, function (x) { x.setAttribute('aria-pressed', 'false'); });
        b.setAttribute('aria-pressed', 'true');
        renderQuals();
      });
      box.appendChild(b);
    });
  }

  function init(data) {
    matcher = window.BenMatcher.createMatcher(data);
    renderChips();
    renderQuals();
    $('qual-search').addEventListener('input', function () {
      var n = renderQuals();
      var q = $('qual-search').value;
      if (q.trim().length >= 2) {
        logSearch('schedule', { box: 'qualifications', query: q, result: n > 0 ? 'YES' : 'NOT YET', matched: n, total: matcher.skills.length, unmet: [] });
      }
    });
    $('matcher-form').addEventListener('submit', function (e) { e.preventDefault(); runCheck('typed'); });
    $('req-input').addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runCheck('typed'); }
    });
    $('clear-btn').addEventListener('click', function () {
      $('req-input').value = ''; $('results').textContent = ''; $('req-input').focus();
    });
    Array.prototype.forEach.call(document.querySelectorAll('.example'), function (b) {
      b.addEventListener('click', function () {
        $('req-input').value = b.getAttribute('data-text');
        runCheck('example');
      });
    });
  }

  // Hero stat boxes: tap or Enter toggles the details tooltip (hover and focus work in CSS).
  (function stats() {
    var items = document.querySelectorAll('.stat-item');
    function closeAll(except) { Array.prototype.forEach.call(items, function (i) { if (i !== except) i.classList.remove('open'); }); }
    Array.prototype.forEach.call(items, function (item) {
      var btn = item.querySelector('.stat');
      btn.addEventListener('click', function (e) { e.stopPropagation(); closeAll(item); item.classList.toggle('open'); });
    });
    document.addEventListener('click', function () { closeAll(null); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAll(null); });
  })();

  try {
    init({ skills: readData('data-skills'), titles: readData('data-titles'), gaps: readData('data-gaps') });
  } catch (err) {
    $('results').textContent = 'The matcher could not load. Please refresh, or email Ben directly.';
    if (window.console) console.error(err);
  }
})();
