/* Shared helpers for Mike's EZ Standup portals. No framework, no build step. */
'use strict';

/* ---------- DOM builder (never uses innerHTML for user data) */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'svg') el.innerHTML = v; // static icon markup only
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (['value', 'checked', 'disabled', 'selected', 'hidden'].includes(k)) el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of kids.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
const $ = (sel, root = document) => root.querySelector(sel);
/* replaceChildren that skips null/false (plain replaceChildren would render the text "null") */
function fill(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
  return el;
}

const ICONS = {
  mic: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  camera: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="6" width="13" height="12" rx="2"/><path d="M15.5 10.5l6-3.5v10l-6-3.5z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  text: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 11h16M4 16h10"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M7 5v14l12-7z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  send: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12l16-8-6 16-2-7z"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  chart: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  ask: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3 2.4c-.5.2-.5.6-.5 1.1M12 16h.01"/></svg>',
  megaphone: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11v2a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1zM17 9a4 4 0 0 1 0 6"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  team: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/></svg>',
  shield: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
};
const icon = (name) => h('span', { class: 'ico', svg: ICONS[name] });

/* ---------- API */
async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
  if (opts.blob) { init.body = opts.blob; init.headers['Content-Type'] = opts.blob.type || 'application/octet-stream'; }
  else if (opts.body !== undefined) { init.body = JSON.stringify(opts.body); init.headers['Content-Type'] = 'application/json'; }
  let res;
  try { res = await fetch(path, init); } catch (_) { throw new Error('Cannot reach the server. Check your network connection.'); }
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (res.status === 401 && !opts.allow401) {
    location.href = '/?next=' + encodeURIComponent(location.pathname + location.hash);
    throw new Error('Please sign in.');
  }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status}).`);
  if (init.method !== 'GET' && typeof desktopPoll === 'function') desktopPoll();
  return data;
}
const uploadAudio = async (blob) => (await api('/api/audio', { method: 'POST', blob })).audioId;
const uploadVideo = async (blob) => (await api('/api/audio?kind=video', { method: 'POST', blob })).audioId;

let APP = { name: "Mike's EZ Standup", reasons: {}, maxRecordingSeconds: 180, donationUrl: '' };
async function loadAppInfo() {
  try { APP = await api('/api/app-info', { allow401: true }); } catch (_) {}
  return APP;
}

/* ---------- feedback */
let toastTimer;
function toast(msg, kind) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = h('div', { class: 'toast' + (kind === 'error' ? ' error' : ''), role: kind === 'error' ? 'alert' : 'status' }, msg);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), kind === 'error' ? 6000 : 3200);
}
const showError = (e) => toast(e && e.message ? e.message : String(e), 'error');

async function busy(btn, fn) {
  const was = btn.disabled;
  btn.disabled = true;
  try { return await fn(); } finally { btn.disabled = was; }
}

/* ---------- dates */
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => ymd(new Date());
const parseDay = (s) => new Date(s + 'T12:00:00');
const fmtDay = (s) => parseDay(s).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const fmtDayShort = (s) => parseDay(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const fmtTime = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const fmtDateTime = (iso) => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtDeadline = (iso) => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const addDays = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return ymd(d); };

/* ---------- players for stored recordings */
const mediaUrl = (id) => `/api/audio/${encodeURIComponent(id)}`;
const audioPlayer = (audioId) => h('audio', { controls: true, preload: 'none', src: mediaUrl(audioId) });
const videoPlayer = (videoId) => h('video', { class: 'video-player', controls: true, preload: 'metadata', playsinline: true, src: mediaUrl(videoId) });
// type: 'voice' | 'video'
const mediaPlayer = (type, id) => (type === 'video' ? videoPlayer(id) : audioPlayer(id));

/* ---------- Recorder for voice or video: Record / Replay / Delete. The caller adds its own Send button.
   Video: call startPreview() to turn the camera on before recording, so people can see it works. */
function createRecorder({ onChange, video = false } = {}) {
  const maxSec = APP.maxRecordingSeconds || 180;
  const what = video ? 'video' : 'recording';
  let mediaRec = null;
  let stream = null;
  let chunks = [];
  let blob = null;
  let started = 0;
  let tick = null;
  let player = null;
  let playUrl = null;
  let previewing = false;   // camera on, not recording
  let wantPreview = false;  // caller asked for the camera preview
  let problem = null;       // camera/microphone problem being shown

  const talk = h('button', { class: 'talk', type: 'button', 'aria-label': 'Record', svg: video ? ICONS.camera : ICONS.mic });
  const screen = video ? h('video', { class: 'video-screen', playsinline: true, muted: true }) : null;
  const idleTitle = h('strong');
  const idleText = h('div', { class: 'small' });
  const retryBtn = h('button', { class: 'btn small hidden', type: 'button' }, 'Try again');
  const idle = video ? h('div', { class: 'video-idle' }, h('div', null, idleTitle, idleText, retryBtn)) : null;
  const screenWrap = video ? h('div', { class: 'video-wrap' }, screen, idle) : null;
  const timer = h('div', { class: 'timer', 'aria-live': 'off' }, '0:00');
  const hint = () => (video && previewing ? 'Camera is on. Tap the button to start recording' : 'Tap to record') + ` (up to ${Math.round(maxSec / 60)} minutes).`;
  const status = h('div', { class: 'rec-status', role: 'status' }, hint());
  const replayBtn = h('button', { class: 'btn', type: 'button', disabled: true }, icon('play'), 'Replay');
  const deleteBtn = h('button', { class: 'btn danger', type: 'button', disabled: true }, icon('trash'), 'Delete');
  const recordLabel = h('span', null, 'Record');
  const recordBtn = h('button', { class: 'btn', type: 'button' }, icon(video ? 'camera' : 'mic'), recordLabel);
  const el = h('div', { class: 'recorder' + (video ? ' is-video' : '') }, screenWrap, talk, timer, status, h('div', { class: 'rec-controls' }, recordBtn, replayBtn, deleteBtn));

  const fmt = (s) => `${Math.floor(s / 60)}:${pad(Math.floor(s % 60))}`;
  const recording = () => !!(mediaRec && mediaRec.state === 'recording');
  const changed = () => { if (onChange) onChange(!!blob); };
  const refresh = () => {
    const rec = recording();
    talk.classList.toggle('recording', rec);
    talk.innerHTML = rec ? ICONS.stop : (video ? ICONS.camera : ICONS.mic);
    talk.setAttribute('aria-label', rec ? 'Stop recording' : 'Record');
    talk.disabled = recordBtn.disabled = !!problem && !rec;
    recordLabel.textContent = rec ? 'Stop' : blob ? 'Record again' : 'Record';
    replayBtn.disabled = rec || !blob;
    deleteBtn.disabled = rec || !blob;
    if (screenWrap) {
      screenWrap.classList.toggle('live', rec || previewing || !!blob);
      screenWrap.classList.toggle('problem', !!problem);
    }
  };
  function setIdle(title, text, canRetry) {
    if (!idle) return;
    idleTitle.textContent = title || '';
    idleText.textContent = text || '';
    retryBtn.classList.toggle('hidden', !canRetry);
  }

  function pickType() {
    if (!window.MediaRecorder) return '';
    const list = video
      ? ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4']
      : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    for (const t of list) if (MediaRecorder.isTypeSupported(t)) return t;
    return '';
  }

  // Explains what's wrong in plain words. Returns { title, text } or null when all is well.
  async function checkDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      return window.isSecureContext
        ? { title: 'Recording isn\'t supported here', text: 'Try Chrome, Edge, Firefox or Safari, or use the desktop app.' }
        : { title: 'Recording needs a secure connection', text: 'Use the desktop app, or ask your administrator to turn on HTTPS. You can still send a text update.' };
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (video && !devices.some((d) => d.kind === 'videoinput')) return { title: 'No camera found', text: 'Connect a camera or turn it on, then choose Try again. Or go back and send a voice or text update.' };
      if (!devices.some((d) => d.kind === 'audioinput')) return { title: 'No microphone found', text: 'Connect a microphone or headset, then choose Try again.' };
    } catch (_) { /* fall through to getUserMedia, which reports its own errors */ }
    return null;
  }
  function explain(e) {
    const n = e && e.name;
    const dev = video ? 'camera' : 'microphone';
    if (n === 'NotAllowedError' || n === 'SecurityError') return { title: `${video ? 'Camera' : 'Microphone'} access is blocked`, text: `Allow the ${dev} for this site (click the ${dev} icon in the address bar, or check Windows Settings > Privacy > ${video ? 'Camera' : 'Microphone'}), then choose Try again.` };
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return { title: `No ${dev} found`, text: `Connect a ${dev}, then choose Try again.` };
    if (n === 'NotReadableError' || n === 'AbortError') return { title: `The ${dev} is busy`, text: `Another app (such as Teams or Zoom) may be using it. Close that app, then choose Try again.` };
    return { title: `Couldn't start the ${dev}`, text: (e && e.message) || 'Choose Try again.' };
  }
  function showProblem(p) {
    problem = p;
    status.textContent = video ? 'Recording is available once the camera works.' : `${p.title}. ${p.text}`;
    setIdle(p.title, p.text, true);
    refresh();
  }

  async function getStream() {
    return navigator.mediaDevices.getUserMedia(video
      ? { audio: true, video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24 } } }
      : { audio: true });
  }
  function releaseStream() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    previewing = false;
  }

  async function startPreview() {
    wantPreview = true;
    if (!video || recording() || blob || previewing) return;
    problem = null;
    setIdle('Starting camera...', '', false);
    refresh();
    const p = await checkDevices();
    if (p) { showProblem(p); return; }
    try { stream = await getStream(); } catch (e) { showProblem(explain(e)); return; }
    if (!wantPreview || blob) { releaseStream(); return; } // closed or switched away meanwhile
    previewing = true;
    showLive();
    status.textContent = hint();
    refresh();
  }
  function stopPreview() {
    wantPreview = false;
    if (previewing && !recording()) {
      releaseStream();
      if (screen) screen.srcObject = null;
      setIdle('Camera is off', '', false);
      refresh();
    }
  }

  function showLive() {
    if (!screen) return;
    screen.controls = false;
    screen.muted = true;
    screen.removeAttribute('src');
    screen.srcObject = stream;
    screen.play().catch(() => {});
  }
  function showRecorded() {
    if (!screen) return;
    screen.srcObject = null;
    if (playUrl) URL.revokeObjectURL(playUrl);
    playUrl = URL.createObjectURL(blob);
    screen.src = playUrl;
    screen.muted = false;
    screen.controls = true;
  }

  async function start() {
    if (blob && !confirm(`Replace the ${what} you just made?`)) return;
    if (!(video && previewing && stream)) {
      problem = null;
      const p = await checkDevices();
      if (p) { showProblem(p); return; }
      try { stream = await getStream(); } catch (e) { showProblem(explain(e)); return; }
    }
    problem = null;
    previewing = false;
    stopPlayback();
    blob = null;
    chunks = [];
    const type = pickType();
    const opts = type ? { mimeType: type } : {};
    if (video) { opts.videoBitsPerSecond = 1000000; opts.audioBitsPerSecond = 64000; } // about 8 MB per minute
    mediaRec = new MediaRecorder(stream, opts);
    mediaRec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    mediaRec.onstop = () => {
      const mime = (mediaRec.mimeType || type || (video ? 'video/webm' : 'audio/webm')).split(';')[0];
      blob = new Blob(chunks, { type: mime });
      releaseStream();
      clearInterval(tick);
      status.textContent = 'Recorded. Replay it, delete it, or send it.';
      showRecorded();
      refresh();
      changed();
    };
    showLive();
    mediaRec.start(250);
    started = Date.now();
    timer.textContent = '0:00';
    status.textContent = 'Recording... tap again to stop.';
    tick = setInterval(() => {
      const s = (Date.now() - started) / 1000;
      timer.textContent = fmt(s);
      if (s >= maxSec) stop();
    }, 250);
    refresh();
    changed();
  }

  function stop() { if (recording()) mediaRec.stop(); }
  function stopPlayback() {
    if (screen && !screen.srcObject) screen.pause();
    if (player) { player.pause(); URL.revokeObjectURL(player.src); player = null; }
    replayBtn.lastChild.textContent = 'Replay';
  }
  function toggle() { if (recording()) stop(); else start(); }

  talk.addEventListener('click', toggle);
  recordBtn.addEventListener('click', toggle);
  retryBtn.addEventListener('click', () => { problem = null; startPreview(); });
  replayBtn.addEventListener('click', () => {
    if (video) {
      if (!screen.paused) { screen.pause(); return; }
      screen.currentTime = 0;
      screen.play().catch(() => {});
      return;
    }
    if (player) { stopPlayback(); return; }
    player = new Audio(URL.createObjectURL(blob));
    player.onended = stopPlayback;
    player.play();
    replayBtn.lastChild.textContent = 'Stop replay';
  });
  deleteBtn.addEventListener('click', () => {
    if (!confirm(`Delete this ${what}?`)) return;
    reset();
  });

  function reset() {
    stop();
    stopPlayback();
    blob = null;
    chunks = [];
    if (screen) { screen.removeAttribute('src'); screen.srcObject = null; screen.controls = false; screen.load(); }
    if (playUrl) { URL.revokeObjectURL(playUrl); playUrl = null; }
    timer.textContent = '0:00';
    status.textContent = hint();
    refresh();
    changed();
    if (video && wantPreview) startPreview(); // back to the live camera, ready to record again
  }
  function destroy() { wantPreview = false; stop(); stopPlayback(); releaseStream(); clearInterval(tick); }

  if (video) setIdle('Camera is off', '', false);
  refresh();
  return { el, getBlob: () => blob, isRecording: recording, reset, destroy, startPreview, stopPreview, kind: video ? 'video' : 'voice' };
}

/* ---------- Time picker: hour / minute / AM-PM dropdowns (AM always listed above PM).
   value() and set() use 24-hour "HH:MM" text, or '' when empty. */
function createTimePicker({ id, value = '', allowEmpty = true, step = 5, label = 'Time', onChange } = {}) {
  const hour = h('select', { id, 'aria-label': `${label}: hour` }, allowEmpty ? h('option', { value: '' }, '--') : null,
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => h('option', { value: String(n) }, String(n))));
  const minute = h('select', { 'aria-label': `${label}: minutes` }, allowEmpty ? h('option', { value: '' }, '--') : null);
  for (let m = 0; m < 60; m += step) minute.append(h('option', { value: pad(m) }, pad(m)));
  const ampm = h('select', { 'aria-label': `${label}: AM or PM` }, h('option', { value: 'AM' }, 'AM'), h('option', { value: 'PM' }, 'PM'));
  const clearBtn = allowEmpty ? h('button', { class: 'btn ghost small', type: 'button', 'aria-label': `Clear ${label}` }, 'Clear') : null;
  const el = h('div', { class: 'time-pick' }, hour, h('span', { 'aria-hidden': 'true' }, ':'), minute, ampm, clearBtn);

  function get() {
    if (!hour.value) return '';
    const h12 = parseInt(hour.value, 10) % 12;
    return `${pad(h12 + (ampm.value === 'PM' ? 12 : 0))}:${minute.value || '00'}`;
  }
  function set(v) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(v || '');
    if (!m) { hour.value = allowEmpty ? '' : '12'; minute.value = allowEmpty ? '' : '00'; ampm.value = allowEmpty ? 'AM' : 'PM'; return; }
    const H = parseInt(m[1], 10);
    hour.value = String(H % 12 === 0 ? 12 : H % 12);
    if (![...minute.options].some((o) => o.value === m[2])) minute.append(h('option', { value: m[2] }, m[2]));
    minute.value = m[2];
    ampm.value = H >= 12 ? 'PM' : 'AM';
  }
  const fire = () => { if (onChange) onChange(get()); };
  hour.addEventListener('change', () => { if (hour.value && !minute.value) minute.value = '00'; if (!hour.value) minute.value = ''; fire(); });
  minute.addEventListener('change', () => { if (minute.value && !hour.value) hour.value = '9'; fire(); });
  ampm.addEventListener('change', fire);
  if (clearBtn) clearBtn.addEventListener('click', () => { set(''); fire(); });
  set(value);
  return { el, value: get, set };
}

/* ---------- Month calendar */
function createCalendar({ isSelected = () => false, isMarked = () => false, isExcluded = () => false, onSelect, onMonthChange, month } = {}) {
  let view = month ? parseDay(month + '-01') : new Date();
  view = new Date(view.getFullYear(), view.getMonth(), 1);
  const title = h('span');
  const prev = h('button', { class: 'btn ghost small', type: 'button', 'aria-label': 'Previous month' }, '<');
  const next = h('button', { class: 'btn ghost small', type: 'button', 'aria-label': 'Next month' }, '>');
  const grid = h('div', { class: 'cal-grid' });
  const el = h('div', { class: 'cal' }, h('div', { class: 'cal-head' }, prev, title, next), grid);
  const monthKey = () => `${view.getFullYear()}-${pad(view.getMonth() + 1)}`;

  function render() {
    title.textContent = view.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    fill(grid, ...['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => h('div', { class: 'cal-dow' }, d)));
    const first = new Date(view);
    first.setDate(1 - first.getDay());
    const today = todayStr();
    for (let i = 0; i < 42; i++) {
      const d = new Date(first);
      d.setDate(first.getDate() + i);
      const s = ymd(d);
      const cls = ['cal-day'];
      if (d.getMonth() !== view.getMonth()) cls.push('out');
      if (s === today) cls.push('today');
      if (isMarked(s)) cls.push('marked');
      if (isExcluded(s)) cls.push('excluded');
      if (isSelected(s)) cls.push('selected');
      grid.append(h('button', { class: cls.join(' '), type: 'button', 'aria-label': fmtDay(s), 'aria-pressed': isSelected(s) || isExcluded(s) ? 'true' : 'false', onClick: () => onSelect && onSelect(s) }, d.getDate()));
    }
  }
  const go = (n) => { view.setMonth(view.getMonth() + n); render(); if (onMonthChange) onMonthChange(monthKey()); };
  prev.addEventListener('click', () => go(-1));
  next.addEventListener('click', () => go(1));
  render();
  return { el, render, month: monthKey };
}

/* ---------- Team selector: shown only when the admin has more than one team */
function teamSelect(teams, { includeAll = true, value, onChange } = {}) {
  if (teams.length <= 1) {
    return { el: null, value: () => (teams[0] ? teams[0].id : 'all') };
  }
  const sel = h('select', { id: 'team-select', onChange: () => onChange && onChange(sel.value) },
    includeAll ? h('option', { value: 'all' }, 'All teams') : null,
    teams.map((t) => h('option', { value: t.id }, t.name)));
  if (value) sel.value = value;
  const el = h('div', { class: 'field' }, h('label', { for: 'team-select' }, 'Team'), sel);
  return { el, value: () => sel.value };
}

/* ---------- Header + change password + footer, shared by both portals */
function renderTopbar(me, { portal }) {
  const bar = $('#topbar');
  const pwBtn = h('button', { class: 'btn ghost small', type: 'button', onClick: () => passwordDialog() }, 'Change password');
  const logout = h('button', { class: 'btn small', type: 'button', onClick: async () => { await api('/api/logout', { method: 'POST', allow401: true }).catch(() => {}); location.href = '/'; } }, 'Sign out');
  const other = portal === 'worker'
    ? (me.isAdmin ? h('a', { class: 'btn ghost small', href: '/admin' }, 'Admin Portal') : null)
    : h('a', { class: 'btn ghost small', href: '/worker' }, 'Worker Portal');
  fill(bar, h('div', { class: 'topbar-inner' },
    h('a', { class: 'brand', href: portal === 'admin' ? '/admin#home' : '/worker' }, h('img', { src: '/img/logo.svg', alt: '' }), h('span', null, APP.name), portal === 'admin' ? h('small', null, 'Admin') : null),
    h('div', { class: 'topbar-right' }, h('span', { class: 'who' }, me.name), other, pwBtn, logout)));
  const foot = $('#footer');
  if (foot) {
    fill(foot, h('span', null, `${APP.name} v${APP.version || ''}. Free to use.`),
      APP.donationUrl ? h('span', null, ' If it helps your team, ', h('a', { href: APP.donationUrl, target: '_blank', rel: 'noopener' }, 'support its development'), '.') : null);
  }
}

/* ---------- Strong password suggestions + strength meter */
// 16 random characters in groups of 4 (about 90 bits), without look-alikes such as 0/O and 1/l/I.
function suggestPassword() {
  const lower = 'abcdefghijkmnpqrstuvwxyz', upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ', digits = '23456789';
  const all = lower + upper + digits;
  for (;;) {
    const r = new Uint32Array(16);
    crypto.getRandomValues(r);
    let out = '';
    for (let i = 0; i < 16; i++) { if (i && i % 4 === 0) out += '-'; out += all[r[i] % all.length]; }
    if (/[a-z]/.test(out) && /[A-Z]/.test(out) && /[2-9]/.test(out)) return out;
  }
}

function passwordStrength(pw) {
  if (!pw) return { label: '', level: 0 };
  if (pw.length < 8) return { label: 'Too short (at least 8 characters)', level: 1 };
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
  const common = /^(password|passw0rd|welcome|letmein|qwerty|abc123|iloveyou|admin|standup)/i.test(pw) || /^(.)\1+$/.test(pw) || /^(0123|1234|2345|abcd)/i.test(pw);
  if (common) return { label: 'Weak: too easy to guess', level: 1 };
  if (pw.length >= 16 || (pw.length >= 12 && classes >= 3)) return { label: 'Strong', level: 3 };
  if (pw.length >= 10 && classes >= 2) return { label: 'Good', level: 2 };
  return { label: 'Weak: use 12+ characters with a mix of letters and numbers', level: 1 };
}

// Adds "Suggest a strong password", "Show", a strength meter and "Copy" under a new-password field.
function passwordHelper(pw, pw2) {
  const meter = h('div', { class: 'pw-meter', 'aria-live': 'polite' }, h('span', { class: 'bar' }), h('span', { class: 'label' }));
  const showBtn = h('button', { class: 'btn ghost small', type: 'button' }, 'Show');
  const copyBtn = h('button', { class: 'btn ghost small hidden', type: 'button' }, 'Copy');
  const suggestBtn = h('button', { class: 'btn small', type: 'button' }, 'Suggest a strong password');
  const note = h('p', { class: 'muted small hidden' }, 'Save it in your password manager, or let the browser or app remember it when you sign in.');
  const setVisible = (v) => { pw.type = pw2.type = v ? 'text' : 'password'; showBtn.textContent = v ? 'Hide' : 'Show'; };
  const update = () => {
    const st = passwordStrength(pw.value);
    meter.dataset.level = st.level;
    meter.lastChild.textContent = st.label;
    copyBtn.classList.toggle('hidden', !pw.value);
  };
  showBtn.addEventListener('click', () => setVisible(pw.type === 'password'));
  suggestBtn.addEventListener('click', () => {
    pw.value = pw2.value = suggestPassword();
    setVisible(true);
    note.classList.remove('hidden');
    update();
  });
  copyBtn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(pw.value); copyBtn.textContent = 'Copied'; }
    catch (_) { pw.select(); copyBtn.textContent = 'Press Ctrl+C'; }
    setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
  });
  pw.addEventListener('input', update);
  update();
  return h('div', { class: 'pw-tools' }, meter, h('div', { class: 'btn-row' }, suggestBtn, showBtn, copyBtn), note);
}

function passwordDialog() {
  const cur = h('input', { type: 'password', id: 'pw-cur', autocomplete: 'current-password', required: true });
  const nw = h('input', { type: 'password', id: 'pw-new', autocomplete: 'new-password', minlength: '8', required: true });
  const nw2 = h('input', { type: 'password', id: 'pw-new2', autocomplete: 'new-password', required: true });
  const err = h('p', { class: 'notice error hidden', role: 'alert' });
  const save = h('button', { class: 'btn primary', type: 'submit' }, 'Change password');
  const dlg = h('dialog', null, h('form', { method: 'dialog' },
    h('h2', null, 'Change password'),
    h('div', { class: 'field' }, h('label', { for: 'pw-cur' }, 'Current password'), cur),
    h('div', { class: 'field' }, h('label', { for: 'pw-new' }, 'New password (at least 8 characters)'), nw),
    h('div', { class: 'field' }, h('label', { for: 'pw-new2' }, 'Confirm new password'), nw2),
    passwordHelper(nw, nw2),
    err,
    h('div', { class: 'btn-row' }, save, h('button', { class: 'btn', type: 'button', onClick: () => dlg.close() }, 'Cancel'))));
  dlg.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    err.classList.add('hidden');
    if (nw.value !== nw2.value) { err.textContent = 'The new passwords do not match.'; err.classList.remove('hidden'); return; }
    try {
      await busy(save, () => api('/api/me/password', { method: 'POST', body: { current: cur.value, password: nw.value } }));
      dlg.close();
      toast('Password changed');
    } catch (x) { err.textContent = x.message; err.classList.remove('hidden'); }
  });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

/* ---------- Report / history entries, grouped by day */
// onForward(entry): when given, update cards get a "Forward" button.
function renderEntries(entries, { showName = true, dayHeadings = true, onForward = null } = {}) {
  const groups = new Map();
  for (const e of entries) {
    const day = ymd(new Date(e.createdAt));
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(e);
  }
  return h('div', null, [...groups.entries()].map(([day, list]) => h('div', { class: 'day-group' },
    dayHeadings ? h('h3', null, fmtDay(day)) : null,
    h('div', { class: 'entries' }, list.map((e) => entryCard(e, showName, onForward))))));
}

function entryCard(e, showName = true, onForward = null) {
  const fwd = onForward && e.kind === 'update'
    ? h('button', { class: 'btn ghost small', type: 'button', onClick: () => onForward(e) }, icon('send'), 'Forward')
    : null;
  const head = h('div', { class: 'entry-head' },
    showName ? h('strong', null, e.name) : null,
    showName && e.role ? h('span', { class: 'muted small' }, e.role) : null,
    e.kind === 'declined' ? h('span', { class: 'chip warn' }, e.meeting ? 'Can\'t attend meeting' : 'Rejected request') : h('span', { class: 'chip ok' }, e.type === 'voice' ? 'Voice' : e.type === 'video' ? 'Video' : 'Text'),
    e.late ? h('span', { class: 'chip late' }, 'Late') : null,
    h('span', { class: 'chips' }, (e.teams || []).map((t) => h('span', { class: 'chip' }, t))),
    h('time', { datetime: e.createdAt }, fmtTime(e.createdAt)), fwd);
  let body;
  if (e.kind === 'declined') {
    body = h('div', { class: 'body' }, e.reasons.join(', '), e.otherText ? ` - "${e.otherText}"` : '');
  } else {
    body = e.type === 'voice' || e.type === 'video' ? mediaPlayer(e.type, e.audioId) : h('div', { class: 'body' }, e.text);
  }
  const ctx = e.answering && e.answering.length ? h('div', { class: 'context' }, 'Answering: ', e.answering.join('; ')) : null;
  const shared = e.sharedWith && e.sharedWith.length ? h('div', { class: 'context' }, 'Shared with: ', e.sharedWith.join(', ')) : null;
  return h('article', { class: 'entry' + (e.kind === 'declined' ? ' declined' : '') }, head, body, ctx, shared);
}

/* ---------- Pick people + optional note, used to forward updates */
function forwardDialog({ title, subtitle, people, onSend }) {
  const search = h('input', { type: 'text', id: 'fwd-search', placeholder: 'Filter by name', autocomplete: 'off' });
  const list = h('div', { class: 'pick-list' });
  const note = h('textarea', { id: 'fwd-note', maxlength: '1000', style: 'min-height:70px', placeholder: 'Optional: why you are sharing this' });
  const err = h('p', { class: 'notice error hidden', role: 'alert' });
  const send = h('button', { class: 'btn primary', type: 'button' }, icon('send'), 'Forward');
  const boxes = people.map((p) => {
    const cb = h('input', { type: 'checkbox', value: p.id });
    const row = h('label', { class: 'check', 'data-name': (p.name + ' ' + (p.email || '')).toLowerCase() }, cb, p.name, p.sub ? h('span', { class: 'muted small' }, ' ', p.sub) : null);
    return row;
  });
  fill(list, boxes.length ? boxes : h('p', { class: 'muted' }, 'There is nobody else on your teams yet.'));
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    boxes.forEach((b) => b.classList.toggle('hidden', !!q && !b.dataset.name.includes(q)));
  });
  const dlg = h('dialog', null,
    h('h2', null, title), subtitle ? h('p', { class: 'muted' }, subtitle) : null,
    people.length > 8 ? h('div', { class: 'field' }, search) : null,
    h('div', { class: 'field' }, h('label', null, 'Send to'), list),
    h('div', { class: 'field' }, h('label', { for: 'fwd-note' }, 'Note'), note),
    err,
    h('div', { class: 'btn-row' }, send, h('button', { class: 'btn', type: 'button', onClick: () => dlg.close() }, 'Cancel')));
  send.addEventListener('click', () => busy(send, async () => {
    const ids = [...list.querySelectorAll('input:checked')].map((c) => c.value);
    if (!ids.length) { err.textContent = 'Choose at least one person.'; err.classList.remove('hidden'); return; }
    try {
      const n = await onSend(ids, note.value);
      dlg.close();
      toast(`Forwarded to ${n} ${n === 1 ? 'person' : 'people'}`);
    } catch (x) { err.textContent = x.message; err.classList.remove('hidden'); }
  }));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

/* ---------- Meeting helpers */
function fmtClock(hhmm) {
  if (!hhmm) return '';
  const [hr, mi] = hhmm.split(':').map(Number);
  const d = new Date(); d.setHours(hr, mi, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
function meetingService(link) {
  if (!link) return 'In person';
  if (/teams\.(microsoft|live)\.com/i.test(link)) return 'Microsoft Teams';
  if (/zoom\.us/i.test(link)) return 'Zoom';
  if (/meet\.google\.com/i.test(link)) return 'Google Meet';
  if (/webex\.com/i.test(link)) return 'Webex';
  if (/slack\.com/i.test(link)) return 'Slack huddle';
  return 'Online meeting';
}

/* ---------- Desktop app (WebView2) integration */
const IN_DESKTOP = !!(window.chrome && window.chrome.webview);
function desktopPoll() { if (IN_DESKTOP) { try { window.chrome.webview.postMessage('poll'); } catch (_) {} } }
if (IN_DESKTOP) {
  document.documentElement.classList.add('in-desktop');
  window.addEventListener('load', desktopPoll);
}

/* ---------- PWA install support (not needed inside the desktop app) */
if (!IN_DESKTOP && 'serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
