/* Alejo dashboard: Enquiries. Who asked, who booked, who needed a person, and who is still thinking about it.
   Signed in, the figures come from the database function enquiry_report (sql/018_enquiries.sql) and count Telegram conversations from the
   day the bot started logging every message. Signed out, the public sample dashboard shows made-up figures, labelled as such.
   The switch for following up unfinished bookings is the setting FOLLOWUP_ENABLED (the scheduler reads it). */
(async () => {
  'use strict';
  if (!document.body || document.body.dataset.page !== 'enquiries') return;
  if (window.AlejoReady) await window.AlejoReady;
  const A = window.Alejo, FD = window.FD, LIVE = !!(A && A.live);

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
  const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const ago = (iso) => { const m = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60000)); return m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
  const dayLabel = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' });

  // made-up figures for the public sample dashboard
  const SAMPLE = (days) => {
    const k = days === 7 ? 1 : 3.7, s = (n) => Math.round(n * k);
    return { days, sample: true, tracking_since: null, enquiries: s(46), asked_rooms: s(29), wanted_booking: s(17), booked: s(9), booked_of_room_enquiries: s(9), needed_person: s(8),
      answered_alone: s(38), after_hours: s(14), median_staff_reply_minutes: 11, followups_sent: s(6), booked_after_followup: s(2), lost: s(5),
      open: [{ name: 'Tunde A.', room_type: 'Deluxe', check_in: '2026-10-30', check_out: '2026-11-01', last_at: new Date(Date.now() - 3 * 3600e3).toISOString(), followed_up: true },
        { name: 'Ngozi E.', room_type: 'Standard', check_in: '2026-11-02', check_out: '2026-11-03', last_at: new Date(Date.now() - 26 * 3600e3).toISOString(), followed_up: true },
        { name: 'Someone on Telegram', room_type: null, last_at: new Date(Date.now() - 50 * 60e3).toISOString(), followed_up: false }] };
  };

  let days = 7, loading = 0, lastReport = null;
  const followupOn = () => String((window.FD_FACTS || {}).FOLLOWUP_ENABLED || 'yes').toLowerCase() !== 'no';

  const kpi = (label, value, note) => h('div', {}, h('b', { text: String(value) }), h('span', { text: label }), h('small', { text: note }));
  const render = (r) => {
    const note = $('#eqnote');
    if (r.sample) note.textContent = 'Sample figures for a hotel like yours. Sign in to see your own.';
    else if (!r.tracking_since) note.textContent = 'Nothing recorded yet. Counting starts with the next message a guest sends on Telegram.';
    else if (Date.parse(r.tracking_since) > Date.now() - days * 86400000) note.textContent = `Counting from ${dayLabel(r.tracking_since)}: earlier chats were not recorded, so the days before show nothing.`;
    else note.textContent = '';

    const withRooms = r.asked_rooms;
    $('#eqkpis').replaceChildren(
      kpi('Enquiries', r.enquiries, `conversations in ${r.days} days`),
      kpi('Asked about rooms', r.asked_rooms, `${pct(r.asked_rooms, r.enquiries)}% of enquiries`),
      kpi('Booked', r.booked, withRooms ? `${pct(r.booked_of_room_enquiries, withRooms)}% of those who asked about rooms` : 'nobody asked about rooms yet'),
      kpi('Answered by Alejo alone', r.answered_alone, `${pct(r.answered_alone, r.enquiries)}% of enquiries`),
      kpi('Needed a person', r.needed_person, r.median_staff_reply_minutes != null ? `staff replied in ${r.median_staff_reply_minutes} min (typical)` : 'no staff replies in this period'),
      kpi('After hours', r.after_hours, 'started between 21:00 and 08:00'));

    const steps = [['Sent a message', r.enquiries], ['Asked about rooms or dates', r.asked_rooms], ['Wanted to book', r.wanted_booking], ['Booked', r.booked]];
    const top = Math.max(1, r.enquiries);
    $('#eqfunnel').replaceChildren(...steps.map(([label, n]) => h('div', { class: 'frow' }, h('span', { text: label }),
      h('span', { class: 'bar', role: 'img', 'aria-label': `${n} of ${r.enquiries}` }, h('i', { style: `width:${n ? Math.max(2, pct(n, top)) : 0}%` })), h('b', { text: String(n) }))));

    const open = r.open || [];
    $('#eqopen').replaceChildren(...(open.length ? open.map((o) => h('div', { class: 'tr cols-q', role: 'row' },
      h('div', { class: 'id' }, h('div', {}, h('b', { text: o.name || 'Someone on Telegram' }), o.phone ? h('small', { text: o.phone }) : null)),
      h('div', {}, o.room_type && o.check_in ? `${o.room_type}, ${FD.fmtDay(o.check_in)} to ${FD.fmtDay(o.check_out)}` : 'Asked about rooms, no dates yet'),
      h('div', { text: ago(o.last_at) }),
      h('div', {}, h('span', { class: 'pill ' + (o.followed_up ? 'pos' : ''), text: o.followed_up ? 'Follow-up sent' : (followupOn() ? 'Not yet' : 'Off') })))) :
      [h('p', { class: 'foot-note', text: 'Nobody is waiting. Everyone who asked about rooms has either booked or is more than 3 days old.' })]));
    $('#eqlost').textContent = r.lost ? `${plural(r.lost, 'person', 'people')} asked about rooms in this period, did not book and went quiet for more than 3 days.` : '';

    $('#eqfustats').textContent = `${plural(r.followups_sent, 'follow-up', 'follow-ups')} sent in this period. ${plural(r.booked_after_followup, 'guest', 'guests')} booked afterwards.`;
  };

  const paintToggle = () => {
    const t = $('#eqtoggle');
    t.setAttribute('aria-checked', String(followupOn()));
    t.disabled = !LIVE;
    $('#eqfustate').textContent = LIVE ? (followupOn() ? 'On' : 'Off') : 'On (sample)';
  };
  $('#eqtoggle').addEventListener('click', async () => {
    const t = $('#eqtoggle'), want = followupOn() ? 'no' : 'yes';
    t.disabled = true;
    try { await A.saveFact('FOLLOWUP_ENABLED', want); await A.refresh(); $('#eqstatus').textContent = want === 'yes' ? 'Follow-ups are on.' : 'Follow-ups are off. No more will be sent.'; }
    catch (e) { $('#eqstatus').textContent = e.message || 'Could not change that.'; }
    paintToggle();
    if (lastReport) render(lastReport);                          // the list says Not yet / Off depending on the switch
  });

  const load = async () => {
    const mine = ++loading;
    try {
      const r = LIVE ? await A.report(days) : SAMPLE(days);
      if (mine !== loading) return;
      lastReport = r; render(r); $('#eqerr').textContent = '';
    } catch (e) { if (mine === loading) $('#eqerr').textContent = 'Could not load the figures: ' + (e.message || 'try again.'); }
  };
  document.querySelectorAll('[data-days]').forEach((b) => b.addEventListener('click', () => {
    days = Number(b.dataset.days);
    document.querySelectorAll('[data-days]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    load();
  }));

  paintToggle();
  await load();
  let last = Date.now();
  window.addEventListener('alejo:data', () => { if (Date.now() - last > 30000) { last = Date.now(); load(); paintToggle(); } });   // not on every message: the report is a heavier query
})();
