'use strict';
/* Worker portal: Send Updates (voice / text), Pending Requests, Messages, My Updates */
(async function () {
  await loadAppInfo();
  const me = await api('/api/me');
  renderTopbar(me, { portal: 'worker' });

  const view = $('#view');
  const state = { tab: 'send', screen: 'choose', answering: null, pending: [], recorder: null, circle: { teammates: [], admins: [] } };
  const tabs = { send: $('#tab-send'), pending: $('#tab-pending'), messages: $('#tab-messages'), history: $('#tab-history') };
  for (const [name, btn] of Object.entries(tabs)) btn.addEventListener('click', () => show(name));

  // Pending Requests holds update requests only. Meetings are shown on the Send Updates tab
  // all day (so "Join" is always handy) and are not counted as pending.
  const openItems = () => state.pending.filter((p) => p.kind !== 'meeting');
  const meetings = () => state.pending.filter((p) => p.kind === 'meeting');

  async function refreshCounts() {
    try {
      const [p, m] = await Promise.all([api('/api/worker/pending'), api('/api/worker/messages')]);
      state.pending = p.items;
      const n = openItems().length;
      const pc = $('#pending-count');
      pc.textContent = n;
      pc.classList.toggle('hidden', !n);
      const mc = $('#msg-count');
      mc.textContent = m.unread;
      mc.classList.toggle('hidden', !m.unread);
    } catch (e) { showError(e); }
  }

  async function loadCircle() {
    try { state.circle = await api('/api/worker/circle'); } catch (_) {}
  }

  function show(tab) {
    if (state.recorder) { state.recorder.destroy(); state.recorder = null; }
    state.tab = tab;
    for (const [name, btn] of Object.entries(tabs)) btn.setAttribute('aria-selected', String(name === tab));
    if (tab === 'send') renderSend();
    if (tab === 'pending') renderPending();
    if (tab === 'messages') renderMessages();
    if (tab === 'history') renderHistory();
  }

  /* ---------------------------------------------------------------- meetings */
  async function markJoined(m) {
    try {
      await api('/api/worker/meeting/join', { method: 'POST', body: { key: m.key } });
      await refreshCounts();
      if (state.tab === 'pending') renderPending();
      else if (state.tab === 'send' && state.screen === 'choose') renderSend();
    } catch (e) { showError(e); }
  }

  // A real link (not a script-opened window) so pop-up blockers never get in the way.
  function joinButton(m, label) {
    if (!m.link) return h('button', { class: 'btn primary', type: 'button', onClick: () => markJoined(m) }, label || 'I\'m attending');
    return h('a', { class: 'btn primary', href: m.link, target: '_blank', rel: 'noopener noreferrer', onClick: () => markJoined(m) }, label || 'Join meeting');
  }

  const meetingWhen = (m) => [m.time ? fmtClock(m.time) + (m.endTime ? ' to ' + fmtClock(m.endTime) : '') : null, meetingService(m.link)].filter(Boolean).join(' · ');

  /* ------------------------------------------------------------ send updates */
  function answeringBanner() {
    if (!state.answering) return null;
    const p = state.answering;
    const label = p.kind === 'scheduled' ? `the ${fmtDay(p.date)} standup${p.deadline ? ' (due by ' + fmtTime(p.deadline) + ')' : ''}`
      : p.kind === 'meeting' ? `today's ${p.teams[0]} standup meeting (instead of attending)`
        : `${p.from}'s request from ${fmtDayShort(p.date)}${p.deadline ? ' (due by ' + fmtDeadline(p.deadline) + ')' : ''}`;
    return h('div', { class: 'banner' }, h('span', null, `Answering ${label}.`),
      h('button', { class: 'btn small ghost', type: 'button', onClick: () => { state.answering = null; renderSend(); } }, 'Send a general update instead'));
  }

  function renderSend() {
    if (state.recorder) { state.recorder.destroy(); state.recorder = null; }
    if (state.screen === 'voice') return renderRecorded(false);
    if (state.screen === 'video') return renderRecorded(true);
    if (state.screen === 'text') return renderText();
    const waiting = openItems();
    const pendingNote = !state.answering && waiting.length
      ? h('p', { class: 'muted' }, `You have ${waiting.length} pending request${waiting.length > 1 ? 's' : ''}. Sending an update answers ${waiting.length > 1 ? 'them' : 'it'}.`)
      : null;
    fill(view,
      state.answering ? null : (meetings().length ? h('div', { class: 'notes', style: 'margin-bottom:1.25rem' }, meetings().map(meetingNote)) : null),
      answeringBanner(),
      h('h1', null, `${greeting()}, ${me.firstName || me.name}. What's your update?`),
      pendingNote,
      h('div', { class: 'choices three' },
        h('button', { class: 'choice', type: 'button', onClick: () => { state.screen = 'text'; renderSend(); } },
          h('span', { class: 'icon', svg: ICONS.text }), h('strong', null, 'Text'), h('span', null, 'Type what you did, what\'s next, and any blockers.')),
        h('button', { class: 'choice', type: 'button', onClick: () => { state.screen = 'voice'; renderSend(); } },
          h('span', { class: 'icon', svg: ICONS.mic }), h('strong', null, 'Voice'), h('span', null, 'Record a short spoken update.')),
        h('button', { class: 'choice', type: 'button', onClick: () => { state.screen = 'video'; renderSend(); } },
          h('span', { class: 'icon', svg: ICONS.camera }), h('strong', null, 'Video'), h('span', null, 'Record a short video, e.g. to show a demo.'),
          h('span', { class: 'note-line' }, 'Video files are large. Use video only when you need to show something.'))));
  }

  function greeting() {
    const hr = new Date().getHours();
    return hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  }

  function screenHead(title) {
    return h('div', { class: 'screen-head' },
      h('button', { class: 'btn ghost small', type: 'button', onClick: () => { if (leaveOk()) { state.screen = 'choose'; renderSend(); } } }, icon('back'), 'Back'),
      h('h2', null, title));
  }
  let dirty = () => false;
  const leaveOk = () => !dirty() || confirm('Discard this update?');

  // "Sending to": admins are always included (they see every update in Reports);
  // teammates can be ticked to also get it in their Messages tab.
  function shareBox() {
    const { admins, teammates } = state.circle;
    const adminBox = h('input', { type: 'checkbox', checked: true, disabled: true });
    const adminNames = admins.length ? admins.map((a) => a.name).join(', ') : '';
    const boxes = teammates.map((p) => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: p.id }), p.name,
      h('span', { class: 'muted small' }, ' ', [p.role, p.teams.map((t) => t.name).join(', ')].filter(Boolean).join(' · '))));
    const list = h('div', { class: boxes.length > 7 ? 'pick-scroll' : '' }, boxes);
    const el = h('div', { class: 'share-box' },
      h('label', null, 'Sending to'),
      h('label', { class: 'check' }, adminBox, h('span', null, h('strong', null, 'Admins'), ' (always included)', adminNames ? h('span', { class: 'muted small' }, ' ', adminNames) : null)),
      teammates.length ? h('p', { class: 'muted small', style: 'margin:.5rem 0 .25rem' }, 'Also send to team members:') : null,
      teammates.length ? list : null);
    return { el, ids: () => [...list.querySelectorAll('input:checked')].map((c) => c.value) };
  }

  async function sent(r) {
    state.screen = 'choose';
    state.answering = null;
    dirty = () => false;
    await refreshCounts();
    const waiting = openItems().length;
    const parts = [];
    if (r.answered) parts.push(`It answered ${r.answered} pending request${r.answered > 1 ? 's' : ''}.`);
    else parts.push('Your admins can see it now.');
    if (r.shared) parts.push(`Shared with ${r.shared} teammate${r.shared > 1 ? 's' : ''}.`);
    fill(view, h('div', { class: 'panel empty' },
      h('h2', null, 'Update sent'),
      h('p', null, parts.join(' ')),
      h('div', { class: 'btn-row', style: 'justify-content:center' },
        h('button', { class: 'btn', type: 'button', onClick: () => renderSend() }, 'Send another update'),
        waiting ? h('button', { class: 'btn primary', type: 'button', onClick: () => show('pending') }, `See ${waiting} pending item${waiting > 1 ? 's' : ''}`) : null)));
  }

  function renderRecorded(video) {
    const share = shareBox();
    const sendBtn = h('button', { class: 'btn primary', type: 'button', disabled: true }, icon('send'), 'Send');
    const rec = createRecorder({ video, onChange: (has) => { sendBtn.disabled = !has || rec.isRecording(); } });
    state.recorder = rec;
    dirty = () => !!rec.getBlob();
    sendBtn.addEventListener('click', () => busy(sendBtn, async () => {
      try {
        const audioId = video ? await uploadVideo(rec.getBlob()) : await uploadAudio(rec.getBlob());
        const r = await api('/api/worker/updates', { method: 'POST', body: { type: video ? 'video' : 'voice', audioId, requestKey: state.answering && state.answering.key, shareWith: share.ids() } });
        rec.destroy();
        state.recorder = null;
        toast('Update sent');
        await sent(r);
      } catch (e) { showError(e); }
    }));
    fill(view, answeringBanner(), h('div', { class: 'panel' }, screenHead(video ? 'Video update' : 'Voice update'),
      h('p', { class: 'muted' }, 'Cover what you did yesterday, what you\'re doing today, and anything blocking you.'),
      rec.el, share.el, h('div', { class: 'actions-bar' }, sendBtn)));
    if (video) rec.startPreview();
  }

  // The template stays in the box as real text: click next to a label and type.
  const TEMPLATE = 'Yesterday: \nToday: \nBlockers: ';
  const isBlank = (t) => !t.replace(/^\s*(yesterday|today|blockers)\s*:/gim, '').trim();

  function renderText() {
    let text = '';
    let mode = 'empty'; // empty | editing | review
    const share = shareBox();
    const area = h('textarea', { id: 'update-text', maxlength: '5000' });
    const editor = h('div', { class: 'field hidden' }, h('label', { for: 'update-text' }, 'Your update'),
      h('p', { class: 'muted small' }, 'Click after each label and type. You can add more lines anywhere.'), area);
    const preview = h('div', { class: 'hidden' }, h('h3', null, 'Review before sending'), h('div', { class: 'preview' }));
    const hint = h('p', { class: 'muted' }, 'Choose Create to start writing.');
    const createBtn = h('button', { class: 'btn', type: 'button' }, icon('text'), 'Create');
    const reviewBtn = h('button', { class: 'btn', type: 'button' }, 'Review');
    const deleteBtn = h('button', { class: 'btn danger', type: 'button' }, icon('trash'), 'Delete');
    const sendBtn = h('button', { class: 'btn primary', type: 'button' }, icon('send'), 'Send');
    dirty = () => !isBlank(text);

    function sync() {
      text = area.value;
      const has = !isBlank(text);
      editor.classList.toggle('hidden', mode !== 'editing');
      preview.classList.toggle('hidden', mode !== 'review');
      hint.classList.toggle('hidden', mode !== 'empty');
      preview.lastChild.textContent = text.trim();
      createBtn.lastChild.textContent = mode === 'review' ? 'Edit' : 'Create';
      createBtn.disabled = mode === 'editing';
      reviewBtn.disabled = !has || mode === 'review';
      deleteBtn.disabled = !has;
      sendBtn.disabled = !has;
    }
    area.addEventListener('input', sync);
    createBtn.addEventListener('click', () => {
      const fresh = !area.value.trim();
      if (fresh) area.value = TEMPLATE;
      mode = 'editing';
      sync();
      area.focus();
      if (fresh) { const pos = 'Yesterday: '.length; area.setSelectionRange(pos, pos); }
    });
    reviewBtn.addEventListener('click', () => { mode = 'review'; sync(); });
    deleteBtn.addEventListener('click', () => { if (!confirm('Delete this update?')) return; area.value = ''; mode = 'empty'; sync(); });
    sendBtn.addEventListener('click', () => busy(sendBtn, async () => {
      try {
        const r = await api('/api/worker/updates', { method: 'POST', body: { type: 'text', text, requestKey: state.answering && state.answering.key, shareWith: share.ids() } });
        toast('Update sent');
        await sent(r);
      } catch (e) { showError(e); }
    }));
    fill(view, answeringBanner(), h('div', { class: 'panel' }, screenHead('Text update'), hint, editor, preview, share.el,
      h('div', { class: 'actions-bar' }, createBtn, reviewBtn, deleteBtn, sendBtn)));
    sync();
  }

  /* -------------------------------------------------------- pending requests */
  async function renderPending() {
    fill(view, h('p', { class: 'muted' }, 'Loading...'));
    await refreshCounts();
    if (state.tab !== 'pending') return;
    const list = openItems();
    const meetNote = meetings().length ? h('p', { class: 'muted' }, 'Today\'s standup meeting is on the ', h('a', { href: '#send' }, 'Send Updates'), ' tab.') : null;
    if (!list.length) {
      fill(view, h('div', { class: 'panel empty' }, h('h2', null, 'You\'re all caught up'),
        h('p', null, 'Update requests from your admins and scheduled update days show up here.'), meetNote,
        h('button', { class: 'btn', type: 'button', onClick: () => show('send') }, 'Send an update anyway')));
      return;
    }
    fill(view, h('h1', null, 'Pending requests'), meetNote, h('div', { class: 'notes' }, list.map(noteFor)));
  }

  const answer = (p) => { state.answering = p; state.screen = 'choose'; show('send'); };

  function noteFor(p) {
    const meta = p.kind === 'scheduled'
      ? `Scheduled standup for ${p.teams.join(', ')}`
      : `Request from ${p.from} at ${fmtTime(p.createdAt)}${p.teams.length ? ' for ' + p.teams.join(', ') : ''}`;
    const msg = p.kind === 'request' && (p.text || p.audioId || p.videoId)
      ? h('div', { class: 'msg' }, p.text ? h('div', null, p.text) : null, p.audioId ? audioPlayer(p.audioId) : null, p.videoId ? videoPlayer(p.videoId) : null)
      : null;
    const rejectBox = h('div', { class: 'reject-box hidden' });
    const rejectBtn = h('button', { class: 'btn', type: 'button' }, 'Reject');
    rejectBtn.addEventListener('click', () => openReject(rejectBox, rejectBtn, p, 'Why can\'t you send an update?'));
    let due = null;
    if (p.deadline) {
      const left = Date.parse(p.deadline) - Date.now();
      due = h('div', { class: 'due' + (left < 0 ? ' overdue' : left < 3600e3 ? ' soon' : '') },
        left < 0 ? `Overdue: was due ${fmtDeadline(p.deadline)}` : `Due by ${fmtDeadline(p.deadline)}`);
    }
    return h('article', { class: 'note' },
      h('h3', null, fmtDay(p.date)), h('div', { class: 'meta' }, meta), due, msg,
      h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', onClick: () => answer(p) }, 'Send Updates'), rejectBtn),
      rejectBox);
  }

  function meetingNote(m) {
    const open = m.status === 'open';
    const status = m.status === 'joined' ? `You joined at ${fmtTime(m.joinedAt)}.`
      : m.status === 'declined' ? 'You said you can\'t attend.'
        : m.status === 'updated' ? 'You sent a written update instead.' : null;
    const rejectBox = h('div', { class: 'reject-box hidden' });
    const cantBtn = h('button', { class: 'btn', type: 'button' }, 'Can\'t attend');
    cantBtn.addEventListener('click', () => openReject(rejectBox, cantBtn, m, 'Why can\'t you attend?'));
    return h('article', { class: 'note meeting' + (open ? '' : ' done') },
      h('h3', null, `${m.teams[0]} standup meeting, ${fmtDay(m.date)}`),
      h('div', { class: 'meet-when' }, meetingWhen(m) || 'Today'),
      h('div', { class: 'meta' }, m.teams.join(', ')),
      m.notes ? h('div', { class: 'msg' }, m.notes) : null,
      status ? h('p', null, h('strong', null, status)) : null,
      h('div', { class: 'btn-row' },
        m.status === 'declined' ? null : joinButton(m, m.status === 'joined' && m.link ? 'Join again' : null),
        open ? cantBtn : null,
        open ? h('button', { class: 'btn ghost', type: 'button', onClick: () => answer(m) }, 'Send an update instead') : null),
      rejectBox);
  }

  function openReject(box, btn, p, question) {
    if (!box.childElementCount) {
      const otherText = h('textarea', { id: `other-${p.key}`, maxlength: '500', style: 'min-height:70px', placeholder: 'Tell your admin why' });
      const otherWrap = h('div', { class: 'field hidden' }, h('label', { for: `other-${p.key}` }, 'Other reason'), otherText);
      const boxes = Object.entries(APP.reasons).map(([key, label]) => {
        const cb = h('input', { type: 'checkbox', value: key });
        if (key === 'other') cb.addEventListener('change', () => { otherWrap.classList.toggle('hidden', !cb.checked); if (cb.checked) otherText.focus(); });
        return h('label', { class: 'check' }, cb, label);
      });
      const submit = h('button', { class: 'btn primary', type: 'button' }, 'Submit');
      submit.addEventListener('click', () => busy(submit, async () => {
        const reasons = [...box.querySelectorAll('input[type=checkbox]:checked')].map((c) => c.value);
        if (!reasons.length) { toast('Pick at least one reason.', 'error'); return; }
        try {
          await api('/api/worker/reject', { method: 'POST', body: { requestKey: p.key, reasons, otherText: otherText.value } });
          toast('Sent. Your admin will see the reason.');
          await refreshCounts();
          show(state.tab);
        } catch (e) { showError(e); }
      }));
      box.append(h('h3', null, question), h('div', { class: 'reasons' }, boxes), otherWrap,
        h('div', { class: 'btn-row' }, submit, h('button', { class: 'btn ghost', type: 'button', onClick: () => { box.classList.add('hidden'); btn.disabled = false; } }, 'Cancel')));
    }
    box.classList.remove('hidden');
    btn.disabled = true;
  }

  /* ---------------------------------------------------------------- messages */
  function messageCard(x) {
    const f = x.forward;
    const title = f ? (f.own ? `${f.author} shared their update` : `${x.from} forwarded ${f.author}'s update`) : x.from;
    return h('article', { class: 'entry' + (x.read ? '' : ' unread') },
      h('div', { class: 'entry-head' }, h('strong', null, title), h('span', { class: 'chips' }, x.teams.map((t) => h('span', { class: 'chip' }, t))),
        h('time', { datetime: x.createdAt }, fmtDateTime(x.createdAt))),
      x.text ? h('div', { class: 'body' }, f ? h('em', null, `"${x.text}"`) : x.text) : null,
      x.audioId ? audioPlayer(x.audioId) : null,
      x.videoId ? videoPlayer(x.videoId) : null,
      f ? h('div', { class: 'msg preview', style: 'margin-top:.5rem' },
        h('div', { class: 'small muted' }, `${f.author}'s update from ${fmtDateTime(f.createdAt)}`),
        f.type === 'voice' || f.type === 'video' ? mediaPlayer(f.type, f.audioId) : h('div', null, f.text)) : null);
  }

  async function renderMessages() {
    fill(view, h('p', { class: 'muted' }, 'Loading...'));
    try {
      const m = await api('/api/worker/messages');
      if (state.tab !== 'messages') return;
      if (!m.items.length) {
        fill(view, h('div', { class: 'panel empty' }, h('h2', null, 'No messages yet'), h('p', null, 'Project updates from your admins, and updates shared with you, appear here.')));
      } else {
        fill(view, h('h1', null, 'Messages'), h('div', { class: 'entries' }, m.items.map(messageCard)));
      }
      if (m.unread) { await api('/api/worker/messages/read', { method: 'POST' }); $('#msg-count').classList.add('hidden'); }
    } catch (e) { showError(e); }
  }

  /* ----------------------------------------------------------------- history */
  function forwardMine(e) {
    const { teammates, admins } = state.circle;
    const people = [...teammates.map((p) => ({ id: p.id, name: p.name, email: p.email, sub: [p.role, p.teams.map((t) => t.name).join(', ')].filter(Boolean).join(' · ') })),
      ...admins.filter((a) => !teammates.some((t) => t.id === a.id)).map((a) => ({ id: a.id, name: a.name, sub: 'Admin' }))];
    forwardDialog({
      title: 'Forward your update',
      subtitle: `From ${fmtDateTime(e.createdAt)}`,
      people,
      onSend: async (ids, note) => {
        const r = await api('/api/worker/forward', { method: 'POST', body: { updateId: e.id, recipientIds: ids, note } });
        renderHistory();
        return r.recipients;
      },
    });
  }

  async function renderHistory() {
    fill(view, h('p', { class: 'muted' }, 'Loading...'));
    try {
      const r = await api('/api/worker/history');
      if (state.tab !== 'history') return;
      if (!r.entries.length) {
        fill(view, h('div', { class: 'panel empty' }, h('h2', null, 'Nothing sent in the last 14 days'), h('button', { class: 'btn primary', type: 'button', onClick: () => show('send') }, 'Send an update')));
        return;
      }
      fill(view, h('h1', null, 'My updates'), h('p', { class: 'muted' }, 'The last 14 days. Use Forward to share an update with teammates.'),
        renderEntries(r.entries, { showName: false, onForward: forwardMine }));
    } catch (e) { showError(e); }
  }

  await Promise.all([refreshCounts(), loadCircle()]);
  // #pending, #messages, #history or #send pick the tab (tray notifications link here).
  const tabFromHash = () => { const t = location.hash.slice(1); return tabs[t] ? t : null; };
  window.addEventListener('hashchange', () => { const t = tabFromHash(); if (t && t !== state.tab) { state.screen = 'choose'; show(t); } });
  show(tabFromHash() || 'send');
  setInterval(refreshCounts, 5 * 60e3);
})();
