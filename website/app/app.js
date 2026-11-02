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
    const mins = (a) => { const m = /^(\d+)\s*(min|h|d)/.exec(a || ''); return m ? +m[1] * { min: 1, h: 60, d: 1440 }[m[2]] : 0; };
    const waiting = needs().sort((a, b) => mins(b.ago) - mins(a.ago));
    const arriving = B.filter((b) => b.in === today && b.stage < 4);
    const inHouse = B.filter((b) => b.stage >= 2 && b.stage < 4);
    const leaving = B.filter((b) => b.out === today && b.stage < 4);
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const longest = waiting.length ? waiting[0].ago : '';

    // the finding, then the one job
    const bits = [waiting.length ? `${plural(waiting.length, 'guest needs', 'guests need')} a person, the longest for ${longest}.` : 'Nobody is waiting on you. The AI has it.'];
    if (held.length) bits.push(`${plural(held.length, 'answer is', 'answers are')} held back until ${plural(blank.length, 'fact is', 'facts are')} filled in.`);
    $('#ovSub').textContent = FD.NOW.label + '. ' + bits.join(' ');
    const cta = $('#ovCta');
    if (waiting.length) { cta.textContent = 'Reply to ' + waiting[0].guest.split(' ')[0]; cta.href = '/app/inbox.html?c=' + encodeURIComponent(waiting[0].id); } else { cta.textContent = 'Open inbox'; }

    const kpi = (cls, label, value, note) => h('div', { class: 'kpi' + cls }, h('span', { text: label }), h('b', { text: String(value) }), h('small', { text: note }));
    const byTg = inHouse.filter((b) => b.src === 'Telegram').length;
    $('#ovKpis').replaceChildren(
      kpi(' lead', 'Need you', waiting.length, waiting.length ? 'longest wait ' + longest : 'nobody is waiting'),
      kpi('', 'Arriving today', arriving.length, FD.naira(arriving.reduce((t, b) => t + b.total, 0)) + ' booked'),
      kpi(' house', 'In house', inHouse.length, `${byTg} on Telegram, ${inHouse.length - byTg} by phone`),
      kpi('', 'Leaving today', leaving.length, `${leaving.filter((b) => b.stage === 3).length} checkout reminders sent`));

    // who is waiting
    $('#ovNeeds').replaceChildren(...(waiting.length ? waiting.slice(0, 4).map((c) => h('div', { class: 'qrow' },
      disc(c.guest, FD.byGuest[c.guest].hue),
      h('div', {}, h('b', { text: c.guest }), h('small', { text: c.topic }), c.why ? h('small', { class: 'why', text: c.why }) : null),
      h('span', { class: 'wait', text: c.ago }),
      h('a', { class: 'btn line small', href: '/app/inbox.html?c=' + encodeURIComponent(c.id), 'aria-label': 'Reply to ' + c.guest }, 'Reply'))) : [h('p', { class: 'foot-note', text: 'Nobody is waiting on you.' })]));

    // arrivals and departures
    const grp = (label, list, none) => [h('p', { class: 'mgrp', text: `${label} (${list.length})` }),
      ...(list.length ? list.slice(0, 3).map((b) => h('div', { class: 'mrow' }, disc(b.guest, b.hue), h('div', {}, h('b', { text: b.guest }), h('small', { text: `${b.type}, room ${b.room}` })), h('span', { class: 'amt', text: FD.naira(b.total) }))) : [h('p', { class: 'foot-note', text: none })])];
    $('#ovMove').replaceChildren(...grp('Arriving', arriving, 'Nobody arrives today.'), ...grp('Leaving', leaving, 'Nobody leaves today.'));

    // stays, day by day: rooms down the side, days across, each state its own mark
    const vw = innerWidth, N = vw < 600 ? 6 : vw < 1000 ? 8 : 10, first = FD.day(today) - (N === 10 ? 3 : 1), last = first + N - 1;   // fewer days on a phone, so it fits without sideways scrolling
    const compact = vw < 600, shortName = (n) => { const p = n.split(' '); return p.length > 1 ? p[0] + ' ' + p[p.length - 1][0] + '.' : n; };
    const WORD = { in: 'In house', arr: 'Arriving', done: 'Thanked', ph: 'Not on Telegram' };
    const KIND = (b) => (b.stage === 4 ? 'done' : b.linked === false && b.stage === 0 ? 'ph' : b.stage >= 2 ? 'in' : 'arr');
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
  if (page === 'overview') {
    renderOverview(); onData(renderOverview);
    let lastN = innerWidth < 600 ? 6 : innerWidth < 1000 ? 8 : 10;
    addEventListener('resize', () => { const n = innerWidth < 600 ? 6 : innerWidth < 1000 ? 8 : 10; if (n !== lastN) { lastN = n; renderOverview(); } });
  }

  /* ---------- INBOX ---------- */
  if (page === 'inbox') {
    const mail = $('#mail'), rowsEl = $('#crows'), pane = $('#pane'), det = $('#details'), tabsEl = $('#ctabs'), qEl = $('#cq');
    const gq = $('#q');
    let tab = ['needs', 'all', 'phone'].includes(params.get('tab')) ? params.get('tab') : 'needs', q = (params.get('q') || '').toLowerCase(), sel = (FD.conversations.find((x) => x.id === params.get('c')) || needs()[0] || FD.conversations[0] || {}).id;
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
      const list = FD.conversations.filter((c) => inTab(c) && (!q || (c.guest + ' ' + c.topic).toLowerCase().includes(q)));
      rowsEl.replaceChildren(...(list.length ? list.map((c) => {
        const st = statusOf(c), b = FD.byGuest[c.guest];
        const mark = st === 'needs' ? h('span', { class: 'pill neg', text: 'Needs you' }) : st === 'ai' ? h('span', { class: 'pill ai', text: 'AI answered' }) : st === 'waiting' ? h('span', { class: 'pill', text: 'Waiting on guest' }) : h('span', { class: 'pill pos', text: 'Resolved' });
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
        h('div', { class: 'actions' }, st === 'done'
          ? (LIVE ? null : h('button', { class: 'btn sec small', type: 'button', onclick: () => { S.resolved = S.resolved.filter((i) => i !== c.id); c.status = c.status === 'done' ? 'waiting' : c.status; save(); paint(); } }, 'Reopen'))
          : (LIVE && !(c.escIds && c.escIds.length) ? null : h('button', { class: 'btn sec small', type: 'button', onclick: async () => {
              try { if (LIVE) await window.Alejo.resolve(c.escIds); S.resolved.push(c.id); save(); paint(); } catch (e) { toast(e.message); }
            } }, 'Resolve'))));
      const need = st === 'needs' ? h('div', { class: 'need' }, h('div', {}, h('b', { text: 'Needs you' }), c.why), c.fact ? h('a', { class: 'btn line small', href: '/app/knowledge.html#' + c.fact }, 'Fill in the fact') : null) : null;
      const ta = h('textarea', { id: 'reply', rows: '3', 'aria-label': 'Reply to ' + c.guest, placeholder: 'Write to ' + c.guest.split(' ')[0] + ' on ' + c.ch + (c.ch === 'Phone' ? ' (sent once they link Telegram)' : '') }); ta.value = st === 'needs' ? (c.suggest || '') : '';
      if (drafts[c.id] !== undefined) ta.value = drafts[c.id];
      ta.addEventListener('input', () => {                          // keep the draft, and show "typing..." to the guest in Telegram while staff write
        drafts[c.id] = ta.value;
        if (LIVE && c.escId && ta.value.trim() && Date.now() - lastPing > 4000) { lastPing = Date.now(); window.Alejo.typing(c.escId).catch(() => {}); }
      });
      const keep = h('input', { type: 'checkbox', id: 'keep' }); keep.checked = st === 'needs' && (!!c.suggest || LIVE);                // live: answers become Facts by default (untick for an answer about one guest only)
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
        h('div', { class: 'row2' }, st === 'needs' && !c.fact ? h('label', { class: 'check', for: 'keep' }, keep, LIVE ? 'Save as an answer for future guests' : 'Save my answer to Facts') : h('span', { class: 'sub', text: '' }), sendBtn));
      if (LIVE && !c.escId) { ta.disabled = true; ta.value = ''; ta.placeholder = 'Nothing is waiting for a reply here.'; sendBtn.disabled = true; }
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
    const paintSum = () => $('#bsum').replaceChildren(
      ...[[sets.arriving.length, 'arriving today'], [sets.inhouse.length, 'in house'], [sets.leaving.length, 'leaving today'], [FD.naira(sets.arriving.reduce((s, b) => s + b.total, 0)), 'booked for today\'s arrivals']]
        .map(([n, t]) => h('div', {}, h('b', { text: String(n) }), h('span', { text: t }))));
    const paint = () => {
      tabsEl.replaceChildren(...labels.map(([id, l]) => h('button', { class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(tab === id), onclick: () => { tab = id; remember('tab', id); paint(); } }, l, h('span', { class: 'n', text: String(sets[id].length) }))));
      let list = sets[tab].filter((b) => !q || (b.guest + ' ' + b.room + ' ' + b.ref).toLowerCase().includes(q));
      const key = sortEl.value;
      const rank = (b) => (b.stage === 4 ? 3 : b.in === today ? 0 : b.stage >= 2 ? 1 : 2);   // today's arrivals, then in house, then coming up, then done
      list = [...list].sort((a, b) => key === 'name' ? a.guest.localeCompare(b.guest) : key === 'total' ? b.total - a.total : key === 'in' ? a.in.localeCompare(b.in) || a.guest.localeCompare(b.guest) : rank(a) - rank(b) || a.in.localeCompare(b.in));
      meta.textContent = `${list.length} stay${list.length === 1 ? '' : 's'}, ${FD.naira(list.reduce((s, b) => s + b.total, 0))}`;
      body.replaceChildren(...(list.length ? list.map((b) => h('div', { class: 'tr cols-b', role: 'row' },
        h('div', { class: 'id' }, disc(b.guest, b.hue), h('div', {}, h('b', { text: b.guest }), h('small', { text: b.ref + (b.linked === false ? ', not on Telegram yet' : '') }))),
        h('div', {}, `${b.type}`, h('small', { class: 'sub', style: 'display:block;color:var(--muted);font-size:13px', text: 'Room ' + b.room })),
        h('div', {}, `${FD.fmtDay(b.in)} to ${FD.fmtDay(b.out)}`, h('small', { style: 'display:block;color:var(--muted);font-size:13px', text: `${b.nights} night${b.nights > 1 ? 's' : ''}` })),
        h('div', { class: 'jr', title: b.note }, h('span', { class: 'bars', 'aria-hidden': 'true' }, FD.STAGES.map((s, i) => h('i', { class: i < b.stage ? 'done' : i === b.stage ? 'cur' : '' }))), h('span', { text: FD.STAGE_WORD[b.stage] })),
        h('div', { text: b.src }),
        h('div', { class: 'num', text: FD.naira(b.total) }))) : [h('p', { class: 'foot-note', text: 'No stays match.' })]));
    };
    qEl.addEventListener('input', () => { q = qEl.value.trim().toLowerCase(); paint(); });
    if (gq) gq.addEventListener('input', () => { q = gq.value.trim().toLowerCase(); qEl.value = gq.value; paint(); });
    sortEl.addEventListener('change', paint);
    $('#bexport').addEventListener('click', () => {
      const rows = [['Guest', 'Reference', 'Room', 'Check-in', 'Check-out', 'Nights', 'Source', 'Stage', 'Total (NGN)'], ...sets[tab].map((b) => [b.guest, b.ref, b.type + ' ' + b.room, b.in, b.out, b.nights, b.src, FD.STAGE_WORD[b.stage], b.total])];
      const csv = rows.map((r) => r.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
      const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'stays-' + tab + '.csv' }); document.body.append(a); a.click(); a.remove();
    });
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
    if (LIVE) $('.title-row').after(h('p', { class: 'foot-note', text: 'Preview: staff, channels and usage on this page are not connected to your hotel yet. Facts and the inbox are live.' }));
    $$('.tog').forEach((t) => t.addEventListener('click', () => t.setAttribute('aria-checked', String(t.getAttribute('aria-checked') !== 'true'))));
    const used = 212, included = 400, extra = Math.max(0, used - included), rate = 80, base = 150000;
    $('#u-used').textContent = String(used); $('#u-left').textContent = String(Math.max(0, included - used));
    $('#u-bill').textContent = FD.naira(base + extra * rate);
    $$('[data-save]').forEach((b) => b.addEventListener('click', () => { const old = b.textContent; b.textContent = 'Saved'; b.disabled = true; setTimeout(() => { b.textContent = old; b.disabled = false; }, 1400); }));
  }
})();
