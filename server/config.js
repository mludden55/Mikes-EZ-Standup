'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_NAME = "Mike's EZ Standup";
const VERSION = '1.2.0';

// Donation page shown as "support its development" in the app's footer, in every copy you
// distribute. Paste your Stripe Payment Link here, e.g. 'https://donate.stripe.com/abc123'.
// (An installation can override it with "donationUrl" in its config/config.json.)
const DONATION_URL = '';

const paths = {
  ROOT,
  CONFIG_DIR: path.join(ROOT, 'config'),
  CONFIG_FILE: path.join(ROOT, 'config', 'config.json'),
  CERTS: path.join(ROOT, 'config', 'certs'),
  DATA: path.join(ROOT, 'data'),
  DB: path.join(ROOT, 'data', 'db.json'),
  RECORDINGS: path.join(ROOT, 'data', 'recordings'),
  TEXT_UPDATES: path.join(ROOT, 'data', 'text-updates'),
  OUTBOX: path.join(ROOT, 'data', 'outbox'),
  BACKUPS: path.join(ROOT, 'data', 'backups'),
  LOGS: path.join(ROOT, 'logs'),
  PUBLIC: path.join(ROOT, 'public'),
  INSTALLERS: path.join(ROOT, 'installers'),
};

function ensureDirs() {
  for (const k of ['CONFIG_DIR', 'DATA', 'RECORDINGS', 'TEXT_UPDATES', 'OUTBOX', 'BACKUPS', 'LOGS', 'INSTALLERS']) {
    fs.mkdirSync(paths[k], { recursive: true });
  }
}

function loadConfig() {
  if (!fs.existsSync(paths.CONFIG_FILE)) return null;
  return JSON.parse(fs.readFileSync(paths.CONFIG_FILE, 'utf8'));
}

function saveConfig(cfg) {
  fs.mkdirSync(paths.CONFIG_DIR, { recursive: true });
  fs.writeFileSync(paths.CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

module.exports = { paths, ensureDirs, loadConfig, saveConfig, APP_NAME, VERSION, DONATION_URL };
