/* Alejo dashboard: Earnings. What the hotel took in over a period, what earned it, and who still owes.
   Signed in, every figure comes from the database function earnings_report (sql/029_earnings.sql), which only answers the owner
   (or a manager, once the owner switches that on). Signed out, the public sample dashboard shows made-up figures, labelled as such.
   Charts are drawn here as plain SVG: one hue (the data blue) on the figure the period is about, a scale on every chart, a tooltip
   on every bar and a table of the same numbers. Periods, grouping and sample figures live in earnings-core.js. */
(async () => {
  'use strict';
  if (!document.body || document.body.dataset.page !== 'earnings') return;
  const release = window.AlejoBoot ? window.AlejoBoot.hold() : () => {};   // the outlines stay until the first report is on screen
  if (window.AlejoReady) await window.AlejoReady;
  const A = window.Alejo, FD = window.FD, E = window.EarnCore, LIVE = !!(A && A.live);
  if (LIVE && A.denied) { release(); return; }                        // live.js has already explained that this page is for the owner

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
  const SVG = 'http://www.w3.org/2000/svg';
  const s = (tag, attrs) => { const el = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v); return el; };
  const money = E.money, pct = (x) => (x == null ? '–' : Math.round(x * 100) + '%');
  const today = (FD && FD.NOW && FD.NOW.date) || new Date().toISOString().slice(0, 10);
  const hotelName = () => (LIVE && A.hotel && A.hotel() && A.hotel().name) || 'BrightSide Hotel';

  let preset = 'month', range = E.presetRange('month', today), metric = 'received', report = null, chartRep = null, seq = 0;
  let showTable = false;
  try { const p = sessionStorage.getItem('alejo-earn-period'); if (p && E.PRESETS.includes(p)) { preset = p; range = E.presetRange(p, today); } } catch (e) { /* private mode */ }

  /* ---------- fetching ---------- */
  // the first report waits out network problems (the loading screen stays up); later ones show their error in the page
  const fetchReport = (from, to) => (!LIVE ? Promise.resolve(E.sample(from, to)) : report ? A.earnings(from, to) : A.keepTrying(() => A.earnings(from, to)));
  const load = async () => {
    const my = ++seq, body = $('#erBody');
    body.setAttribute('aria-busy', 'true'); body.classList.add('loading'); $('#erErr').textContent = '';
    try {
      const cr = E.chartRange(range);
      const [r, c] = await Promise.all([fetchReport(range.from, range.to), cr.from === range.from ? null : fetchReport(cr.from, cr.to)]);
      if (my !== seq) return;                                       // a newer period was asked for meanwhile
      report = r; chartRep = c || r;
      render();
    } catch (e) {
      if (my !== seq) return;
      $('#erErr').textContent = /for the owner|42501/.test(e.message) ? 'Earnings are for the owner. Ask the owner if you need to see them.'
        : /earnings_report|Could not find the function/i.test(e.message) ? 'Earnings are not switched on for this hotel yet.' : e.message;
    } finally {
      if (my === seq && (report || $('#erErr').textContent)) { body.removeAttribute('aria-busy'); body.classList.remove('loading'); release(); }
    }
  };

  /* ---------- the period controls ---------- */
  const paintTabs = () => {
    document.querySelectorAll('#erTabs .tab').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.p === preset)));
    const custom = preset === 'custom';
    $('#erCustom').hidden = !custom; $('#erTabs [data-p=custom]').setAttribute('aria-expanded', String(custom));
  };
  $('#erTabs').addEventListener('click', (e) => {
    const b = e.target.closest('.tab'); if (!b) return;
    preset = b.dataset.p; paintTabs();
    if (preset === 'custom') { $('#erFrom').value = range.from; $('#erTo').value = range.to; $('#erFrom').max = $('#erTo').max = today; $('#erFrom').focus(); return; }
    try { sessionStorage.setItem('alejo-earn-period', preset); } catch (x) { /* private mode */ }
    range = E.presetRange(preset, today); load();
  });
  $('#erCustom').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = $('#erFrom').value, t = $('#erTo').value;
    if (!f || !t) return;
    if (t < f) { $('#erErr').textContent = 'Choose a start date on or before the end date.'; return; }
    if (E.span(f, t) > 400) { $('#erErr').textContent = 'Choose a period of 400 days or less.'; return; }
    range = { from: f, to: t }; load();
  });
  $('#erMetric').addEventListener('click', (e) => {
    const b = e.target.closest('.tab'); if (!b || b.dataset.m === metric) return;
    metric = b.dataset.m;
    document.querySelectorAll('#erMetric .tab').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.m === metric)));
    drawChart();
  });
  $('#erTblBtn').addEventListener('click', () => {
    showTable = !showTable;
    $('#erTable').hidden = !showTable; $('#erTblBtn').setAttribute('aria-expanded', String(showTable)); $('#erTblBtn').textContent = showTable ? 'Hide table' : 'Show table';
  });
  $('#erCsv').addEventListener('click', () => {
    if (!report) return;
    const rows = [['Date', 'Money received (NGN)', 'Room sales (NGN)', 'Services booked (NGN)', 'Nights sold']]
      .concat(report.series.map((r) => [r.d, r.received, r.rooms, r.services, r.nights]));
    const csv = rows.map((r) => r.map((v) => (/[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v)).join(',')).join('\r\n');
    const a = h('a', { href: URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })), download: `earnings-${report.from}-to-${report.to}.csv` });
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });

  /* ---------- the summary ---------- */
  const chg = (c) => h('span', { class: 'chg ' + c.tone }, c.tone === 'good' ? '▲ ' : c.tone === 'bad' ? '▼ ' : '', c.text);
  const render = () => {
    const r = report, t = r.totals, p = r.previous, rt = E.rates(t), rp = E.rates(p);
    const one = r.from === r.to;
    const before = one ? (r.previous.from === E.add(today, -1) ? 'yesterday' : E.longDay(p.from)) : `the ${r.days} days before (${E.rangeLabel(p.from, p.to)})`;
    $('#erNote').textContent = r.sample ? 'Sample figures for a hotel like yours. Sign in as the owner to see your own.' : '';
    $('#erSub').textContent = `What ${hotelName()} took in, and what earned it.`;
    $('#erWhen').textContent = E.rangeLabel(r.from, r.to) + (r.to === today ? (one ? ', so far' : ', to date') : '');
    $('#erRec').textContent = money(t.received);
    $('#erCmp').replaceChildren(chg(E.change(t.received, p.received)), ` vs ${money(p.received)} ${one ? 'on' : 'in'} ${before}`);
    $('#erSplit').replaceChildren(
      h('div', {}, h('dt', { text: 'For rooms' }), h('dd', { text: money(r.by_kind.rooms) })),
      h('div', {}, h('dt', { text: 'For services' }), h('dd', { text: money(r.by_kind.services) })),
      ...(t.refunds > 0 ? [h('div', {}, h('dt', { text: 'Refunded' }), h('dd', { text: money(t.refunds) }))] : []));
    const o = r.owed;
    $('#erFind').replaceChildren(...(o.count
      ? [h('b', { text: money(o.total) }), ` is still owed by ${o.count === 1 ? 'one guest' : o.count + ' guests'}. `, h('a', { href: '#erOwed', text: 'See who' })]
      : ['Nobody owes the hotel money right now.']));

    const kpi = (label, value, c, note) => h('div', { class: 'er-kpi' }, h('span', { text: label }), h('b', { text: value }), h('small', {}, c ? chg(c) : null, note));
    $('#erKpis').replaceChildren(
      kpi('Room sales', money(t.rooms_value), E.change(t.rooms_value, p.rooms_value), ` · ${t.nights_sold.toLocaleString('en-NG')} ${t.nights_sold === 1 ? 'night' : 'nights'} sold`),
      kpi('Occupancy', pct(rt.occupancy), rt.occupancy == null ? null : E.change(rt.occupancy, rp.occupancy, 'pts'), ` · ${r.rooms_on_sale} rooms on sale`),
      kpi('Average rate a night', rt.adr == null ? '–' : money(rt.adr), rt.adr == null || rp.adr == null ? null : E.change(rt.adr, rp.adr), rt.adr == null ? 'no nights sold' : ' · ADR'),
      kpi('Earned per room, per night', rt.revpar == null ? '–' : money(rt.revpar), rt.revpar == null ? null : E.change(rt.revpar, rp.revpar), ' · RevPAR'));

    $('#erMethods').replaceChildren(ranked(r.by_method.map((x) => ({ name: E.methodName(x.name), amount: Number(x.amount), note: x.count ? `${x.count} ${x.count === 1 ? 'payment' : 'payments'}` : '' })), t.received, 'No money recorded in this period.'));
    $('#erSources').replaceChildren(ranked(r.by_source.map((x) => ({ name: E.sourceName(x.name), amount: Number(x.amount), note: `${x.nights} ${x.nights === 1 ? 'night' : 'nights'}` })), t.rooms_value, 'No nights sold in this period.'));
    $('#erTypes').replaceChildren(ranked(r.by_room_type.map((x) => ({ name: x.name, amount: Number(x.amount), note: `${x.nights} ${x.nights === 1 ? 'night' : 'nights'}` })), t.rooms_value, 'No nights sold in this period.'));
    $('#erServices').replaceChildren(ranked(r.by_service.map((x) => ({ name: x.name, amount: Number(x.amount), note: `${x.count} ${x.count === 1 ? 'booking' : 'bookings'}` })), t.services_value, 'No services booked in this period.'));
    $('#erSvcTotal').textContent = t.services_value ? money(t.services_value) : '';
    owedList(o);
    drawChart();
  };

  /* A ranked list: each row is its name and amount, with the share drawn as a bar under it (one hue, longest first). */
  const ranked = (rows, total, empty) => {
    const list = rows.filter((x) => x.amount !== 0);
    if (!list.length) return h('p', { class: 'er-empty', text: empty });
    const top = Math.max(...list.map((x) => x.amount), 1);
    return h('ul', { class: 'er-rank' }, list.map((x) => h('li', {},
      h('div', { class: 'er-rank-t' }, h('span', { class: 'n', text: x.name }), h('b', { text: money(x.amount) })),
      h('span', { class: 'er-track', 'aria-hidden': 'true' }, h('i', { style: `width:${Math.max(0, (x.amount / top) * 100).toFixed(1)}%` })),
      h('small', { text: [total > 0 && x.amount > 0 ? Math.round((x.amount / total) * 100) + '% of the total' : '', x.note].filter(Boolean).join(' · ') }))));
  };

  const owedList = (o) => {
    const el = $('#erOwedList');
    if (!o.top.length) { el.replaceChildren(h('p', { class: 'er-empty', text: 'Nobody owes the hotel money right now.' })); return; }
    el.replaceChildren(h('ul', { class: 'er-owed' }, o.top.map((x) => h('li', {},
      h('div', {}, h('b', { text: x.name }), h('small', { text: x.what + ' · ' + (x.kind !== 'stay' ? E.dayLabel(x.until)
        : x.until < today ? 'left ' + E.dayLabel(x.until) : x.until === today ? 'leaves today' : 'leaves ' + E.dayLabel(x.until)) })),
      h('span', { class: 'amt', text: money(x.owed) })))),
      ...(o.count > o.top.length ? [h('p', { class: 'er-hint', text: `And ${o.count - o.top.length} more, ${money(o.total - o.top.reduce((a, x) => a + Number(x.owed), 0))} between them.` })] : []));
  };

  /* ---------- the chart ---------- */
  const tip = h('div', { class: 'er-tip', role: 'presentation', hidden: true });
  $('#erChart').append(tip);
  const drawChart = () => {
    if (!chartRep) return;
    const box = $('#erChart'), cr = E.chartRange(range), grain = E.grainFor(chartRep.from, chartRep.to);
    const buckets = E.bucket(chartRep.series, grain), focus = cr.focus;
    const key = metric === 'received' ? 'received' : 'rooms';
    const word = metric === 'received' ? 'Money received' : 'Room sales';
    $('#h-chart').textContent = `${word}, by ${grain === 'day' ? (metric === 'rooms' ? 'night' : 'day') : grain}`;
    $('#erChartHint').textContent = focus ? `The last 14 days, with ${E.longDay(focus)} marked.` : grain === 'day' ? '' : `Each bar is one ${grain}${buckets.some((b) => b.partial) ? '; a bar cut by the period\'s edge holds only the days inside it' : ''}.`;

    const W = Math.max(280, box.clientWidth), H = W < 520 ? 200 : 240, L = W < 520 ? 44 : 56, R = 8, T = 10, B = 26;
    const pw = W - L - R, ph = H - T - B, n = buckets.length;
    const max = Math.max(0, ...buckets.map((b) => b[key])), ticks = E.niceTicks(max), top = ticks[ticks.length - 1];
    const y = (v) => T + ph - (Math.max(0, v) / top) * ph;
    const band = pw / n, bw = Math.max(2, Math.min(24, band - Math.max(2, band * 0.32)));
    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', class: 'er-svg',
      'aria-label': `${word} per ${grain}, ${E.rangeLabel(chartRep.from, chartRep.to)}. Highest ${money(max)}. The table below the chart lists every value.` });
    for (const v of ticks) {
      svg.append(s('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: v === 0 ? 'base' : 'grid' }));
      const tx = s('text', { x: L - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }); tx.textContent = E.moneyShort(v); svg.append(tx);
    }
    const hover = s('rect', { class: 'hov', x: 0, y: T, width: band, height: ph, visibility: 'hidden' });
    svg.append(hover);
    const step = Math.ceil(n / (W < 520 ? 5 : 8)), focusAt = focus ? buckets.findIndex((b) => b.from === focus) : -1;
    buckets.forEach((b, i) => {
      const cx = L + band * (i + 0.5), x = cx - bw / 2, v = b[key], yt = y(v), hgt = T + ph - yt;
      if (v > 0 && hgt > 0) {
        const r = Math.min(4, bw / 2, hgt);
        svg.append(s('path', { class: 'bar' + (focus && b.from !== focus ? ' ctx' : ''),
          d: `M${x},${T + ph} V${yt + r} Q${x},${yt} ${x + r},${yt} H${x + bw - r} Q${x + bw},${yt} ${x + bw},${yt + r} V${T + ph} Z` }));
      }
      const isFocus = !!focus && b.from === focus;
      // labels on one even step; the marked day is always labelled, and a step label too close to it gives way
      if (isFocus || (i % step === 0 && !(focusAt >= 0 && Math.abs(focusAt - i) < step))) {
        const tx = s('text', { x: cx, y: H - 8, 'text-anchor': 'middle', class: 'tick' + (isFocus ? ' now' : '') });
        tx.textContent = isFocus && focus === today ? 'Today' : b.label; svg.append(tx);
      }
      const hit = s('rect', { x: L + band * i, y: T, width: band, height: ph + B, fill: 'transparent' });
      hit.addEventListener('pointerenter', () => {
        hover.setAttribute('x', L + band * i); hover.setAttribute('visibility', 'visible');
        tip.replaceChildren(h('b', { text: b.title + (b.partial ? (b.to === today ? ', so far' : ` (${b.days} of its days)`) : (b.from === today ? ', so far' : '')) }),
          h('span', {}, `${word}: `, h('strong', { text: money(v) })),
          h('small', { text: key === 'rooms' ? `${b.nights} ${b.nights === 1 ? 'night' : 'nights'} sold` : `Services booked ${money(b.services)}` }));
        tip.hidden = false;
        const tw = tip.offsetWidth, left = Math.min(Math.max(0, cx - tw / 2), W - tw);
        tip.style.left = left + 'px'; tip.style.top = Math.max(0, yt - tip.offsetHeight - 10) + 'px';
      });
      hit.addEventListener('pointerleave', () => { hover.setAttribute('visibility', 'hidden'); tip.hidden = true; });
      svg.append(hit);
    });
    box.querySelector('svg') ? box.querySelector('svg').replaceWith(svg) : box.prepend(svg);
    $('#erLegend').replaceChildren(...(focus ? [h('span', {}, h('i', { class: 'sw' }), E.longDay(focus)), h('span', {}, h('i', { class: 'sw ctx' }), 'The 13 days before')] : []));
    drawTable(buckets, grain);
  };

  /* the same numbers as a table: every bar, with the period's totals at the foot */
  const drawTable = (buckets, grain) => {
    const rooms = chartRep.rooms_on_sale;
    const occ = (b) => (rooms ? Math.round((b.nights / (rooms * b.days)) * 100) + '%' : '–');
    const sum = buckets.reduce((a, b) => ({ received: a.received + b.received, rooms: a.rooms + b.rooms, services: a.services + b.services, nights: a.nights + b.nights, days: a.days + b.days }), { received: 0, rooms: 0, services: 0, nights: 0, days: 0 });
    const head = h('tr', {}, ['When', 'Received', 'Room sales', 'Services', 'Nights sold', 'Occupancy'].map((x, i) => h('th', { scope: 'col', class: i ? 'num' : null, text: x })));
    const row = (label, b, foot) => h('tr', { class: foot ? 'foot' : null }, h(foot ? 'th' : 'td', foot ? { scope: 'row', text: label } : { text: label }),
      h('td', { class: 'num', text: money(b.received) }), h('td', { class: 'num', text: money(b.rooms) }), h('td', { class: 'num', text: money(b.services) }),
      h('td', { class: 'num', text: b.nights.toLocaleString('en-NG') }), h('td', { class: 'num', text: occ(b) }));
    $('#erTable').replaceChildren(h('table', {}, h('caption', { class: 'sr', text: `Earnings by ${grain}` }), h('thead', {}, head),
      h('tbody', {}, buckets.map((b) => row(b.title + (b.partial ? ' (part)' : ''), b))), h('tfoot', {}, row('Total', sum, true))));
  };

  let rz = null;
  new ResizeObserver(() => { clearTimeout(rz); rz = setTimeout(drawChart, 80); }).observe($('#erChart'));

  /* ---------- who can see this page (the owner's switch) ---------- */
  const access = async () => {
    const isOwner = LIVE ? A.can('owner') : true;
    if (!isOwner) return;
    const card = $('#erAccess'), tog = $('#erAccTog');
    card.hidden = false;
    let on = LIVE ? await A.earningsForManagers() : false;
    const paint = () => {
      tog.setAttribute('aria-checked', String(on));
      $('#erAccDesc').textContent = on ? 'On: managers see the same figures as you. Front-desk staff never see them.' : 'Off: only you, the owner, see these figures. Front-desk staff never see them.';
    };
    paint();
    tog.addEventListener('click', async () => {
      const want = !on; tog.disabled = true;
      try {
        if (LIVE) await A.setEarningsForManagers(want);
        on = want; paint(); $('#erAccStatus').textContent = on ? 'Managers can now see Earnings.' : 'Only the owner can see Earnings now.';
      } catch (e) { $('#erAccStatus').textContent = ''; $('#erErr').textContent = /Only the owner/.test(e.message) ? 'Only the owner can change this.' : e.message; }
      finally { tog.disabled = false; }
    });
  };

  paintTabs();
  access();
  load();
})();
