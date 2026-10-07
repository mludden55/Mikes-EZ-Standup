'use strict';
// Simple JSON-file data store. Keeps the app dependency-free and easy to back up:
// everything lives in data/db.json, with daily snapshots in data/backups/.
const fs = require('fs');
const path = require('path');
const { paths } = require('./config');
const log = require('./logger');
const { localDate } = require('./util');

let data = null;
let timer = null;

const EMPTY = () => ({
  meta: { schema: 1, createdAt: new Date().toISOString() },
  users: [], teams: [], schedules: [], requests: [], messages: [],
  updates: [], rejections: [], attendance: [], audio: [], tokens: [], sessions: [],
});

function init() {
  if (!fs.existsSync(paths.DB)) {
    throw new Error(`Database not found at ${paths.DB}. Run the installer: node install/install-server.js`);
  }
  data = JSON.parse(fs.readFileSync(paths.DB, 'utf8'));
  const blank = EMPTY();
  for (const k of Object.keys(blank)) if (data[k] === undefined) data[k] = blank[k];
  backupDaily();
  return data;
}

const get = () => data;

// Throttled (not debounced): a burst of changes is written within 100 ms,
// so a crash or power loss can never hold back writes indefinitely.
function save() {
  if (!timer) timer = setTimeout(flush, 100);
}

function flush() {
  clearTimeout(timer);
  timer = null;
  if (!data) return;
  writeFile(paths.DB, data);
}

function writeFile(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
  fs.renameSync(tmp, file);
}

function backupDaily(keep = 30) {
  try {
    fs.mkdirSync(paths.BACKUPS, { recursive: true });
    const target = path.join(paths.BACKUPS, `db-${localDate()}.json`);
    if (!fs.existsSync(target) && fs.existsSync(paths.DB)) {
      fs.copyFileSync(paths.DB, target);
      log.info('Daily database backup written', { file: path.basename(target) });
    }
    const files = fs.readdirSync(paths.BACKUPS).filter((f) => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    while (files.length > keep) fs.unlinkSync(path.join(paths.BACKUPS, files.shift()));
  } catch (e) {
    log.warn('Backup failed', { err: e.message });
  }
}

module.exports = { init, get, save, flush, writeFile, backupDaily, EMPTY };
