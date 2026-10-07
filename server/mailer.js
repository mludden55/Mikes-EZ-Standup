'use strict';
// Sends email through SMTP when configured (config/config.json -> smtp).
// If a message isn't delivered it is written to data/outbox/, and the caller gets the
// reason so admins see what went wrong.
const fs = require('fs');
const path = require('path');
const { paths, APP_NAME } = require('./config');
const log = require('./logger');

let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch (_) { /* reported via status() */ }

function status(config) {
  const smtp = config && config.smtp;
  if (!smtp || !smtp.host) return { ok: false, reason: 'not-configured', message: 'Email (SMTP) is not set up in config/config.json.' };
  if (!nodemailer) return { ok: false, reason: 'missing-package', message: 'The email package is missing. Run "npm install" in the app folder on the server, then restart.' };
  return { ok: true, message: `SMTP ${smtp.host}:${Number(smtp.port) || 587} as ${smtp.user || '(no login)'}` };
}

// Hand-edited config files often have "port": "587" or "secure": "false" (strings), and
// "false" in quotes would count as true. Port 465 always means encrypted from the start;
// 587, 2525 and 25 always start plain and upgrade with STARTTLS. Other ports follow "secure".
function settings(smtp) {
  const port = Number(smtp.port) || 587;
  const flag = smtp.secure === true || String(smtp.secure).trim().toLowerCase() === 'true';
  const secure = port === 465 ? true : [587, 2525, 25].includes(port) ? false : flag;
  return { port, secure, flag };
}

function transportFor(smtp) {
  const { port, secure } = settings(smtp);
  return nodemailer.createTransport({
    host: String(smtp.host).trim(),
    port,
    secure,
    requireTLS: !secure && port !== 25,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
  });
}

// Turns raw SMTP errors into something an admin can act on.
function explain(e, smtp) {
  const msg = String((e && (e.response || e.message)) || e);
  const code = e && (e.responseCode || e.code);
  if (code === 535 || code === 'EAUTH' || /auth|535|credential|username and password/i.test(msg)) {
    return `The SMTP server rejected the login. Check "user" and "pass" in config/config.json (for Brevo: the SMTP login and an SMTP key, not an API key). Server said: ${msg}`;
  }
  if (/sender|from address|not.*(verified|allowed|authori[sz]ed)|550|553|554/i.test(msg)) {
    return `The SMTP server refused the "from" address "${smtp.from || smtp.user}". It must be a sender or domain verified with your email provider. Server said: ${msg}`;
  }
  if (/wrong version number|ssl3|tls/i.test(msg)) {
    return `Encryption mismatch. Use "secure": false with port 587 or 2525, and "secure": true only with port 465. Details: ${msg}`;
  }
  if (['ECONNREFUSED', 'ETIMEDOUT', 'ESOCKET', 'ECONNECTION', 'EDNS', 'ENOTFOUND'].includes(code) || /timeout|ENOTFOUND|ECONNREFUSED/i.test(msg)) {
    return `Could not connect to ${smtp.host}:${Number(smtp.port) || 587}. Check the host and port, and that a firewall or antivirus isn't blocking outgoing mail (try port 2525). Details: ${msg}`;
  }
  return msg;
}

async function send(config, { to, subject, text }) {
  const st = status(config);
  let error = st.ok ? null : st.message;
  let reason = st.ok ? null : st.reason;
  if (st.ok) {
    const smtp = config.smtp;
    try {
      await transportFor(smtp).sendMail({ from: smtp.from || smtp.user, to, subject, text });
      log.info('Email sent', { to, subject });
      return { delivered: true };
    } catch (e) {
      reason = 'failed';
      error = explain(e, smtp);
      log.error('Email delivery failed', { to, subject, err: error });
    }
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(paths.OUTBOX, `${stamp}_${to.replace(/[^a-z0-9@._-]/gi, '_')}.txt`);
  fs.mkdirSync(paths.OUTBOX, { recursive: true });
  fs.writeFileSync(file, `From: ${APP_NAME}\nTo: ${to}\nSubject: ${subject}\nDate: ${new Date().toString()}\nNot delivered: ${error}\n\n${text}\n`);
  if (reason !== 'failed') log.warn('Email not delivered. Saved to outbox.', { to, reason, file: path.relative(paths.ROOT, file) });
  return { delivered: false, reason, error, file };
}

// Connects and signs in without sending anything.
async function verify(config) {
  const st = status(config);
  if (!st.ok) return st;
  try {
    await transportFor(config.smtp).verify();
    return { ok: true, message: `Connected to ${config.smtp.host} and signed in successfully.` };
  } catch (e) {
    return { ok: false, reason: 'failed', message: explain(e, config.smtp) };
  }
}

module.exports = { send, verify, status, settings };
