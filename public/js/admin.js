'use strict';
/* Admin portal: Reports, Request, Send Update, Configure Updates, Edit Teams, Administrator Portal */
(async function () {
  await loadAppInfo();
  const me = await api('/api/me');
  if (!me.isAdmin) { location.replace('/worker'); return; }
  renderTopbar(me, { portal: 'admin' });

  const view = $('#view');
  const enc = encodeURIComponent;
  let teams = [];
  let cleanup = null;
  const loadTeams = async () => { teams = (await api('/api/admin/teams')).teams; };
  await loadTeams();

  const VIEWS = { home, reports, request: () => composer('request'), send: () => composer('message'), configure, teams: teamsView, admins: adminsView };
  async function route() {
    if (cleanup) { cleanup(); cleanup = null; }
    const name = (location.hash.slice(1) || 'home').split('/')[0];
    window.scrollTo(0, 0);
    try { await (VIEWS[name] || home)(); } catch (e) { showError(e); }
  }
  window.addEventListener('hashchange', route);

  function page(title, intro, ...content) {
    fill(view, h('a', { class: 'crumb', href: '#home' }, icon('back'), 'Admin home'), h('h1', null, title), intro ? h('p', { class: 'muted' }, intro) : null, ...content);
  }
  const noTeams = () => h('div', { class: 'panel empty' }, h('h2', null, 'You don\'t administer any teams yet'),
    h('p', null, me.isPrimary
      ? 'Create a team in Edit Teams, or assign yourself existing teams with Edit in the Administrator Portal.'
      : 'Create a team in Edit Teams, or ask a Primary Administrator to assign you one.'),
    h('div', { class: 'btn-row', style: 'justify-content:center' }, h('a', { class: 'btn primary', href: '#teams' }, 'Go to Edit Teams'),
      me.isPrimary ? h('a', { class: 'btn', href: '#admins' }, 'Administrator Portal') : null));
  const field = (id, label, input) => h('div', { class: 'field' }, h('label', { for: id }, label), input);

  function showInvite(invite, person) {
    if (!invite || invite.skipped) return;
    if (invite.delivered) { toast(`Invitation emailed to ${person}`); return; }
    const copy = h('button', { class: 'btn', type: 'button' }, 'Copy link');
    const dlg = h('dialog', null,
      h('h2', null, 'Share this sign-up link'),
      h('p', null, invite.reason === 'failed'
        ? `The invitation email to ${person} could not be sent. Send them this link yourself. It works for 7 days.`
        : `Email isn't set up on the server, so ${person} didn't get an invitation. Send them this link yourself. It works for 7 days.`),
      h('p', { class: 'link-box' }, invite.link),
      invite.error ? h('p', { class: 'notice error small' }, h('strong', null, 'Why: '), invite.error) : null,
      h('p', { class: 'muted small' }, 'To diagnose email, run "node install/test-email.js" on the server (see README.md, "Email setup").'),
      h('div', { class: 'btn-row' }, copy, h('button', { class: 'btn primary', type: 'button', onClick: () => dlg.close() }, 'Done')));
    copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(invite.link); copy.textContent = 'Copied'; } catch (_) { copy.textContent = 'Select the link and copy it'; } });
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  /* ===================================================================== home */
  async function home() {
    const tiles = [
      ['reports', 'chart', 'Reports', 'Today\'s updates, or search by date or person.'],
      ['request', 'ask', 'Request Update', 'Ask team members for an update. They reply by text, voice or video.'],
      ['send', 'megaphone', 'Send Update', 'Share a project update with your team members.'],
      ['configure', 'calendar', 'Configure Updates', 'Pick update days and meeting days, with the meeting link.'],
      ['teams', 'team', 'Edit Teams', 'Create teams and add or remove members.'],
      ['admins', 'shield', 'Administrator Portal', me.isPrimary ? 'Add administrators and manage Primary Administrators.' : 'Add administrators for your teams.'],
    ];
    const today = h('p', { class: 'muted' }, `${me.isPrimary ? 'Primary Administrator. ' : ''}Administrator for ${teams.map((t) => t.name).join(', ') || 'no teams yet'}`);
    fill(view, h('h1', null, `Hello, ${me.firstName || me.name}`), today,
      h('div', { class: 'tiles' }, tiles.map(([id, ic, t, d]) => h('a', { class: 'tile', href: '#' + id }, h('span', { class: 'icon', svg: ICONS[ic] }), h('strong', null, t), h('span', null, d)))));
    if (!teams.length) return;
    try {
      const r = await api('/api/admin/reports?team=all');
      const updates = r.entries.filter((e) => e.kind === 'update').length;
      const waiting = r.outstanding ? r.outstanding.length : 0;
      today.textContent += `. Today so far: ${updates} update${updates === 1 ? '' : 's'}${r.outstanding ? `, ${waiting} still to report` : ''}.`;
    } catch (_) {}
  }

  /* ================================================================== reports */
  async function reports() {
    if (!teams.length) return page('Reports', null, noTeams());
    const st = { mode: 'today', date: todayStr(), person: null, personMode: 'week' };
    const ts = teamSelect(teams, { onChange: () => { st.person = null; renderMode(); } });
    const modes = [['today', 'Today'], ['date', 'Search by date'], ['person', 'Search by individual']];
    const segBtns = modes.map(([m, label]) => h('button', { type: 'button', 'aria-pressed': String(m === st.mode), onClick: () => {
      st.mode = m; st.person = null;
      segBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(modes[i][0] === m)));
      renderMode();
    } }, label));
    const body = h('div');
    page('Reports', null, h('div', { class: 'toolbar' }, ts.el, h('div', { class: 'field' }, h('label', null, 'Show'), h('div', { class: 'seg', role: 'group' }, segBtns))), body);

    async function loadList(target, params, heading) {
      fill(target, h('p', { class: 'muted' }, 'Loading...'));
      try {
        const q = new URLSearchParams({ team: ts.value(), ...params });
        const r = await api('/api/admin/reports?' + q);
        const parts = [h('h2', null, heading)];
        if (r.outstanding && r.outstanding.length) {
          parts.push(h('div', { class: 'notice warn outstanding' }, h('strong', null, `Not reported yet (${r.outstanding.length})${r.dueBy ? ', due by ' + fmtDeadline(r.dueBy) : ''}: `), r.outstanding.map((p) => p.name).join(', ')));
        } else if (r.outstanding) {
          parts.push(h('div', { class: 'notice' }, 'Everyone scheduled for this day has responded.'));
        }
        for (const m of r.meetings || []) parts.push(meetingSummary(m));
        const reload = () => loadList(target, params, heading);
        parts.push(r.entries.length
          ? renderEntries(r.entries, { showName: !params.user, dayHeadings: !params.date, onForward: (e) => forwardFromReport(e, reload) })
          : h('div', { class: 'panel empty' }, h('p', null, (r.meetings || []).length ? 'No written updates. This was a meeting day.' : 'No updates for this period.')));
        fill(target, ...parts);
      } catch (e) { fill(target, h('p', { class: 'notice error' }, e.message)); }
    }

    function meetingSummary(m) {
      const line = (label, names, cls) => (names.length ? h('div', { class: cls || '' }, h('strong', null, `${label} (${names.length}): `), names.join(', ')) : null);
      return h('div', { class: 'meeting-strip', style: 'display:block' },
        h('div', null, h('strong', null, `${m.team} standup meeting`), ' ', [m.time ? fmtClock(m.time) + (m.endTime ? ' to ' + fmtClock(m.endTime) : '') : null, meetingService(m.link)].filter(Boolean).join(' · '),
          m.link ? h('span', null, ' · ', h('a', { href: m.link, target: '_blank', rel: 'noopener noreferrer' }, 'Open meeting link')) : null),
        line('Clicked Join', m.joined.map((j) => `${j.name} (${fmtTime(j.at)})`)),
        line('Can\'t attend', m.cantAttend),
        line('Sent a written update instead', m.sentUpdate),
        line('No response', m.noResponse, 'muted'),
        !m.joined.length && !m.cantAttend.length && !m.sentUpdate.length && !m.noResponse.length ? h('div', { class: 'muted' }, 'No team members.') : null);
    }

    async function forwardFromReport(e, reload) {
      let people;
      try { people = (await api('/api/admin/people?team=all')).people; } catch (x) { showError(x); return; }
      forwardDialog({
        title: `Forward ${e.name}'s update`,
        subtitle: `From ${fmtDateTime(e.createdAt)}. It appears in their Messages tab.`,
        people: people.filter((p) => p.id !== e.userId && p.id !== me.id).map((p) => ({ id: p.id, name: `${p.lastName}, ${p.firstName}`, email: p.email, sub: [p.role, p.teams.map((t) => t.name).join(', ')].filter(Boolean).join(' · ') })),
        onSend: async (ids, note) => {
          const r = await api('/api/admin/forward', { method: 'POST', body: { updateId: e.id, recipientIds: ids, note } });
          reload();
          return r.recipients;
        },
      });
    }

    function reportCalendar(extra, getSelected, onSelect) {
      let marked = new Set();
      const cal = createCalendar({
        isSelected: (d) => d === getSelected(), isMarked: (d) => marked.has(d),
        onSelect: (d) => { onSelect(d); cal.render(); }, onMonthChange: (m) => loadMarks(m),
      });
      async function loadMarks(m) {
        try { marked = new Set((await api(`/api/admin/report-days?team=${enc(ts.value())}&month=${m}${extra}`)).days); cal.render(); } catch (_) {}
      }
      loadMarks(cal.month());
      return h('div', null, cal.el, h('p', { class: 'muted small' }, 'Dots mark days with updates.'));
    }

    async function renderMode() {
      if (st.mode === 'today') {
        await loadList(body, { date: todayStr() }, `Today, ${fmtDay(todayStr())}`);
      } else if (st.mode === 'date') {
        const out = h('div');
        fill(body, h('div', { class: 'layout-2' }, reportCalendar('', () => st.date, (d) => { st.date = d; loadList(out, { date: d }, fmtDay(d)); }), out));
        loadList(out, { date: st.date }, fmtDay(st.date));
      } else {
        await renderPeople();
      }
    }

    async function renderPeople() {
      const listEl = h('ul', { class: 'list scroll' });
      const detail = h('div', null, h('div', { class: 'panel empty' }, h('p', null, 'Choose a person to see their last 7 days.')));
      fill(body, h('div', { class: 'layout-2' }, h('div', null, h('h2', null, 'People'), listEl), detail));
      let people;
      try { people = (await api('/api/admin/people?team=' + enc(ts.value()))).people; } catch (e) { showError(e); return; }
      if (!people.length) { listEl.append(h('li', null, h('div', { class: 'row muted' }, 'No team members yet.'))); return; }
      const buttons = people.map((p) => {
        const b = h('button', { class: 'item', type: 'button', onClick: () => { buttons.forEach((x) => x.removeAttribute('aria-current')); b.setAttribute('aria-current', 'true'); st.person = p; st.personMode = 'week'; renderPerson(detail); } },
          h('div', null, `${p.lastName}, ${p.firstName}`, p.role ? h('span', { class: 'role-tag' }, p.role) : null), h('div', { class: 'sub' }, p.email));
        return b;
      });
      listEl.append(...buttons.map((b) => h('li', null, b)));
    }

    function renderPerson(detail) {
      const p = st.person;
      const out = h('div');
      const pm = [['week', 'Last 7 days'], ['date', 'Search by date']];
      const btns = pm.map(([m, label]) => h('button', { type: 'button', 'aria-pressed': String(m === st.personMode), onClick: () => { st.personMode = m; renderPerson(detail); } }, label));
      fill(detail, h('div', { class: 'panel-head' }, h('h2', null, p.name), h('div', { class: 'spacer' }), h('div', { class: 'seg', role: 'group' }, btns)), out);
      if (st.personMode === 'week') {
        loadList(out, { from: addDays(todayStr(), -6), to: todayStr(), user: p.id }, `${fmtDayShort(addDays(todayStr(), -6))} to ${fmtDayShort(todayStr())}`);
      } else {
        const list = h('div');
        fill(out, reportCalendar(`&user=${enc(p.id)}`, () => st.date, (d) => { st.date = d; loadList(list, { date: d, user: p.id }, fmtDay(d)); }), list);
        loadList(list, { date: st.date, user: p.id }, fmtDay(st.date));
      }
    }

    renderMode();
  }

  /* ================================================== request / send update */
  async function composer(kind) {
    const isReq = kind === 'request';
    const title = isReq ? 'Request updates' : 'Send a project update';
    const intro = isReq
      ? 'Workers see this in Pending Requests. Each worker chooses whether to answer by text, voice or video, or rejects it with a reason.'
      : 'Workers see this in their Messages tab.';
    if (!teams.length) return page(title, intro, noTeams());

    // The starting text stays in the box as real text; type after it.
    const template = isReq ? 'Please send a quick update for today.' : `Project update for ${fmtDay(todayStr())}: `;
    const ts = teamSelect(teams, { onChange: () => loadPeople() });
    const area = h('textarea', { id: 'msg-text', maxlength: '5000' });
    area.value = template;
    // While the box still holds only the starting text, any click puts the cursor at the end of it.
    const toEnd = () => { if (area.value === template) area.setSelectionRange(template.length, template.length); };
    area.addEventListener('focus', () => setTimeout(toEnd, 0));
    area.addEventListener('mouseup', toEnd);
    const textWrap = h('div', { class: 'field' }, h('label', { for: 'msg-text' }, isReq ? 'Request' : 'Text message'), area);

    // Project updates can also carry a voice and/or video message.
    let useText = null, useVoice = null, useVideo = null, voiceRec = null, videoRec = null, voiceWrap = null, videoWrap = null;
    if (!isReq) {
      useText = h('input', { type: 'checkbox', checked: true });
      useVoice = h('input', { type: 'checkbox' });
      useVideo = h('input', { type: 'checkbox' });
      voiceRec = createRecorder({ onChange: sync });
      videoRec = createRecorder({ video: true, onChange: sync });
      cleanup = () => { voiceRec.destroy(); videoRec.destroy(); };
      voiceWrap = h('div', { class: 'field hidden' }, h('label', null, 'Voice message'), voiceRec.el);
      videoWrap = h('div', { class: 'field hidden' }, h('label', null, 'Video message'), videoRec.el);
    }
    const allBox = h('input', { type: 'checkbox', checked: true });
    const peopleBox = h('div', { class: 'reasons hidden' });
    const sendBtn = h('button', { class: 'btn primary hidden', type: 'button' }, icon('send'), 'Send');
    const recent = h('div');

    // Optional deadline for requests (entered in this computer's local time).
    const dDate = isReq ? h('input', { type: 'date', id: 'due-date', min: todayStr() }) : null;
    // The time field starts at the last deadline time this admin chose on this computer (or 12:00 PM).
    const TIME_KEY = 'mas.lastDeadlineTime';
    const savedTime = () => { try { return localStorage.getItem(TIME_KEY) || '12:00'; } catch (_) { return '12:00'; } };
    const rememberTime = (t) => { try { if (t) localStorage.setItem(TIME_KEY, t); } catch (_) {} };
    const dTime = isReq ? createTimePicker({ id: 'due-time', label: 'Deadline time', allowEmpty: false, value: savedTime(), onChange: (v) => rememberTime(v) }) : null;
    const deadlineField = isReq ? h('div', { class: 'field' }, h('label', null, 'Deadline (optional)'),
      h('div', { class: 'grid-2' }, h('div', null, dDate), h('div', null, dTime.el)),
      h('p', { class: 'muted small', style: 'margin:.35rem 0 0' }, 'Workers see "Due by" on the request.')) : null;
    function deadlineIso() {
      if (!isReq || !dDate.value) return null;
      const d = new Date(`${dDate.value}T${dTime.value() || savedTime()}`);
      return isNaN(d) ? null : d.toISOString();
    }

    // Voice and video are either/or: ticking one unticks the other (both stay clickable).
    if (!isReq) {
      const exclusive = (mine, myRec, other, otherRec, label) => mine.addEventListener('change', () => {
        if (mine.checked && otherRec.getBlob() && !confirm(`Switching to ${label} discards the recording you made. Continue?`)) { mine.checked = false; sync(); return; }
        if (mine.checked) { other.checked = false; otherRec.reset(); }
        sync();
      });
      exclusive(useVoice, voiceRec, useVideo, videoRec, 'voice');
      exclusive(useVideo, videoRec, useVoice, voiceRec, 'video');
      // Turn the camera on as soon as Video is ticked, so it can be checked before recording.
      const camera = () => (useVideo.checked ? videoRec.startPreview() : videoRec.stopPreview());
      useVideo.addEventListener('change', camera);
      useVoice.addEventListener('change', camera);
    }

    // A request's starting sentence can be sent as it is; a project update needs something added.
    const hasText = () => (!useText || useText.checked) && area.value.trim() && (isReq || area.value.trim() !== template.trim());
    const ready = (on, rec) => on && on.checked && rec.getBlob() && !rec.isRecording();
    function sync() {
      if (useText) {
        textWrap.classList.toggle('hidden', !useText.checked);
        voiceWrap.classList.toggle('hidden', !useVoice.checked);
        videoWrap.classList.toggle('hidden', !useVideo.checked);
      }
      peopleBox.classList.toggle('hidden', allBox.checked);
      sendBtn.classList.toggle('hidden', !(hasText() || ready(useVoice, voiceRec) || ready(useVideo, videoRec)));
    }
    [useText, useVoice, useVideo, allBox].filter(Boolean).forEach((c) => c.addEventListener('change', sync));
    area.addEventListener('input', sync);

    async function loadPeople() {
      try {
        const people = (await api('/api/admin/people?team=' + enc(ts.value()))).people.filter((p) => p.id !== me.id);
        fill(peopleBox, ...(people.length
          ? people.map((p) => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: p.id }), `${p.lastName}, ${p.firstName}`))
          : [h('p', { class: 'muted' }, 'No workers on this team yet.')]));
      } catch (e) { showError(e); }
      loadRecent();
    }

    sendBtn.addEventListener('click', () => busy(sendBtn, async () => {
      const recipients = allBox.checked ? 'all' : [...peopleBox.querySelectorAll('input:checked')].map((c) => c.value);
      if (recipients !== 'all' && !recipients.length) { toast('Choose at least one worker, or check "Send to All".', 'error'); return; }
      try {
        const audioId = ready(useVoice, voiceRec) ? await uploadAudio(voiceRec.getBlob()) : null;
        const videoId = ready(useVideo, videoRec) ? await uploadVideo(videoRec.getBlob()) : null;
        const text = hasText() ? area.value : '';
        const r = await api(isReq ? '/api/admin/requests' : '/api/admin/messages', { method: 'POST', body: { team: ts.value(), recipients, text, audioId, videoId, deadline: deadlineIso() } });
        toast(`Sent to ${r.recipients} worker${r.recipients === 1 ? '' : 's'}`);
        area.value = template;
        if (isReq) { if (dDate.value) rememberTime(dTime.value()); dDate.value = ''; dTime.set(savedTime()); }
        if (voiceRec) { voiceRec.reset(); videoRec.reset(); }
        sync();
        loadRecent();
      } catch (e) { showError(e); }
    }));

    async function loadRecent() {
      try {
        const r = await api(`/api/admin/sent?kind=${kind}`);
        fill(recent, h('h2', null, 'Recently sent'), r.items.length ? h('div', { class: 'entries' }, r.items.map((x) => h('article', { class: 'entry' },
          h('div', { class: 'entry-head' }, h('strong', null, x.from), h('span', { class: 'chips' }, x.teams.map((t) => h('span', { class: 'chip' }, t))),
            h('span', { class: 'chip ' + (isReq && x.answered < x.recipients ? 'warn' : 'ok') }, isReq ? `${x.answered} of ${x.recipients} answered` : `${x.read} of ${x.recipients} read`),
            h('time', { datetime: x.createdAt }, fmtDateTime(x.createdAt))),
          x.deadline ? h('div', { class: 'small muted' }, `Due by ${fmtDeadline(x.deadline)}`) : null,
          x.text ? h('div', { class: 'body' }, x.text) : null,
          x.audioId ? audioPlayer(x.audioId) : null,
          x.videoId ? videoPlayer(x.videoId) : null))) : h('p', { class: 'muted' }, 'Nothing sent yet.'));
      } catch (_) {}
    }

    page(title, intro,
      h('section', { class: 'panel' },
        ts.el,
        isReq ? null : h('div', { class: 'field' }, h('label', null, 'Message type'), h('div', { class: 'btn-row' },
          h('label', { class: 'check' }, useText, 'Text'), h('label', { class: 'check' }, useVoice, 'Voice'), h('label', { class: 'check' }, useVideo, 'Video'))),
        textWrap, voiceWrap, videoWrap, deadlineField,
        h('div', { class: 'field' }, h('label', null, 'Send to'), h('label', { class: 'check' }, allBox, 'Send to All'), peopleBox),
        h('div', { class: 'actions-bar' }, sendBtn)),
      h('section', { class: 'panel' }, recent));
    loadPeople();
    sync();
  }

  /* ================================================================ configure */
  async function configure() {
    const intro = 'Choose, for each weekday, whether workers send an update (text, voice or video), meet live, or do nothing. Each team has its own schedule.';
    if (!teams.length) return page('Configure updates', intro, noTeams());
    const DAYS = [[1, 'Monday'], [2, 'Tuesday'], [3, 'Wednesday'], [4, 'Thursday'], [5, 'Friday'], [6, 'Saturday'], [0, 'Sunday']];
    const NAMES = Object.fromEntries(DAYS);
    const blank = () => ({ days: [], dayDeadlines: {}, meetingDays: [], meeting: { time: '', endTime: '', link: '', notes: '' }, always: true, startDate: null, endDate: null, excludedDates: [] });
    let s = blank();
    const ts = teamSelect(teams, { includeAll: false, onChange: () => load() });
    const plan = h('div', { class: 'day-plan', role: 'group', 'aria-label': 'Standup days' });
    const time = createTimePicker({ id: 'meet-time', label: 'Start time', onChange: (v) => { s.meeting.time = v; renderSummary(); } });
    const endTime = createTimePicker({ id: 'meet-end', label: 'End time', onChange: (v) => { s.meeting.endTime = v; renderSummary(); } });
    const link = h('input', { type: 'text', id: 'meet-link', inputmode: 'url', placeholder: 'https://teams.microsoft.com/l/meetup-join/...' });
    const notes = h('textarea', { id: 'meet-notes', maxlength: '500', style: 'min-height:60px', placeholder: 'Optional, e.g. "Conference room B, or join online"' });
    const testLink = h('a', { class: 'btn small', target: '_blank', rel: 'noopener noreferrer' }, 'Test the link');
    const meetPanel = h('section', { class: 'panel hidden' },
      h('h2', null, 'Meeting details'),
      h('p', { class: 'muted' }, 'On meeting days, workers get a "Join meeting" button instead of a request for an update. Anyone who can\'t attend can say why, or send an update instead.'),
      h('div', { class: 'grid-2' }, field('meet-time', 'Start time', time.el), field('meet-end', 'End time', endTime.el)),
      h('p', { class: 'muted small', style: 'margin:-.5rem 0 1rem' }, 'Times are in the server\'s time zone.'),
      field('meet-link', 'Meeting link', link),
      h('details', { class: 'small help', style: 'margin:-.5rem 0 1rem' }, h('summary', null, 'How do I get a meeting link?'),
        h('p', null, 'Create a recurring meeting for your standup once, invite the team, and paste its join link above. One link works for every occurrence. Menu names vary a little between versions.'),
        h('h4', null, 'Microsoft Teams'),
        h('ol', null,
          h('li', null, 'In Outlook or the Teams calendar, create a meeting that repeats on your standup days, with "Teams meeting" turned on.'),
          h('li', null, 'Open the meeting, right-click "Join the meeting now" (or "Click here to join the meeting") and choose Copy link.')),
        h('h4', null, 'Zoom'),
        h('ol', null,
          h('li', null, 'In the Zoom app or zoom.us, choose Schedule, tick "Recurring meeting", and save.'),
          h('li', null, 'Open the meeting under Meetings and choose Copy invitation (or copy the "Invite link"); paste just the https:// link.')),
        h('h4', null, 'Google Meet'),
        h('ol', null,
          h('li', null, 'In Google Calendar, create an event that repeats on your standup days and choose "Add Google Meet video conferencing".'),
          h('li', null, 'Open the event and copy the meet.google.com link.')),
        h('h4', null, 'Webex'),
        h('ol', null,
          h('li', null, 'Use your Personal Room link (it never changes), found under Meetings in the Webex app or site; or schedule a recurring meeting and copy its link.')),
        h('p', null, 'In person? Leave the link empty and put the room in the notes. Workers then get an "I\'m attending" button.')),
      field('meet-notes', 'Notes', notes),
      h('div', { class: 'btn-row' }, testLink));
    const alwaysR = h('input', { type: 'radio', name: 'period', value: 'always' });
    const rangeR = h('input', { type: 'radio', name: 'period', value: 'range' });
    const start = h('input', { type: 'date', id: 'start-date' });
    const stop = h('input', { type: 'date', id: 'stop-date' });
    const rangeWrap = h('div', { class: 'grid-2' }, field('start-date', 'Start', start), field('stop-date', 'Stop (leave blank for no end)', stop));
    const exChips = h('div', { class: 'chips' });
    const note = h('p', { class: 'notice hidden' });
    const summary = h('p', { class: 'notice' });
    const saveBtn = h('button', { class: 'btn primary', type: 'button' }, 'Save schedule');
    const cal = createCalendar({ isExcluded: (d) => s.excludedDates.includes(d), onSelect: (d) => {
      s.excludedDates = s.excludedDates.includes(d) ? s.excludedDates.filter((x) => x !== d) : [...s.excludedDates, d].sort();
      renderEx();
    } });

    const typeOf = (n) => (s.meetingDays.includes(n) ? 'meeting' : s.days.includes(n) ? 'update' : 'off');
    function setType(n, t) {
      s.days = s.days.filter((x) => x !== n);
      s.meetingDays = s.meetingDays.filter((x) => x !== n);
      if (t === 'update') {
        const shared = [...new Set(s.days.map((d) => s.dayDeadlines[d] || ''))];
        if (shared.length === 1 && shared[0] && !s.dayDeadlines[n]) s.dayDeadlines[n] = shared[0];
        s.days.push(n);
      }
      if (t === 'meeting') s.meetingDays.push(n);
      renderPlan(); renderSummary();
    }
    function renderPlan() {
      fill(plan, DAYS.map(([n, name]) => {
        const cur = typeOf(n);
        const opt = (t, label) => h('button', { type: 'button', class: t === 'meeting' ? 'is-meeting' : '', 'aria-pressed': String(cur === t), onClick: () => setType(n, t) }, label);
        let due = null;
        if (cur === 'update') {
          const pick = createTimePicker({ id: `due-${n}`, label: `${name} deadline`, value: s.dayDeadlines[n] || '', onChange: (v) => {
            if (v) s.dayDeadlines[n] = v; else delete s.dayDeadlines[n];
            renderSummary();
          } });
          const applyAll = h('button', { class: 'btn ghost small', type: 'button', title: 'Use this deadline on every Send update day', onClick: () => {
            const v = s.dayDeadlines[n] || '';
            s.days.forEach((d) => { if (v) s.dayDeadlines[d] = v; else delete s.dayDeadlines[d]; });
            renderPlan(); renderSummary();
            toast(v ? `Due by ${fmtClock(v)} on every Send update day` : 'Deadlines cleared on every Send update day');
          } }, 'Apply to all');
          due = h('div', { class: 'day-due' }, h('label', { for: `due-${n}` }, 'Due by'), pick.el, s.days.length > 1 ? applyAll : null);
        }
        return h('div', { class: 'row' }, h('strong', null, name), h('div', { class: 'seg', role: 'group', 'aria-label': name }, opt('off', 'Off'), opt('update', 'Send update'), opt('meeting', 'Meeting')), due);
      }));
      meetPanel.classList.toggle('hidden', !s.meetingDays.length);
    }
    function renderMeeting() {
      time.set(s.meeting.time || '');
      endTime.set(s.meeting.endTime || '');
      link.value = s.meeting.link || '';
      notes.value = s.meeting.notes || '';
      syncTest();
    }
    function syncTest() {
      const ok = /^https?:\/\/\S+$/i.test(link.value.trim());
      testLink.classList.toggle('hidden', !ok);
      if (ok) testLink.href = link.value.trim();
    }
    link.addEventListener('input', () => { s.meeting.link = link.value.trim(); syncTest(); renderSummary(); });
    notes.addEventListener('input', () => { s.meeting.notes = notes.value; });

    function renderEx() {
      cal.render();
      fill(exChips, s.excludedDates.length ? s.excludedDates.map((d) => h('span', { class: 'chip warn' }, fmtDayShort(d) + ' ' + d.slice(0, 4), ' ',
        h('button', { class: 'btn ghost small', type: 'button', 'aria-label': `Remove ${fmtDay(d)}`, onClick: () => { s.excludedDates = s.excludedDates.filter((x) => x !== d); renderEx(); } }, 'x')))
        : h('span', { class: 'muted small' }, 'No excluded dates.'));
    }
    function renderPeriod() {
      alwaysR.checked = s.always; rangeR.checked = !s.always;
      rangeWrap.classList.toggle('hidden', s.always);
      start.value = s.startDate || ''; stop.value = s.endDate || '';
    }
    function describeDays(list) {
      const sel = [...list].sort().join(',');
      if (sel === '0,1,2,3,4,5,6') return 'every day';
      if (sel === '1,2,3,4,5') return 'every weekday';
      return DAYS.filter(([n]) => list.includes(n)).map(([, name]) => name).join(', ');
    }
    function renderSummary() {
      const when = s.always ? 'with no start or stop date' : `${s.startDate ? 'from ' + fmtDay(s.startDate) : ''}${s.endDate ? ' until ' + fmtDay(s.endDate) : ''}`;
      const parts = [];
      if (s.days.length) {
        const times = [...new Set(s.days.map((d) => s.dayDeadlines[d] || ''))];
        if (times.length === 1) parts.push(`Send update: ${describeDays(s.days)}${times[0] ? ', due by ' + fmtClock(times[0]) : ''}.`);
        else parts.push(`Send update: ${DAYS.filter(([d]) => s.days.includes(d)).map(([d, nm]) => nm + (s.dayDeadlines[d] ? ` (due ${fmtClock(s.dayDeadlines[d])})` : '')).join(', ')}.`);
      }
      if (s.meetingDays.length) parts.push(`Meetings: ${describeDays(s.meetingDays)}${s.meeting.time ? ' at ' + fmtClock(s.meeting.time) + (s.meeting.endTime ? ' to ' + fmtClock(s.meeting.endTime) : '') : ''}${s.meeting.link ? ' (' + meetingService(s.meeting.link) + ')' : ''}.`);
      summary.textContent = parts.length ? `${parts.join(' ')} Active ${when}.` : 'Every day is Off, so nothing is scheduled.';
    }
    alwaysR.addEventListener('change', () => { s.always = true; renderPeriod(); renderSummary(); });
    rangeR.addEventListener('change', () => { s.always = false; renderPeriod(); renderSummary(); });
    start.addEventListener('change', () => { s.startDate = start.value || null; renderSummary(); });
    stop.addEventListener('change', () => { s.endDate = stop.value || null; renderSummary(); });

    async function load() {
      try {
        const list = (await api('/api/admin/schedules?team=' + enc(ts.value()))).schedules;
        s = { ...blank(), ...JSON.parse(JSON.stringify(list[0])) };
        const sig = (x) => JSON.stringify([[...x.days].sort(), [...(x.meetingDays || [])].sort(), x.meeting, x.always, x.startDate, x.endDate, x.excludedDates]);
        if (list.length > 1) {
          const same = list.every((x) => sig(x) === sig(list[0]));
          note.textContent = same
            ? `Saving applies this schedule to all ${list.length} teams.`
            : `These teams have different schedules. Showing ${list[0].teamName}'s. Saving applies it to all ${list.length} teams.`;
          note.className = 'notice' + (same ? '' : ' warn');
        } else note.className = 'notice hidden';
        renderPlan(); renderMeeting(); renderPeriod(); renderEx(); renderSummary();
      } catch (e) { showError(e); }
    }

    saveBtn.addEventListener('click', () => busy(saveBtn, async () => {
      try {
        const r = await api('/api/admin/schedules', { method: 'PUT', body: { team: ts.value(), days: s.days, dayDeadlines: Object.fromEntries(s.days.filter((d) => s.dayDeadlines[d]).map((d) => [d, s.dayDeadlines[d]])), meetingDays: s.meetingDays, meeting: s.meeting, always: s.always, startDate: s.startDate, endDate: s.endDate, excludedDates: s.excludedDates } });
        toast(`Schedule saved for ${r.teams} team${r.teams === 1 ? '' : 's'}`);
      } catch (e) { showError(e); }
    }));

    page('Configure updates', intro,
      h('section', { class: 'panel' }, ts.el, note,
        h('h2', null, 'Standup days'),
        h('p', { class: 'muted' }, 'Send update: workers get a pending request and reply with a text, voice or video update, optionally due by a time you pick for that day. Meeting: workers get a "Join meeting" button instead.'),
        plan),
      meetPanel,
      h('section', { class: 'panel' }, h('h2', null, 'When this schedule is active'),
        h('label', { class: 'check' }, alwaysR, 'Always'), h('label', { class: 'check' }, rangeR, 'Between dates'), rangeWrap),
      h('section', { class: 'panel' }, h('h2', null, 'Excluded dates'), h('p', { class: 'muted' }, 'Click dates such as holidays to skip them (no requests and no meeting). Click again to include them.'),
        h('div', { class: 'layout-2' }, cal.el, h('div', null, exChips))),
      h('section', { class: 'panel' }, summary, h('div', { class: 'btn-row' }, saveBtn)));
    load();
  }

  /* =============================================================== edit teams */
  async function teamsView() {
    await loadTeams();
    let selectedId = location.hash.split('/')[1] || (teams[0] && teams[0].id);
    let adding = !teams.length;
    const left = h('div');
    const right = h('div');
    page('Edit teams', null, h('div', { class: 'layout-2' }, left, right));

    function renderLeft() {
      fill(left, 
        h('div', { class: 'panel-head' }, h('h2', null, 'Teams'), h('div', { class: 'spacer' }),
          h('button', { class: 'btn primary small', type: 'button', onClick: () => { adding = true; renderLeft(); renderRight(); } }, 'Add Team')),
        teams.length ? h('ul', { class: 'list scroll' }, teams.map((t) => h('li', null, h('button', { class: 'item', type: 'button', 'aria-current': String(!adding && t.id === selectedId), onClick: () => { adding = false; selectedId = t.id; history.replaceState(null, '', '#teams/' + t.id); renderLeft(); renderRight(); } },
          h('div', null, t.name), h('div', { class: 'sub' }, `${t.members.length} member${t.members.length === 1 ? '' : 's'}`)))))
          : h('p', { class: 'muted' }, 'No teams yet.'));
    }

    function renderRight() {
      if (adding) return renderAdd();
      const t = teams.find((x) => x.id === selectedId);
      if (!t) { fill(right, h('div', { class: 'panel empty' }, h('p', null, 'Choose a team.'))); return; }

      const name = h('input', { type: 'text', id: 'team-name', value: t.name, maxlength: '80' });
      const desc = h('textarea', { id: 'team-desc', maxlength: '500', style: 'min-height:70px' });
      desc.value = t.description;
      const saveBtn = h('button', { class: 'btn', type: 'button' }, 'Save changes');
      saveBtn.addEventListener('click', () => busy(saveBtn, async () => {
        try { await api(`/api/admin/teams/${enc(t.id)}`, { method: 'PUT', body: { name: name.value, description: desc.value } }); await loadTeams(); toast('Team saved'); renderLeft(); renderRight(); } catch (e) { showError(e); }
      }));
      const delBtn = h('button', { class: 'btn danger', type: 'button' }, icon('trash'), 'Delete team');
      delBtn.addEventListener('click', () => busy(delBtn, async () => {
        if (!confirm(`Delete the ${t.name} team? Members keep their accounts and past updates stay in Reports.`)) return;
        try { await api(`/api/admin/teams/${enc(t.id)}`, { method: 'DELETE' }); await loadTeams(); selectedId = teams[0] && teams[0].id; adding = !teams.length; toast('Team deleted'); renderLeft(); renderRight(); } catch (e) { showError(e); }
      }));

      const members = h('ul', { class: 'list scroll' }, t.members.length ? t.members.map((m) => {
        const remove = h('button', { class: 'btn danger small', type: 'button' }, 'Delete');
        remove.addEventListener('click', () => busy(remove, async () => {
          if (!confirm(`Remove ${m.name} from ${t.name}?`)) return;
          try { await api(`/api/admin/teams/${enc(t.id)}/members/${enc(m.id)}`, { method: 'DELETE' }); await loadTeams(); toast(`${m.name} removed`); renderLeft(); renderRight(); } catch (e) { showError(e); }
        }));
        const resend = m.pendingSetup ? h('button', { class: 'btn ghost small', type: 'button' }, 'Resend invite') : null;
        if (resend) resend.addEventListener('click', () => busy(resend, async () => {
          try { const r = await api(`/api/admin/users/${enc(m.id)}/invite`, { method: 'POST' }); showInvite(r.invite, m.name); } catch (e) { showError(e); }
        }));
        // "Edit" opens a small inline editor for the person's name and their role on this team.
        const roleText = h('span', { class: 'role-tag' + (m.role ? '' : ' hidden') }, m.role);
        const fFirst = h('input', { type: 'text', maxlength: '60', value: m.firstName, 'aria-label': 'First name', placeholder: 'First name' });
        const fLast = h('input', { type: 'text', maxlength: '60', value: m.lastName, 'aria-label': 'Last name', placeholder: 'Last name' });
        const roleInput = h('input', { type: 'text', maxlength: '60', value: m.role || '', placeholder: 'Role, e.g. QA (optional)', 'aria-label': `Role for ${m.name}` });
        const roleSave = h('button', { class: 'btn primary small', type: 'button' }, 'Save');
        const roleEdit = h('div', { class: 'role-edit hidden' }, fFirst, fLast, roleInput, roleSave,
          h('button', { class: 'btn ghost small', type: 'button', onClick: () => roleEdit.classList.add('hidden') }, 'Cancel'));
        const roleBtn = h('button', { class: 'btn ghost small', type: 'button', onClick: () => { roleEdit.classList.toggle('hidden'); fFirst.focus(); } }, 'Edit');
        const saveRole = () => busy(roleSave, async () => {
          try {
            if (fFirst.value.trim() !== m.firstName || fLast.value.trim() !== m.lastName) {
              await api(`/api/admin/users/${enc(m.id)}`, { method: 'PUT', body: { firstName: fFirst.value, lastName: fLast.value } });
            }
            if (roleInput.value.trim() !== (m.role || '')) {
              await api(`/api/admin/teams/${enc(t.id)}/members/${enc(m.id)}`, { method: 'PUT', body: { role: roleInput.value } });
            }
            await loadTeams(); toast('Saved'); renderLeft(); renderRight();
          } catch (e) { showError(e); }
        });
        roleSave.addEventListener('click', saveRole);
        [fFirst, fLast, roleInput].forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveRole(); } }));
        // Fixed columns (name | role | invite | delete) so buttons line up on every row.
        return h('li', null, h('div', { class: 'member-row' },
          h('div', { class: 'm-name' }, h('div', null, `${m.lastName}, ${m.firstName}`, ' ', roleText), h('div', { class: 'sub' }, m.email)),
          h('div', { class: 'm-role' }, roleBtn),
          h('div', { class: 'm-invite' }, m.pendingSetup ? h('span', { class: 'chip warn' }, 'Invite pending') : null, resend),
          h('div', { class: 'm-delete' }, remove),
          roleEdit));
      }) : [h('li', null, h('div', { class: 'row muted' }, 'No members yet. Add the first one below.'))]);

      // ---- Add someone already in the app (e.g. from another team)
      const search = h('input', { type: 'text', id: 'm-search', placeholder: 'Search by name or email', autocomplete: 'off' });
      const pickList = h('div', { class: 'pick-scroll' }, h('p', { class: 'muted small' }, 'Loading...'));
      const addPicked = h('button', { class: 'btn primary', type: 'button', disabled: true }, 'Add selected');
      let rows = [];
      api('/api/admin/directory').then((d) => {
        const others = d.people.filter((p) => !t.members.some((m) => m.id === p.id));
        rows = others.map((p) => h('label', { class: 'check', 'data-q': `${p.name} ${p.email}`.toLowerCase() },
          h('input', { type: 'checkbox', value: p.email }), `${p.lastName || p.name}${p.firstName ? ', ' + p.firstName : ''}`,
          h('span', { class: 'muted small' }, ` ${p.email}${p.teams.length ? ' · ' + p.teams.join(', ') : ''}`)));
        fill(pickList, rows.length ? rows : h('p', { class: 'muted small' }, 'Everyone in the app is already on this team.'));
      }).catch((x) => fill(pickList, h('p', { class: 'muted small' }, x.message)));
      search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        rows.forEach((r) => r.classList.toggle('hidden', !!q && !r.dataset.q.includes(q)));
      });
      pickList.addEventListener('change', () => { addPicked.disabled = !pickList.querySelector('input:checked'); });
      const pickedRole = h('input', { type: 'text', id: 'm-picked-role', maxlength: '60', placeholder: 'Optional, e.g. QA', style: 'max-width:240px' });
      addPicked.addEventListener('click', () => busy(addPicked, async () => {
        const emails = [...pickList.querySelectorAll('input:checked')].map((c) => c.value);
        let added = 0;
        try {
          for (const em of emails) {
            await api(`/api/admin/teams/${enc(t.id)}/members`, { method: 'POST', body: { email: em, role: pickedRole.value, sendInvite: false } });
            added++;
          }
        } catch (x) { showError(x); }
        await loadTeams();
        if (added) toast(`Added ${added} ${added === 1 ? 'person' : 'people'} to ${t.name}`);
        renderLeft(); renderRight();
      }));

      // ---- Add someone new
      const email = h('input', { type: 'email', id: 'm-email', autocomplete: 'off' });
      const first = h('input', { type: 'text', id: 'm-first', maxlength: '60' });
      const last = h('input', { type: 'text', id: 'm-last', maxlength: '60' });
      const newRole = h('input', { type: 'text', id: 'm-role', maxlength: '60', placeholder: 'e.g. QA, Backend, Scrum master' });
      const sendMail = h('input', { type: 'checkbox', checked: true });
      const addBtn = h('button', { class: 'btn primary', type: 'submit' }, 'Add team member');
      const form = h('form', { novalidate: true }, field('m-email', 'Email', email), h('div', { class: 'grid-2' }, field('m-first', 'First name', first), field('m-last', 'Last name', last)),
        field('m-role', 'Role on this team (optional)', newRole),
        h('label', { class: 'check' }, sendMail, 'Send email', h('span', { class: 'muted small' }, ' (an invitation to create a password)')),
        h('p', { class: 'muted small' }, 'Without the email, use "Resend invite" in the member list when you\'re ready.'), addBtn);
      form.addEventListener('submit', (e) => { e.preventDefault(); busy(addBtn, async () => {
        try {
          const r = await api(`/api/admin/teams/${enc(t.id)}/members`, { method: 'POST', body: { email: email.value, firstName: first.value, lastName: last.value, role: newRole.value, sendInvite: sendMail.checked } });
          await loadTeams();
          const added = r.team.members.find((m) => m.email === email.value.trim().toLowerCase());
          const who = added ? added.name : 'the new member';
          toast(r.invite && r.invite.skipped ? `${who} added. No email was sent.` : 'Team member added');
          renderLeft(); renderRight();
          showInvite(r.invite, who);
        } catch (x) { showError(x); }
      }); });

      fill(right,
        h('section', { class: 'panel' }, h('h2', null, 'Team details'), field('team-name', 'Team name', name), field('team-desc', 'Description', desc), h('div', { class: 'btn-row' }, saveBtn, delBtn)),
        h('section', { class: 'panel' }, h('h2', null, `Members (${t.members.length})`), members),
        h('section', { class: 'panel' }, h('h2', null, 'Add team member'),
          h('h3', null, 'Someone already in the app'),
          h('p', { class: 'muted small' }, 'For example, a person on another team. Tick one or more, then choose Add selected.'),
          h('div', { class: 'field' }, search), pickList,
          h('div', { class: 'btn-row', style: 'margin-top:.75rem' }, h('label', { for: 'm-picked-role', style: 'margin:0' }, 'Role'), pickedRole, addPicked),
          h('h3', { style: 'margin-top:1.5rem' }, 'Someone new'), form));
    }

    function renderAdd() {
      const name = h('input', { type: 'text', id: 'new-team-name', maxlength: '80' });
      const desc = h('textarea', { id: 'new-team-desc', maxlength: '500', style: 'min-height:70px' });
      const create = h('button', { class: 'btn primary', type: 'submit' }, 'Create team');
      const form = h('form', { novalidate: true }, field('new-team-name', 'Team name', name), field('new-team-desc', 'Description', desc),
        h('div', { class: 'btn-row' }, create, teams.length ? h('button', { class: 'btn', type: 'button', onClick: () => { adding = false; renderLeft(); renderRight(); } }, 'Cancel') : null));
      form.addEventListener('submit', (e) => { e.preventDefault(); busy(create, async () => {
        try {
          const r = await api('/api/admin/teams', { method: 'POST', body: { name: name.value, description: desc.value } });
          await loadTeams(); adding = false; selectedId = r.team.id;
          toast(`${r.team.name} created. It's set to "Send update" Monday to Friday until you change it in Configure Updates.`);
          renderLeft(); renderRight();
        } catch (x) { showError(x); }
      }); });
      fill(right, h('section', { class: 'panel' }, h('h2', null, 'New team'), form));
      name.focus();
    }

    renderLeft();
    renderRight();
  }

  /* ===================================================== administrator portal */
  async function adminsView() {
    await loadTeams();
    let assignable = [];
    try { assignable = (await api('/api/admin/admins')).assignable; } catch (e) { showError(e); }
    const listWrap = h('div');
    const orphanNote = h('div');
    const email = h('input', { type: 'email', id: 'a-email', autocomplete: 'off' });
    const first = h('input', { type: 'text', id: 'a-first', maxlength: '60' });
    const last = h('input', { type: 'text', id: 'a-last', maxlength: '60' });
    const teamBoxes = h('div', { class: 'reasons' }, assignable.length ? assignable.map((t) => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: t.id }), t.name)) : h('p', { class: 'muted' }, 'No teams yet. Create one in Edit Teams.'));
    const addBtn = h('button', { class: 'btn primary', type: 'submit' }, 'Add Administrator');
    const form = h('form', { novalidate: true }, field('a-email', 'Email', email), h('div', { class: 'grid-2' }, field('a-first', 'First name', first), field('a-last', 'Last name', last)),
      h('div', { class: 'field' }, h('label', null, 'Administrator for'), teamBoxes), addBtn);
    form.addEventListener('submit', (e) => { e.preventDefault(); busy(addBtn, async () => {
      const teamIds = [...teamBoxes.querySelectorAll('input:checked')].map((c) => c.value);
      try {
        const r = await api('/api/admin/admins', { method: 'POST', body: { email: email.value, firstName: first.value, lastName: last.value, teamIds } });
        toast(`${r.admin.name} is now an administrator`);
        form.reset();
        showInvite(r.invite, r.admin.name);
        loadList();
      } catch (x) { showError(x); }
    }); });

    async function loadList() {
      try {
        const r = await api('/api/admin/admins');
        assignable = r.assignable;
        fill(listWrap, h('ul', { class: 'list' }, r.admins.map((a) => h('li', null, adminRow(a)))));
        fill(orphanNote, r.unadministered.length
          ? h('p', { class: 'notice warn' }, h('strong', null, 'Teams with no administrator: '), r.unadministered.join(', '),
            '. Use Edit on an administrator (yourself included) to assign them.')
          : null);
      } catch (e) { showError(e); }
    }

    function adminRow(a) {
      const row = h('div', { class: 'row', style: 'flex-wrap:wrap' },
        h('div', { class: 'grow' }, h('div', null, a.name, a.id === me.id ? ' (you)' : ''), h('div', { class: 'sub' }, a.email),
          h('div', { class: 'chips', style: 'margin-top:.3rem' }, a.isPrimary ? h('span', { class: 'chip warn' }, 'Primary Administrator') : null,
            a.adminTeams.length ? a.adminTeams.map((t) => h('span', { class: 'chip' }, t.name)) : h('span', { class: 'muted small' }, 'No teams'),
            a.pendingSetup ? h('span', { class: 'chip warn' }, 'Invite pending') : null)));
      const act = (label, cls, fn) => { const b = h('button', { class: `btn small ${cls}`, type: 'button' }, label); b.addEventListener('click', () => busy(b, fn)); return b; };
      // Primary Administrators can edit anyone's teams (including their own and other primaries').
      // Other administrators can edit non-primary administrators, for teams they administer themselves.
      const canEdit = assignable.length && (me.isPrimary || !a.isPrimary);
      const edit = canEdit ? act('Edit', '', async () => editAdmin(a)) : null;
      if (!me.isPrimary) { if (edit) row.append(h('div', { class: 'btn-row' }, edit)); return row; }

      const controls = h('div', { class: 'btn-row' },
        edit,
        a.isPrimary
          ? act('Remove Primary', 'ghost', async () => {
            if (!confirm(`Remove Primary Administrator status from ${a.name}? They stay an administrator.`)) return;
            try { await api(`/api/admin/admins/${enc(a.id)}/primary`, { method: 'POST', body: { primary: false } }); toast('Primary status removed'); if (a.id === me.id) location.reload(); else loadList(); } catch (e) { showError(e); }
          })
          : act('Make Primary', 'ghost', async () => {
            if (!confirm(`Make ${a.name} a Primary Administrator? They will manage all teams and administrators.`)) return;
            try { await api(`/api/admin/admins/${enc(a.id)}/primary`, { method: 'POST', body: { primary: true } }); toast(`${a.name} is now a Primary Administrator`); loadList(); } catch (e) { showError(e); }
          }),
        act('Remove administrator', 'danger', async () => {
          if (!confirm(`Remove ${a.name} as an administrator? They keep their worker account.`)) return;
          try { await api(`/api/admin/admins/${enc(a.id)}`, { method: 'DELETE' }); toast('Administrator removed'); if (a.id === me.id) location.replace('/worker'); else loadList(); } catch (e) { showError(e); }
        }));
      row.append(controls);
      return row;
    }

    // Same team checkboxes as "Add Administrator". You can change the teams you administer;
    // any other teams they have are listed but left as they are.
    function editAdmin(a) {
      const mine = new Set(assignable.map((t) => t.id));
      const others = a.adminTeams.filter((t) => !mine.has(t.id));
      const boxes = h('div', { class: 'reasons' }, assignable.map((t) => h('label', { class: 'check' },
        h('input', { type: 'checkbox', value: t.id, checked: a.adminTeams.some((x) => x.id === t.id) }), t.name)));
      const err = h('p', { class: 'notice error hidden', role: 'alert' });
      const save = h('button', { class: 'btn primary', type: 'button' }, 'Save');
      const dlg = h('dialog', null,
        h('h2', null, `Edit ${a.name}`),
        h('p', { class: 'muted' }, a.email),
        h('div', { class: 'field' }, h('label', null, 'Administrator for'), boxes),
        others.length ? h('p', { class: 'muted small' }, `Also administers (not yours to change): ${others.map((t) => t.name).join(', ')}`) : null,
        err,
        h('div', { class: 'btn-row' }, save, h('button', { class: 'btn', type: 'button', onClick: () => dlg.close() }, 'Cancel')));
      save.addEventListener('click', () => busy(save, async () => {
        try {
          await api(`/api/admin/admins/${enc(a.id)}`, { method: 'PUT', body: { teamIds: [...boxes.querySelectorAll('input:checked')].map((c) => c.value) } });
          dlg.close(); toast(`${a.name}'s teams saved`);
          if (a.id === me.id) { await loadTeams(); }
          loadList();
        } catch (x) { err.textContent = x.message; err.classList.remove('hidden'); }
      }));
      dlg.addEventListener('close', () => dlg.remove());
      document.body.append(dlg);
      dlg.showModal();
    }

    const sections = [
      h('section', { class: 'panel' }, h('h2', null, 'Add Administrator'),
        h('p', { class: 'muted' }, me.isPrimary ? 'Choose the teams they will administer. Names are only needed for people new to the app.' : 'You can grant access to the teams you administer.'), form),
      h('section', { class: 'panel' }, h('h2', null, 'Administrators'), orphanNote, listWrap),
    ];
    if (me.isPrimary) {
      const test = h('button', { class: 'btn', type: 'button' }, 'Send me a test email');
      test.addEventListener('click', () => busy(test, async () => {
        try { const r = await api('/api/admin/test-email', { method: 'POST' }); toast(r.delivered ? `Test email sent to ${me.email}` : `Test email not sent. ${r.error || ''}`, r.delivered ? undefined : 'error'); } catch (e) { showError(e); }
      }));
      sections.push(h('section', { class: 'panel' }, h('h2', null, 'Email delivery'),
        h('p', { class: 'muted' }, 'Invitations and password resets are sent by email. Check that it works:'), test));
    }
    if (me.isPrimary) sections.push(storagePanel());
    sections.push(h('p', { class: 'notice warn' }, 'There must always be at least one Primary Administrator. If none remain, the app has to be reinstalled on the server to create a new one.'));
    // Automatic cleanup of old items (Primary Administrators only).
    function storagePanel() {
      const label = (d, unit) => (d === 0 ? 'Forever' : d % 365 === 0 ? `${d / 365} year${d > 365 ? 's' : ''}` : `${d} days`);
      const msgSel = h('select', { id: 'keep-messages' });
      const updSel = h('select', { id: 'keep-updates' });
      const stats = h('p', { class: 'muted small' }, 'Loading...');
      const save = h('button', { class: 'btn primary', type: 'button' }, 'Save');
      const run = h('button', { class: 'btn', type: 'button' }, 'Clean up now');
      const showStats = (st) => fill(stats,
        `Database: ${st.databaseMB} MB. Voice recordings: ${st.voiceCount} (${st.voiceMB} MB). Videos: ${st.videoCount} (${st.videoMB} MB). `,
        `Kept now: ${st.updates} updates, ${st.messages} messages, ${st.requests} requests.`);
      api('/api/admin/retention').then((r) => {
        fill(msgSel, r.choices.messagesDays.map((d) => h('option', { value: String(d) }, label(d))));
        fill(updSel, r.choices.updatesDays.map((d) => h('option', { value: String(d) }, label(d))));
        msgSel.value = String(r.retention.messagesDays);
        updSel.value = String(r.retention.updatesDays);
        showStats(r.stats);
      }).catch(showError);
      save.addEventListener('click', () => busy(save, async () => {
        const days = Number(updSel.value);
        if (days && !confirm(`Standup updates (and their recordings) older than ${label(days)} will be deleted from now on, including from Reports. Continue?`)) return;
        try { await api('/api/admin/retention', { method: 'PUT', body: { messagesDays: Number(msgSel.value), updatesDays: days } }); toast('Cleanup settings saved'); } catch (e) { showError(e); }
      }));
      run.addEventListener('click', () => busy(run, async () => {
        try {
          const r = await api('/api/admin/retention/run', { method: 'POST' });
          const x = r.removed;
          toast(x.total ? `Removed ${x.messages + x.requests} messages/requests, ${x.updates + x.declines} updates, ${x.recordings} recordings (${x.freedMB} MB).` : 'Nothing old enough to remove.');
          showStats(r.stats);
        } catch (e) { showError(e); }
      }));
      return h('section', { class: 'panel' }, h('h2', null, 'Storage & cleanup'),
        h('div', { class: 'grid-2' },
          field('keep-messages', 'Keep messages and requests for', msgSel),
          field('keep-updates', 'Keep standup updates and their recordings for', updSel)),
        h('p', { class: 'muted small', style: 'margin-top:-.5rem' }, 'Messages and requests: project updates, shared or forwarded updates, and update requests. Standup updates are your Reports history.'),
        stats,
        h('div', { class: 'btn-row' }, save, run));
    }

    page('Administrator Portal', null, ...sections);
    loadList();
  }

  route();
})();
