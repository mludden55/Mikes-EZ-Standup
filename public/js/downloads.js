'use strict';
(async function () {
  const d = await api('/api/downloads', { allow401: true });
  const dl = $('#desktop');
  if (d.desktop && d.desktop.length) d.desktop.forEach((f) => dl.append(h('li', null, h('div', { class: 'row' }, h('a', { class: 'grow', href: f.url }, f.name)))));
  else dl.append(h('li', null, h('div', { class: 'row muted' }, 'Not built yet. Administrators: run desktop\\build.cmd on the server (see desktop\\README.md).')));
  if (d.certificate && d.certificate.length) {
    $('#cert-panel').classList.remove('hidden');
    const order = ['Trust-Certificate-Windows.bat', 'Trust-Certificate-Mac.command', 'MikesEZStandup-Certificate.crt', 'README.txt'];
    d.certificate.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name))
      .forEach((f) => $('#certificate').append(h('li', null, h('div', { class: 'row' }, h('a', { class: 'grow', href: f.url }, f.name)))));
  }
  for (const k of ['worker', 'admin']) {
    const ul = $('#' + k);
    if (!d[k].length) { ul.append(h('li', null, h('div', { class: 'row' }, 'No installers yet. Run the server installer first.'))); continue; }
    for (const f of d[k]) ul.append(h('li', null, h('div', { class: 'row' }, h('a', { class: 'grow', href: f.url }, f.name))));
  }
})();
