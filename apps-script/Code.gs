/**
 * ben-lawson.site Resume Requests: Google Apps Script web app.
 *
 * Bound to the Sheet "ben-lawson.site Resume Requests" (tabs "Requests" and "Searches").
 * Called only by the site's Vercel functions /api/request-resume and /api/log-search.
 *
 * Two kinds of POST, told apart by the "type" field in the JSON body:
 *   - type "search" (from /api/log-search): adds one row to the Searches tab. It never sends email.
 *   - anything else (from /api/request-resume): a resume request, handled exactly as below.
 *
 * What a resume request does:
 *   1. Checks the shared secret token. The secret is read from the Script Property SHARED_SECRET,
 *      falling back to the hidden "Config" tab (cell B1). It is never written in this file.
 *   2. Validates the fields again.
 *   3. Appends a row: Timestamp (America/Chicago), Name, Email, Company, Job title, Status = New, Notes.
 *   4. Emails Ben a notification. It never emails the recruiter, so there is no auto-reply.
 *
 * Setup: see apps-script/README.md.
 */

var NOTIFY_TO = 'benhlawson@gmail.com';
var SHEET_NAME = 'Requests';
var SEARCH_SHEET_NAME = 'Searches';
var SEARCH_HEADERS = ['Timestamp (America/Chicago)', 'Box', 'Query', 'Result', 'Matched', 'Of', 'Not yet items', 'Input', 'Referrer'];
var QUERY_MAX = 200;
var CONFIG_SHEET_NAME = 'Config';
var TIMEZONE = 'America/Chicago';
var LIMITS = { name: 100, email: 160, company: 120, jobTitle: 140 };
var EMAIL_RE = /^[^\s@<>()\[\]\\,;:"]+@[^\s@<>()\[\]\\,;:"]+\.[A-Za-z]{2,}$/;

function doPost(e) {
  try {
    var data = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    var secret = getSecret_();
    hideConfig_();
    if (!secret || !constantTimeEquals_(String(data.token || ''), secret)) {
      return json_({ ok: false, error: 'unauthorized' });
    }
    if (data.type === 'search') return logSearch_(data); // anonymous search log: row only, no email
    if (data.website) { // honeypot filled in: pretend success, store nothing
      return json_({ ok: true });
    }

    var clean = {};
    var errors = {};
    ['name', 'email', 'company', 'jobTitle'].forEach(function (k) {
      var v = String(data[k] == null ? '' : data[k]).replace(/\s+/g, ' ').trim();
      if (!v) errors[k] = 'required';
      else if (v.length > LIMITS[k]) errors[k] = 'too_long';
      else if (/[\u0000-\u001f<>]/.test(v)) errors[k] = 'bad_characters';
      else if (k === 'email' && !EMAIL_RE.test(v)) errors[k] = 'invalid';
      clean[k] = v;
    });
    if (Object.keys(errors).length) return json_({ ok: false, error: 'invalid', fields: errors });

    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
      if (!sheet) throw new Error('Missing sheet tab ' + SHEET_NAME);
      var ts = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
      // A leading ' stops Sheets from running text as a formula (=, +, -, @).
      sheet.appendRow([ts, safe_(clean.name), safe_(clean.email), safe_(clean.company), safe_(clean.jobTitle), 'New', '']);
    } finally {
      lock.releaseLock();
    }

    var subject = 'Resume request from ' + clean.name + ' at ' + clean.company + ', ' + clean.jobTitle;
    var body = [
      subject,
      '',
      'Name: ' + clean.name,
      'Email: ' + clean.email,
      'Company: ' + clean.company,
      'Job opening: ' + clean.jobTitle,
      '',
      'Verify they are legit, then send your resume. Update the Status column in the sheet:',
      SpreadsheetApp.getActiveSpreadsheet().getUrl()
    ].join('\n');
    // To Ben only. noReply stops replies being addressed to the script owner's no-reply alias;
    // nothing is ever sent to the recruiter.
    MailApp.sendEmail({ to: NOTIFY_TO, subject: subject, body: body, name: 'ben-lawson.site', noReply: true });

    return json_({ ok: true });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'server_error' });
  }
}

/**
 * Adds one row to the Searches tab (created with headers if it is missing). No email, ever.
 * Stores only: time, which box, what was typed, the result, counts, items not matched, whether it
 * was a typed query or an example button, and the referrer's domain. No IP, name, email or browser.
 */
function logSearch_(data) {
  var box = data.box === 'matcher' || data.box === 'qualifications' ? data.box : '';
  var query = clip_(data.query, QUERY_MAX);
  var result = data.result === 'YES' || data.result === 'NOT YET' ? data.result : '';
  if (!box || !query || !result) return json_({ ok: false, error: 'invalid' });
  var unmet = clip_(data.unmet, 300);
  var source = data.source === 'example' ? 'example' : 'typed';
  var referrer = /^[a-z0-9.\-]{1,100}$/i.test(String(data.referrer || '')) ? String(data.referrer).toLowerCase() : '';
  var matched = num_(data.matched);
  var total = num_(data.total);

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SEARCH_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(SEARCH_SHEET_NAME);
      sheet.appendRow(SEARCH_HEADERS);
      sheet.setFrozenRows(1);
    }
    var ts = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
    // safe_ keeps Sheets from running typed text as a formula (a leading =, +, - or @).
    sheet.appendRow([ts, box, safe_(query), result, matched, total, safe_(unmet), source, safe_(referrer)]);
  } finally {
    lock.releaseLock();
  }
  return json_({ ok: true });
}

function clip_(v, max) {
  if (Array.isArray(v)) v = v.join('; ');
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function num_(v) {
  var n = Math.floor(Number(v));
  return isFinite(n) && n >= 0 && n <= 9999 ? n : 0;
}

/** Runs when the sheet is opened: keeps the Config tab hidden. */
function onOpen() {
  hideConfig_();
}

function hideConfig_() {
  try {
    var cfg = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_SHEET_NAME);
    if (cfg && !cfg.isSheetHidden()) cfg.hideSheet();
  } catch (err) {
    console.error(err);
  }
}

/** Script Property SHARED_SECRET wins; otherwise Config!B1 (when A1 says SHARED_SECRET). */
function getSecret_() {
  var prop = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
  if (prop) return String(prop).trim();
  var cfg = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_SHEET_NAME);
  if (!cfg) return '';
  var key = String(cfg.getRange('A1').getValue()).trim();
  var val = String(cfg.getRange('B1').getValue()).trim();
  return key === 'SHARED_SECRET' ? val : '';
}

// A GET (for example someone opening the URL in a browser) reveals nothing.
function doGet() {
  return json_({ ok: false, error: 'method_not_allowed' });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function safe_(v) {
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function constantTimeEquals_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Optional: run once from the editor to confirm the sheet, email permission and timezone work.
 * It writes a clearly marked TEST row and sends you one email. Delete the row afterwards.
 */
function selfTest() {
  var secret = getSecret_();
  var res = doPost({ postData: { contents: JSON.stringify({ token: secret, name: 'TEST Recruiter', email: 'test@example.com', company: 'Test Co', jobTitle: 'Test opening' }) } });
  console.log(res.getContent());
}

/** Optional: adds one TEST row to the Searches tab (no email). Delete the row afterwards. */
function selfTestSearch() {
  var res = doPost({ postData: { contents: JSON.stringify({ token: getSecret_(), type: 'search', box: 'matcher', query: '=TEST search', result: 'YES', matched: 1, total: 1, unmet: [], source: 'typed', referrer: '' }) } });
  console.log(res.getContent());
}
