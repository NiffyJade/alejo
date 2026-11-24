/* Alejo staff dashboard: behaviour for the four screens. Sample data in the browser, or the hotel's live data when signed in (see live.js). */
(async () => {
  'use strict';
  if (window.AlejoReady) await window.AlejoReady;               // live.js swaps in the real rows first when someone is signed in
  const FD = window.FD;
  const LIVE = !!(window.Alejo && window.Alejo.live);
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
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
  const initials = (n) => n.split(' ').map((p) => p[0]).slice(0, 2).join('');
  const disc = (name, hue, cls) => h('span', { class: 'disc' + (cls ? ' ' + cls : ''), style: `--h:${hue}`, 'aria-hidden': 'true', text: initials(name) });

  /* ---------- state kept for the session so the screens agree with each other ---------- */
  let S = { resolved: [], facts: {}, added: [], sent: {}, removed: [] };
  if (!LIVE) { try { S = Object.assign(S, JSON.parse(sessionStorage.getItem('fd-demo') || '{}')); } catch (e) { /* private mode: fine */ } }
  const save = () => { if (LIVE) return; try { sessionStorage.setItem('fd-demo', JSON.stringify(S)); } catch (e) { /* ignore */ } };
  const toast = (msg) => { let t = $('#toast'); if (!t) { t = h('p', { id: 'toast', class: 'toast', role: 'alert' }); document.body.append(t); } t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 5000); };
  const statusOf = (c) => (S.resolved.includes(c.id) ? 'done' : c.status);
  const needs = () => FD.conversations.filter((c) => statusOf(c) === 'needs');
  // service recovery: a request, complaint or emergency is tracked until someone settles it, and is late once it has been open past its target
  const SERVICE = (c) => !!c.kind && c.kind !== 'question';
  const TARGET = (c) => (c.kind === 'emergency' ? 10 : 30);               // minutes
  const KIND_WORD = (c) => (c.kind === 'emergency' ? 'Emergency' : (c.category ? c.category[0].toUpperCase() + c.category.slice(1) + ' ' : '') + (c.category ? c.kind : c.kind[0].toUpperCase() + c.kind.slice(1)));
  const KIND_CLS = (c) => (c.kind === 'emergency' ? 'neg' : c.kind === 'complaint' ? 'warn' : '');
  const waitMins = (c) => { if (c.waitMins != null) return c.waitMins; const m = /^(\d+)\s*(min|h|d)/.exec(c.ago || ''); return m ? +m[1] * { min: 1, h: 60, d: 1440 }[m[2]] : 0; };
  const late = (c) => SERVICE(c) && statusOf(c) === 'needs' && waitMins(c) > TARGET(c);
  const urgency = (c) => (statusOf(c) !== 'needs' ? 3 : c.kind === 'emergency' ? 0 : SERVICE(c) ? 1 : 2);
  const chasedWord = (c) => (c.chased ? ', guest has chased ' + c.chased + 'x' : '');
  const ownerWord = (c) => (c.owner ? 'Owner: ' + c.owner : 'Nobody has taken it') + chasedWord(c);
  const meName = () => (LIVE ? (window.Alejo.me && (window.Alejo.me.name || window.Alejo.me.email)) || 'Staff' : 'Amaka O.');
  // "Take it": say who is handling a request, so two people do not both chase it. Taking over from someone else is allowed.
  const takeBtn = (c, st, repaint) => {
    if (st !== 'needs' || !SERVICE(c) || (LIVE && !(c.escIds || []).length)) return null;
    const me = meName(), mine = c.owner === me;
    return h('button', { class: 'btn line small', type: 'button', onclick: async () => {
      try { if (LIVE) { await window.Alejo.take(c.escIds, mine ? null : me); await window.Alejo.refresh(); } else { c.owner = mine ? null : me; repaint(); } } catch (e) { toast(e.message); }
    } }, mine ? 'Release' : c.owner ? 'Take over' : 'Take it');
  };
  const kindPill = (c) => (SERVICE(c) ? h('span', { class: 'pill kind ' + KIND_CLS(c), text: KIND_WORD(c) }) : null);
  const dataHandlers = [];
  const onData = (fn) => dataHandlers.push(fn);                      // live.js announces fresh rows with an "alejo:data" event
  addEventListener('alejo:data', () => dataHandlers.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }));
  addEventListener('alejo:new', (e) => toast(e.detail.text));
  const baseTitle = document.title;

  /* ---------- shell ---------- */
  const page = document.body.dataset.page;
  const params = new URLSearchParams(location.search);
  const remember = (k, v) => { const p = new URLSearchParams(location.search); p.set(k, v); history.replaceState(null, '', '?' + p.toString()); };
  const badge = $('#needCount');
  const paintBadge = () => { const n = needs().length; document.title = (n ? '(' + n + ') ' : '') + baseTitle; if (badge) { badge.textContent = n; badge.hidden = n === 0; } };
  paintBadge();
  onData(paintBadge);
  const menuBtn = $('#menuBtn'), side = $('#side'), scrim = $('#scrim');
  const setMenu = (open) => { side.classList.toggle('open', open); scrim.classList.toggle('show', open); menuBtn.setAttribute('aria-expanded', String(open)); };
  if (menuBtn) {
    menuBtn.addEventListener('click', () => setMenu(!side.classList.contains('open')));
    scrim.addEventListener('click', () => setMenu(false));
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && side.classList.contains('open')) { setMenu(false); menuBtn.focus(); } });
  }
  const topSearch = $('#q');                                       // "/" jumps to search; on screens without a list, Enter searches the inbox
  addEventListener('keydown', (e) => { if (e.key === '/' && topSearch && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) { e.preventDefault(); topSearch.focus(); } });
  if (topSearch && !['inbox', 'bookings', 'facts'].includes(page)) topSearch.addEventListener('keydown', (e) => { if (e.key === 'Enter' && topSearch.value.trim()) location.href = '/app/inbox.html?q=' + encodeURIComponent(topSearch.value.trim()); });

  /* ---------- TODAY ---------- */
  const renderOverview = () => {
    const today = FD.NOW.date, B = FD.bookings;
    const KB = [...(window.FD_KB || []), ...S.added], facts = Object.assign({}, window.FD_FACTS, S.facts);
    const missing = (e) => (e.k || []).filter((k) => !facts[k]);
    const held = KB.filter((e) => missing(e).length), blank = [...new Set(held.flatMap(missing))];
    const rank = (c) => (c.kind === 'emergency' ? 0 : SERVICE(c) ? 1 : 2);
    const waiting = needs().sort((a, b) => rank(a) - rank(b) || waitMins(b) - waitMins(a));
    const arriving = B.filter((b) => b.in === today && b.stage < 4);
    const inHouse = B.filter((b) => b.stage >= 2 && b.stage < 4);
    const leaving = B.filter((b) => b.out === today && b.stage < 4);
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const longest = waiting.length ? [...waiting].sort((a, b) => waitMins(b) - waitMins(a))[0].ago : '';

    // the finding, then the one job
    const bits = [waiting.length ? `${plural(waiting.length, 'guest needs', 'guests need')} a person, the longest for ${longest}.${waiting.some(late) ? ' ' + plural(waiting.filter(late).length, 'item is', 'items are') + ' past the target.' : ''}` : 'Nobody is waiting on you. The AI has it.'];
    if (held.length) bits.push(`${plural(held.length, 'answer is', 'answers are')} held back until ${plural(blank.length, 'fact is', 'facts are')} filled in.`);
    $('#ovSub').textContent = FD.NOW.label + '. ' + bits.join(' ');
    const cta = $('#ovCta');
    if (waiting.length) { cta.textContent = 'Reply to ' + waiting[0].guest.split(' ')[0]; cta.href = '/app/inbox.html?c=' + encodeURIComponent(waiting[0].id); } else { cta.textContent = 'Open inbox'; }

    const kpi = (cls, label, value, note) => h('div', { class: 'kpi' + cls }, h('span', { text: label }), h('b', { text: String(value) }), h('small', { text: note }));
    // how well guests are being looked after: every guest question, and who settled it
    const week = FD.conversations.filter((c) => !c.last || Date.now() - new Date(c.last).getTime() < 7 * 864e5);
    const asked = week.filter((c) => c.msgs.some((m) => m.r === 'guest')), settled = asked.filter((c) => statusOf(c) !== 'needs');
    const withStaff = asked.filter((c) => statusOf(c) === 'done' && (c.resolvedIn || c.msgs.some((m) => m.r === 'staff'))).length, alone = settled.length - withStaff;
    const times = week.map((c) => c.resolvedIn).filter((n) => n > 0).sort((a, b) => a - b), median = times.length ? times[Math.floor(times.length / 2)] : 0;
    const dur = (m) => (m < 60 ? m + ' min' : Math.round(m / 6) / 10 + ' h');
    const rate = asked.length ? Math.round((settled.length / asked.length) * 100) : 100;
    // resolution score: of this week's requests, complaints and emergencies, how many were settled within their target (an open one counts once it is late)
    const svc = week.filter(SERVICE), settledOn = svc.filter((c) => c.resolvedIn > 0 && c.resolvedIn <= TARGET(c)).length, settledLate = svc.filter((c) => c.resolvedIn > 0 && c.resolvedIn > TARGET(c)).length, openLate = svc.filter(late).length;
    const scored = settledOn + settledLate + openLate, score = scored ? Math.round((settledOn / scored) * 100) : null;
    $('#ovKpis').replaceChildren(
      kpi(' lead', 'Need you', waiting.length, waiting.length ? 'longest wait ' + longest : 'nobody is waiting'),
      kpi('', 'Questions settled', rate + '%', asked.length ? `${settled.length} of ${asked.length} this week${median ? ', staff fix in ' + dur(median) : ''}` : 'no questions yet'),
      kpi(' house', 'Alejo handled alone', alone, withStaff ? `${withStaff} more settled with your staff` : 'no staff needed'),
      kpi(score !== null && score < 80 ? ' warn' : '', 'Fixed on time', score === null ? 'n/a' : score + '%', scored ? `${settledOn} of ${scored} requests within target` : 'no requests yet'));

    // what Alejo would do next, from the rows above (plain rules, no guessing)
    const sug = [];
    waiting.filter((c) => c.fact).forEach((c) => sug.push({ t: `Fill in ${c.fact === 'WIFI_PASSWORD' ? 'the Wi-Fi password' : 'a missing fact'}`, d: `${c.guest.split(' ')[0]} is waiting on it, and so will the next guest who asks.`, href: '/app/knowledge.html#' + c.fact, cta: 'Add fact' }));
    if (held.length && !waiting.some((c) => c.fact)) sug.push({ t: `Switch on ${plural(held.length, 'held-back answer', 'held-back answers')}`, d: `Fill in ${plural(blank.length, 'fact', 'facts')} and guests get these answers without waiting for staff.`, href: '/app/knowledge.html?tab=held', cta: 'Open Facts' });
    const soon = B.filter((b) => b.linked === false && b.stage < 2 && FD.day(b.in) - FD.day(today) <= 2 && FD.day(b.in) >= FD.day(today));
    if (soon.length) sug.push({ t: `${plural(soon.length, 'guest arrives', 'guests arrive')} within 2 days without Telegram`, d: `${soon.slice(0, 3).map((b) => b.guest.split(' ')[0]).join(', ')}: their reminder and check-in button cannot reach them. Ask them to share their number with the bot.`, href: '/app/bookings.html?tab=arriving', cta: 'See stays' });
    const loose = waiting.filter((c) => SERVICE(c) && !c.owner);
    if (loose.length) sug.unshift({ t: `${plural(loose.length, 'request has', 'requests have')} no owner`, d: 'Open it and tap Take it, so staff know who is handling it.', href: '/app/inbox.html?c=' + encodeURIComponent(loose[0].id), cta: 'Open' });
    const slow = waiting.filter(late);
    if (slow.length) sug.unshift({ t: `${plural(slow.length, 'request is', 'requests are')} past the ${slow.some((c) => c.kind === 'emergency') ? '10 minute emergency' : '30 minute'} target`, d: slow.slice(0, 2).map((c) => `${c.guest.split(' ')[0]}: ${KIND_WORD(c).toLowerCase()}, ${c.ago}`).join('. ') + '. Alejo keeps re-alerting your staff group while they stay open; a reply or Resolve closes them.', href: '/app/inbox.html?c=' + encodeURIComponent(slow[0].id), cta: 'Open' });
    $('#ovSug').replaceChildren(...(sug.length ? sug.slice(0, 3).map((s) => h('div', { class: 'sug' }, h('div', {}, h('b', { text: s.t }), h('small', { text: s.d })), h('a', { class: 'btn line small', href: s.href }, s.cta))) : [h('p', { class: 'foot-note', text: 'Nothing to suggest. Questions are being settled and every guest can be reached.' })]));

    // who is waiting
    $('#ovNeeds').replaceChildren(...(waiting.length ? waiting.slice(0, 4).map((c) => h('div', { class: 'qrow' },
      disc(c.guest, FD.byGuest[c.guest].hue),
      h('div', {}, h('b', { text: c.guest }), h('small', {}, kindPill(c), c.topic), c.why ? h('small', { class: 'why', text: c.why }) : null, SERVICE(c) ? h('small', { class: 'owner' + (c.owner ? '' : ' none'), text: ownerWord(c) }) : null),
      h('span', { class: 'wait' + (late(c) ? ' late' : ''), text: c.ago + (late(c) ? ', late' : '') }),
      h('a', { class: 'btn line small', href: '/app/inbox.html?c=' + encodeURIComponent(c.id), 'aria-label': 'Reply to ' + c.guest }, 'Reply'))) : [h('p', { class: 'foot-note', text: 'Nobody is waiting on you.' })]));

    // arrivals and departures
    const grp = (label, list, none) => [h('p', { class: 'mgrp', text: `${label} (${list.length})` }),
      ...(list.length ? list.slice(0, 3).map((b) => h('div', { class: 'mrow' }, disc(b.guest, b.hue), h('div', {}, h('b', { text: b.guest }), h('small', { text: `${b.type}, room ${b.room}` })), h('span', { class: 'amt', text: FD.naira(b.total) }))) : [h('p', { class: 'foot-note', text: none })])];
    $('#ovMove').replaceChildren(...grp('Arriving', arriving, 'Nobody arrives today.'), ...grp('Leaving', leaving, 'Nobody leaves today.'));

    // stays, day by day: rooms down the side, days across, each state its own mark
    const vw = innerWidth, N = vw < 600 ? 6 : vw < 1000 ? 8 : 10, first = FD.day(today) - (N === 10 ? 3 : 1), last = first + N - 1;   // fewer days on a phone, so it fits without sideways scrolling
    const compact = vw < 600, shortName = (n) => { const p = n.split(' '); return p.length > 1 ? p[0] + ' ' + p[p.length - 1][0] + '.' : n; };
    const WORD = { in: 'In house', arr: 'Arriving', done: 'Checked out', ph: 'Not on Telegram' };
    const KIND = (b) => (b.stage >= 4 ? 'done' : b.linked === false && b.stage === 0 ? 'ph' : b.stage >= 2 ? 'in' : 'arr');
    const typeOrder = Object.keys(FD.RATES), RANK = { in: 0, arr: 1, ph: 2, done: 3 };
    const rows = B.filter((b) => FD.day(b.out) > first && FD.day(b.in) <= last)
      .sort((a, b) => typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type) || RANK[KIND(a)] - RANK[KIND(b)] || String(a.room).localeCompare(String(b.room), undefined, { numeric: true }));
    const grid = h('div', { class: 'tl-grid', style: `--cols:${N}` });
    const dayInfo = (i) => { const d = new Date((first + i) * 86400000); return { wd: d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }), n: d.getUTCDate(), wk: [0, 6].includes(d.getUTCDay()), today: first + i === FD.day(today) }; };
    const cells = (small) => Array.from({ length: N }, (_, i) => { const d = dayInfo(i); return h('div', { class: 'tl-c' + (d.wk ? ' wk' : '') + (d.today ? ' today' : '') + (small ? ' sm' : ''), style: `grid-column:${i + 2}` }); });
    grid.append(h('div', { class: 'tl-row tl-head' }, h('div'), ...Array.from({ length: N }, (_, i) => { const d = dayInfo(i); return h('div', { class: 'tl-h' + (d.wk ? ' end' : '') + (d.today ? ' today' : ''), style: `grid-column:${i + 2}` }, d.wd, h('b', { text: String(d.n) })); })));
    const used = new Set();
    let type = null;
    rows.forEach((b) => {
      if (b.type !== type) { type = b.type; grid.append(h('div', { class: 'tl-row grp' }, h('div', { class: 'tl-g', text: type }), ...cells(true))); }
      const k = KIND(b); used.add(k);
      const s0 = FD.day(b.in), e0 = FD.day(b.out), c0 = Math.max(s0, first) - first + 2, c1 = Math.min(e0, last + 1) - first + 2;
      const text = k === 'arr' ? (b.stage === 1 ? 'Reminded' : 'Booked') : WORD[k];
      grid.append(h('div', { class: 'tl-row' },
        h('div', { class: 'tl-n' }, h('b', { text: compact ? shortName(b.guest) : b.guest, title: b.guest }), h('small', { text: `${b.type} ${b.room}` })),
        ...cells(false),
        h('div', { class: `tl-b k-${k}${s0 < first ? ' cut-l' : ''}${e0 > last + 1 ? ' cut-r' : ''}`, style: `grid-column:${c0} / ${c1}`, title: `${b.guest}: ${text}, ${FD.fmtDay(b.in)} to ${FD.fmtDay(b.out)}` }, compact && c1 - c0 < 2 ? ({ in: 'In', arr: 'Due', done: 'Out', ph: '' })[k] : text)));
    });
    $('#ovTimeline').replaceChildren(rows.length ? grid : h('p', { class: 'foot-note', text: 'No stays in this window.' }));
    const LEGEND = { in: 'In house', arr: 'Arriving, not yet in', done: 'Checked out and thanked', ph: 'Booked by phone, not on Telegram yet' };
    $('#tlLegend').replaceChildren(...['in', 'arr', 'done', 'ph'].filter((k) => used.has(k)).map((k) => h('span', {}, h('i', { class: 'tl-sw k-' + k }), LEGEND[k])));
  };
  /* ---------- ASK ALEJO: quick answers computed here from the data on screen, free questions go to the copilot (signed in only) ---------- */
  const setupAsk = () => {
    const form = $('#askForm'); if (!form) return;
    const input = $('#askQ'), out = $('#askOut'), go = $('#askGo'), note = $('#askNote');
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const show = (lines, cls) => { out.hidden = false; out.className = 'answer' + (cls ? ' ' + cls : ''); out.replaceChildren(...lines.map((l) => h('p', { class: /:$/.test(l) ? 'a-h' : '', text: l }))); };
    const person = (b) => `${b.guest}, ${b.type} ${b.room}, ${b.linked === false && b.stage === 0 ? 'not on Telegram yet' : FD.STAGE_WORD[b.stage].toLowerCase()}`;
    const itemLine = (c) => `• ${c.guest}, ${SERVICE(c) ? KIND_WORD(c).toLowerCase() : 'question'}, ${c.ago}${late(c) ? ', late' : ''}${SERVICE(c) ? ', ' + (c.owner ? 'owner ' + c.owner : 'nobody has taken it') + chasedWord(c) : ''}`;
    const urgent = () => needs().sort((a, b) => (a.kind === 'emergency' ? 0 : SERVICE(a) ? 1 : 2) - (b.kind === 'emergency' ? 0 : SERVICE(b) ? 1 : 2) || waitMins(b) - waitMins(a));
    const nextDay = () => new Date((FD.day(FD.NOW.date) + 1) * 86400000).toISOString().slice(0, 10);
    const A = {
      arrivals: () => {
        const t = FD.bookings.filter((b) => b.in === FD.NOW.date && b.stage < 4), n = FD.bookings.filter((b) => b.in === nextDay());
        return [`Arriving today (${t.length}):`, ...(t.length ? t.map((b) => '• ' + person(b)) : ['Nobody arrives today.']), `Arriving tomorrow (${n.length}):`, ...(n.length ? n.map((b) => '• ' + person(b)) : ['Nobody arrives tomorrow.'])];
      },
      pending: () => { const l = urgent(); return [`Waiting on staff (${l.length}):`, ...(l.length ? l.map(itemLine) : ['Nothing is waiting. Alejo has it.'])]; },
      handover: () => {
        const l = urgent(), t = FD.bookings.filter((b) => b.in === FD.NOW.date && b.stage < 4), out2 = FD.bookings.filter((b) => b.out === FD.NOW.date && b.stage < 4), inh = FD.bookings.filter((b) => b.stage >= 2 && b.stage < 4);
        const wk = FD.conversations.filter((c) => !c.last || Date.now() - new Date(c.last).getTime() < 7 * 864e5), asked = wk.filter((c) => c.msgs.some((m) => m.r === 'guest')), done = asked.filter((c) => statusOf(c) !== 'needs').length;
        const svc = wk.filter(SERVICE), onTime = svc.filter((c) => c.resolvedIn > 0 && c.resolvedIn <= TARGET(c)).length, scored = onTime + svc.filter((c) => c.resolvedIn > TARGET(c)).length + svc.filter(late).length;
        const ghost = FD.bookings.filter((b) => b.linked === false && b.stage < 2 && FD.day(b.in) - FD.day(FD.NOW.date) <= 2 && FD.day(b.in) >= FD.day(FD.NOW.date));
        return [`Shift handover, ${FD.NOW.label}`,
          `Still open (${l.length}):`, ...(l.length ? l.map(itemLine) : ['Nothing. Every guest question is settled.']),
          'At the desk:', `• In house: ${inh.length}. Arriving today: ${t.length}${t.length ? ' (' + t.map((b) => b.guest).join(', ') + ')' : ''}. Leaving today: ${out2.length}${out2.length ? ' (' + out2.map((b) => b.guest).join(', ') + ')' : ''}.`,
          ...(ghost.length ? [`• ${plural(ghost.length, 'guest arrives', 'guests arrive')} within 2 days without Telegram: ${ghost.map((b) => b.guest).join(', ')}. They get no reminders until they share their number with the bot.`] : []),
          'This week:', `• ${done} of ${asked.length} guest questions settled${scored ? '; ' + onTime + ' of ' + scored + ' requests handled within target' : ''}.`];
      },
    };
    const CHIPS = [['arrivals', 'Who arrives today?'], ['pending', 'What is pending?'], ['handover', 'Shift handover']];
    const run = (key) => show(A[key]());
    $('#askChips').replaceChildren(...CHIPS.map(([k, label]) => h('button', { class: 'achip', type: 'button', onclick: () => { input.value = label; run(k); } }, label)));
    note.textContent = LIVE ? 'Quick answers come from your screen; anything else is answered by the assistant from your live records.' : 'Sample data. Sign in to ask anything in your own words.';
    const route = (q) => { if (q.split(/\s+/).length > 7) return null; const s = q.toLowerCase(); return /handover|hand over|summar|shift|tonight/.test(s) ? 'handover' : /arriv|check.?in|coming today/.test(s) ? 'arrivals' : /pending|open|waiting|late|overdue|owner|outstanding/.test(s) ? 'pending' : null; };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = input.value.trim(); if (!q) { input.focus(); return; }
      const key = route(q);
      if (key) { run(key); return; }
      if (!LIVE) { show(['In the sample, try one of the quick questions above. Signed in, you can ask anything about your guests, arrivals and open items.'], 'wait'); return; }
      go.disabled = true; show(['Looking at your records…'], 'wait');
      try { show(String(await window.Alejo.ask(q)).split('\n').filter(Boolean)); } catch (err) { show([err.message]); } finally { go.disabled = false; }
    });
  };

  if (page === 'overview') {
    setupAsk();
    renderOverview(); onData(renderOverview);
    let lastN = innerWidth < 600 ? 6 : innerWidth < 1000 ? 8 : 10;
    addEventListener('resize', () => { const n = innerWidth < 600 ? 6 : innerWidth < 1000 ? 8 : 10; if (n !== lastN) { lastN = n; renderOverview(); } });
  }

  /* ---------- INBOX ---------- */
  if (page === 'inbox') {
    const mail = $('#mail'), rowsEl = $('#crows'), pane = $('#pane'), det = $('#details'), tabsEl = $('#ctabs'), qEl = $('#cq');
    const gq = $('#q');
    let tab = ['needs', 'all', 'phone'].includes(params.get('tab')) ? params.get('tab') : 'needs', q = (params.get('q') || '').toLowerCase(), sel = (FD.conversations.find((x) => x.id === params.get('c')) || [...needs()].sort((a, b) => urgency(a) - urgency(b) || (urgency(a) < 3 ? waitMins(b) - waitMins(a) : 0))[0] || FD.conversations[0] || {}).id;
    let lastSig = '', lastPing = 0;                                 // lastSig: did the open conversation change? lastPing: throttle for the typing signal
    const drafts = {};                                              // what the staff member has typed, per conversation, so a refresh never eats it
    const sig = (c) => (c ? c.msgs.length + '|' + statusOf(c) + '|' + (c.escId || '') + '|' + c.msgs.map((m) => m.x.length).join(',') : '');
    const lastText = (c) => { const m = [...c.msgs].reverse().find((x) => x.r !== 'note'); return m ? m.x : ''; };
    const tabs = [['needs', 'Needs you'], ['all', 'All'], ['phone', 'Phone']];
    const inTab = (c) => tab === 'all' || (tab === 'needs' && statusOf(c) === 'needs') || (tab === 'phone' && c.ch === 'Phone');
    const count = (t) => FD.conversations.filter((c) => t === 'all' || (t === 'needs' && statusOf(c) === 'needs') || (t === 'phone' && c.ch === 'Phone')).length;

    const paintTabs = () => {
      tabsEl.replaceChildren(...tabs.map(([id, label]) => h('button', { class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(tab === id), onclick: () => { tab = id; remember('tab', id); paint(); } }, label, h('span', { class: 'n', text: String(count(id)) }))));
    };
    const paintList = () => {
      const list = FD.conversations.filter((c) => inTab(c) && (!q || (c.guest + ' ' + c.topic).toLowerCase().includes(q))).sort((a, b) => urgency(a) - urgency(b) || (urgency(a) < 3 ? waitMins(b) - waitMins(a) : 0));
      rowsEl.replaceChildren(...(list.length ? list.map((c) => {
        const st = statusOf(c), b = FD.byGuest[c.guest];
        const mark = st === 'needs' ? (SERVICE(c) ? h('span', { class: 'pill ' + (KIND_CLS(c) || 'neg'), text: KIND_WORD(c) + (late(c) ? ', late' : '') }) : h('span', { class: 'pill neg', text: 'Needs you' })) : st === 'ai' ? h('span', { class: 'pill ai', text: 'AI answered' }) : st === 'waiting' ? h('span', { class: 'pill', text: 'Waiting on guest' }) : h('span', { class: 'pill pos', text: 'Resolved' });
        return h('button', { class: 'crow' + (c.unread && c.id !== sel ? ' unread' : ''), type: 'button', 'aria-current': String(c.id === sel), onclick: () => { sel = c.id; c.unread = false; remember('c', c.id); paint(); mail.classList.add('open'); } },
          disc(c.guest, b.hue),
          h('div', {},
            h('div', { class: 'l1' }, h('span', { class: 'nm', text: c.guest }), h('span', { class: 'tm', text: c.ago })),
            h('div', { class: 'l2' }, h('span', { class: 'sn', text: lastText(c) }), h('span', { class: 'tags' }, c.unread && c.id !== sel ? h('span', { class: 'dot', title: 'Unread' }) : null, h('span', { class: 'ch', text: c.ch }))),
            h('div', { class: 'l2' }, mark)));
      }) : [h('p', { class: 'foot-note', text: tab === 'needs' ? 'Nobody is waiting on you. The AI has it.' : 'No conversations match.' })]));
    };
    const paintPane = () => {
      const c = FD.conversations.find((x) => x.id === sel);
      if (!c) { pane.replaceChildren(h('p', { class: 'foot-note', text: 'No conversations yet. They appear here when guests message your Telegram bot or book by phone.' })); return; }
      const b = FD.byGuest[c.guest], st = statusOf(c);
      const sent = S.sent[c.id] || [];
      const bubbles = [...c.msgs, ...sent].map((m) => {
        if (m.r === 'note') return h('p', { class: 'note', text: m.x });
        const by = m.r === 'ai' ? 'Alejo, AI' : m.r === 'staff' ? (m.by || 'You') : c.guest;
        return h('div', { class: 'bub ' + m.r }, h('span', { class: 'by', text: by }), m.x, h('span', { class: 'tt', text: m.t }));
      });
      const head = h('div', { class: 'pane-head' },
        h('div', { class: 'who' }, h('button', { class: 'btn line small back', type: 'button', onclick: () => mail.classList.remove('open') }, 'Back'), disc(c.guest, b.hue),
          h('div', {}, h('h2', { text: c.guest }), h('p', { class: 'sub', text: `${[c.ch, c.lang].filter(Boolean).join(', ')}. ${c.topic}` }))),
        h('div', { class: 'actions' }, takeBtn(c, st, paint), st === 'done'
          ? (LIVE ? null : h('button', { class: 'btn sec small', type: 'button', onclick: () => { S.resolved = S.resolved.filter((i) => i !== c.id); c.status = c.status === 'done' ? 'waiting' : c.status; save(); paint(); } }, 'Reopen'))
          : (LIVE && !(c.escIds && c.escIds.length) ? null : h('button', { class: 'btn sec small', type: 'button', onclick: async () => {
              try { if (LIVE) await window.Alejo.resolve(c.escIds); S.resolved.push(c.id); save(); paint(); } catch (e) { toast(e.message); }
            } }, 'Resolve'))));
      const need = st === 'needs' ? h('div', { class: 'need' }, h('div', {}, h('b', { text: SERVICE(c) ? KIND_WORD(c) + ', needs you' + (late(c) ? ' (past the ' + TARGET(c) + ' minute target)' : '') : 'Needs you' }), c.why, SERVICE(c) ? h('small', { class: 'owner' + (c.owner ? '' : ' none'), style: 'display:block', text: ownerWord(c) }) : null), c.fact ? h('a', { class: 'btn line small', href: '/app/knowledge.html#' + c.fact }, 'Fill in the fact') : null) : null;
      const ta = h('textarea', { id: 'reply', rows: '3', 'aria-label': 'Reply to ' + c.guest, placeholder: 'Write to ' + c.guest.split(' ')[0] + ' on ' + c.ch + (c.ch === 'Phone' ? ' (sent once they link Telegram)' : '') }); ta.value = st === 'needs' ? (c.suggest || '') : '';
      if (drafts[c.id] !== undefined) ta.value = drafts[c.id];
      ta.addEventListener('input', () => {                          // keep the draft, and show "typing..." to the guest in Telegram while staff write
        drafts[c.id] = ta.value;
        if (LIVE && c.escId && ta.value.trim() && Date.now() - lastPing > 4000) { lastPing = Date.now(); window.Alejo.typing(c.escId).catch(() => {}); }
      });
      const keep = h('input', { type: 'checkbox', id: 'keep' }); const canTeach = !LIVE || window.Alejo.can('manager'); keep.checked = canTeach && st === 'needs' && (!!c.suggest || LIVE);                // live: answers become Facts by default (untick for an answer about one guest only)
      const sendBtn = h('button', { class: 'btn', type: 'button', onclick: async () => {
        const text = ta.value.trim(); if (!text) { ta.focus(); return; }
        if (LIVE) {
          sendBtn.disabled = true; sendBtn.textContent = 'Sending…';
          try { await window.Alejo.reply(c.escId, text, keep.checked && st === 'needs' && !c.fact); }
          catch (e) { toast(e.message); sendBtn.disabled = false; sendBtn.textContent = 'Send reply'; return; }
          drafts[c.id] = undefined;
          await window.Alejo.refresh();                              // the saved reply comes back from the database, so no local copy is needed
          $('#live').textContent = `Reply sent to ${c.guest.split(' ')[0]}. ${needs().length} still need you.`;
          return;
        }
        (S.sent[c.id] = S.sent[c.id] || []).push({ r: 'staff', by: LIVE ? (window.Alejo.me.name || 'You') : 'Amaka O.', t: LIVE ? window.Alejo.clock() : '02:32', x: text });
        if (keep.checked && st === 'needs' && !LIVE) { S.added.push({ id: 'staff-' + c.id, c: 'staff', q: c.topic.replace(/^Asked (about )?/i, '').replace(/^a /, 'A '), a: text, k: [], s: 'staff' }); S.sent[c.id].push({ r: 'note', t: '02:32', x: 'Saved to Facts as an answer for next time.' }); }
        if (st === 'needs') S.resolved.push(c.id);
        drafts[c.id] = undefined; save(); paint(); $('#live').textContent = `Reply sent to ${c.guest.split(' ')[0]}. ${needs().length} still need you.`;
      } }, 'Send reply');
      const composer = h('div', { class: 'composer' }, ta,
        h('div', { class: 'row2' }, st === 'needs' && !c.fact && canTeach ? h('label', { class: 'check', for: 'keep' }, keep, LIVE ? 'Save as an answer for future guests' : 'Save my answer to Facts') : h('span', { class: 'sub', text: '' }), sendBtn));
      if (LIVE && !c.escId) { ta.disabled = true; ta.value = ''; ta.placeholder = c.phone && st === 'needs' ? 'Phone caller: call ' + c.phone + ' back, then press Resolve.' : 'Nothing is waiting for a reply here.'; sendBtn.disabled = true; }
      pane.replaceChildren(head, need, h('div', { class: 'thread', id: 'thread', tabindex: '0', 'aria-label': 'Conversation' }, bubbles), composer);
      const th = $('#thread'); th.scrollTop = th.scrollHeight;
    };
    const STEP_NOTE = (b, i) => (i === b.stage ? b.note : '');
    const paintDetails = () => {
      const c = FD.conversations.find((x) => x.id === sel);
      if (!c) { det.replaceChildren(); return; }
      const b = FD.byGuest[c.guest];
      const kv = [['Guest', c.guest], ['Channel', c.ch], ['Language', c.lang], ['Room', `${b.type} ${b.room}`], ['Stay', `${FD.fmtDay(b.in)} to ${FD.fmtDay(b.out)}, ${b.nights} night${b.nights > 1 ? 's' : ''}`], ['Total', FD.naira(b.total)], ['Reference', b.ref]];
      det.replaceChildren(
        h('section', {}, h('h3', { text: 'Guest' }), h('dl', { class: 'kv' }, kv.filter(([, v]) => v).map(([k, v]) => [h('dt', { text: k }), h('dd', { text: v, title: v })]))),
        h('section', {}, h('h3', { text: 'Stay journey' }), h('ol', { class: 'journey' }, FD.STAGES.map((s, i) => h('li', { class: 'jstep ' + (i < b.stage ? 'done' : i === b.stage ? 'cur' : '') }, h('span', { class: 'jdot' }), h('div', {}, h('b', { text: s }), h('span', { text: i === b.stage ? b.note : i < b.stage ? 'Done' : 'Not yet' })))))));
    };
    const paint = () => { paintBadge(); paintTabs(); paintList(); paintPane(); paintDetails(); $('#needSummary').textContent = needs().length + ' need you'; lastSig = sig(FD.conversations.find((x) => x.id === sel)); };
    qEl.addEventListener('input', () => { q = qEl.value.trim().toLowerCase(); paintList(); });
    if (gq) gq.addEventListener('input', () => { q = gq.value.trim().toLowerCase(); qEl.value = gq.value; paintList(); });
    if (q) { qEl.value = params.get('q'); if (gq) gq.value = params.get('q'); tab = 'all'; }
    paint();
    onData(() => {                                                  // new rows: refresh the list and details; redraw the open chat only if it changed
      if (!FD.conversations.find((x) => x.id === sel)) sel = (needs()[0] || FD.conversations[0] || {}).id;
      paintBadge(); paintTabs(); paintList(); paintDetails(); $('#needSummary').textContent = needs().length + ' need you';
      const s2 = sig(FD.conversations.find((x) => x.id === sel));
      if (s2 !== lastSig) {
        lastSig = s2;
        const ta = $('#reply'), focus = ta && document.activeElement === ta, pos = ta ? ta.selectionStart : 0;
        paintPane();
        const nt = $('#reply');
        if (focus && nt && !nt.disabled) { nt.focus(); nt.setSelectionRange(pos, pos); }
      }
    });
  }

  /* ---------- BOOKINGS ---------- */
  if (page === 'bookings') {
    const tabsEl = $('#btabs'), body = $('#bbody'), qEl = $('#bq'), sortEl = $('#bsort'), meta = $('#bmeta'), gq = $('#q');
    let tab = ['arriving', 'inhouse', 'leaving', 'all'].includes(params.get('tab')) ? params.get('tab') : 'all', q = '';
    let B, today, sets;
    const compute = () => {
      B = FD.bookings; today = FD.NOW.date;
      sets = { arriving: B.filter((b) => b.in === today), inhouse: B.filter((b) => b.stage >= 2 && b.stage < 4), leaving: B.filter((b) => b.out === today && b.stage < 4), all: B };
    };
    compute();
    const labels = [['arriving', 'Arriving today'], ['inhouse', 'In house'], ['leaving', 'Leaving today'], ['all', 'All']];
    const ST = window.AlejoStay;
    const PILL = ['', 'ai', 'pos', 'warn', '', ''];                 // pill colour for each journey stage; the word is always shown too
    let sel = null;                                                 // the stay shown in the panel (its id)
    const payInfo = (b) => { const p = ST.pay(b); return p.state === 'none' ? ['', ''] : p.state === 'paid' ? ['pos', 'Paid in full'] : p.state === 'part' ? ['part', 'Paid ' + FD.naira(p.paid)] : ['neg', 'Unpaid']; };
    const pickTab = (id) => () => { tab = id; remember('tab', id); paintSum(); paint(); };
    const tile = (id, n, label) => h('button', { class: 'tile' + (tab === id ? ' on' : ''), type: 'button', 'aria-pressed': String(tab === id), onclick: pickTab(id) }, h('b', { text: String(n) }), h('span', { text: label }));
    const paintSum = () => $('#bsum').replaceChildren(
      tile('arriving', sets.arriving.length, 'arriving today'), tile('inhouse', sets.inhouse.length, 'in house'), tile('leaving', sets.leaving.length, 'leaving today'),
      h('button', { class: 'tile', type: 'button', onclick: pickTab('arriving') }, h('b', { text: FD.naira(sets.arriving.reduce((s, b) => s + b.total, 0)) }), h('span', { text: 'booked for today\'s arrivals' })));

    const phoneOf = (b) => (b.phone || '').replace(/[^\d+]/g, '');
    const detailEl = $('#bdetail');
    const paintDetail = (b) => {
      if (!b) { detailEl.replaceChildren(h('p', { class: 'foot-note', text: 'No stay selected. Choose a stay in the list to see its details.' })); return; }
      const pay = ST.pay(b), main = ST.primary(b, today), nt = ST.note(b), nights = `${b.nights} night${b.nights === 1 ? '' : 's'}`, tel = phoneOf(b);
      const kv = (k, v) => h('div', {}, h('dt', { text: k }), h('dd', { text: v }));
      const off = LIVE ? false : true;                              // the public sample cannot change a stay
      const act = (cls, label, a, extra) => h('button', Object.assign({ class: 'btn ' + cls, type: 'button', 'data-act': a, 'data-sid': b.id, disabled: off }, extra || {}), label);
      detailEl.replaceChildren(...[
        h('div', { class: 'sd-head' }, disc(b.guest, b.hue, 'big'),
          h('div', {}, h('h2', { text: b.guest }), h('small', { text: b.ref }))),
        h('span', { class: 'pill sd-pill ' + PILL[b.stage], text: FD.STAGE_WORD[b.stage] }),
        h('dl', { class: 'sd-kv' }, kv('Room', `${b.type}, room ${b.room}`), kv('Booked via', b.src), kv('Dates', `${FD.fmtDay(b.in)} to ${FD.fmtDay(b.out)}`), kv('Length', nights),
          kv('Total', FD.naira(b.total)), tel ? h('div', {}, h('dt', { text: 'Phone' }), h('dd', {}, h('a', { href: 'tel:' + tel, text: b.phone }))) : null),
        LIVE && pay.state !== 'none' ? h('div', { class: 'sd-pay ' + pay.state }, h('div', { class: 'sd-pay-t' }, h('b', { text: pay.state === 'paid' ? 'Paid in full' : pay.state === 'unpaid' ? 'Nothing paid yet' : `Paid ${FD.naira(pay.paid)} of ${FD.naira(pay.total)}` }),
          pay.balance > 0 ? h('span', { text: 'Balance ' + FD.naira(pay.balance) }) : null), h('i', { class: 'sd-bar', 'aria-hidden': 'true' }, h('b', { style: 'width:' + pay.pct + '%' }))) : null,
        h('p', { class: 'sd-note ' + nt.tone, text: nt.text }),
        h('div', {}, h('h3', { text: 'Stay journey' }), h('ol', { class: 'sd-steps' }, ST.steps(b).map((s) => h('li', { class: s.state },
          h('span', { class: 'dot', 'aria-hidden': 'true', text: s.state === 'done' ? '✓' : '' }),
          h('span', { class: 'lbl' }, s.label, s.state === 'now' && b.note ? h('small', { text: b.note }) : null),
          h('span', { class: 'tag', text: s.tag })))),
          h('p', { class: 'sd-auto', text: 'Reminders and the thank-you are sent automatically.' })),
        h('div', { class: 'sd-actions' },
          main ? act('', main.label, main.act, { 'data-early': main.early ? '1' : false }) : null,
          b.linked === false ? (tel ? h('a', { class: 'btn line', href: 'tel:' + tel, text: 'Call guest' }) : h('p', { class: 'foot-note', text: 'Not on Telegram yet and no phone number saved.' })) : h('a', { class: 'btn line', href: '/app/inbox.html?c=' + encodeURIComponent(b.guestId), text: 'Message guest on Telegram' }),
          act('line', 'Manage stay: room, payments, cancel', 'manage')),
        off ? h('p', { class: 'foot-note', text: 'Sample data. Sign in to check guests in and out and to manage stays.' }) : null].filter(Boolean));   // an absent part must not print as "null"
    };
    const select = (id, opts) => {
      sel = id;
      let on = null;
      body.querySelectorAll('.tr').forEach((r) => { const is = r.dataset.sid === id; r.classList.toggle('on', is); r.setAttribute('aria-pressed', String(is)); if (is) on = r; });
      paintDetail(B.find((x) => x.id === id));
      if (opts && opts.focus && on) on.focus();
      if (opts && opts.reveal && matchMedia('(max-width: 1279px)').matches) detailEl.scrollIntoView({ block: 'start' });   // the panel sits under the list on narrow screens
    };
    const paint = () => {
      tabsEl.replaceChildren(...labels.map(([id, l]) => h('button', { class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(tab === id), onclick: () => { tab = id; remember('tab', id); paintSum(); paint(); } }, l, h('span', { class: 'n', text: String(sets[id].length) }))));
      let list = sets[tab].filter((b) => !q || (b.guest + ' ' + b.room + ' ' + b.ref).toLowerCase().includes(q));
      const key = sortEl.value;
      const rank = (b) => (b.stage >= 4 ? 3 : b.in === today ? 0 : b.stage >= 2 ? 1 : 2);   // today's arrivals, then in house, then coming up, then done
      list = [...list].sort((a, b) => key === 'name' ? a.guest.localeCompare(b.guest) : key === 'total' ? b.total - a.total : key === 'in' ? a.in.localeCompare(b.in) || a.guest.localeCompare(b.guest) : rank(a) - rank(b) || a.in.localeCompare(b.in));
      meta.innerHTML = '';
      meta.append(h('b', { text: String(list.length) }), ` stay${list.length === 1 ? '' : 's'}, `, h('b', { text: FD.naira(list.reduce((s, b) => s + b.total, 0)) }));
      sel = ST.keepSelection(list.map((b) => b.id), sel);
      body.replaceChildren(...(list.length ? list.map((b) => h('button', { class: 'tr cols-b' + (b.id === sel ? ' on' : ''), type: 'button', 'data-sid': b.id, 'aria-pressed': String(b.id === sel), onclick: () => select(b.id, { reveal: true }) },
        h('div', { class: 'id' }, disc(b.guest, b.hue), h('div', {}, h('b', { text: b.guest }), h('small', { text: b.ref + ' · ' + b.src + (b.linked === false ? ' · no code' : '') }))),
        h('div', {}, `${b.type}`, h('small', { class: 'sub', style: 'display:block;color:var(--muted);font-size:13px', text: 'Room ' + b.room })),
        h('div', {}, `${FD.fmtDay(b.in)} to ${FD.fmtDay(b.out)}`, h('small', { style: 'display:block;color:var(--muted);font-size:13px', text: `${b.nights} night${b.nights > 1 ? 's' : ''}` })),
        h('div', { class: 'jr', title: b.note }, h('span', { class: 'pill ' + PILL[b.stage], text: FD.STAGE_WORD[b.stage] }), h('span', { class: 'bars', 'aria-hidden': 'true' }, FD.STAGES.map((s, i) => h('i', { class: i < b.stage ? 'done' : i === b.stage ? 'cur' : '' })))),
        h('div', { class: 'num' }, FD.naira(b.total), LIVE && payInfo(b)[1] ? h('small', { class: 'paid ' + payInfo(b)[0], text: payInfo(b)[1] }) : null))) : [h('p', { class: 'foot-note', text: 'No stays match. Try another tab or clear the search.' })]));
      paintDetail(list.find((b) => b.id === sel));
    };
    body.addEventListener('keydown', (e) => {                      // arrow keys move through the list
      const d = { ArrowDown: 1, ArrowUp: -1 }[e.key];
      if (!d || !e.target.matches('.tr')) return;
      e.preventDefault();
      const next = ST.neighbour([...body.querySelectorAll('.tr')].map((r) => r.dataset.sid), e.target.dataset.sid, d);
      if (next) select(next, { focus: true });
    });
    qEl.addEventListener('input', () => { q = qEl.value.trim().toLowerCase(); paint(); });
    if (gq) gq.addEventListener('input', () => { q = gq.value.trim().toLowerCase(); qEl.value = gq.value; paint(); });
    sortEl.addEventListener('change', paint);
    $('#bexport').addEventListener('click', () => {
      const rows = [['Guest', 'Reference', 'Room', 'Check-in', 'Check-out', 'Nights', 'Source', 'Stage', 'Total (NGN)'].concat(LIVE ? ['Paid (NGN)'] : []), ...sets[tab].map((b) => [b.guest, b.ref, b.type + ' ' + b.room, b.in, b.out, b.nights, b.src, FD.STAGE_WORD[b.stage], b.total].concat(LIVE ? [b.paid || 0] : []))];
      const csv = rows.map((r) => r.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
      const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'stays-' + tab + '.csv' }); document.body.append(a); a.click(); a.remove();
    });
    // Desk check: the guest says their stay code, the desk types it, and sees whose stay it is (and whether it is a valid, in-house stay).
    const vform = $('#vform');
    if (vform) {
      const vin = $('#vcode'), vout = $('#vresult');
      const hit = (cls, label, title, detail) => h('div', { class: 'vhit' }, h('span', { class: 'pill ' + cls, text: label }), h('div', {}, h('b', { text: title }), h('small', { text: detail })));
      vin.addEventListener('input', () => vout.replaceChildren());
      vform.addEventListener('submit', (e) => {
        e.preventDefault();
        const code = vin.value.replace(/\D/g, '');
        if (code.length !== 6) { vout.replaceChildren(h('p', { class: 'vmsg', text: 'Type all 6 digits of the stay code.' })); return; }
        const hits = FD.bookings.filter((b) => b.code && b.code === code);
        if (!hits.length) { vout.replaceChildren(hit('neg', 'No match', 'No stay has this code', 'Do not treat this person as a verified guest. Check their ID and booking reference.')); return; }
        const cards = hits.map((b) => {
          const stay = `${b.type} ${b.room}, ${FD.fmtDay(b.in)} to ${FD.fmtDay(b.out)}, reference ${b.ref}`;
          if (b.stage >= 4) return hit('neg', 'Stay ended', b.guest, `This stay is over (checked out), so the code is no longer valid. ${stay}.`);
          if (b.stage >= 2) return hit('pos', 'Verified', b.guest, `In house. ${stay}.`);
          return hit('warn', 'Not checked in', b.guest, `This booking has not checked in, so the guest should not have a code yet. Check their ID. ${stay}.`);
        });
        if (hits.length > 1) cards.push(h('p', { class: 'vmsg', text: 'More than one stay has this code. Confirm the guest\'s name.' }));
        vout.replaceChildren(...cards);
      });
    }

    paintSum();
    paint();
    onData(() => { compute(); paintSum(); paint(); });
  }

  /* ---------- FACTS ---------- */
  if (page === 'facts') {
    let KB;
    const facts = {};
    const LABEL = { WIFI_NAME: 'Wi-Fi network name', WIFI_PASSWORD: 'Wi-Fi password', HOTEL_ADDRESS: 'Hotel address', HOTEL_PHONE: 'Hotel phone', FRONT_DESK_EXT: 'Front desk extension', SECURITY_CONTACT: 'Security contact', NEAREST_HOSPITAL: 'Nearest hospital', ACCOUNT_DETAILS: 'Bank account for transfers', REVIEW_LINK: 'Review link' };
    const buildKB = () => [...window.FD_KB, ...(LIVE ? [] : S.added)].filter((e) => LIVE || !S.removed.includes(e.id));
    const buildFacts = () => Object.assign({}, window.FD_FACTS, LIVE ? {} : S.facts);
    const humanize = (k) => LABEL[k] || k.toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()).replace(/\batm\b/i, 'ATM').replace(/\bwifi\b/i, 'Wi-Fi').replace(/\bpos\b/i, 'POS');

    // delete one fact (answer): the first click asks, the second one does it
    const delBtn = (e) => {
      const box = h('div', { class: 'act' });
      const idle = () => box.replaceChildren(h('button', { class: 'btn line small', type: 'button', 'aria-label': 'Delete: ' + e.q, onclick: ask }, 'Delete'));
      const go = async () => {
        box.replaceChildren(h('span', { class: 'sub', text: 'Deleting…' }));
        try {
          if (LIVE) { await window.Alejo.deleteAnswer(e.id); await window.Alejo.refresh(); }
          else { S.removed.push(e.id); S.added = S.added.filter((x) => x.id !== e.id); KB = buildKB(); save(); paint(); }
          live.textContent = 'Fact deleted.';
        } catch (err) { toast(err.message); idle(); }
      };
      const ask = () => box.replaceChildren(h('span', { class: 'sub', text: 'Delete?' }),
        h('button', { class: 'btn small danger', type: 'button', 'aria-label': 'Yes, delete: ' + e.q, onclick: go }, 'Yes'), h('button', { class: 'btn line small', type: 'button', onclick: idle }, 'No'));
      idle();
      return box;
    };

    // hotel details: the values guests are told. Change one, or clear it (answers that need it are then held back)
    const setFact = async (k, v) => {
      if (LIVE) { await window.Alejo.saveFact(k, v); await window.Alejo.refresh(); }
      else { S.facts[k] = v; facts[k] = v; save(); paint(); }
    };
    const paintDetails = () => {
      const keys = Object.keys(facts).filter((k) => facts[k]).sort((a, b) => humanize(a).localeCompare(humanize(b)));
      $('#hdcount').textContent = String(keys.length);
      $('#dlist').replaceChildren(...(keys.length ? keys.map((k) => {
        const row = h('div', { class: 'drow', role: 'row' });
        const idle = () => {
          row.replaceChildren(h('b', { text: humanize(k) }), h('span', { class: 'v', text: facts[k], title: facts[k] }),
            h('div', { class: 'act' },
              h('button', { class: 'btn line small', type: 'button', 'aria-label': 'Edit ' + humanize(k), onclick: edit }, 'Edit'),
              h('button', { class: 'btn line small', type: 'button', 'aria-label': 'Clear ' + humanize(k), onclick: confirmClear }, 'Clear')));
        };
        const edit = () => {
          const input = h('input', { type: 'text', autocomplete: 'off', 'aria-label': humanize(k), value: facts[k] }); input.value = facts[k];
          const save1 = async () => { const v = input.value.trim(); if (!v) { input.focus(); return; } row.replaceChildren(h('b', { text: humanize(k) }), h('span', { class: 'v', text: 'Saving…' })); try { await setFact(k, v); live.textContent = humanize(k) + ' saved.'; if (!LIVE) idle(); } catch (err) { toast(err.message); idle(); } };
          input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); save1(); } if (ev.key === 'Escape') idle(); });
          row.replaceChildren(h('b', { text: humanize(k) }), input, h('div', { class: 'act' }, h('button', { class: 'btn small', type: 'button', onclick: save1 }, 'Save'), h('button', { class: 'btn line small', type: 'button', onclick: idle }, 'Cancel')));
          input.focus();
        };
        const confirmClear = () => {
          const n = KB.filter((e) => e.k.includes(k)).length;
          row.replaceChildren(h('b', { text: humanize(k) }), h('span', { class: 'v', text: n ? `Clear it? ${n} answer${n === 1 ? ' is' : 's are'} held back until it is filled in again.` : 'Clear it?' }),
            h('div', { class: 'act' },
              h('button', { class: 'btn small danger', type: 'button', onclick: async () => { row.replaceChildren(h('b', { text: humanize(k) }), h('span', { class: 'v', text: 'Clearing…' })); try { await setFact(k, ''); live.textContent = humanize(k) + ' cleared.'; } catch (err) { toast(err.message); idle(); } } }, 'Yes, clear'),
              h('button', { class: 'btn line small', type: 'button', onclick: idle }, 'No')));
        };
        idle();
        return row;
      }) : [h('p', { class: 'foot-note', text: 'No hotel details are filled in yet. Fill in a fact above and it appears here.' })]));
    };
    KB = buildKB(); Object.assign(facts, buildFacts());
    const missingKeys = (e) => e.k.filter((k) => !facts[k]);
    const heldOf = (e) => missingKeys(e).length > 0;
    const tabsEl = $('#ktabs'), body = $('#kbody'), qEl = $('#kq'), meta = $('#kmeta'), panel = $('#missing'), sub = $('#ksub'), live = $('#klive'), gq = $('#q');
    let tab = ['all', 'held', 'staff'].includes(params.get('tab')) ? params.get('tab') : 'all', q = '';
    const text = (e) => e.a.replace(/\[\[(\w+)\]\]/g, (_, k) => facts[k] || '…');
    const paintMissing = () => {
      const blank = Object.keys(LABEL).filter((k) => !facts[k]);
      panel.hidden = blank.length === 0;
      $('#mcount').textContent = String(blank.length);
      $('#mgrid').replaceChildren(...blank.map((k) => {
        const n = KB.filter((e) => e.k.includes(k)).length;
        const input = h('input', { id: k, type: 'text', autocomplete: 'off', 'aria-describedby': k + '-h', placeholder: LABEL[k] });
        const ok = async () => { const v = input.value.trim(); if (!v) { input.focus(); return; } if (LIVE) { try { await window.Alejo.saveFact(k, v); } catch (e) { toast(e.message); return; } } const was = KB.filter(heldOf).length; facts[k] = v; if (!LIVE) { S.facts[k] = v; save(); } const on = was - KB.filter(heldOf).length; live.textContent = on ? `${LABEL[k]} saved. ${on} answer${on === 1 ? '' : 's'} switched on.` : `${LABEL[k]} saved. Answers that also need another fact stay held back until that is filled in.`; paint(); };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
        return h('div', {}, h('label', { for: k, text: LABEL[k] }), h('div', { class: 'ff' }, input, h('button', { class: 'btn small', type: 'button', onclick: ok }, 'Save')), h('p', { class: 'hint', id: k + '-h', text: `Used by ${n} answer${n === 1 ? '' : 's'}.` }));
      }));
    };
    const paint = () => {
      const held = KB.filter(heldOf), staff = KB.filter((e) => e.s === 'staff');
      sub.textContent = `${KB.length} answers. ${held.length ? held.length + ' held back until you fill in a fact.' : 'Every answer is switched on.'}`;
      const set = { all: KB, held, staff };
      tabsEl.replaceChildren(...[['all', 'All'], ['held', 'Held back'], ['staff', 'From your staff']].map(([id, l]) => h('button', { class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(tab === id), onclick: () => { tab = id; remember('tab', id); paint(); } }, l, h('span', { class: 'n', text: String(set[id].length) }))));
      const list = set[tab].filter((e) => !q || (e.q + ' ' + e.c).toLowerCase().includes(q));
      meta.textContent = `${list.length} answer${list.length === 1 ? '' : 's'}`;
      body.replaceChildren(...list.slice(0, 80).map((e) => {
        const miss = missingKeys(e);
        return h('div', { class: 'tr cols-k' + (miss.length ? ' held' : ''), role: 'row' },
          h('div', {}, h('b', { style: 'display:block;font-weight:600', text: e.q }), h('small', { class: 'ans', style: 'display:block', text: miss.length ? 'Not shown to guests until filled in' : text(e) })),
          h('div', { text: e.c.charAt(0).toUpperCase() + e.c.slice(1) }),
          h('div', { text: e.s === 'staff' ? 'Your staff' : 'Starter' }),
          miss.length ? h('div', { class: 'st' }, 'Held back: ', miss.map((k) => LABEL[k].toLowerCase()).join(', ')) : h('div', { class: 'st', text: 'Answered' }), delBtn(e));
      }));
      paintMissing();
      paintDetails();
    };
    qEl.addEventListener('input', () => { q = qEl.value.trim().toLowerCase(); paint(); });
    if (gq) gq.addEventListener('input', () => { q = gq.value.trim().toLowerCase(); qEl.value = gq.value; paint(); });
    $('#kadd').addEventListener('click', () => { const f = $('#addform'); f.hidden = !f.hidden; if (!f.hidden) $('#aq').focus(); });
    $('#addform').addEventListener('submit', async (e) => {
      e.preventDefault();
      const qv = $('#aq').value.trim(), av = $('#aa').value.trim(); if (!qv || !av) return;
      if (LIVE) {                                                  // saved in the database; the fresh list comes back by refresh, so no local copy
        try { await window.Alejo.addAnswer(qv, av); await window.Alejo.refresh(); } catch (err) { toast(err.message); return; }
        $('#aq').value = ''; $('#aa').value = ''; $('#addform').hidden = true; tab = 'staff'; live.textContent = 'Fact added.'; paint();
        return;
      }
      const entry = { id: 'staff-new-' + KB.length, c: 'staff', q: qv, a: av, k: [], s: 'staff' };
      KB.push(entry); S.added.push(entry); save(); $('#aq').value = ''; $('#aa').value = ''; $('#addform').hidden = true; tab = 'staff'; live.textContent = 'Fact added.'; paint();
    });
    const reload = () => {                                          // new rows: rebuild, but never while someone is typing in a field here
      if ($('#mgrid').contains(document.activeElement) || $('#addform').contains(document.activeElement) || $('#dlist input, .danger')) { setTimeout(reload, 2000); return; }
      KB = buildKB();
      Object.keys(facts).forEach((k) => delete facts[k]);
      Object.assign(facts, buildFacts());
      paint();
    };
    onData(reload);
    paint();
    if (location.hash.length > 1) { const el = document.getElementById(decodeURIComponent(location.hash.slice(1))); if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); } }
  }

  /* ---------- SETTINGS ---------- */
  if (page === 'settings') {
    if (LIVE) $('.title-row').after(h('p', { class: 'foot-note', text: 'Preview: staff, channels and usage on this page are not connected to your hotel yet. Facts, the inbox and the daily summary are live.' }));
    $$('.tog:not([data-live])').forEach((t) => t.addEventListener('click', () => t.setAttribute('aria-checked', String(t.getAttribute('aria-checked') !== 'true'))));
    // the daily summary is real: its switch and hour are the settings DAILY_DIGEST and DAILY_DIGEST_HOUR that the scheduler reads
    const dgT = $('#dgtoggle'), dgH = $('#dghour');
    if (dgT && dgH) {
      const fact = (k) => (window.FD_FACTS || {})[k];
      const dgOn = () => String(fact('DAILY_DIGEST') || 'yes').toLowerCase() !== 'no';
      const dgPaint = () => {
        dgT.setAttribute('aria-checked', String(dgOn())); dgT.disabled = !LIVE; dgH.disabled = !LIVE;
        dgH.value = String(parseInt(fact('DAILY_DIGEST_HOUR'), 10) || 8);
        $('#dgstate').textContent = LIVE ? (dgOn() ? 'On' : 'Off') : 'On (sample)';
      };
      const dgSave = async (key, value, said) => {
        try { await window.Alejo.saveFact(key, value); await window.Alejo.refresh(); $('#dgstatus').textContent = said; }
        catch (e) { $('#dgstatus').textContent = e.message || 'Could not save that.'; }
        dgPaint();
      };
      dgT.addEventListener('click', () => { if (!LIVE) return; dgT.disabled = true; dgSave('DAILY_DIGEST', dgOn() ? 'no' : 'yes', dgOn() ? 'The daily summary is off.' : 'The daily summary is on.'); });
      dgH.addEventListener('change', () => { if (!LIVE) return; dgSave('DAILY_DIGEST_HOUR', dgH.value, 'The daily summary will be sent at ' + dgH.options[dgH.selectedIndex].text + '.'); });
      dgPaint();
    }
    const used = 212, included = 400, extra = Math.max(0, used - included), rate = 80, base = 150000;
    $('#u-used').textContent = String(used); $('#u-left').textContent = String(Math.max(0, included - used));
    $('#u-bill').textContent = FD.naira(base + extra * rate);
    $$('[data-save]').forEach((b) => b.addEventListener('click', () => { const old = b.textContent; b.textContent = 'Saved'; b.disabled = true; setTimeout(() => { b.textContent = old; b.disabled = false; }, 1400); }));
  }
})();
