#!/usr/bin/env node
'use strict';
/*
 * Mike's EZ Standup - server installer
 *
 * Interactive:      node install/install-server.js
 * Unattended:       node install/install-server.js --yes --email=boss@corp.com --password=Secret123 \
 *                       --first=Pat --last=Lee --port=8443 --address=standup.corp.local --https=generate
 * (Values can also come from env vars: STANDUP_ADMIN_EMAIL, STANDUP_ADMIN_PASSWORD, STANDUP_PORT, ...)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');
const { paths, ensureDirs, loadConfig, saveConfig, APP_NAME, VERSION } = require('../server/config');
const auth = require('../server/auth');
const db = require('../server/db');
const U = require('../server/util');
const { writeClientInstallers } = require('./client-installers');
const { generateCert, lanAddresses } = require('./cert');

const args = {};
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2];
}
const env = process.env;
const unattended = !!(args.yes || env.STANDUP_UNATTENDED);
const opt = (name, envName, def) => (args[name] !== undefined ? args[name] : env[envName] !== undefined ? env[envName] : def);

let lines;
let muted = false;
let rl;
function startPrompts() {
  rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
  const orig = rl._writeToOutput.bind(rl);
  rl._writeToOutput = (s) => { if (!muted) orig(s); };
  lines = rl[Symbol.asyncIterator]();
}
async function nextLine() {
  const { value, done } = await lines.next();
  if (done) fail('Installation stopped: no more input. Nothing was changed.');
  return value || '';
}
async function ask(q, def) {
  if (unattended) return def === undefined ? '' : String(def);
  process.stdout.write(def !== undefined && def !== '' ? `${q} [${def}]: ` : `${q}: `);
  const v = (await nextLine()).trim();
  return v === '' && def !== undefined ? String(def) : v;
}
async function askHidden(q) {
  process.stdout.write(`${q}: `);
  muted = true;
  const value = await nextLine();
  muted = false;
  process.stdout.write('\n');
  return value;
}
async function yesNo(q, def) {
  if (unattended) return def;
  const a = (await ask(`${q} (${def ? 'Y/n' : 'y/N'})`)).toLowerCase();
  return a === '' ? def : a.startsWith('y');
}

function fail(msg) {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

async function main() {
  console.log(`\n  ${APP_NAME} v${VERSION} - server installation\n  ${'-'.repeat(48)}\n`);
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major < 20) fail(`Node.js 20 or newer is required (found ${process.versions.node}). Install it from https://nodejs.org`);
  startPrompts();

  // ---- existing installation?
  const oldConfig = loadConfig();
  let keepData = false;
  if (oldConfig || fs.existsSync(paths.DB)) {
    let choice = String(opt('existing', 'STANDUP_EXISTING', unattended ? '' : '')).toLowerCase();
    if (!choice && unattended) fail('An installation already exists. Re-run with --existing=keep or --existing=fresh.');
    if (!choice) {
      console.log('  An existing installation was found. Choose what to do:');
      console.log('    1) Reinstall and KEEP existing teams, updates and recordings (sets a new Primary Administrator)');
      console.log('    2) Fresh install (current data is archived to data-archive/ and the app starts empty)');
      console.log('    3) Cancel\n');
      const a = await ask('  Choice', '3');
      choice = a === '1' ? 'keep' : a === '2' ? 'fresh' : 'cancel';
    }
    if (choice === 'cancel' || !['keep', 'fresh'].includes(choice)) { console.log('\n  Installation cancelled. Nothing was changed.\n'); process.exit(0); }
    keepData = choice === 'keep';
    if (!keepData) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const archive = path.join(paths.ROOT, 'data-archive', stamp);
      fs.mkdirSync(archive, { recursive: true });
      if (fs.existsSync(paths.DATA)) fs.renameSync(paths.DATA, path.join(archive, 'data'));
      if (fs.existsSync(paths.CONFIG_FILE)) fs.copyFileSync(paths.CONFIG_FILE, path.join(archive, 'config.json'));
      console.log(`\n  Previous data archived to ${path.relative(paths.ROOT, archive)}\n`);
    }
  }
  ensureDirs();

  // ---- primary administrator
  console.log('  Primary Administrator (signs in to the Admin Portal and can manage all teams and admins)\n');
  let email = U.normEmail(opt('email', 'STANDUP_ADMIN_EMAIL', ''));
  while (!U.isEmail(email)) {
    if (unattended) fail('A valid --email (or STANDUP_ADMIN_EMAIL) is required.');
    email = U.normEmail(await ask('  Email address'));
    if (!U.isEmail(email)) console.log('  That does not look like an email address. Try again.');
  }
  const firstName = U.cleanText(await ask('  First name', opt('first', 'STANDUP_ADMIN_FIRST', 'Primary')), 60) || 'Primary';
  const lastName = U.cleanText(await ask('  Last name', opt('last', 'STANDUP_ADMIN_LAST', 'Administrator')), 60) || 'Administrator';

  let password = opt('password', 'STANDUP_ADMIN_PASSWORD', '');
  if (unattended) {
    const p = auth.passwordProblem(password);
    if (p) fail(`Password problem: ${p}`);
  } else {
    for (;;) {
      password = await askHidden('  Password (at least 8 characters)');
      const p = auth.passwordProblem(password);
      if (p) { console.log(`  ${p}`); continue; }
      const again = await askHidden('  Confirm password');
      if (again !== password) { console.log('  The passwords do not match. Try again.'); continue; }
      break;
    }
  }

  // ---- network
  console.log('\n  Network\n');
  const ips = lanAddresses();
  const defaultAddress = opt('address', 'STANDUP_ADDRESS', (oldConfig && oldConfig.address) || os.hostname());
  if (!unattended && ips.length) console.log(`  This computer's network address(es): ${ips.join(', ')}  (hostname: ${os.hostname()})`);
  const address = await ask('  Address workers will use to reach this server (hostname or IP)', defaultAddress);

  const httpsChoice = String(opt('https', 'STANDUP_HTTPS', '')).toLowerCase();
  let useHttps;
  if (httpsChoice) useHttps = httpsChoice !== 'off' && httpsChoice !== 'no' && httpsChoice !== 'false';
  else useHttps = await yesNo('  Turn on HTTPS? Browsers only allow voice recording over HTTPS', true);

  let httpsCfg = { enabled: false, certFile: '', keyFile: '' };
  if (useHttps) {
    let cert = opt('cert', 'STANDUP_CERT', '');
    let key = opt('key', 'STANDUP_KEY', '');
    if (!cert && !unattended && httpsChoice !== 'generate') {
      cert = await ask('  Path to your certificate file (.pem/.crt), or leave blank to generate a self-signed one', '');
      if (cert) key = await ask('  Path to the private key file (.pem/.key)');
    }
    if (cert && key) {
      if (!fs.existsSync(cert) || !fs.existsSync(key)) fail('Certificate or key file not found.');
      fs.mkdirSync(paths.CERTS, { recursive: true });
      fs.copyFileSync(cert, path.join(paths.CERTS, 'cert.pem'));
      fs.copyFileSync(key, path.join(paths.CERTS, 'key.pem'));
      httpsCfg = { enabled: true, certFile: 'config/certs/cert.pem', keyFile: 'config/certs/key.pem', selfSigned: false };
    } else {
      const made = await generateCert(address);
      if (made) {
        httpsCfg = { enabled: true, certFile: made.certFile, keyFile: made.keyFile, selfSigned: true };
        console.log(`  Self-signed certificate created in config/certs/ (using ${made.how}).`);
      } else {
        console.log('  Could not create a certificate. Continuing with HTTPS off.');
        console.log('  Fix: run "npm install", then "node install/enable-https.js".');
      }
    }
  }
  const port = parseInt(await ask('  Port', opt('port', 'STANDUP_PORT', httpsCfg.enabled ? 8443 : 8080)), 10);
  if (!(port > 0 && port < 65536)) fail('Invalid port number.');
  const publicUrl = `${httpsCfg.enabled ? 'https' : 'http'}://${address}:${port}`;

  // ---- email
  let smtp = oldConfig && keepData ? oldConfig.smtp || null : null;
  const smtpHost = opt('smtp-host', 'STANDUP_SMTP_HOST', '');
  if (smtpHost) {
    smtp = { host: smtpHost, port: Number(opt('smtp-port', 'STANDUP_SMTP_PORT', 587)), secure: String(opt('smtp-secure', 'STANDUP_SMTP_SECURE', 'false')) === 'true', user: opt('smtp-user', 'STANDUP_SMTP_USER', ''), pass: opt('smtp-pass', 'STANDUP_SMTP_PASS', ''), from: opt('smtp-from', 'STANDUP_SMTP_FROM', '') };
  } else if (!unattended) {
    console.log('\n  Email (used for password resets and invitations)\n');
    if (await yesNo('  Set up outgoing email (SMTP) now?', false)) {
      const host = await ask('  SMTP server');
      const sport = Number(await ask('  SMTP port', 587));
      const secure = await yesNo('  Use SSL/TLS from the start (usually only for port 465)?', sport === 465);
      const user = await ask('  SMTP username (blank if none)', '');
      const pass = user ? await askHidden('  SMTP password') : '';
      const from = await ask('  "From" address', user || `standup@${address}`);
      smtp = { host, port: sport, secure, user, pass, from };
    } else {
      console.log('  Skipped. Emails will be saved to data/outbox/ until SMTP is set in config/config.json.');
    }
  }

  // ---- write config
  const config = {
    appName: APP_NAME,
    version: VERSION,
    address,
    port,
    host: '0.0.0.0',
    publicUrl,
    https: httpsCfg,
    smtp,
    donationUrl: (oldConfig && oldConfig.donationUrl) || '',
    maxRecordingSeconds: (oldConfig && oldConfig.maxRecordingSeconds) || 180,
    maxUploadMB: 20,
    logRetentionDays: 90,
    installedAt: new Date().toISOString(),
  };
  saveConfig(config);

  // ---- database
  let data;
  if (keepData && fs.existsSync(paths.DB)) {
    data = JSON.parse(fs.readFileSync(paths.DB, 'utf8'));
    const blank = db.EMPTY();
    for (const k of Object.keys(blank)) if (data[k] === undefined) data[k] = blank[k];
  } else {
    data = db.EMPTY();
  }
  let admin = data.users.find((u) => u.email === email);
  if (!admin) {
    admin = { id: U.uid(), email, firstName, lastName, adminTeams: [], active: true, createdAt: new Date().toISOString() };
    data.users.push(admin);
  }
  Object.assign(admin, { firstName, lastName, passwordHash: auth.hashPassword(password), isAdmin: true, isPrimary: true, active: true });
  data.sessions = data.sessions.filter((s) => s.userId !== admin.id);
  db.writeFile(paths.DB, data);

  // ---- client installers
  writeClientInstallers(publicUrl);

  if (rl) rl.close();
  console.log(`
  ${'-'.repeat(48)}
  Installation complete.

  Primary Administrator:  ${email}
  Worker portal:          ${publicUrl}/worker
  Admin portal:           ${publicUrl}/admin
  Client installers:      installers/worker  and  installers/admin
                          (also downloadable from ${publicUrl}/downloads)

  Next steps
    1. npm install           (if you haven't already)
    2. npm start             (or start.bat / start.sh)
    3. Sign in at ${publicUrl}/admin and create your first team.
${httpsCfg.selfSigned ? `
  Note: the certificate is self-signed, so browsers will show a warning the first
  time. See README.md, "Turning on HTTPS", for how to trust it on each computer.
` : ''}`);
}

main().catch((e) => fail(e.stack || e.message));
