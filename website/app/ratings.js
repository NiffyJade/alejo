/* Alejo dashboard: Ratings. How guests rated their stay after checking out on Telegram, and the low scores that need a person.
   Signed in, the figures come from the database function ratings_report (sql/019_ratings.sql). A score of 3 or less has already opened a
   complaint item in the Inbox and alerted the staff group; this page shows the overall picture. Signed out, the public sample dashboard
   shows made-up figures, labelled as such. */
(async () => {
  'use strict';
  if (!document.body || document.body.dataset.page !== 'ratings') return;
  const releaseBoot = window.AlejoBoot ? window.AlejoBoot.hold() : () => {};   // the outlines stay until the report is drawn (boot.js)
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
  const dayLabel = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: ((window.Alejo && window.Alejo.hotel && window.Alejo.hotel() && window.Alejo.hotel().timezone) || 'Africa/Lagos') });

  // made-up figures for the public sample dashboard
  const SAMPLE = (days) => {
    const k = days === 7 ? 1 : days === 30 ? 4 : 12, s = (n) => Math.round(n * k);
    const hours = (n) => new Date(Date.now() - n * 3600e3).toISOString();
    return { days, sample: true, tracking_since: null, rated: s(11), asked: s(14), average: 4.4, previous_average: 4.1, previous_rated: s(9), low_count: s(2),
      distribution: { 1: 0, 2: s(1), 3: s(1), 4: s(3), 5: s(6) },
      by_room: [{ room_type: 'Deluxe', average: 4.6, count: s(5) }, { room_type: 'Standard', average: 4.2, count: s(5) }, { room_type: 'Suite', average: 4.0, count: s(1) }],
      low: [{ name: 'Funmi A.', room_type: 'Standard', room_number: '110', check_in: '2026-10-25', check_out: '2026-10-27', rating: 2, rated_at: hours(20), item_open: true },
        { name: 'Emeka N.', room_type: 'Deluxe', room_number: '211', check_in: '2026-10-24', check_out: '2026-10-26', rating: 3, rated_at: hours(70), item_open: false }] };
  };

  let days = 7, loading = 0, shown = false;
  const kpi = (label, value, note) => h('div', {}, h('b', { text: String(value) }), h('span', { text: label }), h('small', { text: note }));

  const render = (r) => {
    const note = $('#rtnote');
    if (r.sample) note.textContent = 'Sample figures for a hotel like yours. Sign in to see your own.';
    else if (!r.tracking_since) note.textContent = 'No ratings yet. Guests on Telegram are asked about 30 minutes after they check out, so this fills in from the next checkout.';
    else if (Date.parse(r.tracking_since) > Date.now() - days * 86400000) note.textContent = `Asking guests since ${dayLabel(r.tracking_since)}: earlier checkouts were not asked, so the days before show nothing.`;
    else note.textContent = '';

    let trend = 'no earlier period to compare';
    if (r.average != null && r.previous_average != null && r.previous_rated) {
      const d = Math.round((r.average - r.previous_average) * 10) / 10;
      trend = d === 0 ? `the same as the ${r.days} days before` : `${d > 0 ? 'up' : 'down'} ${Math.abs(d).toFixed(1)} on the ${r.days} days before`;
    }
    const open = (r.low || []).filter((l) => l.item_open).length;
    $('#rtkpis').replaceChildren(
      kpi('Average rating', r.average != null ? `${Number(r.average).toFixed(1)} / 5` : 'None yet', r.average != null ? trend : 'nobody has rated in this period'),
      kpi('Ratings received', r.rated, r.asked ? `${Math.min(100, pct(r.rated, r.asked))}% of the ${plural(r.asked, 'guest', 'guests')} asked` : 'guests asked: none counted yet'),
      kpi('Low scores (3 or less)', r.low_count, r.low_count ? `${open} still open in the Inbox` : 'none'),
      kpi('Rated 5 out of 5', r.rated ? pct((r.distribution || {})['5'] || 0, r.rated) + '%' : 'None yet', r.rated ? `${(r.distribution || {})['5'] || 0} of ${r.rated}` : ''));

    const d = r.distribution || {}, top = Math.max(1, r.rated || 0);
    $('#rtdist').replaceChildren(...[5, 4, 3, 2, 1].map((k) => h('div', { class: 'frow' }, h('span', { text: `${k} ${k === 1 ? 'star' : 'stars'}` }),
      h('span', { class: 'bar', role: 'img', 'aria-label': `${d[k] || 0} of ${r.rated}` }, h('i', { class: k <= 3 ? 'low' : '', style: `width:${d[k] ? Math.max(2, pct(d[k], top)) : 0}%` })), h('b', { text: String(d[k] || 0) }))));

    const rooms = r.by_room || [];
    $('#rtrooms').replaceChildren(...(rooms.length > 1 ? rooms.map((x) => h('div', { class: 'brow' }, h('div', {}, h('b', { text: x.room_type || 'Room' }), h('small', { text: plural(x.count, 'rating', 'ratings') })), h('b', { text: Number(x.average).toFixed(1) + ' / 5' }))) : []));
    $('#rtroomsec').hidden = rooms.length < 2;

    const low = r.low || [];
    $('#rtlow').replaceChildren(...(low.length ? low.map((l) => {
      const stay = `${l.room_type || 'Room'}${l.room_number ? ' ' + l.room_number : ''}, ${FD.fmtDay(l.check_in)} to ${FD.fmtDay(l.check_out)}`;
      const status = l.item_open
        ? h('a', { class: 'pill warn', href: '/app/inbox.html' + (l.guest_id ? '?c=' + encodeURIComponent(l.guest_id) : ''), text: 'Open: see Inbox' })
        : h('span', { class: 'pill pos', text: 'Settled' });
      return h('div', { class: 'tr cols-r', role: 'row' },
        h('div', { class: 'id' }, h('div', {}, h('b', { text: l.name || 'Guest' }), h('small', { text: stay }))),
        h('div', {}, h('span', { class: 'pill neg', text: `${l.rating} out of 5` })),
        h('div', { text: ago(l.rated_at) }), h('div', {}, status));
    }) : [h('p', { class: 'foot-note', text: r.rated ? 'No low scores in this period.' : 'Nothing to show yet.' })]));
  };

  const load = async () => {
    const mine = ++loading;
    try {
      const r = LIVE ? await (shown ? A.ratings(days) : A.keepTrying(() => A.ratings(days))) : SAMPLE(days);   // the first load waits out network problems
      if (mine !== loading) return;
      shown = true; render(r); $('#rterr').textContent = '';
    } catch (e) { if (mine === loading) $('#rterr').textContent = 'Could not load the figures: ' + (e.message || 'try again.'); }
  };
  document.querySelectorAll('[data-days]').forEach((b) => b.addEventListener('click', () => {
    days = Number(b.dataset.days);
    document.querySelectorAll('[data-days]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    load();
  }));
  await load().finally(releaseBoot);
  let last = Date.now();
  window.addEventListener('alejo:data', () => { if (Date.now() - last > 30000) { last = Date.now(); load(); } });
})();
