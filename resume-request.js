/*
 * Request Resume form: UI, client-side validation, and submit.
 * Submit goes to /api/request-resume (the site's only API), which forwards to a
 * Google Apps Script web app that logs a row in Ben's Sheet and emails him.
 * The delivery details live server-side (api/request-resume.js). Nothing secret is in this file.
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var dialog = $('resume-dialog');
  var form = $('resume-form');
  var openBtn = $('request-resume-btn');
  if (!dialog || !form || !openBtn) return;

  var FIELDS = [
    { id: 'rr-name', key: 'name', label: 'your name', max: 100 },
    { id: 'rr-email', key: 'email', label: 'your work email', max: 160 },
    { id: 'rr-company', key: 'company', label: 'your company', max: 120 },
    { id: 'rr-title', key: 'jobTitle', label: 'the job opening title', max: 140 }
  ];
  var EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/;

  function validateField(f) {
    var input = $(f.id);
    var v = input.value.replace(/\s+/g, ' ').trim();
    var msg = '';
    if (!v) msg = 'Please enter ' + f.label + '.';
    else if (v.length > f.max) msg = 'Please keep this under ' + f.max + ' characters.';
    else if (f.key === 'email' && !EMAIL_RE.test(v)) msg = 'Please enter a valid email address, like name@company.com.';
    else if (/[\u0000-\u001f<>]/.test(v)) msg = 'Please remove special characters like < or >.';
    var err = $(f.id + '-err');
    if (msg) { err.textContent = msg; err.hidden = false; input.setAttribute('aria-invalid', 'true'); }
    else { err.textContent = ''; err.hidden = true; input.removeAttribute('aria-invalid'); }
    return { ok: !msg, value: v };
  }

  function validateAll() {
    var payload = {};
    var firstBad = null;
    FIELDS.forEach(function (f) {
      var r = validateField(f);
      payload[f.key] = r.value;
      if (!r.ok && !firstBad) firstBad = $(f.id);
    });
    return { ok: !firstBad, payload: payload, firstBad: firstBad };
  }

  function setStatus(kind, text) {
    var s = $('resume-status');
    s.className = 'form-status' + (kind ? ' ' + kind : '');
    s.textContent = text || '';
  }

  // ---------------------------------------------------------------------------
  // SUBMIT HANDLER. The only place that talks to the server.
  // ---------------------------------------------------------------------------
  function sendRequest(payload) {
    return fetch('/api/request-resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        return { status: res.status, body: body };
      });
    });
  }

  function open() {
    setStatus('', '');
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    $('rr-name').focus();
  }
  function close() {
    if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
    openBtn.focus();
  }

  openBtn.addEventListener('click', open);
  $('rr-close').addEventListener('click', close);
  dialog.addEventListener('click', function (e) { if (e.target === dialog) close(); });
  FIELDS.forEach(function (f) {
    var input = $(f.id);
    input.addEventListener('blur', function () { if (input.value || input.getAttribute('aria-invalid')) validateField(f); });
    input.addEventListener('input', function () { if (input.getAttribute('aria-invalid')) validateField(f); });
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('rr-submit');
    var check = validateAll();
    if (!check.ok) { setStatus('bad', 'Please fix the highlighted fields.'); check.firstBad.focus(); return; }
    check.payload.website = $('rr-website').value; // honeypot, checked again on the server
    btn.disabled = true; btn.textContent = 'Sending\u2026';
    setStatus('', '');
    sendRequest(check.payload).then(function (r) {
      if (r.status === 200 && r.body && r.body.ok) {
        form.reset();
        FIELDS.forEach(function (f) { $(f.id).removeAttribute('aria-invalid'); $(f.id + '-err').hidden = true; });
        setStatus('ok', 'Thank you. Ben has your request and will review it. If it checks out, he will send his resume to the email you gave.');
      } else if (r.status === 429) {
        setStatus('bad', 'That was a lot of requests in a short time. Please try again in a few minutes, or email Ben directly.');
      } else if (r.status === 503) {
        setStatus('bad', 'Request Resume isn\u2019t switched on yet. Please email Ben directly and he will reply.');
      } else if (r.status === 400 && r.body && r.body.errors) {
        setStatus('bad', 'Please check your details and try again.');
      } else {
        setStatus('bad', 'Something went wrong, and your request was not sent. Please email Ben directly.');
      }
    }).catch(function () {
      setStatus('bad', 'We couldn\u2019t reach the server, so your request was not sent. Please check your connection or email Ben directly.');
    }).then(function () { btn.disabled = false; btn.textContent = 'Send request'; });
  });
})();
