'use strict';
const crypto = require('crypto');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(pw, stored) {
  try {
    const [alg, s, h] = String(stored || '').split('$');
    if (alg !== 'scrypt') return false;
    const calc = crypto.scryptSync(String(pw), Buffer.from(s, 'hex'), 64);
    const hb = Buffer.from(h, 'hex');
    return hb.length === calc.length && crypto.timingSafeEqual(hb, calc);
  } catch (_) {
    return false;
  }
}

function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters long.';
  if (pw.length > 200) return 'Password must be 200 characters or fewer.';
  return null;
}

const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');

module.exports = { hashPassword, verifyPassword, passwordProblem, sha, newToken };
