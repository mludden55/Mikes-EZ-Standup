'use strict';
const fs = require('fs');
const path = require('path');
const { paths } = require('./config');

const pad = (n) => String(n).padStart(2, '0');
const day = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function write(level, msg, meta) {
  const line = `${new Date().toISOString()} [${level}] ${msg}${meta ? ' ' + JSON.stringify(meta) : ''}`;
  if (level === 'ERROR') console.error(line); else console.log(line);
  try {
    fs.mkdirSync(paths.LOGS, { recursive: true });
    fs.appendFileSync(path.join(paths.LOGS, `app-${day()}.log`), line + '\n');
  } catch (_) { /* logging must never crash the app */ }
}

function prune(days = 90) {
  try {
    const cutoff = Date.now() - days * 864e5;
    for (const f of fs.readdirSync(paths.LOGS)) {
      const fp = path.join(paths.LOGS, f);
      if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp);
    }
  } catch (_) {}
}

module.exports = {
  info: (m, x) => write('INFO', m, x),
  warn: (m, x) => write('WARN', m, x),
  error: (m, x) => write('ERROR', m, x),
  prune,
};
