/* Alejo dashboard: Calendar. A month of days, each showing how many rooms are free; pick a day to see who is staying, arriving and leaving.
   Read-only: it is drawn from the same bookings and blocked rooms the Bookings page uses (live.js fills window.FD; signed out it shows the sample hotel),
   so it always agrees with the desk, the Telegram bot and the phone line. The arithmetic lives in calendar-core.js and is tested in execution/test_calendar.js. */
(async () => {
  'use strict';
  if (!document.body || document.body.dataset.page !== 'calendar') return;
  if (window.AlejoReady) await window.AlejoReady;
  const FD = window.FD, C = window.AlejoCal;
  if (!FD || !C) return;

  const $ = (s, r = document) => r.querySelector(s);
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style') el.setAttribute('style', v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  };
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const longDay = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const monthName = (v) => new Date(Date.UTC(v.y, v.m, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const naira = (n) => (FD.naira ? FD.naira(n) : '₦' + Number(n).toLocaleString('en-NG'));
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && C.fromNum(C.toNum(s)) === s;

  // the sample hotel (signed out) has no room list, so give it one; a real hotel always has its own
  const DEMO_TOTALS = { Standard: 8, Deluxe: 6, Suite: 3 };
  const ctx = () => ({
    today: FD.NOW.date,
    bookings: FD.bookings || [],
    blocks: FD.blocks || [],
    svcBookings: FD.svcBookings || [],
    roomTypes: FD.roomTypes || Object.keys(FD.RATES || {}).map((name) => ({ name, rate: FD.RATES[name], total: DEMO_TOTALS[name] || 4 })),
  });

  const params = new URLSearchParams(location.search);
  let sel = isDate(params.get('d')) ? params.get('d') : FD.NOW.date;
  let view = C.monthOf(sel);
  let type = '';
  const grid = $('#cgrid'), dayEl = $('#cday');
  const say = (t) => { const s = $('#cstatus'); s.textContent = ''; setTimeout(() => { s.textContent = t; }, 40); };

  /* ---------- the month ---------- */
  const LABEL = {
    open: (s) => `${s.free} free`, few: (s) => `${s.free} left`, full: () => 'Full', closed: () => 'Closed',
    past: (s) => (s.booked ? `${s.booked} stayed` : ''), none: () => '',
  };
  const SPOKEN = {
    open: (s) => `${plural(s.free, 'room', 'rooms')} free`, few: (s) => `only ${plural(s.free, 'room', 'rooms')} left`, full: () => 'full', closed: () => 'closed, rooms blocked',
    past: (s) => `${plural(s.booked, 'room', 'rooms')} were in use`, none: () => 'no rooms set up',
  };
  const hall = (s) => [...new Set(s.svc.filter((b) => b.exclusive).map((b) => b.service))].join(', ');               // an exclusive service (the event hall) booked that day
  const moves = (s) => [s.arriving.length ? `${s.arriving.length} in` : '', s.leaving.length ? `${s.leaving.length} out` : '', s.blocked && s.state !== 'closed' ? `${s.blocked} blocked` : '', hall(s)].filter(Boolean).join(' · ');
  const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const renderGrid = () => {
    const c = ctx();
    $('#cmonth').textContent = monthName(view);
    const cells = C.monthDays(view).map((d) => {
      const s = C.dayStats(d, c, type), inMonth = C.monthOf(d).m === view.m;
      const use = s.total ? Math.min(100, Math.round(((s.booked + s.blocked) / s.total) * 100)) : 0;
      const day = +d.slice(8, 10);
      return h('button', {
        type: 'button', class: `calcell ${s.state}${inMonth ? '' : ' out'}${d === c.today ? ' now' : ''}${d === sel ? ' sel' : ''}`, 'data-d': d,
        'aria-pressed': String(d === sel), 'aria-current': d === c.today ? 'date' : false, tabindex: d === sel ? '0' : '-1',
        'aria-label': `${longDay(d)}: ${SPOKEN[s.state](s)}${s.arriving.length ? ', ' + s.arriving.length + ' arriving' : ''}${s.leaving.length ? ', ' + s.leaving.length + ' leaving' : ''}${hall(s) ? ', ' + hall(s) + ' booked' : ''}`,
      },
      h('span', { class: 'cd' }, day === 1 ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : String(day)),
      h('span', { class: 'cv', text: LABEL[s.state](s) }),
      h('small', { class: 'cm', text: moves(s) }),
      h('i', { class: 'cb', 'aria-hidden': 'true' }, h('b', { style: `width:${use}%` })));
    });
    grid.replaceChildren(...WEEK.map((w) => h('div', { class: 'cw', 'aria-hidden': 'true', text: w })), ...cells);
  };

  /* ---------- the chosen day ---------- */
  const stageWord = (b) => { const g = C.stageOf(b); return g >= 4 ? ['Checked out', ''] : g >= 2 ? ['Checked in', 'pos'] : ['Booked', 'ai']; };
  const roomWord = (b) => { const no = b.roomNo || (b.room && b.room !== 'not assigned' ? b.room : ''); return `${b.type}${no ? ', room ' + no : ''}`; };
  const stayRow = (b) => {
    const [word, cls] = stageWord(b), n = C.toNum(b.out) - C.toNum(b.in);
    return h('div', { class: 'brow' },
      h('div', {}, h('b', { text: b.guest }), h('small', { text: `${roomWord(b)}. ${FD.fmtDay(b.in)} to ${FD.fmtDay(b.out)}, ${plural(n, 'night', 'nights')}${b.ref ? '. Ref ' + b.ref : ''}${b.src ? '. ' + b.src : ''}` })),
      h('span', { class: 'pill ' + cls, text: word }));
  };
  const group = (title, list, empty) => h('div', { class: 'calgrp' }, h('h3', {}, title, h('span', { class: 'n', text: String(list.length) })), ...(list.length ? list.map(stayRow) : [h('p', { class: 'foot-note', text: empty })]));

  const renderDay = () => {
    const s = C.dayStats(sel, ctx(), type), past = s.past;
    const pill = { open: ['pos', `${plural(s.free, 'room', 'rooms')} free`], few: ['warn', `Only ${plural(s.free, 'room', 'rooms')} left`], full: ['neg', 'Full'], closed: ['neg', 'Closed'], past: ['', 'Past'], none: ['', 'No rooms set up'] }[s.state];
    const staying = s.stays.filter((b) => b.in < sel), arriving = s.arriving;
    dayEl.replaceChildren(...[
      h('div', { class: 'calday-h' }, h('h2', { text: longDay(sel) }), h('span', { class: 'pill ' + pill[0], text: pill[1] })),
      h('p', { class: 'sub', text: `${type || 'All rooms'}: ${plural(s.total, 'room', 'rooms')}, ${s.booked} ${past ? 'were in use' : 'in use'}${s.blocked ? ', ' + s.blocked + ' blocked' : ''}${past ? '' : ', ' + s.free + ' free'}.` }),
      s.byType.length > 1 ? h('div', { class: 'calbytype' }, s.byType.map((t) => h('div', {}, h('b', { text: t.name }), h('span', { text: past ? `${t.booked} of ${t.total} in use` : `${t.free} of ${t.total} free` }), h('small', { text: t.rate ? naira(t.rate) + ' a night' : '' })))) : null,
      group(past ? 'Arrived' : 'Arriving', arriving, past ? 'Nobody arrived.' : 'Nobody is arriving.'),
      group(past ? 'Stayed over' : 'Staying', staying, 'Nobody is staying over from the night before.'),
      group(past ? 'Left' : 'Leaving', s.leaving, past ? 'Nobody left.' : 'Nobody is leaving.'),
      s.svc.length ? h('div', { class: 'calgrp' }, h('h3', {}, 'Event hall, gym and other bookings', h('span', { class: 'n', text: String(s.svc.length) })),
        ...s.svc.map((b) => h('div', { class: 'brow' }, h('div', {}, h('b', { text: b.name }), h('small', { text: `${b.service}${b.startTime ? ', ' + b.startTime + (b.endTime ? ' to ' + b.endTime : '') : ''}. ${b.start === b.end ? FD.fmtDay(b.start) : FD.fmtDay(b.start) + ' to ' + FD.fmtDay(b.end)}. Ref ${b.ref}` })),
          h('span', { class: 'pill ' + (b.amount > 0 && b.paid >= b.amount ? 'pos' : b.paid > 0 ? 'warn' : ''), text: b.amount > 0 && b.paid >= b.amount ? 'Paid in full' : b.paid > 0 ? 'Part paid' : 'Not paid' })))) : null,
      s.blocks.length ? h('div', { class: 'calgrp' }, h('h3', {}, 'Rooms out of sale', h('span', { class: 'n', text: String(s.blocks.reduce((n, k) => n + k.rooms, 0)) })),
        ...s.blocks.map((k) => h('div', { class: 'brow' }, h('div', {}, h('b', { text: `${k.type}: ${plural(k.rooms, 'room', 'rooms')}` }), h('small', { text: `${FD.fmtDay(k.start)} to ${FD.fmtDay(k.end)}${k.reason ? ', ' + k.reason : ''}` }))))) : null].filter(Boolean));       // an absent part must not print as "null"
  };

  const choose = (d, opts) => {
    sel = d;
    if (C.monthOf(d).y !== view.y || C.monthOf(d).m !== view.m) view = C.monthOf(d);
    try { const p = new URLSearchParams(location.search); p.set('d', d); history.replaceState(null, '', '?' + p.toString()); } catch (e) { /* ignore */ }
    renderGrid(); renderDay();
    $('#cgo').value = d;
    if (opts && opts.focus) { const b = grid.querySelector(`[data-d="${d}"]`); if (b) b.focus(); }
    if (opts && opts.scroll) dayEl.scrollIntoView({ block: 'nearest' });
    say(`${longDay(d)} selected.`);
  };

  grid.addEventListener('click', (e) => { const b = e.target.closest('[data-d]'); if (b) choose(b.dataset.d, { scroll: true }); });
  grid.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (step == null) return;
    e.preventDefault();
    choose(C.addDays(sel, step), { focus: true });
  });
  const moveMonth = (n) => { view = C.shiftMonth(view, n); renderGrid(); };
  $('#cprev').addEventListener('click', () => moveMonth(-1));
  $('#cnext').addEventListener('click', () => moveMonth(1));
  $('#ctoday').addEventListener('click', () => choose(FD.NOW.date));
  $('#cgo').addEventListener('change', (e) => { if (isDate(e.target.value)) choose(e.target.value); });

  const typeSel = $('#ctype');
  const fillTypes = () => {
    const names = ctx().roomTypes.map((t) => t.name), keep = names.includes(type) ? type : '';
    typeSel.replaceChildren(h('option', { value: '', text: 'All rooms' }), ...names.map((n) => h('option', Object.assign({ value: n, text: n }, n === keep ? { selected: true } : {}))));
    type = keep; typeSel.value = keep;
  };
  typeSel.addEventListener('change', () => { type = typeSel.value; renderGrid(); renderDay(); });

  /* ---------- go ---------- */
  fillTypes(); renderGrid(); renderDay();
  $('#cgo').value = sel;
  addEventListener('alejo:data', () => { fillTypes(); renderGrid(); renderDay(); });      // a booking arrived or changed: the calendar follows
})();
