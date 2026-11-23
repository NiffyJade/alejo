/* Alejo dashboard: manage bookings (Bookings page, signed-in staff only).
   New booking, a panel per stay (room number, payments, check in / check out, cancel) and blocked rooms.
   Every change calls a database function through Alejo.manage (see live.js and sql/017_manage_bookings.sql); the database decides whether
   a room is really free, so the desk, the Telegram bot and the phone line can never double-book each other.
   Signed out, the public sample dashboard stays read-only and this file does nothing. */
(async () => {
  'use strict';
  if (!document.body || document.body.dataset.page !== 'bookings') return;
  if (window.AlejoReady) await window.AlejoReady;
  const A = window.Alejo, FD = window.FD;
  if (!A || !A.live || !A.manage) return;

  const $ = (s, r = document) => r.querySelector(s);
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'value') el.value = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  };
  const addDays = (s, n) => new Date(Date.parse(s) + n * 86400000).toISOString().slice(0, 10);
  const today = () => FD.NOW.date;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const say = (t) => { const s = $('#mstatus'); s.textContent = ''; setTimeout(() => { s.textContent = t; }, 40); };

  /* ---------- the dialog ---------- */
  const dlg = $('#mdlg'), body = $('#mbody'), title = $('#mdt');
  const show = (t, ...nodes) => { title.textContent = t; body.replaceChildren(...nodes.filter(Boolean)); if (!dlg.open) dlg.showModal(); };   // filter: a missing optional part must not print as "null"
  $('#mclose').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

  const field = (label, control, hint) => h('label', { class: 'mfield' }, h('span', { text: label }), control, hint ? h('small', { text: hint }) : null);
  const input = (attrs) => h('input', Object.assign({ class: 'minput' }, attrs));
  const select = (options, value) => h('select', { class: 'minput' }, options.map(([v, t]) => h('option', Object.assign({ value: v, text: t }, v === value ? { selected: true } : {}))));
  const METHODS = [['', 'How was it paid?'], ['cash', 'Cash'], ['transfer', 'Bank transfer'], ['pos', 'POS / card'], ['other', 'Other']];

  // runs an action on a button: disables it meanwhile and shows the error (if any) in the dialog
  const busy = (btn, on) => { btn.disabled = on; btn.setAttribute('aria-busy', String(on)); };
  const run = async (btn, errEl, fn) => {
    errEl.textContent = ''; busy(btn, true);
    try { await fn(); } catch (e) { errEl.textContent = e.message || 'That did not work.'; } finally { busy(btn, false); }
  };

  // free rooms for a date range, shown under a form and kept current as the dates change
  const availabilityHint = (getRange) => {
    const el = h('p', { class: 'mhint', 'aria-live': 'polite' });
    let seq = 0;
    const update = async () => {
      const n = ++seq, [ci, co] = getRange();
      if (!ci || !co || co <= ci) { el.textContent = ''; return; }
      try {
        const rows = await A.manage.availability(ci, co);
        if (n === seq) el.textContent = 'Free for these dates: ' + rows.map((r) => `${r.room_type} ${r.free}`).join(', ') + '.';
      } catch (e) { if (n === seq) el.textContent = ''; }
    };
    return { el, update };
  };

  /* ---------- new booking ---------- */
  const openNew = () => {
    const t0 = today();
    const f = {
      name: input({ type: 'text', required: true, maxlength: 80, autocomplete: 'off' }),
      phone: input({ type: 'tel', inputmode: 'tel', autocomplete: 'off', placeholder: '0803 000 0000' }),
      type: select(FD.roomTypes.map((r) => [r.name, `${r.name} (${FD.naira(r.rate)} a night)`])),
      ci: input({ type: 'date', required: true, min: t0, value: t0 }),
      co: input({ type: 'date', required: true, min: t0, value: addDays(t0, 1) }),
      source: select([['walk-in', 'Walk-in'], ['phone', 'Phone call'], ['online', 'Online or another platform'], ['other', 'Other']]),
      room: input({ type: 'text', maxlength: 20, autocomplete: 'off', placeholder: 'Optional, for example 204' }),
      now: h('input', { type: 'checkbox' }),
      paid: input({ type: 'number', min: '0', step: '100', placeholder: '0', inputmode: 'numeric' }),
      method: select(METHODS),
    };
    const nowRow = h('label', { class: 'mcheck' }, f.now, 'The guest is here now: check them in');
    const avail = availabilityHint(() => [f.ci.value, f.co.value]);
    const err = h('p', { class: 'merr', role: 'alert' });
    const submit = h('button', { class: 'btn', type: 'submit', text: 'Create booking' });
    const sync = () => {
      if (f.co.value && f.ci.value && f.co.value <= f.ci.value) f.co.value = addDays(f.ci.value, 1);
      f.co.min = f.ci.value ? addDays(f.ci.value, 1) : t0;
      nowRow.hidden = f.ci.value !== t0;
      if (nowRow.hidden) f.now.checked = false;
      avail.update();
    };
    f.ci.addEventListener('change', sync); f.co.addEventListener('change', sync);
    const form = h('form', { class: 'msec', novalidate: false, onsubmit: (e) => {
      e.preventDefault();
      run(submit, err, async () => {
        const r = await A.manage.create({ name: f.name.value, phone: f.phone.value, type: f.type.value, ci: f.ci.value, co: f.co.value, source: f.source.value,
          room: f.room.value, checkInNow: f.now.checked && !nowRow.hidden, paid: Number(f.paid.value || 0), method: f.method.value });
        dlg.close();
        say(`Booked ${r.guest_name}, ${r.room_type}, reference ${r.ref}.`);
        await A.refresh();
      });
    } },
      h('div', { class: 'mgrid' },
        field('Guest name', f.name), field('Phone number', f.phone, 'Used to find the guest again and to link Telegram later.'),
        field('Room type', f.type), field('Source', f.source),
        field('Check-in', f.ci), field('Check-out', f.co),
        field('Room number', f.room), field('Amount paid so far (₦)', f.paid)),
      h('div', { class: 'mgrid' }, field('Payment method', f.method), h('span')),
      avail.el, nowRow,
      h('div', { class: 'mact' }, submit, h('button', { class: 'btn line', type: 'button', onclick: () => dlg.close(), text: 'Cancel' })), err);
    show('New booking', form);
    avail.update();
    f.name.focus();
  };

  /* ---------- one stay ---------- */
  const STATUS = { booked: 'Booked', checked_in: 'Checked in', checked_out: 'Checked out' };
  const openStay = (id, note) => {
    const b = FD.bookings.find((x) => x.id === id);
    if (!b) { if (dlg.open) dlg.close(); return; }
    const balance = Math.max(0, b.total - (b.paid || 0));
    const err = h('p', { class: 'merr', role: 'alert' });
    const after = async (msg) => { await A.refresh(); say(msg); openStay(id, msg); };

    const kv = h('dl', { class: 'mkv' },
      [['Reference', b.ref], ['Status', STATUS[b.status] || b.status], ['Room', `${b.type}${b.roomNo ? ', room ' + b.roomNo : ', room not assigned'}`],
        ['Stay', `${FD.fmtDay(b.in)} to ${FD.fmtDay(b.out)} (${plural(b.nights, 'night', 'nights')})`], ['Source', b.src],
        ['Total', FD.naira(b.total)], ['Paid', FD.naira(b.paid || 0)], ['Balance', balance > 0 ? FD.naira(balance) : 'None']]
        .flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })]));

    // room number
    const room = input({ type: 'text', maxlength: 20, autocomplete: 'off', value: b.roomNo, 'aria-label': 'Room number', placeholder: 'Room number' });
    const saveRoom = h('button', { class: 'btn line', type: 'button', text: 'Save room', disabled: b.status === 'checked_out' });
    saveRoom.addEventListener('click', () => run(saveRoom, err, async () => { await A.manage.room(b.id, room.value); await after(room.value.trim() ? `Room ${room.value.trim()} saved.` : 'Room number cleared.'); }));

    // payments
    const amount = input({ type: 'number', step: '100', inputmode: 'numeric', 'aria-label': 'Amount in naira', placeholder: 'Amount (₦)' });
    const method = select(METHODS);
    method.setAttribute('aria-label', 'Payment method');
    const pnote = input({ type: 'text', maxlength: 200, 'aria-label': 'Payment note', placeholder: 'Note (optional)' });
    const addPay = h('button', { class: 'btn line', type: 'button', text: 'Record payment' });
    addPay.addEventListener('click', () => run(addPay, err, async () => {
      const v = Number(amount.value);
      if (!v) throw new Error('Enter the amount received. Use a minus sign for a refund.');
      await A.manage.pay(b.id, v, method.value, pnote.value);
      await after(v > 0 ? `Recorded ${FD.naira(v)}.` : `Recorded a refund of ${FD.naira(-v)}.`);
    }));
    const payList = (b.payments || []).map((p) => h('div', { class: 'mpay' },
      h('span', {}, `${p.amount < 0 ? 'Refund ' : ''}${FD.naira(Math.abs(p.amount))}`, h('small', { text: [p.method, p.note].filter(Boolean).map((s) => ' ' + s).join(' ·') })),
      h('small', { text: new Date(p.at).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) })));

    // check in / out and cancel
    const actions = [];
    if (b.status === 'booked') {
      const early = b.in > today();
      const inBtn = h('button', { class: 'btn', type: 'button', text: early ? 'Check in early' : 'Check in' });
      inBtn.addEventListener('click', () => {
        if (early && !confirm(`${b.guest} is booked from ${FD.fmtDay(b.in)}. Check them in now?`)) return;
        run(inBtn, err, async () => { await A.manage.status(b.id, 'checkin'); await after(`${b.guest} is checked in.`); });
      });
      actions.push(inBtn);
    }
    if (b.status === 'checked_in') {
      const outBtn = h('button', { class: 'btn', type: 'button', text: 'Check out' });
      outBtn.addEventListener('click', () => run(outBtn, err, async () => {
        if (balance > 0 && !confirm(`${b.guest} still owes ${FD.naira(balance)}. Check them out anyway?`)) return;
        await A.manage.status(b.id, 'checkout'); await after(`${b.guest} is checked out.`);
      }));
      actions.push(outBtn);
    }
    let cancelBox = null;
    if (b.status === 'booked') {
      const reason = input({ type: 'text', maxlength: 200, 'aria-label': 'Reason for cancelling', placeholder: 'Reason (optional), for example guest called' });
      const confirmBtn = h('button', { class: 'btn danger', type: 'button', text: 'Yes, cancel this booking' });
      confirmBtn.addEventListener('click', () => run(confirmBtn, err, async () => {
        await A.manage.cancel(b.id, reason.value); await A.refresh(); say(`Booking ${b.ref} cancelled.`); if (dlg.open) dlg.close();
      }));
      cancelBox = h('div', { class: 'msec', hidden: true }, h('p', { class: 'mhint', text: `This frees the room. The guest is not told automatically: reply to them in the Inbox if they asked.` }), reason, h('div', { class: 'mact' }, confirmBtn));
      const showCancel = h('button', { class: 'btn line', type: 'button', text: 'Cancel booking', 'aria-expanded': 'false' });
      showCancel.addEventListener('click', () => { cancelBox.hidden = !cancelBox.hidden; showCancel.setAttribute('aria-expanded', String(!cancelBox.hidden)); if (!cancelBox.hidden) reason.focus(); });
      actions.push(showCancel);
    }

    show(b.guest,
      note ? h('p', { class: 'mhint', role: 'status', text: note }) : null,
      kv,
      actions.length ? h('div', { class: 'mact' }, actions) : null, cancelBox,
      h('div', { class: 'msec' }, h('h3', { text: 'Room number' }), h('div', { class: 'mact' }, room, saveRoom)),
      h('div', { class: 'msec' }, h('h3', { text: 'Payments' }), ...(payList.length ? payList : [h('p', { class: 'mhint', text: 'No payments recorded yet.' })]),
        h('div', { class: 'mgrid' }, amount, method), pnote, h('div', { class: 'mact' }, addPay), h('p', { class: 'mhint', text: 'Use a minus sign for a refund.' })),
      err);
  };

  /* ---------- blocked rooms ---------- */
  const renderBlocks = () => {
    const t0 = today();
    const list = (FD.blocks || []).filter((k) => k.end > t0);
    $('#blist').replaceChildren(...(list.length ? list.map((k) => {
      const rm = h('button', { class: 'btn line small', type: 'button', text: 'Remove', 'aria-label': `Remove the block of ${plural(k.rooms, 'room', 'rooms')} (${k.type})` });
      rm.addEventListener('click', async () => {
        if (!confirm('Put these rooms back on sale?')) return;
        busy(rm, true);
        try { await A.manage.unblock(k.id); say('Rooms are back on sale.'); await A.refresh(); } catch (e) { say(e.message); busy(rm, false); }
      });
      return h('div', { class: 'brow' }, h('div', {}, h('b', { text: `${k.type}: ${plural(k.rooms, 'room', 'rooms')}` }),
        h('small', { text: `${FD.fmtDay(k.start)} to ${FD.fmtDay(k.end)}${k.reason ? ', ' + k.reason : ''}` })), rm);
    }) : [h('p', { class: 'foot-note', text: 'No rooms are blocked.' })]));
  };
  const openBlock = () => {
    const t0 = today();
    const f = { type: select(FD.roomTypes.map((r) => [r.name, `${r.name} (${plural(r.total, 'room', 'rooms')})`])), rooms: input({ type: 'number', min: '1', value: '1', required: true, inputmode: 'numeric' }),
      start: input({ type: 'date', required: true, min: t0, value: t0 }), end: input({ type: 'date', required: true, min: addDays(t0, 1), value: addDays(t0, 1) }),
      reason: input({ type: 'text', maxlength: 200, autocomplete: 'off', placeholder: 'For example repainting, or booked on Booking.com' }) };
    const avail = availabilityHint(() => [f.start.value, f.end.value]);
    const err = h('p', { class: 'merr', role: 'alert' });
    const submit = h('button', { class: 'btn', type: 'submit', text: 'Block rooms' });
    const sync = () => { if (f.end.value <= f.start.value) f.end.value = addDays(f.start.value, 1); f.end.min = addDays(f.start.value, 1); avail.update(); };
    f.start.addEventListener('change', sync); f.end.addEventListener('change', sync);
    show('Block rooms', h('form', { class: 'msec', onsubmit: (e) => {
      e.preventDefault();
      run(submit, err, async () => {
        await A.manage.block({ type: f.type.value, rooms: Number(f.rooms.value), start: f.start.value, end: f.end.value, reason: f.reason.value });
        dlg.close(); say('Rooms blocked.'); await A.refresh();
      });
    } },
    h('p', { class: 'mhint', text: 'Blocked rooms cannot be booked by anyone: the desk, the Telegram bot or the phone line. The night of the end date is not blocked, like a check-out day.' }),
    h('div', { class: 'mgrid' }, field('Room type', f.type), field('Number of rooms', f.rooms), field('From', f.start), field('Until (check-out day)', f.end)),
    field('Reason', f.reason), avail.el, h('div', { class: 'mact' }, submit, h('button', { class: 'btn line', type: 'button', onclick: () => dlg.close(), text: 'Cancel' })), err));
    avail.update();
  };

  /* ---------- wiring ---------- */
  $('#bnew').hidden = false;
  $('#blocksSec').hidden = false;
  $('#bnew').addEventListener('click', openNew);
  $('#bblock').addEventListener('click', openBlock);
  const rows = $('#bbody');
  rows.addEventListener('click', (e) => { const row = e.target.closest('[data-bid]'); if (row) openStay(row.dataset.bid); });
  rows.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-bid]')) { e.preventDefault(); openStay(e.target.dataset.bid); } });
  window.addEventListener('alejo:data', renderBlocks);
  renderBlocks();
})();
