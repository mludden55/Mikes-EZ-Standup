'use strict';
const crypto = require('crypto');

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d = new Date()) => `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const uid = () => crypto.randomBytes(9).toString('base64url');
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00'));
const normEmail = (e) => (typeof e === 'string' ? e.trim().toLowerCase() : '');
const isEmail = (e) => typeof e === 'string' && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const unique = (a) => [...new Set(a)];

function cleanText(s, max = 5000) {
  if (typeof s !== 'string') return '';
  return s.replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return localDate(d);
}

const dayOfWeek = (dateStr) => new Date(dateStr + 'T12:00:00').getDay();

module.exports = { localDate, localTime, uid, isDate, normEmail, isEmail, unique, cleanText, httpError, addDays, dayOfWeek };
