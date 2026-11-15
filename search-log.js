/*
 * Anonymous search logging. Sends what a visitor searched for and the outcome to /api/log-search,
 * fire-and-forget. Sends no name, email, IP or user agent (the browser attaches its own request
 * headers, but the server does not store them). Every failure is swallowed so the page never breaks.
 *
 *   BenSearchLog.log({ box, query, result, matched, total, unmet, source })  log now (matcher runs)
 *   BenSearchLog.schedule(entry)   log once the visitor stops typing (qualifications search)
 */
(function () {
  'use strict';
  var ENDPOINT = '/api/log-search';
  var QUERY_MAX = 200;
  var DEBOUNCE_MS = 1500;
  var last = { key: '', at: 0 };
  var timer = null;
  var pending = null;

  function referrerHost() {
    try {
      if (!document.referrer) return '';
      var h = new URL(document.referrer).hostname.toLowerCase();
      return h === location.hostname ? '' : h;
    } catch (e) { return ''; }
  }

  function send(entry) {
    try {
      var query = String(entry.query || '').replace(/\s+/g, ' ').trim().slice(0, QUERY_MAX);
      if (!query || query.length < 2) return;
      var key = entry.box + '|' + query.toLowerCase();
      var now = Date.now();
      if (key === last.key && now - last.at < 30000) return; // same search repeated: log once
      last = { key: key, at: now };
      var payload = JSON.stringify({
        box: entry.box, query: query, result: entry.result,
        matched: entry.matched, total: entry.total,
        unmet: (entry.unmet || []).slice(0, 10),
        source: entry.source === 'example' ? 'example' : 'typed',
        referrer: referrerHost()
      });
      var sent = false;
      if (navigator.sendBeacon) sent = navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: 'application/json' }));
      if (!sent && window.fetch) {
        fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true, credentials: 'omit' })
          .catch(function () {});
      }
    } catch (e) { /* never break the page */ }
  }

  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (pending) { var p = pending; pending = null; send(p); }
  }

  window.BenSearchLog = {
    log: function (entry) { try { flush(); send(entry); } catch (e) { /* ignore */ } },
    schedule: function (entry) {
      try {
        pending = entry;
        if (timer) clearTimeout(timer);
        timer = setTimeout(flush, DEBOUNCE_MS);
      } catch (e) { /* ignore */ }
    },
    _flush: flush
  };
  // If the visitor leaves while a search is waiting out its debounce, send it now.
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', flush);
})();
