/* Alejo dashboard: Settings, "Services you sell". A manager adds, prices, switches off or removes the event hall, gym, pool and anything else
   a guest can book besides a room. Signed in only; the database lets only managers change these rows (sql/025_services.sql), and
   a service that already has bookings can never be deleted (switch it off instead). */
(async () => {
  'use strict';
  if (!document.body || document.body.dataset.page !== 'settings') return;
  if (window.AlejoReady) await window.AlejoReady;
  const A = window.Alejo, FD = window.FD, V = window.AlejoSvc;
  const sec = document.getElementById('svcSettings');
  if (!sec || !A || !A.live || !A.services || !V || A.denied || !A.can('manager')) return;       // the public sample has no services to edit
  sec.hidden = false;

  const $ = (s, r = document) => r.querySelector(s);
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  };
  const dlg = $('#mdlg'), body = $('#mbody'), title = $('#mdt');
  const show = (t, ...nodes) => { title.textContent = t; body.replaceChildren(...nodes.filter(Boolean)); if (!dlg.open) dlg.showModal(); };
  $('#mclose').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  const say = (t) => { const s = $('#svcstatus'); s.textContent = ''; setTimeout(() => { s.textContent = t; }, 40); };
  const naira = (n) => (FD.naira ? FD.naira(n) : '₦' + Number(n).toLocaleString('en-NG'));
  const field = (label, control, hint) => h('label', { class: 'mfield' }, h('span', { text: label }), control, hint ? h('small', { text: hint }) : null);
  const input = (attrs) => h('input', Object.assign({ class: 'minput' }, attrs));
  const UNIT_LABEL = { per_event: 'per event (one booking, one price)', per_day: 'per day', per_head: 'per person', per_month: 'per month', per_visit: 'per visit' };

  // one card per service: name and tags, the price, a note for staff, and (on the right) Edit and the on-sale switch, always in the same place
  const render = () => {
    const list = FD.servicesAll || [];
    $('#svcList').replaceChildren(...(list.length ? list.map((s) => {
      const tog = h('button', { class: 'tog', type: 'button', role: 'switch', 'aria-checked': String(s.active), 'aria-label': `${s.name} is on sale` });
      tog.addEventListener('click', async () => {
        tog.disabled = true;
        try { await A.services.save(Object.assign({}, s, { active: !s.active })); await A.refresh(); say(`${s.name} is ${s.active ? 'switched off' : 'on sale again'}.`); }
        catch (e) { say(e.message); tog.disabled = false; }
      });
      return h('div', { class: 'svc-card' + (s.active ? '' : ' off') },
        h('div', { class: 'svc-main' },
          h('div', { class: 'svc-name' }, h('b', { text: s.name }), s.exclusive ? h('span', { class: 'pill', text: 'One booking per day' }) : null, s.active ? null : h('span', { class: 'pill warn', text: 'Switched off' })),
          h('div', { class: 'svc-price' }, s.price > 0 ? naira(s.price) : 'Price on request', s.price > 0 ? h('small', { text: ' ' + V.unitOf(s.unit).per }) : null),
          s.notes ? h('p', { class: 'svc-note', text: s.notes }) : null),
        h('div', { class: 'svc-act' }, h('button', { class: 'btn line small', type: 'button', text: 'Edit', 'aria-label': 'Edit ' + s.name, onclick: () => edit(s) }),
          h('span', { class: 'svc-sw' }, tog, h('span', { 'aria-hidden': 'true', text: s.active ? 'On sale' : 'Off' }))));
    }) : [h('p', { class: 'd', text: 'No services yet. Add the first one, for example the event hall, and it appears in New booking.' })]));
  };

  const edit = (s) => {
    const f = {
      name: input({ type: 'text', required: true, maxlength: 80, autocomplete: 'off', value: s ? s.name : '' }),
      price: input({ type: 'number', min: '0', step: '100', required: true, inputmode: 'numeric', value: s ? String(s.price) : '' }),
      unit: h('select', { class: 'minput' }, Object.keys(UNIT_LABEL).map((u) => h('option', Object.assign({ value: u, text: UNIT_LABEL[u] }, (s ? s.unit : 'per_event') === u ? { selected: true } : {})))),
      excl: h('input', Object.assign({ type: 'checkbox' }, s && s.exclusive ? { checked: true } : {})),
      notes: input({ type: 'text', maxlength: 300, autocomplete: 'off', value: s && s.notes ? s.notes : '', placeholder: 'Optional, for staff' }),
    };
    const err = h('p', { class: 'merr', role: 'alert' });
    const save = h('button', { class: 'btn', type: 'submit', text: s ? 'Save' : 'Add service' });
    const fail = (e) => { err.textContent = e.message || 'That did not work.'; };
    const form = h('form', { class: 'msec', onsubmit: async (e) => {
      e.preventDefault(); err.textContent = ''; save.disabled = true;
      try {
        await A.services.save({ id: s ? s.id : null, name: f.name.value.trim(), price: Number(f.price.value), unit: f.unit.value, exclusive: f.excl.checked, active: s ? s.active : true, notes: f.notes.value.trim(), sort: s ? s.sort : (FD.servicesAll || []).length + 1 });
        dlg.close(); await A.refresh(); say(s ? `${f.name.value.trim()} saved.` : `${f.name.value.trim()} added. It now appears in New booking.`);
      } catch (x) { fail(x); } finally { save.disabled = false; }
    } },
    h('div', { class: 'mgrid' }, field('Name', f.name), field('Price (₦)', f.price)),
    field('The price is', f.unit, 'This decides what New booking asks for: people, days, months or an end date.'),
    h('label', { class: 'mcheck' }, f.excl, 'Only one booking per day (for example the event hall)'),
    field('Notes', f.notes),
    h('div', { class: 'mact' }, save, h('button', { class: 'btn line', type: 'button', text: 'Cancel', onclick: () => dlg.close() })),
    s ? h('div', { class: 'msec' }, h('h3', { text: 'Remove' }), h('p', { class: 'mhint', text: 'A service that already has bookings cannot be deleted: switch it off instead.' }),
      h('div', { class: 'mact' }, h('button', { class: 'btn danger', type: 'button', text: 'Delete this service', onclick: async (ev) => {
        if (!confirm(`Delete ${s.name}? This cannot be undone.`)) return;
        ev.target.disabled = true; err.textContent = '';
        try { await A.services.remove(s.id); dlg.close(); await A.refresh(); say(`${s.name} deleted.`); } catch (x) { fail(x); ev.target.disabled = false; }
      } }))) : null,
    err);
    show(s ? 'Edit ' + s.name : 'Add a service', form);
    f.name.focus();
  };

  $('#svcAdd').addEventListener('click', () => edit(null));
  window.addEventListener('alejo:data', render);
  render();
})();
