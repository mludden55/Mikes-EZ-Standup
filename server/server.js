'use strict';
/*
 * Mike's EZ Standup - server
 * One Node.js process serves the Worker portal (/worker), the Admin portal (/admin),
 * the JSON API (/api/...) and the client installers (/downloads).
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { paths, ensureDirs, loadConfig, APP_NAME, VERSION, DONATION_URL } = require('./config');
const log = require('./logger');
const db = require('./db');
const auth = require('./auth');
const mailer = require('./mailer');
const U = require('./util');

if (parseInt(process.versions.node, 10) < 20) {
  console.error(`\n${APP_NAME} needs Node.js 20 or newer (this PC has ${process.versions.node}). Install the LTS version from https://nodejs.org\n`);
  process.exit(1);
}
const config = loadConfig();
if (!config) {
  console.error(`\n${APP_NAME} is not installed yet.\nRun the installer first:  node install/install-server.js\n`);
  process.exit(1);
}
ensureDirs();
db.init();
(function upgradePrimaryTeams() {
  const d = db.get();
  if (d.meta.primaryTeamsExplicit) return;
  const all = d.teams.map((t) => t.id);
  for (const u of d.users) if (u.isAdmin && u.isPrimary) u.adminTeams = [...new Set([...(u.adminTeams || []), ...all])];
  d.meta.primaryTeamsExplicit = true;
  db.flush();
})();

// Keep the Worker, Admin and desktop installers in step with this server's address.
try { require('../install/client-installers').writeClientInstallers(config.publicUrl); } catch (e) { log.warn('Could not write client installers', { err: e.message }); }
log.prune(config.logRetentionDays || 90);

const D = () => db.get();
const COOKIE = 'mas_session';
const SESSION_DAYS = 14;      // after setting a password from an email link
const REMEMBER_DAYS = 90;     // "Keep me signed in"
const SHORT_SESSION_HOURS = 12;
const STREAMED = Symbol('streamed');
const baseUrl = () => (config.publicUrl || `http://localhost:${config.port}`).replace(/\/$/, '');
const httpError = U.httpError;

const REASONS = {
  sick: 'Sick',
  ooo: 'Out of office',
  pto: 'On vacation / PTO',
  nothing: 'Nothing to share',
  busy: 'Busy',
  meetings: 'In meetings all day',
  blocked: 'Blocked - would like to talk live',
  shared: 'Already shared in a meeting or chat',
  personal: 'Personal / family matter',
  other: 'Other',
};

/* ------------------------------------------------------------------ helpers */

const userById = (id) => D().users.find((u) => u.id === id);
const userByEmail = (e) => D().users.find((u) => u.email === U.normEmail(e));
const teamById = (id) => D().teams.find((t) => t.id === id);
const teamName = (id) => (teamById(id) || { name: '(deleted team)' }).name;
const fullName = (u) => (u ? [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email : '(removed user)');
const teamsOf = (uid) => D().teams.filter((t) => t.memberIds.includes(uid));
const dateOf = (iso) => U.localDate(new Date(iso));

// Teams an administrator works with (Reports, Request, Configure, Edit Teams...).
// Primary Administrators have explicit teams too; being Primary is about managing administrators.
function adminTeamIds(u) {
  if (!u || !u.isAdmin) return [];
  const all = D().teams.map((t) => t.id);
  return (u.adminTeams || []).filter((id) => all.includes(id));
}

// Resolve a "team" query value ("all", an id, or comma separated ids) to ids the admin may see.
// Teams an administrator may hand out to other administrators: every team for a Primary
// Administrator, otherwise only the teams they administer themselves.
const assignableTeamIds = (u) => (u && u.isPrimary ? D().teams.map((t) => t.id) : adminTeamIds(u));

function scopeTeams(u, team) {
  const allowed = adminTeamIds(u);
  if (!team || team === 'all') return allowed;
  const ids = String(team).split(',').filter(Boolean);
  for (const id of ids) if (!allowed.includes(id)) throw httpError(403, 'You are not an administrator of that team.');
  return ids;
}

function membersOf(teamIds) {
  const ids = U.unique(D().teams.filter((t) => teamIds.includes(t.id)).flatMap((t) => t.memberIds));
  return ids.map(userById).filter((u) => u && u.active);
}

function sortPeople(list) {
  const c = (a, b) => (a || '').localeCompare(b || '', undefined, { sensitivity: 'base' });
  return list.sort((a, b) => c(a.lastName, b.lastName) || c(a.firstName, b.firstName) || c(a.email, b.email));
}

const roleIn = (t, uid) => ((t && t.roles) || {})[uid] || '';
const personView = (u) => ({
  id: u.id, email: u.email, firstName: u.firstName || '', lastName: u.lastName || '', name: fullName(u),
  teams: teamsOf(u.id).map((t) => ({ id: t.id, name: t.name, role: roleIn(t, u.id) })), pendingSetup: !u.passwordHash,
});
// Roles a person has across some teams, e.g. "QA" or "Backend, Scrum master".
const rolesOf = (uid, teamIds) => U.unique(D().teams.filter((t) => !teamIds || teamIds.includes(t.id)).map((t) => roleIn(t, uid)).filter(Boolean)).join(', ');

const meView = (u) => ({ ...personView(u), isAdmin: !!u.isAdmin, isPrimary: !!u.isPrimary, adminTeamIds: adminTeamIds(u) });

const defaultSchedule = (teamId) => ({ teamId, days: [1, 2, 3, 4, 5], dayDeadlines: {}, meetingDays: [], meeting: { time: '', endTime: '', link: '', notes: '' }, always: true, startDate: null, endDate: null, excludedDates: [] });
const scheduleFor = (teamId) => {
  const s = D().schedules.find((x) => x.teamId === teamId) || defaultSchedule(teamId);
  let dayDeadlines = s.dayDeadlines;
  if (!dayDeadlines) {
    dayDeadlines = {};
    if (s.updateDeadline) for (const d of s.days || []) dayDeadlines[d] = s.updateDeadline;
  }
  return { ...s, dayDeadlines, meetingDays: s.meetingDays || [], meeting: { time: '', endTime: '', link: '', notes: '', ...(s.meeting || {}) } };
};

// What happens on a date for a team: 'update' (written/voice update), 'meeting', or null.
function dayType(s, date) {
  if (!s) return null;
  if (!s.always) {
    if (s.startDate && date < s.startDate) return null;
    if (s.endDate && date > s.endDate) return null;
  }
  if ((s.excludedDates || []).includes(date)) return null;
  const dow = U.dayOfWeek(date);
  if ((s.meetingDays || []).includes(dow)) return 'meeting';
  if ((s.days || []).includes(dow)) return 'update';
  return null;
}
const scheduledOn = (s, date) => dayType(s, date) === 'update';

// Deadline for a scheduled update day (each weekday can have its own), as a full date-time
// (ISO), or null. When someone is on several teams with update days, the earliest applies.
function scheduledDeadline(teamIds, date) {
  const dow = U.dayOfWeek(date);
  const times = teamIds.map((id) => scheduleFor(id).dayDeadlines[dow]).filter(Boolean).sort();
  if (!times.length) return null;
  const d = new Date(`${date}T${times[0]}:00`);
  return isNaN(d) ? null : d.toISOString();
}
const meetingOn = (s, date) => dayType(s, date) === 'meeting';

/* ------------------------------------------------------- sessions & tokens */

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) {
      try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch (_) {}
    }
  });
  return out;
}

// maxAge null = cookie lasts until the browser (or desktop app) is closed.
function setCookie(res, value, maxAge) {
  const secure = config.https && config.https.enabled ? '; Secure' : '';
  const age = maxAge === null ? '' : `; Max-Age=${maxAge}`;
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax${age}${secure}`);
}

function createSession(res, userId, mode = 'normal') {
  const raw = auth.newToken();
  const days = mode === 'remember' ? REMEMBER_DAYS : SESSION_DAYS;
  const ms = mode === 'short' ? SHORT_SESSION_HOURS * 3600e3 : days * 864e5;
  D().sessions.push({ hash: auth.sha(raw), userId, expires: Date.now() + ms });
  db.save();
  setCookie(res, raw, mode === 'short' ? null : days * 86400);
}

function sessionUser(req) {
  const raw = parseCookies(req)[COOKIE];
  if (!raw) return null;
  const hash = auth.sha(raw);
  const s = D().sessions.find((x) => x.hash === hash);
  if (!s || s.expires < Date.now()) return null;
  const u = userById(s.userId);
  if (!u || !u.active) return null;
  return { user: u, session: s };
}

function createToken(userId, purpose, hours) {
  const raw = auth.newToken();
  D().tokens.push({ hash: auth.sha(raw), userId, purpose, expires: Date.now() + hours * 3600e3, used: false });
  db.save();
  return raw;
}

function findToken(raw) {
  if (!raw) return null;
  const hash = auth.sha(raw);
  const t = D().tokens.find((x) => x.hash === hash);
  return t && !t.used && t.expires > Date.now() ? t : null;
}

function housekeeping() {
  const d = D();
  const now = Date.now();
  const before = d.sessions.length + d.tokens.length;
  d.sessions = d.sessions.filter((s) => s.expires > now);
  d.tokens = d.tokens.filter((t) => t.expires > now && !t.used);
  if (d.sessions.length + d.tokens.length !== before) db.save();
  db.backupDaily();
  try { cleanup(); } catch (e) { log.error('Cleanup failed', { err: e.message }); }
}

const attempts = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let a = attempts.get(key);
  if (!a || a.reset < now) { a = { count: 0, reset: now + windowMs }; attempts.set(key, a); }
  a.count += 1;
  if (a.count > max) throw httpError(429, 'Too many attempts. Wait a few minutes, then try again.');
}

/* ------------------------------------------------------------------- email */

async function sendSetupEmail(u, inviter, reason) {
  const token = createToken(u.id, 'setup', 24 * 7);
  const link = `${baseUrl()}/reset?token=${token}`;
  const who = inviter ? fullName(inviter) : 'Your administrator';
  const r = await mailer.send(config, {
    to: u.email,
    subject: `You've been added to ${APP_NAME}`,
    text: `Hi ${u.firstName || 'there'},\n\n${who} ${reason}.\n\n${APP_NAME} is where your team shares daily standup updates by voice or text.\n\nCreate your password here (this link works for 7 days):\n${link}\n\nAfter that, sign in at ${baseUrl()}/ with ${u.email}.\n`,
  });
  return { delivered: r.delivered, link: r.delivered ? undefined : link, reason: r.reason, error: r.error };
}

/* ------------------------------------------------------------------ router */

const routes = [];
function route(method, pattern, opts, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, opts, handler });
}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(httpError(413, 'That upload is too large.')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handleApi(req, res, url, pathname) {
  try {
    let found = null;
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(pathname);
      if (m) { found = { r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) }; break; }
    }
    if (!found) throw httpError(404, 'Not found.');
    const { r, params } = found;

    if (req.method !== 'GET' && req.headers.origin) {
      let ok = false;
      try { ok = new URL(req.headers.origin).host === req.headers.host; } catch (_) {}
      if (!ok) throw httpError(403, 'Cross-site request blocked.');
    }

    const ctx = { req, res, params, query: Object.fromEntries(url.searchParams), ip: req.socket.remoteAddress };
    if (r.opts.auth !== 'public') {
      const s = sessionUser(req);
      if (!s) throw httpError(401, 'Please sign in.');
      ctx.user = s.user;
      ctx.session = s.session;
      if ((r.opts.auth === 'admin' || r.opts.auth === 'primary') && !s.user.isAdmin) throw httpError(403, 'Administrator access is required.');
      if (r.opts.auth === 'primary' && !s.user.isPrimary) throw httpError(403, 'Only a Primary Administrator can do that.');
    }

    if (req.method !== 'GET') {
      const limit = r.opts.raw ? Math.max(config.maxUploadMB || 20, config.maxVideoMB || 150) * 1048576 : 1048576;
      const buf = await readBody(req, limit);
      if (r.opts.raw) ctx.raw = buf;
      else {
        ctx.body = {};
        if (buf.length) {
          try { ctx.body = JSON.parse(buf.toString('utf8')); } catch (_) { throw httpError(400, 'Invalid request body.'); }
        }
      }
    }

    const result = await r.handler(ctx);
    if (req.method !== 'GET') db.flush(); // a change is on disk before we confirm it
    if (result === STREAMED) return;
    json(res, 200, result === undefined ? { ok: true } : result);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) log.error('API error', { path: pathname, err: e.stack || e.message });
    if (!res.headersSent) json(res, status, { error: status >= 500 ? 'Something went wrong on the server. The details are in the server logs.' : e.message });
    else res.end();
  }
}

/* -------------------------------------------------------------- public API */

route('GET', '/api/app-info', { auth: 'public' }, () => ({
  name: APP_NAME, version: VERSION, donationUrl: config.donationUrl || DONATION_URL, reasons: REASONS,
  maxRecordingSeconds: config.maxRecordingSeconds || 180, secure: !!(config.https && config.https.enabled),
}));

route('POST', '/api/login', { auth: 'public' }, ({ body, res, ip }) => {
  const email = U.normEmail(body.email);
  rateLimit(`login:${ip}`, 20, 15 * 60e3);
  rateLimit(`login:${email}`, 8, 15 * 60e3);
  const u = userByEmail(email);
  if (!u || !u.active || !u.passwordHash || !auth.verifyPassword(body.password || '', u.passwordHash)) {
    log.warn('Failed sign-in', { email, ip });
    throw httpError(401, 'That email and password combination is not recognized.');
  }
  attempts.delete(`login:${email}`);
  createSession(res, u.id, body.remember === false ? 'short' : 'remember');
  u.lastLoginAt = new Date().toISOString();
  db.save();
  log.info('Signed in', { email });
  return { user: meView(u), home: u.isAdmin ? '/admin' : '/worker' };
});

route('POST', '/api/logout', { auth: 'public' }, ({ req, res }) => {
  const raw = parseCookies(req)[COOKIE];
  if (raw) {
    const hash = auth.sha(raw);
    D().sessions = D().sessions.filter((s) => s.hash !== hash);
    db.save();
  }
  setCookie(res, '', 0);
});

route('POST', '/api/forgot', { auth: 'public' }, async ({ body, ip }) => {
  const email = U.normEmail(body.email);
  rateLimit(`forgot:${ip}`, 10, 15 * 60e3);
  const u = userByEmail(email);
  if (u && u.active) {
    const token = createToken(u.id, 'reset', 1);
    const link = `${baseUrl()}/reset?token=${token}`;
    await mailer.send(config, {
      to: u.email,
      subject: `Reset your ${APP_NAME} password`,
      text: `Hi ${u.firstName || 'there'},\n\nSomeone (hopefully you) asked to reset your ${APP_NAME} password.\n\nChoose a new password here (this link works for 1 hour):\n${link}\n\nIf you didn't ask for this, you can ignore this email; your password stays the same.\n`,
    });
    log.info('Password reset requested', { email });
  } else {
    log.warn('Password reset requested for unknown email', { email });
  }
  return { ok: true, message: 'If that email belongs to an account, a reset link is on its way.' };
});

route('GET', '/api/reset/check', { auth: 'public' }, ({ query }) => {
  const t = findToken(query.token);
  const u = t && userById(t.userId);
  if (!u) return { valid: false };
  return { valid: true, email: u.email, firstName: u.firstName || '', welcome: t.purpose === 'setup' };
});

route('POST', '/api/reset', { auth: 'public' }, ({ body, res }) => {
  const t = findToken(body.token);
  const u = t && userById(t.userId);
  if (!u) throw httpError(400, 'This link has expired or was already used. Request a new one from the sign-in page.');
  const problem = auth.passwordProblem(body.password);
  if (problem) throw httpError(400, problem);
  u.passwordHash = auth.hashPassword(body.password);
  t.used = true;
  D().sessions = D().sessions.filter((s) => s.userId !== u.id);
  db.save();
  createSession(res, u.id);
  log.info('Password set', { email: u.email, via: t.purpose });
  return { ok: true, home: u.isAdmin ? '/admin' : '/worker' };
});

/* ------------------------------------------------------------ any user API */

route('GET', '/api/me', { auth: 'user' }, ({ user }) => meView(user));

route('GET', '/api/session', { auth: 'public' }, ({ req }) => {
  const s = sessionUser(req);
  return { user: s ? meView(s.user) : null };
});

route('POST', '/api/me/password', { auth: 'user' }, ({ user, body, session }) => {
  if (!auth.verifyPassword(body.current || '', user.passwordHash)) throw httpError(400, 'Your current password is not correct.');
  const problem = auth.passwordProblem(body.password);
  if (problem) throw httpError(400, problem);
  user.passwordHash = auth.hashPassword(body.password);
  D().sessions = D().sessions.filter((s) => s.userId !== user.id || s.hash === session.hash);
  db.save();
  log.info('Password changed', { email: user.email });
});

const AUDIO_TYPES = { 'audio/webm': 'webm', 'video/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav' };
const VIDEO_TYPES = { 'video/webm': 'webm', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/x-matroska': 'mkv' };

// Voice and video recordings. ?kind=video for video; anything else is treated as audio.
route('POST', '/api/audio', { auth: 'user', raw: true }, ({ req, raw, user, query }) => {
  const video = query.kind === 'video';
  const type = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const ext = (video ? VIDEO_TYPES : AUDIO_TYPES)[type];
  if (!ext) throw httpError(415, `That ${video ? 'video' : 'audio'} format is not supported.`);
  if (!raw || raw.length < 200) throw httpError(400, 'The recording is empty. Record again, then send.');
  const maxMB = video ? (config.maxVideoMB || 150) : (config.maxUploadMB || 20);
  if (raw.length > maxMB * 1048576) throw httpError(413, `That recording is larger than ${maxMB} MB. Record a shorter one.`);
  const now = new Date();
  const id = U.uid();
  const rel = path.join(String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'), `${U.localDate(now)}_${U.localTime(now)}_${video ? 'video_' : ''}${id}.${ext}`);
  const file = path.join(paths.RECORDINGS, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, raw);
  const mime = video ? type : (type === 'video/webm' ? 'audio/webm' : type);
  D().audio.push({ id, kind: video ? 'video' : 'audio', file: rel, mime, ownerId: user.id, bytes: raw.length, createdAt: now.toISOString() });
  db.save();
  log.info(video ? 'Video saved' : 'Recording saved', { by: user.email, file: rel, bytes: raw.length });
  return { audioId: id };
});

const mediaKind = (a) => a.kind || 'audio';

function canHear(user, a) {
  if (a.ownerId === user.id || user.isAdmin) return true;
  const sentTo = (x) => (x.audioId === a.id || x.videoId === a.id || (x.forward && x.forward.audioId === a.id)) && x.recipientIds.includes(user.id);
  return D().requests.some(sentTo) || D().messages.some(sentTo);
}

route('GET', '/api/audio/:id', { auth: 'user' }, ({ req, res, params, user }) => {
  const a = D().audio.find((x) => x.id === params.id);
  if (!a || !canHear(user, a)) throw httpError(404, 'Recording not found.');
  const file = path.join(paths.RECORDINGS, a.file);
  let st;
  try { st = fs.statSync(file); } catch (_) { throw httpError(404, 'The recording file is missing from the server.'); }
  const total = st.size;
  const headers = { 'Content-Type': a.mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' };
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (m) {
    let start = m[1] ? parseInt(m[1], 10) : 0;
    let end = m[2] ? parseInt(m[2], 10) : total - 1;
    if (!m[1] && m[2]) { start = Math.max(0, total - parseInt(m[2], 10)); end = total - 1; }
    end = Math.min(end, total - 1);
    if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${total}` }); res.end(); return STREAMED; }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': total });
    fs.createReadStream(file).pipe(res);
  }
  return STREAMED;
});

/* -------------------------------------------------------------- worker API */

function isResolved(uid, key) {
  return D().updates.some((x) => x.userId === uid && (x.requestKeys || []).includes(key))
    || D().rejections.some((x) => x.userId === uid && x.requestKey === key)
    || D().attendance.some((x) => x.userId === uid && x.key === key);
}

// Today's standup meetings for this person, one per team that meets today.
function meetingsFor(u, date = U.localDate()) {
  return teamsOf(u.id).filter((t) => meetingOn(scheduleFor(t.id), date)).map((t) => {
    const s = scheduleFor(t.id);
    const key = `meet:${t.id}:${date}`;
    const joined = D().attendance.find((x) => x.userId === u.id && x.key === key);
    const declined = D().rejections.find((x) => x.userId === u.id && x.requestKey === key);
    const updated = D().updates.find((x) => x.userId === u.id && (x.requestKeys || []).includes(key));
    const status = joined ? 'joined' : declined ? 'declined' : updated ? 'updated' : 'open';
    return { key, kind: 'meeting', date, createdAt: null, teamId: t.id, teams: [t.name], time: s.meeting.time, endTime: s.meeting.endTime, link: s.meeting.link, notes: s.meeting.notes, status, joinedAt: joined ? joined.createdAt : null };
  });
}

// Everything waiting on this person. Meetings are listed all day (so "Join" stays
// available); only meetings with status "open" count as pending.
function pendingFor(u) {
  const today = U.localDate();
  const items = [];
  const scheduledTeams = teamsOf(u.id).filter((t) => scheduledOn(scheduleFor(t.id), today));
  if (scheduledTeams.length) {
    const key = `sched:${today}`;
    if (!isResolved(u.id, key)) items.push({ key, kind: 'scheduled', date: today, createdAt: null, teams: scheduledTeams.map((t) => t.name), deadline: scheduledDeadline(scheduledTeams.map((t) => t.id), today) });
  }
  const cutoff = Date.now() - 14 * 864e5;
  const mine = teamsOf(u.id).map((t) => t.id);
  for (const r of D().requests) {
    if (!r.recipientIds.includes(u.id) || Math.max(Date.parse(r.createdAt), r.deadline ? Date.parse(r.deadline) : 0) < cutoff) continue;
    const key = `req:${r.id}`;
    if (isResolved(u.id, key)) continue;
    items.push({ key, kind: 'request', date: dateOf(r.createdAt), createdAt: r.createdAt, from: fullName(userById(r.fromId)), text: r.text, audioId: r.audioId, videoId: r.videoId || null, deadline: r.deadline || null, teams: r.teamIds.filter((id) => mine.includes(id)).map(teamName) });
  }
  items.sort((a, b) => (b.createdAt || b.date).localeCompare(a.createdAt || a.date));
  return [...meetingsFor(u, today), ...items];
}
const openKeys = (u) => pendingFor(u).filter((p) => p.kind !== 'meeting' || p.status === 'open').map((p) => p.key);

// People a worker can share with: their teammates; plus the admins who already see their updates.
function circleOf(u) {
  const myTeams = teamsOf(u.id).map((t) => t.id);
  const teammates = sortPeople(membersOf(myTeams).filter((p) => p.id !== u.id));
  const admins = sortPeople(D().users.filter((a) => a.isAdmin && a.active && a.id !== u.id && adminTeamIds(a).some((id) => myTeams.includes(id))));
  return { teammates, admins };
}

function forwardUpdate(sender, upd, recipientIds, note, allowedIds) {
  const ids = U.unique(Array.isArray(recipientIds) ? recipientIds : []).filter((id) => id !== upd.userId && id !== sender.id);
  if (!ids.length) throw httpError(400, 'Choose at least one person.');
  for (const id of ids) if (!allowedIds.includes(id)) throw httpError(400, 'One of the selected people is not on your teams.');
  const msg = {
    id: U.uid(), fromId: sender.id, teamIds: upd.teamIds || [], recipientIds: ids, text: U.cleanText(note, 1000) || null, audioId: null,
    forward: { updateId: upd.id, authorId: upd.userId, type: upd.type, text: upd.text, audioId: upd.audioId, createdAt: upd.createdAt },
    createdAt: new Date().toISOString(),
  };
  D().messages.push(msg);
  log.info('Update shared', { by: sender.email, author: (userById(upd.userId) || {}).email, recipients: ids.length });
  return ids.length;
}

route('GET', '/api/worker/pending', { auth: 'user' }, ({ user }) => ({ items: pendingFor(user) }));

route('GET', '/api/worker/circle', { auth: 'user' }, ({ user }) => {
  const { teammates, admins } = circleOf(user);
  const myTeams = teamsOf(user.id).map((t) => t.id);
  return { teammates: teammates.map((u) => ({ ...personView(u), role: rolesOf(u.id, myTeams) })), admins: admins.map((a) => ({ id: a.id, name: fullName(a) })) };
});

route('POST', '/api/worker/updates', { auth: 'user' }, ({ user, body }) => {
  let text = null;
  let audioId = null;
  if (body.type === 'text') {
    text = U.cleanText(body.text, 5000);
    if (!text) throw httpError(400, 'Write your update before sending.');
  } else if (body.type === 'voice' || body.type === 'video') {
    // audioId holds the recording for both voice and video updates
    const a = D().audio.find((x) => x.id === body.audioId && x.ownerId === user.id);
    if (!a || (body.type === 'video') !== (mediaKind(a) === 'video')) throw httpError(400, 'Record your update before sending.');
    audioId = a.id;
  } else throw httpError(400, 'Choose text, voice or video.');

  // A specific request answers that request (plus today's scheduled standup);
  // a general update answers everything pending except meetings (you may still join those).
  const open = openKeys(user);
  let keys = open.filter((k) => !k.startsWith('meet:'));
  if (body.requestKey && open.includes(body.requestKey)) {
    keys = [body.requestKey, ...open.filter((k) => k.startsWith('sched:'))];
  }
  // Check the share list before saving anything, so a bad recipient can't leave a half-sent update.
  const shareWith = Array.isArray(body.shareWith) ? U.unique(body.shareWith) : [];
  const { teammates, admins } = circleOf(user);
  const allowed = [...teammates, ...admins].map((p) => p.id);
  for (const id of shareWith) if (!allowed.includes(id)) throw httpError(400, 'One of the selected people is not on your teams.');

  const now = new Date();
  const sched = pendingFor(user).find((p) => p.kind === 'scheduled' && keys.includes(p.key));
  const late = !!(sched && sched.deadline && now.getTime() > Date.parse(sched.deadline));
  const upd = { id: U.uid(), userId: user.id, type: body.type, text, audioId, teamIds: teamsOf(user.id).map((t) => t.id), requestKeys: U.unique(keys), late, createdAt: now.toISOString() };
  D().updates.push(upd);
  const shared = shareWith.length ? forwardUpdate(user, upd, shareWith, '', allowed) : 0;
  db.save();

  if (text) {
    const dir = path.join(paths.TEXT_UPDATES, U.localDate(now));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${U.localTime(now)}_${user.email.replace(/[^a-z0-9@._-]/gi, '_')}.txt`),
      `From: ${fullName(user)} <${user.email}>\nTeams: ${teamsOf(user.id).map((t) => t.name).join(', ') || '(none)'}\nSent: ${now.toString()}\n\n${text}\n`);
  }
  log.info('Update received', { by: user.email, type: body.type, answered: upd.requestKeys, shared });
  return { ok: true, answered: upd.requestKeys.length, shared };
});

route('POST', '/api/worker/forward', { auth: 'user' }, ({ user, body }) => {
  const upd = D().updates.find((x) => x.id === body.updateId && x.userId === user.id);
  if (!upd) throw httpError(404, 'Update not found.');
  const { teammates, admins } = circleOf(user);
  const n = forwardUpdate(user, upd, body.recipientIds, body.note, [...teammates, ...admins].map((p) => p.id));
  db.save();
  return { ok: true, recipients: n };
});

route('POST', '/api/worker/meeting/join', { auth: 'user' }, ({ user, body }) => {
  const m = meetingsFor(user).find((x) => x.key === body.key);
  if (!m) throw httpError(400, 'There is no standup meeting for you today.');
  if (!D().attendance.some((x) => x.userId === user.id && x.key === m.key)) {
    D().attendance.push({ id: U.uid(), userId: user.id, key: m.key, teamId: m.teamId, date: m.date, createdAt: new Date().toISOString() });
    db.save();
    log.info('Joined standup meeting', { by: user.email, team: m.teams[0] });
  }
  return { ok: true, link: m.link };
});

route('POST', '/api/worker/reject', { auth: 'user' }, ({ user, body }) => {
  if (!openKeys(user).includes(body.requestKey)) throw httpError(400, 'That request is no longer pending.');
  const reasons = U.unique((Array.isArray(body.reasons) ? body.reasons : []).filter((r) => REASONS[r]));
  if (!reasons.length) throw httpError(400, 'Pick at least one reason.');
  const otherText = U.cleanText(body.otherText, 500);
  if (reasons.includes('other') && !otherText) throw httpError(400, 'Describe the "Other" reason.');
  D().rejections.push({ id: U.uid(), userId: user.id, requestKey: body.requestKey, reasons, otherText: otherText || null, teamIds: teamsOf(user.id).map((t) => t.id), createdAt: new Date().toISOString() });
  db.save();
  log.info('Request declined', { by: user.email, key: body.requestKey, reasons });
});

route('GET', '/api/worker/messages', { auth: 'user' }, ({ user }) => {
  const cutoff = Date.now() - 60 * 864e5;
  const mine = teamsOf(user.id).map((t) => t.id);
  const items = D().messages
    .filter((m) => m.recipientIds.includes(user.id) && Date.parse(m.createdAt) >= cutoff)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((m) => ({
      id: m.id, from: fullName(userById(m.fromId)), teams: m.teamIds.filter((id) => mine.includes(id)).map(teamName),
      text: m.text, audioId: m.audioId, videoId: m.videoId || null, createdAt: m.createdAt, read: (m.readBy || []).includes(user.id),
      forward: m.forward ? { author: fullName(userById(m.forward.authorId)), own: m.forward.authorId === m.fromId, type: m.forward.type, text: m.forward.text, audioId: m.forward.audioId, createdAt: m.forward.createdAt } : null,
    }));
  return { items, unread: items.filter((i) => !i.read).length };
});

route('POST', '/api/worker/messages/read', { auth: 'user' }, ({ user }) => {
  for (const m of D().messages) {
    if (m.recipientIds.includes(user.id)) {
      m.readBy = m.readBy || [];
      if (!m.readBy.includes(user.id)) m.readBy.push(user.id);
    }
  }
  db.save();
});

route('GET', '/api/worker/history', { auth: 'user' }, ({ user }) => {
  const cutoff = Date.now() - 14 * 864e5;
  const mine = (x) => x.userId === user.id && Date.parse(x.createdAt) >= cutoff;
  const entries = [...D().updates.filter(mine).map(entryFromUpdate), ...D().rejections.filter(mine).map(entryFromRejection)];
  return { entries: entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
});

/* ------------------------------------------------------------ reports API */

function describeKey(k) {
  if (k.startsWith('sched:')) return 'Scheduled standup';
  if (k.startsWith('meet:')) return `Standup meeting (${teamName(k.split(':')[1])})`;
  const r = D().requests.find((x) => `req:${x.id}` === k);
  if (!r) return 'Request';
  return r.text ? `Request: ${r.text.length > 90 ? r.text.slice(0, 90) + '...' : r.text}` : 'Request (voice message)';
}

function entryBase(x) {
  const u = userById(x.userId);
  return { id: x.id, userId: x.userId, name: fullName(u), role: rolesOf(x.userId, x.teamIds || []), email: u ? u.email : '', teams: (x.teamIds || []).map(teamName), createdAt: x.createdAt };
}
function sharedWith(updateId) {
  const ids = U.unique(D().messages.filter((m) => m.forward && m.forward.updateId === updateId).flatMap((m) => m.recipientIds));
  return ids.map((id) => fullName(userById(id)));
}
const entryFromUpdate = (x) => ({ ...entryBase(x), kind: 'update', type: x.type, text: x.text, audioId: x.audioId, late: !!x.late, answering: (x.requestKeys || []).map(describeKey), sharedWith: sharedWith(x.id) });
const entryFromRejection = (x) => ({ ...entryBase(x), kind: 'declined', meeting: x.requestKey.startsWith('meet:'), reasons: x.reasons.map((r) => REASONS[r] || r), otherText: x.otherText, answering: [describeKey(x.requestKey)] });

route('GET', '/api/admin/reports', { auth: 'admin' }, ({ user, query }) => {
  const teamIds = scopeTeams(user, query.team);
  let from = U.localDate();
  let to = from;
  if (query.date) { if (!U.isDate(query.date)) throw httpError(400, 'Invalid date.'); from = to = query.date; }
  else if (query.from && query.to) {
    if (!U.isDate(query.from) || !U.isDate(query.to)) throw httpError(400, 'Invalid date range.');
    [from, to] = query.from <= query.to ? [query.from, query.to] : [query.to, query.from];
  }
  const keep = (x) => (x.teamIds || []).some((id) => teamIds.includes(id)) && (!query.user || x.userId === query.user)
    && dateOf(x.createdAt) >= from && dateOf(x.createdAt) <= to;
  const entries = [...D().updates.filter(keep).map(entryFromUpdate), ...D().rejections.filter(keep).map(entryFromRejection)]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  let outstanding = null;
  let dueBy = null;
  if (from === to && !query.user && from <= U.localDate()) {
    const scheduledTeams = teamIds.filter((id) => scheduledOn(scheduleFor(id), from));
    dueBy = scheduledTeams.length ? scheduledDeadline(scheduledTeams, from) : null;
    if (scheduledTeams.length) {
      const responded = new Set([...D().updates, ...D().rejections].filter((x) => dateOf(x.createdAt) === from).map((x) => x.userId));
      outstanding = sortPeople(membersOf(scheduledTeams).filter((p) => !responded.has(p.id))).map((p) => ({ id: p.id, name: fullName(p) }));
    }
  }
  let meetings = null;
  if (from === to && !query.user) {
    meetings = teamIds.filter((id) => meetingOn(scheduleFor(id), from)).map((id) => {
      const s = scheduleFor(id);
      const key = `meet:${id}:${from}`;
      const members = sortPeople(membersOf([id]));
      const joined = D().attendance.filter((x) => x.key === key);
      const declined = new Set(D().rejections.filter((x) => x.requestKey === key).map((x) => x.userId));
      const updated = new Set(D().updates.filter((x) => (x.requestKeys || []).includes(key)).map((x) => x.userId));
      const done = new Set([...joined.map((x) => x.userId), ...declined, ...updated]);
      return {
        teamId: id, team: teamName(id), time: s.meeting.time, endTime: s.meeting.endTime, link: s.meeting.link, notes: s.meeting.notes,
        joined: sortPeople(joined.map((x) => userById(x.userId)).filter(Boolean)).map((u) => ({ name: fullName(u), at: joined.find((x) => x.userId === u.id).createdAt })),
        cantAttend: members.filter((m) => declined.has(m.id)).map(fullName),
        sentUpdate: members.filter((m) => updated.has(m.id) && !declined.has(m.id)).map(fullName),
        noResponse: from <= U.localDate() ? members.filter((m) => !done.has(m.id)).map(fullName) : [],
      };
    });
  }
  return { from, to, entries, outstanding, dueBy, meetings };
});

route('POST', '/api/admin/forward', { auth: 'admin' }, ({ user, body }) => {
  const upd = D().updates.find((x) => x.id === body.updateId);
  const allowedTeams = adminTeamIds(user);
  if (!upd || !(upd.teamIds || []).some((id) => allowedTeams.includes(id))) throw httpError(404, 'Update not found.');
  const n = forwardUpdate(user, upd, body.recipientIds, body.note, membersOf(allowedTeams).map((p) => p.id));
  db.save();
  return { ok: true, recipients: n };
});

route('GET', '/api/admin/report-days', { auth: 'admin' }, ({ user, query }) => {
  const teamIds = scopeTeams(user, query.team);
  const month = /^\d{4}-\d{2}$/.test(query.month || '') ? query.month : U.localDate().slice(0, 7);
  const days = new Set();
  for (const x of [...D().updates, ...D().rejections]) {
    const d = dateOf(x.createdAt);
    if (d.startsWith(month) && (x.teamIds || []).some((id) => teamIds.includes(id)) && (!query.user || x.userId === query.user)) days.add(d);
  }
  return { month, days: [...days].sort() };
});

route('GET', '/api/admin/directory', { auth: 'admin' }, () => ({
  people: sortPeople(D().users.filter((u) => u.active)).map((u) => ({ id: u.id, email: u.email, firstName: u.firstName || '', lastName: u.lastName || '', name: fullName(u), teams: teamsOf(u.id).map((t) => t.name) })),
}));

route('GET', '/api/admin/people', { auth: 'admin' }, ({ user, query }) => {
  const teamIds = scopeTeams(user, query.team);
  return { people: sortPeople(membersOf(teamIds)).map((u) => ({ ...personView(u), role: rolesOf(u.id, teamIds) })) };
});

/* ------------------------------------------------- requests & messages API */

function createOutbound(kind, user, body) {
  const teamIds = scopeTeams(user, body.team);
  if (!teamIds.length) throw httpError(400, 'Create a team first in Edit Teams.');
  const members = membersOf(teamIds).filter((m) => m.id !== user.id);
  let recipientIds;
  if (!body.recipients || body.recipients === 'all') recipientIds = members.map((m) => m.id);
  else {
    const ids = U.unique(Array.isArray(body.recipients) ? body.recipients : []);
    for (const id of ids) if (!members.some((m) => m.id === id)) throw httpError(400, 'One of the selected workers is not on these teams.');
    recipientIds = ids;
  }
  if (!recipientIds.length) throw httpError(400, 'Choose at least one worker. Teams with no members can be filled in Edit Teams.');
  const text = U.cleanText(body.text, 5000) || null;
  let audioId = null;
  if (body.audioId) {
    const a = D().audio.find((x) => x.id === body.audioId && x.ownerId === user.id);
    if (!a) throw httpError(400, 'The voice message was not found. Record it again.');
    audioId = a.id;
  }
  let videoId = null;
  if (body.videoId) {
    const v = D().audio.find((x) => x.id === body.videoId && x.ownerId === user.id && mediaKind(x) === 'video');
    if (!v) throw httpError(400, 'The video was not found. Record it again.');
    videoId = v.id;
  }
  if (!text && !audioId && !videoId) throw httpError(400, 'Add a message before sending.');
  let deadline = null;
  if (kind === 'request' && body.deadline) {
    const t = Date.parse(body.deadline);
    if (isNaN(t)) throw httpError(400, 'The deadline is not a valid date and time.');
    if (t < Date.now() - 5 * 60e3) throw httpError(400, 'The deadline is in the past. Pick a later date or time.');
    if (t > Date.now() + 366 * 864e5) throw httpError(400, 'The deadline must be within a year.');
    deadline = new Date(t).toISOString();
  }
  const rec = { id: U.uid(), fromId: user.id, teamIds, recipientIds, text, audioId, videoId, deadline, createdAt: new Date().toISOString() };
  D()[kind === 'request' ? 'requests' : 'messages'].push(rec);
  db.save();
  log.info(kind === 'request' ? 'Update request sent' : 'Project update sent', { by: user.email, recipients: recipientIds.length });
  return { ok: true, recipients: recipientIds.length };
}

route('POST', '/api/admin/requests', { auth: 'admin' }, ({ user, body }) => createOutbound('request', user, body));
route('POST', '/api/admin/messages', { auth: 'admin' }, ({ user, body }) => createOutbound('message', user, body));

route('GET', '/api/admin/sent', { auth: 'admin' }, ({ user, query }) => {
  const list = query.kind === 'message' ? D().messages : D().requests;
  const allowed = adminTeamIds(user);
  const items = list.filter((x) => !x.forward && x.teamIds.some((id) => allowed.includes(id)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 15)
    .map((x) => {
      const key = `req:${x.id}`;
      const answered = query.kind === 'message' ? null : x.recipientIds.filter((id) => isResolved(id, key)).length;
      return { id: x.id, from: fullName(userById(x.fromId)), teams: x.teamIds.map(teamName), text: x.text, audioId: x.audioId, videoId: x.videoId || null, deadline: x.deadline || null, createdAt: x.createdAt, recipients: x.recipientIds.length, answered, read: query.kind === 'message' ? (x.readBy || []).length : null };
    });
  return { items };
});

/* ------------------------------------------------------------ schedules API */

route('GET', '/api/admin/schedules', { auth: 'admin' }, ({ user, query }) => {
  const teamIds = scopeTeams(user, query.team);
  return { schedules: teamIds.map((id) => ({ ...scheduleFor(id), teamName: teamName(id) })) };
});

route('PUT', '/api/admin/schedules', { auth: 'admin' }, ({ user, body }) => {
  const teamIds = scopeTeams(user, body.team);
  if (!teamIds.length) throw httpError(400, 'Create a team first in Edit Teams.');
  const dayList = (v) => U.unique((Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)).sort();
  const meetingDays = dayList(body.meetingDays);
  const days = dayList(body.days).filter((d) => !meetingDays.includes(d)); // a day is either an update day or a meeting day
  const m = body.meeting || {};
  const dayDeadlines = {};
  for (const [k, v] of Object.entries(body.dayDeadlines && typeof body.dayDeadlines === 'object' ? body.dayDeadlines : {})) {
    const t = String(v || '').trim();
    if (!t) continue;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw httpError(400, 'Enter each deadline like 12:00.');
    if (days.includes(Number(k))) dayDeadlines[Number(k)] = t; // only for "Send update" days
  }
  const meeting = { time: String(m.time || '').trim(), endTime: String(m.endTime || '').trim(), link: String(m.link || '').trim().slice(0, 2000), notes: U.cleanText(m.notes, 500) };
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (meeting.time && !hhmm.test(meeting.time)) throw httpError(400, 'Enter the meeting start time like 09:30.');
  if (meeting.endTime && !hhmm.test(meeting.endTime)) throw httpError(400, 'Enter the meeting end time like 09:45.');
  if (meeting.endTime && !meeting.time) throw httpError(400, 'Add a start time to go with the end time.');
  if (meeting.time && meeting.endTime && meeting.endTime <= meeting.time) throw httpError(400, 'The end time must be after the start time.');
  if (meeting.link && !/^https?:\/\/\S+$/i.test(meeting.link)) throw httpError(400, 'The meeting link must start with https:// (copy it from the meeting invitation).');
  if (meetingDays.length && !meeting.link && !meeting.notes) throw httpError(400, 'Add a meeting link, or a note saying where the meeting is (for example a room name).');
  const always = body.always !== false;
  const startDate = body.startDate || null;
  const endDate = body.endDate || null;
  if (!always) {
    if (!startDate && !endDate) throw httpError(400, 'Pick a start date, a stop date, or choose "Always".');
    if ((startDate && !U.isDate(startDate)) || (endDate && !U.isDate(endDate))) throw httpError(400, 'Invalid start or stop date.');
    if (startDate && endDate && startDate > endDate) throw httpError(400, 'The stop date must be on or after the start date.');
  }
  const excludedDates = U.unique((Array.isArray(body.excludedDates) ? body.excludedDates : []).filter(U.isDate)).sort();
  for (const teamId of teamIds) {
    const s = { teamId, days, dayDeadlines, meetingDays, meeting, always, startDate: always ? null : startDate, endDate: always ? null : endDate, excludedDates, updatedAt: new Date().toISOString(), updatedBy: user.id };
    const i = D().schedules.findIndex((x) => x.teamId === teamId);
    if (i >= 0) D().schedules[i] = s; else D().schedules.push(s);
  }
  db.save();
  log.info('Standup schedule saved', { by: user.email, teams: teamIds.map(teamName), days, meetingDays });
  return { ok: true, teams: teamIds.length };
});

/* ---------------------------------------------------------------- teams API */

function teamView(t) {
  return { id: t.id, name: t.name, description: t.description || '', members: sortPeople(t.memberIds.map(userById).filter(Boolean)).map((u) => ({ ...personView(u), role: roleIn(t, u.id) })) };
}

route('GET', '/api/admin/teams', { auth: 'admin' }, ({ user }) => {
  const ids = adminTeamIds(user);
  const teams = D().teams.filter((t) => ids.includes(t.id)).sort((a, b) => a.name.localeCompare(b.name)).map(teamView);
  return { teams };
});

function checkTeamName(name, exceptId) {
  const n = U.cleanText(name, 80);
  if (!n) throw httpError(400, 'Give the team a name.');
  if (D().teams.some((t) => t.id !== exceptId && t.name.toLowerCase() === n.toLowerCase())) throw httpError(409, 'A team with that name already exists.');
  return n;
}

route('POST', '/api/admin/teams', { auth: 'admin' }, ({ user, body }) => {
  const t = { id: U.uid(), name: checkTeamName(body.name), description: U.cleanText(body.description, 500), memberIds: [], createdAt: new Date().toISOString(), createdBy: user.id };
  D().teams.push(t);
  D().schedules.push(defaultSchedule(t.id));
  user.adminTeams = U.unique([...(user.adminTeams || []), t.id]);
  db.save();
  log.info('Team created', { by: user.email, team: t.name });
  return { team: teamView(t) };
});

function adminTeam(user, id) {
  const t = teamById(id);
  if (!t || !adminTeamIds(user).includes(t.id)) throw httpError(404, 'Team not found.');
  return t;
}

route('PUT', '/api/admin/teams/:id', { auth: 'admin' }, ({ user, params, body }) => {
  const t = adminTeam(user, params.id);
  t.name = checkTeamName(body.name, t.id);
  t.description = U.cleanText(body.description, 500);
  db.save();
  return { team: teamView(t) };
});

route('DELETE', '/api/admin/teams/:id', { auth: 'admin' }, ({ user, params }) => {
  const t = adminTeam(user, params.id);
  D().teams = D().teams.filter((x) => x.id !== t.id);
  D().schedules = D().schedules.filter((s) => s.teamId !== t.id);
  for (const u of D().users) u.adminTeams = (u.adminTeams || []).filter((id) => id !== t.id);
  db.save();
  log.info('Team deleted', { by: user.email, team: t.name });
});

route('POST', '/api/admin/teams/:id/members', { auth: 'admin' }, async ({ user, params, body }) => {
  const t = adminTeam(user, params.id);
  const email = U.normEmail(body.email);
  if (!U.isEmail(email)) throw httpError(400, 'Enter a valid email address.');
  let u = userByEmail(email);
  let created = false;
  if (!u) {
    const firstName = U.cleanText(body.firstName, 60);
    const lastName = U.cleanText(body.lastName, 60);
    if (!firstName || !lastName) throw httpError(400, 'Enter a first and last name for the new team member.');
    u = { id: U.uid(), email, firstName, lastName, passwordHash: null, isAdmin: false, isPrimary: false, adminTeams: [], active: true, createdAt: new Date().toISOString() };
    D().users.push(u);
    created = true;
  }
  if (t.memberIds.includes(u.id)) throw httpError(409, `${fullName(u)} is already on ${t.name}.`);
  t.memberIds.push(u.id);
  const role = U.cleanText(body.role, 60);
  if (role) { t.roles = t.roles || {}; t.roles[u.id] = role; }
  db.save();
  log.info('Team member added', { by: user.email, team: t.name, member: email });
  let invite = null;
  if (!u.passwordHash) {
    invite = body.sendInvite === false
      ? { delivered: false, skipped: true }
      : await sendSetupEmail(u, user, `added you to the ${t.name} team`);
  }
  return { team: teamView(t), created, invite };
});

route('PUT', '/api/admin/teams/:id/members/:uid', { auth: 'admin' }, ({ user, params, body }) => {
  const t = adminTeam(user, params.id);
  if (!t.memberIds.includes(params.uid)) throw httpError(404, 'That person is not on this team.');
  const role = U.cleanText(body.role, 60);
  t.roles = t.roles || {};
  if (role) t.roles[params.uid] = role; else delete t.roles[params.uid];
  db.save();
  return { team: teamView(t) };
});

route('DELETE', '/api/admin/teams/:id/members/:uid', { auth: 'admin' }, ({ user, params }) => {
  const t = adminTeam(user, params.id);
  t.memberIds = t.memberIds.filter((id) => id !== params.uid);
  db.save();
  log.info('Team member removed', { by: user.email, team: t.name, member: (userById(params.uid) || {}).email });
  return { team: teamView(t) };
});

route('POST', '/api/admin/users/:id/invite', { auth: 'admin' }, async ({ user, params }) => {
  const u = userById(params.id);
  const shared = u && teamsOf(u.id).some((t) => adminTeamIds(user).includes(t.id));
  if (!u || (!shared && !user.isPrimary)) throw httpError(404, 'Person not found.');
  return { invite: await sendSetupEmail(u, user, `sent you a new sign-up link`) };
});

/* ----------------------------------------------------------- administrators */

const adminView = (u) => ({ ...personView(u), isPrimary: !!u.isPrimary, adminTeams: adminTeamIds(u).map((id) => ({ id, name: teamName(id) })) });

route('GET', '/api/admin/admins', { auth: 'admin' }, ({ user }) => {
  const admins = D().users.filter((u) => u.isAdmin && u.active);
  const covered = new Set(admins.flatMap((u) => adminTeamIds(u)));
  return {
    admins: sortPeople(admins).map(adminView),
    // Teams this person may assign (all teams for a Primary Administrator).
    assignable: assignableTeamIds(user).map((id) => ({ id, name: teamName(id) })).sort((a, b) => a.name.localeCompare(b.name)),
    unadministered: user.isPrimary ? D().teams.filter((t) => !covered.has(t.id)).map((t) => t.name).sort() : [],
  };
});

route('POST', '/api/admin/admins', { auth: 'admin' }, async ({ user, body }) => {
  const email = U.normEmail(body.email);
  if (!U.isEmail(email)) throw httpError(400, 'Enter a valid email address.');
  const allowed = assignableTeamIds(user);
  const teamIds = U.unique(Array.isArray(body.teamIds) ? body.teamIds : []);
  for (const id of teamIds) if (!allowed.includes(id)) throw httpError(403, 'You can only grant access to teams you administer.');
  if (!teamIds.length && !user.isPrimary) throw httpError(400, 'Select at least one team.');
  let u = userByEmail(email);
  if (!u) {
    const firstName = U.cleanText(body.firstName, 60);
    const lastName = U.cleanText(body.lastName, 60);
    if (!firstName || !lastName) throw httpError(400, 'Enter a first and last name for the new administrator.');
    u = { id: U.uid(), email, firstName, lastName, passwordHash: null, isAdmin: false, isPrimary: false, adminTeams: [], active: true, createdAt: new Date().toISOString() };
    D().users.push(u);
  }
  u.isAdmin = true;
  u.adminTeams = U.unique([...(u.adminTeams || []), ...teamIds]);
  db.save();
  log.info('Administrator added', { by: user.email, admin: email, teams: teamIds.map(teamName) });
  let invite = null;
  if (!u.passwordHash) invite = await sendSetupEmail(u, user, 'made you an administrator');
  else {
    await mailer.send(config, { to: u.email, subject: `You're now an administrator in ${APP_NAME}`, text: `Hi ${u.firstName || 'there'},\n\n${fullName(user)} made you an administrator for: ${teamIds.map(teamName).join(', ') || 'no teams yet'}.\n\nOpen the Admin Portal at ${baseUrl()}/admin\n` });
  }
  return { admin: adminView(u), invite };
});

route('PUT', '/api/admin/admins/:id', { auth: 'admin' }, ({ user, params, body }) => {
  const u = userById(params.id);
  if (!u || !u.isAdmin) throw httpError(404, 'Administrator not found.');
  if (u.isPrimary && !user.isPrimary) throw httpError(403, 'Only a Primary Administrator can change a Primary Administrator\'s teams.');
  // You can only add or remove teams that you administer yourself; their other teams stay as they are.
  const mine = assignableTeamIds(user);
  const wanted = (Array.isArray(body.teamIds) ? body.teamIds : []).filter((id) => mine.includes(id));
  const kept = (u.adminTeams || []).filter((id) => !mine.includes(id) && teamById(id));
  u.adminTeams = U.unique([...kept, ...wanted]);
  db.save();
  log.info('Administrator teams changed', { by: user.email, admin: u.email, teams: u.adminTeams.map(teamName) });
  return { admin: adminView(u) };
});

const primaryCount = () => D().users.filter((u) => u.isAdmin && u.isPrimary && u.active).length;

route('POST', '/api/admin/admins/:id/primary', { auth: 'primary' }, ({ user, params, body }) => {
  const u = userById(params.id);
  if (!u || !u.isAdmin) throw httpError(404, 'Administrator not found.');
  if (body.primary) u.isPrimary = true;
  else {
    if (u.isPrimary && primaryCount() <= 1) throw httpError(400, 'There must always be at least one Primary Administrator. Make someone else primary first.');
    u.isPrimary = false;
  }
  db.save();
  log.info(body.primary ? 'Primary Administrator assigned' : 'Primary Administrator removed', { by: user.email, admin: u.email });
  return { admin: adminView(u) };
});

route('DELETE', '/api/admin/admins/:id', { auth: 'primary' }, ({ user, params }) => {
  const u = userById(params.id);
  if (!u || !u.isAdmin) throw httpError(404, 'Administrator not found.');
  if (u.isPrimary && primaryCount() <= 1) throw httpError(400, 'You cannot remove the last Primary Administrator.');
  u.isAdmin = false;
  u.isPrimary = false;
  u.adminTeams = [];
  db.save();
  log.info('Administrator removed', { by: user.email, admin: u.email });
});

route('POST', '/api/admin/test-email', { auth: 'primary' }, async ({ user }) => {
  const r = await mailer.send(config, { to: user.email, subject: `${APP_NAME} test email`, text: `This is a test email from ${APP_NAME} at ${baseUrl()}.\nIf you can read this, email delivery works.\n` });
  return { delivered: r.delivered, reason: r.reason, error: r.error };
});

/* ------------------------------------------------------------- edit names */

route('PUT', '/api/admin/users/:id', { auth: 'admin' }, ({ user, params, body }) => {
  const u = userById(params.id);
  const shared = u && teamsOf(u.id).some((t) => adminTeamIds(user).includes(t.id));
  if (!u || (!shared && !user.isPrimary && u.id !== user.id)) throw httpError(404, 'Person not found.');
  const firstName = U.cleanText(body.firstName, 60);
  const lastName = U.cleanText(body.lastName, 60);
  if (!firstName || !lastName) throw httpError(400, 'Enter a first and last name.');
  const before = fullName(u);
  u.firstName = firstName;
  u.lastName = lastName;
  db.save();
  log.info('Name changed', { by: user.email, person: u.email, from: before, to: fullName(u) });
  return { person: personView(u) };
});

/* --------------------------------------------------------- storage cleanup */
// Retention settings live in the database (meta.retention) so a Primary Administrator can
// change them in the Administrator Portal. 0 days = keep forever.
const RETENTION_DEFAULTS = { messagesDays: 60, updatesDays: 60 };
const MESSAGE_CHOICES = [30, 60, 90, 180, 365, 0];
const UPDATE_CHOICES = MESSAGE_CHOICES; // same choices for both settings
const retention = () => ({ ...RETENTION_DEFAULTS, ...(D().meta.retention || {}) });

function cleanup() {
  const d = D();
  const r = retention();
  const now = Date.now();
  const older = (iso, days) => days > 0 && Date.parse(iso) < now - days * 864e5;
  const c = { messages: 0, requests: 0, updates: 0, declines: 0, attendance: 0, recordings: 0, textFiles: 0, freedMB: 0, total: 0 };
  const drop = (key, keep, counter) => { const n = d[key].length; d[key] = d[key].filter(keep); c[counter] += n - d[key].length; };

  if (r.messagesDays > 0) {
    drop('messages', (m) => !older(m.createdAt, r.messagesDays), 'messages');
    // requests stay while their deadline is recent, so open requests never vanish early
    drop('requests', (q) => !older(q.createdAt, r.messagesDays) || (q.deadline && !older(q.deadline, 14)), 'requests');
  }
  if (r.updatesDays > 0) {
    drop('updates', (x) => !older(x.createdAt, r.updatesDays), 'updates');
    drop('rejections', (x) => !older(x.createdAt, r.updatesDays), 'declines');
    drop('attendance', (x) => !older(x.createdAt, r.updatesDays), 'attendance');
    const cutoffDay = U.localDate(new Date(now - r.updatesDays * 864e5));
    try {
      for (const dir of fs.readdirSync(paths.TEXT_UPDATES)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(dir) && dir < cutoffDay) {
          const full = path.join(paths.TEXT_UPDATES, dir);
          c.textFiles += fs.readdirSync(full).length;
          fs.rmSync(full, { recursive: true, force: true });
        }
      }
    } catch (_) {}
  }

  // Recordings nothing refers to any more (and at least a day old, so nothing being sent right now).
  const used = new Set();
  for (const x of d.updates) if (x.audioId) used.add(x.audioId);
  for (const x of [...d.messages, ...d.requests]) {
    if (x.audioId) used.add(x.audioId);
    if (x.videoId) used.add(x.videoId);
    if (x.forward && x.forward.audioId) used.add(x.forward.audioId);
  }
  let freed = 0;
  d.audio = d.audio.filter((a) => {
    if (used.has(a.id) || !older(a.createdAt, 1)) return true;
    try { fs.unlinkSync(path.join(paths.RECORDINGS, a.file)); } catch (_) {}
    freed += a.bytes || 0;
    c.recordings++;
    return false;
  });
  c.freedMB = Math.round(freed / 104857.6) / 10;
  c.total = c.messages + c.requests + c.updates + c.declines + c.attendance + c.recordings + c.textFiles;
  if (c.total) { db.save(); log.info('Cleanup removed old items', c); }
  return c;
}

function storageStats() {
  const d = D();
  let dbBytes = 0;
  try { dbBytes = fs.statSync(paths.DB).size; } catch (_) {}
  const mb = (b) => Math.round(b / 104857.6) / 10;
  const media = (kind) => d.audio.filter((a) => (a.kind || 'audio') === kind);
  return {
    databaseMB: mb(dbBytes),
    voiceMB: mb(media('audio').reduce((n, a) => n + (a.bytes || 0), 0)), voiceCount: media('audio').length,
    videoMB: mb(media('video').reduce((n, a) => n + (a.bytes || 0), 0)), videoCount: media('video').length,
    messages: d.messages.length, requests: d.requests.length, updates: d.updates.length,
  };
}

route('GET', '/api/admin/retention', { auth: 'primary' }, () => ({
  retention: retention(), stats: storageStats(), choices: { messagesDays: MESSAGE_CHOICES, updatesDays: UPDATE_CHOICES },
}));

route('PUT', '/api/admin/retention', { auth: 'primary' }, ({ user, body }) => {
  const m = Number(body.messagesDays);
  const u = Number(body.updatesDays);
  if (!MESSAGE_CHOICES.includes(m) || !UPDATE_CHOICES.includes(u)) throw httpError(400, 'Choose one of the listed options.');
  D().meta.retention = { messagesDays: m, updatesDays: u };
  db.save();
  log.info('Retention settings changed', { by: user.email, messagesDays: m, updatesDays: u });
  return { retention: retention() };
});

route('POST', '/api/admin/retention/run', { auth: 'primary' }, ({ user }) => {
  const removed = cleanup();
  log.info('Cleanup run by hand', { by: user.email, ...removed });
  return { removed, stats: storageStats() };
});

/* ------------------------------------------------------------ static files */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};
const PAGES = { '/': 'index.html', '/login': 'index.html', '/worker': 'worker.html', '/admin': 'admin.html', '/reset': 'reset.html', '/downloads': 'downloads.html' };

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  let base = paths.PUBLIC;
  let rel = PAGES[pathname.replace(/\/$/, '') || '/'] || pathname.replace(/^\/+/, '');
  let download = false;
  if (pathname.startsWith('/downloads/') && pathname !== '/downloads/') {
    base = paths.INSTALLERS;
    rel = pathname.slice('/downloads/'.length);
    download = !/\.(txt|md)$/i.test(rel);
  }
  const file = path.resolve(base, rel);
  if (!file.startsWith(base + path.sep)) { res.writeHead(404); res.end('Not found'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    const ext = path.extname(file).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': ext === '.html' || ext === '.js' || ext === '.css' ? 'no-cache' : 'public, max-age=600' };
    if (download) headers['Content-Disposition'] = `attachment; filename="${path.basename(file).replace(/[^\w.\- ']/g, '_')}"`;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
}

route('GET', '/api/downloads', { auth: 'public' }, () => {
  const list = (dir) => {
    try {
      const base = path.join(paths.INSTALLERS, dir);
      return fs.readdirSync(base).filter((f) => !f.startsWith('.') && fs.statSync(path.join(base, f)).isFile())
        .map((f) => ({ name: f, url: `/downloads/${dir}/${encodeURIComponent(f)}` }));
    } catch (_) { return []; }
  };
  const desktop = list('desktop').filter((f) => f.name.endsWith('.zip'));
  return { worker: list('worker'), admin: list('admin'), desktop, certificate: list('certificate') };
});

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=(self), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
}

async function handle(req, res) {
  securityHeaders(res);
  const url = new URL(req.url, 'http://localhost');
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch (_) { res.writeHead(400); res.end(); return; }
  if (pathname.startsWith('/api/')) return handleApi(req, res, url, pathname);
  return serveStatic(req, res, pathname);
}

/* ------------------------------------------------------------------- start */

const onRequest = (req, res) => handle(req, res).catch((e) => {
  log.error('Unhandled request error', { err: e.stack || e.message });
  try { res.writeHead(500); res.end(); } catch (_) {}
});

let server;
if (config.https && config.https.enabled) {
  const p = (f) => path.resolve(paths.ROOT, f);
  server = https.createServer({ key: fs.readFileSync(p(config.https.keyFile)), cert: fs.readFileSync(p(config.https.certFile)) }, onRequest);
} else {
  server = http.createServer(onRequest);
}

server.listen(config.port, config.host || '0.0.0.0', () => {
  log.info(`${APP_NAME} v${VERSION} is running`, { url: baseUrl(), worker: `${baseUrl()}/worker`, admin: `${baseUrl()}/admin`, folder: paths.ROOT });
  console.log(`\n  ${APP_NAME} v${VERSION}\n  App folder: ${paths.ROOT}\n  Open:       ${baseUrl()}/admin\n  Keep this window open. Press Ctrl+C to stop the server.\n`);
  try { const c = cleanup(); if (c.total) log.info('Startup cleanup finished', c); } catch (e) { log.error('Cleanup failed', { err: e.message }); }
  const mail = mailer.status(config);
  if (mail.ok) log.info(`Email: ${mail.message}`); else log.warn(`Email: ${mail.message} Emails will be saved to data/outbox/.`);
  if (!config.https || !config.https.enabled) {
    log.warn('HTTPS is off. Browsers only allow voice recording over HTTPS (or on localhost). See README.md, "Turning on HTTPS".');
  }
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  ${APP_NAME} could NOT start: port ${config.port} is already in use.\n`
      + `  Most likely the server is already running in another window (possibly an older version).\n`
      + `  Close that window (or press Ctrl+C in it), then run npm start again.\n`);
  }
  log.error('Server failed to start', { err: e.message, code: e.code });
  process.exit(1);
});

setInterval(housekeeping, 3600e3).unref();
const shutdown = () => { log.info('Shutting down'); db.flush(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
