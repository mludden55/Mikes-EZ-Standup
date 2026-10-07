'use strict';
(async function () {
  const token = new URLSearchParams(location.search).get('token') || '';
  const intro = $('#intro');
  let info;
  try { info = await api('/api/reset/check?token=' + encodeURIComponent(token), { allow401: true }); } catch (_) { info = { valid: false }; }
  if (!info.valid) {
    $('#title').textContent = 'This link has expired';
    intro.textContent = 'Password links work once and expire (reset links after 1 hour, invitations after 7 days). Use "Forgot password?" on the sign-in page to get a new one.';
    return;
  }
  if (info.welcome) {
    $('#title').textContent = `Welcome${info.firstName ? ', ' + info.firstName : ''}`;
    intro.textContent = `Create a password for ${info.email} to start using Mike's EZ Standup.`;
    $('#save').textContent = 'Create password and sign in';
  } else {
    intro.textContent = `Choose a new password for ${info.email}.`;
  }
  $('#pw').closest('.field').after(passwordHelper($('#pw'), $('#pw2')));
  $('#reset-form').classList.remove('hidden');
  $('#pw').focus();
  $('#reset-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#err');
    err.classList.add('hidden');
    if ($('#pw').value !== $('#pw2').value) { err.textContent = 'The passwords do not match.'; err.classList.remove('hidden'); return; }
    try {
      const r = await busy($('#save'), () => api('/api/reset', { method: 'POST', body: { token, password: $('#pw').value }, allow401: true }));
      location.replace(r.home);
    } catch (x) { err.textContent = x.message; err.classList.remove('hidden'); }
  });
})();
