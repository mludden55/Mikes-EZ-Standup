'use strict';
(async function () {
  await loadAppInfo();
  const next = new URLSearchParams(location.search).get('next');
  const safeNext = next && /^\/(worker|admin)/.test(next) ? next : null;

  try {
    const { user: me } = await api('/api/session', { allow401: true });
    if (me) { location.replace(safeNext || (me.isAdmin ? '/admin' : '/worker')); return; }
  } catch (_) {}

  // Point people to the "trust certificate" helper when the server uses its own certificate.
  if (location.protocol === 'https:') {
    api('/api/downloads', { allow401: true }).then((d) => { if (d.certificate && d.certificate.length) $('#cert-hint').classList.remove('hidden'); }).catch(() => {});
  }
  const loginPanel = $('#login-panel');
  const forgotPanel = $('#forgot-panel');
  $('#show-forgot').addEventListener('click', (e) => { e.preventDefault(); $('#forgot-email').value = $('#email').value; loginPanel.classList.add('hidden'); forgotPanel.classList.remove('hidden'); $('#forgot-email').focus(); });
  $('#show-login').addEventListener('click', (e) => { e.preventDefault(); forgotPanel.classList.add('hidden'); loginPanel.classList.remove('hidden'); $('#email').focus(); });
  $('#email').focus();

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#login-error');
    err.classList.add('hidden');
    const email = $('#email').value.trim();
    const password = $('#password').value;
    if (!email || !password) { err.textContent = 'Enter your email and password.'; err.classList.remove('hidden'); return; }
    try {
      const r = await busy($('#login-btn'), () => api('/api/login', { method: 'POST', body: { email, password, remember: $('#remember').checked }, allow401: true }));
      // Ask the browser (or the desktop app) to offer saving the password.
      if (window.PasswordCredential && $('#remember').checked) {
        try { await navigator.credentials.store(new PasswordCredential({ id: email, password, name: r.user.name })); } catch (_) {}
      }
      location.replace(safeNext && (safeNext.startsWith('/worker') || r.user.isAdmin) ? safeNext : r.home);
    } catch (x) { err.textContent = x.message; err.classList.remove('hidden'); }
  });

  $('#forgot-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#forgot-msg');
    const email = $('#forgot-email').value.trim();
    if (!email) { msg.textContent = 'Enter your email address.'; msg.className = 'notice error'; return; }
    try {
      const r = await busy($('#forgot-btn'), () => api('/api/forgot', { method: 'POST', body: { email }, allow401: true }));
      msg.textContent = r.message + ' Check your inbox (and spam folder).';
      msg.className = 'notice';
    } catch (x) { msg.textContent = x.message; msg.className = 'notice error'; }
  });
})();
