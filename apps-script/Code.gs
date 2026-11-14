/**
 * ben-lawson.site Resume Requests: Google Apps Script web app.
 *
 * Bound to the Sheet "ben-lawson.site Resume Requests" (tab "Requests").
 * Called only by the site's Vercel function /api/request-resume.
 *
 * What it does on each POST:
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
