#!/usr/bin/env node
'use strict';
// Checks the email (SMTP) settings and explains any problem.
//   node install/test-email.js                    check settings and sign in to the SMTP server
//   node install/test-email.js you@example.com    ...and send a test email to that address
const fs = require('fs');
const path = require('path');
const { paths } = require('../server/config');

const ok = (m) => console.log(`  OK    ${m}`);
const bad = (m) => console.log(`  FIX   ${m}`);
const note = (m) => console.log(`        ${m}`);
let problems = 0;
const fail = (m) => { problems++; bad(m); };

(async () => {
  console.log('\nEmail check\n');
  if (!fs.existsSync(paths.CONFIG_FILE)) { fail('config/config.json not found. Install the server first.'); return; }
  const raw = fs.readFileSync(paths.CONFIG_FILE, 'utf8');
  let config;
  try { config = JSON.parse(raw); } catch (e) {
    fail(`config/config.json is not valid JSON: ${e.message}`);
    note('Common causes: a missing comma between entries, a trailing comma after the last entry, or curly quotes.');
    return;
  }
  ok('config/config.json is valid JSON');

  const count = (raw.match(/"smtp"\s*:/g) || []).length;
  if (count > 1) {
    fail(`"smtp" appears ${count} times in config/config.json. Only the LAST one is used.`);
    note('Delete the extra one (often a leftover  "smtp": null  from the installer).');
  }

  const smtp = config.smtp;
  if (!smtp || !smtp.host) {
    fail('No SMTP settings are in effect ("smtp" is empty or null).');
    note('See README.md, "Email setup" (and EMAIL-BREVO.md if you use Brevo).');
    return finish();
  }
  ok(`SMTP host ${smtp.host}, port ${smtp.port || 587}, secure ${!!smtp.secure}`);
  ok(`Login: ${smtp.user || '(none)'}   Password: ${smtp.pass ? smtp.pass.slice(0, 8) + '...' + ` (${smtp.pass.length} characters)` : '(empty)'}`);
  ok(`From: ${smtp.from || '(not set, the login will be used)'}`);

  const { settings } = require('../server/mailer');
  const { port, secure, flag } = settings(smtp);
  if (typeof smtp.secure === 'string') note(`Note: "secure" is in quotes ("${smtp.secure}"). Write it without quotes:  "secure": ${secure}`);
  if (typeof smtp.port === 'string') note(`Note: "port" is in quotes. Write it without quotes:  "port": ${port}`);
  if (flag !== secure) note(`Note: "secure" is ignored for port ${port}; the app uses ${secure ? 'SSL/TLS from the start' : 'STARTTLS'} automatically.`);
  if (!smtp.user || !smtp.pass) fail('"user" and "pass" are both required by most providers, including Brevo.');
  if (/brevo|sendinblue/i.test(smtp.host)) {
    if (smtp.host !== 'smtp-relay.brevo.com') fail(`For Brevo the host should be  smtp-relay.brevo.com  (found ${smtp.host})`);
    if (/^xkeysib-/.test(smtp.pass || '')) fail('That "pass" is a Brevo API key (starts with xkeysib-). Use an SMTP key (usually starts with xsmtpsib-) from Settings > SMTP & API > SMTP tab.');
    if (!smtp.from) fail('Set "from" to a sender address verified in Brevo.');
  }
  if (/\s/.test(smtp.pass || '') || /\s/.test(smtp.user || '')) fail('"user" or "pass" contains spaces. Check for extra spaces when pasting.');

  let nodemailer = null;
  try { nodemailer = require('nodemailer'); ok('Email package (nodemailer) is installed'); } catch (_) {
    fail('The email package is not installed. Run  npm install  in the app folder.');
  }

  // Was the server restarted after the config was edited?
  try {
    const logs = fs.readdirSync(paths.LOGS).filter((f) => f.endsWith('.log')).sort();
    let lastStart = null;
    for (const f of logs.reverse()) {
      const lines = fs.readFileSync(path.join(paths.LOGS, f), 'utf8').split('\n').filter((l) => l.includes(' is running'));
      if (lines.length) { lastStart = new Date(lines[lines.length - 1].slice(0, 24)); break; }
    }
    const edited = fs.statSync(paths.CONFIG_FILE).mtime;
    if (lastStart && edited > lastStart) {
      fail(`config/config.json was changed (${edited.toLocaleString()}) after the server last started (${lastStart.toLocaleString()}).`);
      note('Restart the server so it picks up the new settings.');
    }
  } catch (_) {}

  if (!nodemailer) return finish();
  const mailer = require('../server/mailer');
  console.log(`\n  Connecting to ${smtp.host}:${port} ...`);
  const v = await mailer.verify(config);
  if (v.ok) ok(v.message); else fail(v.message);

  const to = process.argv[2];
  if (v.ok && to) {
    console.log(`\n  Sending a test email to ${to} ...`);
    const r = await mailer.send(config, { to, subject: "Mike's EZ Standup test email", text: 'If you can read this, email delivery works.\n' });
    if (r.delivered) ok(`Sent. Check ${to} (and the spam folder).`); else fail(r.error);
  } else if (v.ok) {
    note('\n        Add an address to also send a test:  node install/test-email.js you@example.com');
  }
  finish();
})();

function finish() {
  console.log(problems ? `\n  ${problems} problem${problems > 1 ? 's' : ''} found. Fix, restart the server, and run this again.\n` : '\n  No problems found.\n');
}
