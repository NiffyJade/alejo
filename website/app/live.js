/* Alejo dashboard: live mode.
   Signed out, the dashboard shows sample data (the public demo). Signed in, this file replaces window.FD, FD_KB and FD_FACTS with the
   hotel's real rows from Supabase and gives app.js the write calls it needs. It uses only the public anon key plus the signed-in user's
   token; row-level security (sql/004_dashboard_access.sql) lets only listed staff read or write. window.AlejoReady resolves when
   the data is in, and app.js waits for it. */
(function () {
  'use strict';
  const SB = 'https://uavlejanscnsvjdxfslh.supabase.co';
  const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhdmxlamFuc2Nuc3ZqZHhmc2xoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMwMDcyODUsImV4cCI6MjEwODU4MzI4NX0.wDbPMD4BHF9ZpkgTwyAub-pyYQgsY93FSdQaUNlrJRA';                                  // public by design
  const KEY = 'alejo_auth';
  const TZ = 'Africa/Lagos';

  /* ---------- session ---------- */
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    clear() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } },
  };
  const authCall = async (grant, body) => {
    const r = await fetch(SB + '/auth/v1/token?grant_type=' + grant, { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error_description || j.msg || 'Sign-in failed.');
    return { access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  };
  const token = async () => {
    let a = store.get();
    if (!a) throw new Error('signed-out');
    if (a.exp - Date.now() < 60000) {
      try { a = await authCall('refresh_token', { refresh_token: a.refresh }); store.set(a); } catch (e) { store.clear(); throw new Error('signed-out'); }
    }
    return a.access;
  };
  const rest = async (path, opts) => {
    const t = await token();
    const r = await fetch(SB + '/rest/v1/' + path, Object.assign({}, opts, { headers: Object.assign({ apikey: ANON, authorization: 'Bearer ' + t, 'content-type': 'application/json' }, (opts || {}).headers) }));
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.message || 'Request failed (' + r.status + ').'); }
    return r.status === 204 ? null : r.json().catch(() => null);
  };

  const fetchRows = async () => {
    const [guests, bookings, escalations, messages, rooms, kb, settings] = await Promise.all([
      rest('guests?select=id,name,phone,telegram_chat_id&limit=1000'),
      rest('bookings?select=*&order=check_in.desc&limit=1000'),
      rest('escalations?select=*&order=created_at.desc&limit=500'),
      rest('messages?select=guest_id,direction,text,created_at&order=created_at.desc&limit=1000'),
      rest('room_types?select=name,nightly_rate'),
      rest('knowledge_entries?select=id,category,question,answer,source&limit=1000'),
      rest('hotel_settings?select=key,value&limit=500'),
    ]);
    return { guests, bookings, escalations, messages, rooms, kb, settings };
  };

  /* ---------- Lagos time ---------- */
  const parts = (d) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((p) => [p.type, p.value]));
  const dayOf = (d) => { const p = parts(d); return p.year + '-' + p.month + '-' + p.day; };
  const clock = (d) => { const p = parts(d); return p.hour + ':' + p.minute; };
  const stamp = (iso) => { const d = new Date(iso), today = dayOf(new Date()); return dayOf(d) === today ? clock(d) : new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short' }).format(d) + ', ' + clock(d); };
  const ago = (iso) => { const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); return m < 60 ? Math.max(1, m) + ' min' : m < 1440 ? Math.round(m / 60) + ' h' : Math.round(m / 1440) + ' d'; };
  const nowInfo = () => { const d = new Date(); return { date: dayOf(d), time: clock(d), label: new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(d) + ', ' + clock(d) }; };

  /* ---------- rows -> the shapes the screens already use ---------- */
  const hue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const dayNum = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000;
  const KEYS = (text) => [...new Set((String(text).match(/\[\[(\w+)\]\]/g) || []).map((m) => m.slice(2, -2)))];

  const build = (rows) => {
    const FD = window.FD;
    const RATES = Object.fromEntries(rows.rooms.map((r) => [r.name, Number(r.nightly_rate) || 0]));
    const guests = Object.fromEntries(rows.guests.map((g) => [g.id, g]));

    const bookings = rows.bookings.filter((b) => b.status !== 'cancelled' && guests[b.guest_id]).map((b) => {
      const g = guests[b.guest_id];
      const stage = b.thanks_sent_at ? 4 : (b.checkout_reminder_sent_at || b.status === 'checked_out') ? 3 : b.checked_in_at ? 2 : b.reminder_sent_at ? 1 : 0;
      const when = [b.thanks_sent_at && ['Thank-you sent', b.thanks_sent_at], b.checkout_reminder_sent_at && ['Checkout reminder', b.checkout_reminder_sent_at], b.checked_in_at && ['Checked in', b.checked_in_at], b.reminder_sent_at && ['Reminder sent', b.reminder_sent_at], ['Booked', b.created_at]].find(Boolean);
      const nights = dayNum(b.check_out) - dayNum(b.check_in);
      return { id: b.id, ref: b.id.slice(0, 8).toUpperCase(), guest: g.name, guestId: g.id, room: b.room_number || 'not assigned', type: b.room_type || 'Room', in: b.check_in, out: b.check_out,
        created: b.created_at, src: g.telegram_chat_id ? 'Telegram' : 'Phone', stage, note: when[0] + ' ' + stamp(when[1]), linked: !!g.telegram_chat_id, hue: hue(g.name), nights, total: nights * (RATES[b.room_type] || 0) };
    });
    const byGuest = {};
    bookings.forEach((b) => { if (!byGuest[b.guest] || b.in > byGuest[b.guest].in) byGuest[b.guest] = b; });
    const fallback = (name) => ({ ref: 'no booking', type: 'Room', room: 'not assigned', in: dayOf(new Date()), out: dayOf(new Date()), nights: 0, total: 0, stage: 0, note: '', hue: hue(name), src: 'Telegram', linked: true });

    const byG = {};
    const put = (gid, ev) => { (byG[gid] = byG[gid] || []).push(ev); };
    rows.messages.forEach((m) => { if (m.guest_id && !/^Update from our team: /.test(m.text)) put(m.guest_id, { at: m.created_at, r: m.direction === 'in' ? 'guest' : 'ai', x: m.text }); });
    const saved = new Set(rows.kb.map((k) => k.id));                // answers staff chose to keep for future guests
    rows.escalations.forEach((e) => {
      if (!e.guest_id) return;
      put(e.guest_id, { at: e.created_at, r: 'note', x: e.status === 'open' ? 'Not in your facts, so the AI held it instead of guessing. Sent to staff, waiting for a reply.' : 'Sent to staff.' });
      if (e.status === 'answered' && e.staff_answer) put(e.guest_id, { at: e.answered_at || e.created_at, r: 'staff', by: 'Staff', x: e.staff_answer });
      if (e.status === 'answered' && e.staff_answer && saved.has('staff-' + e.id)) put(e.guest_id, { at: new Date(new Date(e.answered_at || e.created_at).getTime() + 1).toISOString(), r: 'note', x: 'Saved to Facts as an answer for next time.' });
    });
    const conversations = [];
    Object.keys(byG).forEach((gid) => {
      const g = guests[gid]; if (!g) return;
      const evs = byG[gid].sort((a, b) => new Date(a.at) - new Date(b.at));
      const open = rows.escalations.filter((e) => e.guest_id === gid && e.status === 'open').sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      const lastGuest = [...evs].reverse().find((e) => e.r === 'guest');
      conversations.push({ id: gid, guest: g.name, ch: g.telegram_chat_id ? 'Telegram' : 'Phone', ago: ago(evs[evs.length - 1].at), unread: open.length > 0, status: open.length ? 'needs' : 'ai',
        topic: open.length ? 'Asked: ' + open[0].question.slice(0, 70) : lastGuest ? lastGuest.x.slice(0, 70) : 'Conversation', lang: '', suggest: '',
        why: open.length ? 'Not in your facts, so the AI held it instead of guessing.' : '', escId: open.length ? open[0].id : null, escIds: open.map((e) => e.id),
        msgs: evs.map((e) => ({ r: e.r, t: stamp(e.at), x: e.x, by: e.by })), last: evs[evs.length - 1].at });
    });
    bookings.filter((b) => !b.linked && !byG[b.guestId] && b.stage < 4).forEach((b) => conversations.push({ id: b.guestId, guest: b.guest, ch: 'Phone', ago: ago(b.created || new Date().toISOString()), unread: false, status: 'waiting',
      topic: 'Booked by phone, not on Telegram yet', lang: '', suggest: '', why: '', escId: null, escIds: [],
      msgs: [{ r: 'note', t: '', x: 'Booked by phone. Reference ' + b.ref + '. Waiting for the guest to open Telegram and share their number.' }], last: '1970-01-01' }));
    conversations.sort((a, b) => (b.status === 'needs') - (a.status === 'needs') || new Date(b.last) - new Date(a.last));
    conversations.forEach((c) => { if (!byGuest[c.guest]) byGuest[c.guest] = fallback(c.guest); });

    const settings = Object.fromEntries(rows.settings.filter((s) => s.value).map((s) => [s.key, s.value]));
    const kb = rows.kb.map((e) => ({ id: e.id, c: e.category, q: e.question, a: e.answer, k: KEYS(e.answer), s: e.source === 'staff' ? 'staff' : 'seed' }));

    Object.assign(FD, { NOW: nowInfo(), RATES, bookings, byGuest, conversations, staff: [] });
    window.FD_KB = kb;
    window.FD_FACTS = settings;
  };

  /* ---------- the public object app.js uses ---------- */
  const Alejo = {
    live: false, me: null,
    signedIn: () => !!store.get(),
    async signIn(email, password) { store.set(await authCall('password', { email, password })); },
    signOut() { store.clear(); location.href = '/app/index.html'; },
    async reply(escId, answer, learn) {
      const t = await token();
      const r = await fetch(SB + '/functions/v1/staff-reply', { method: 'POST', headers: { apikey: ANON, authorization: 'Bearer ' + t, 'content-type': 'application/json' }, body: JSON.stringify({ escalation_id: escId, answer, learn: !!learn }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not send the reply.');
    },
    resolve: (ids) => rest('escalations?id=in.(' + ids.join(',') + ')&status=eq.open', { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ status: 'answered', staff_answer: '', answered_at: new Date().toISOString() }) }),
    saveFact: (key, value) => rest('hotel_settings?on_conflict=key', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }) }),
    deleteAnswer: (id) => rest('knowledge_entries?id=eq.' + encodeURIComponent(id), { method: 'DELETE', headers: { prefer: 'return=minimal' } }),
    addAnswer: (q, a) => rest('knowledge_entries', { method: 'POST', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ id: 'staff-' + (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())), category: 'staff', question: q, answer: a, source: 'staff' }) }),
    clock: () => clock(new Date()),
    async typing(escId) {                                           // shows "typing..." to the guest in Telegram while staff write (about 5 s each time)
      const t = await token();
      await fetch(SB + '/functions/v1/staff-typing', { method: 'POST', headers: { apikey: ANON, authorization: 'Bearer ' + t, 'content-type': 'application/json' }, body: JSON.stringify({ escalation_id: escId }) });
    },
  };
  window.Alejo = Alejo;

  /* ---------- keeping the screens current ---------- */
  const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
  let liveState = 'on', lastUpdate = null, refreshing = false, again = false, timer = null, connected = false, beat = 0;
  const paintLive = () => {                                         // "Live, updated 17:52" with a dot that pulses on every update
    const n = document.getElementById('demoNote');
    if (!n || !Alejo.live) return;
    const dot = document.createElement('span'), txt = document.createElement('span');
    dot.className = 'live-dot' + (liveState === 'on' ? ' pulse' : ' off');
    txt.textContent = liveState === 'on' ? 'Live, updated ' + (lastUpdate ? clock(lastUpdate) : '') : 'Reconnecting…';
    n.replaceChildren(dot, txt);
  };
  const doRefresh = async () => {
    if (refreshing) { again = true; return; }
    refreshing = true;
    try { build(await fetchRows()); lastUpdate = new Date(); liveState = 'on'; paintLive(); emit('alejo:data', {}); }
    catch (e) { if (e.message === 'signed-out') { location.replace('/app/login.html?expired=1'); return; } liveState = 'off'; paintLive(); }
    refreshing = false;
    if (again) { again = false; doRefresh(); }
  };
  Alejo.refresh = doRefresh;
  const scheduleRefresh = () => { clearTimeout(timer); timer = setTimeout(doRefresh, 400); };     // several changes at once become one refresh

  const TABLES = ['messages', 'escalations', 'bookings', 'guests', 'knowledge_entries', 'hotel_settings'];
  const onChange = (table, p) => {
    if (table === 'escalations' && p.eventType === 'INSERT') emit('alejo:new', { text: 'A guest needs you: ' + String((p.new || {}).question || '').slice(0, 80) });
    if (table === 'bookings' && p.eventType === 'INSERT') emit('alejo:new', { text: 'New booking received.' });
    scheduleRefresh();
  };
  const loadLib = () => new Promise((resolve, reject) => {
    if (window.supabase) return resolve();
    const el = document.createElement('script');
    el.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';   // pinned; only signed-in staff ever load it
    el.onload = resolve; el.onerror = reject; document.head.append(el);
  });
  const startRealtime = async () => {
    try {
      await loadLib();
      const client = window.supabase.createClient(SB, ANON, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      client.realtime.setAuth(await token());
      const ch = client.channel('alejo-live');
      TABLES.forEach((table) => ch.on('postgres_changes', { event: '*', schema: 'public', table }, (p) => onChange(table, p)));
      ch.subscribe((status) => {
        connected = status === 'SUBSCRIBED';
        liveState = connected ? 'on' : 'off'; paintLive();
        if (connected) scheduleRefresh();                           // catch anything that happened while we were not listening
      });
      setInterval(async () => { try { client.realtime.setAuth(await token()); } catch (e) { /* signed out elsewhere */ } }, 4 * 60000);
    } catch (e) { liveState = 'off'; paintLive(); }
  };
  // the safety net: when realtime is down, refresh every 15 s; when it is up, still once a minute; and whenever the tab comes back into view
  setInterval(() => { if (Alejo.live && !document.hidden && (!connected || ++beat % 4 === 0)) doRefresh(); }, 15000);
  document.addEventListener('visibilitychange', () => { if (Alejo.live && !document.hidden) doRefresh(); });

  /* ---------- header: who is looking, and how to sign in or out ---------- */
  let dressed = false;
  const dress = () => {
    if (dressed) return;
    dressed = true;
    const note = document.getElementById('demoNote'), slot = document.getElementById('authSlot');
    if (!slot) return;
    if (Alejo.live) {
      if (note) paintLive();
      if (Alejo.me) {
        const who = Alejo.me.name || Alejo.me.email || '?';
        const acct = document.getElementById('acct'), nm = document.getElementById('meName'), role = document.getElementById('meRole');
        if (acct) { acct.textContent = who.split(/[ @]/).filter(Boolean).map((p) => p[0].toUpperCase()).slice(0, 2).join(''); acct.title = who + ', ' + Alejo.me.role; }
        if (nm) nm.textContent = who;
        if (role) role.textContent = Alejo.me.role.charAt(0).toUpperCase() + Alejo.me.role.slice(1);
      }
      const b = document.createElement('button'); b.type = 'button'; b.className = 'web-link'; b.textContent = 'Sign out'; b.addEventListener('click', Alejo.signOut);
      slot.append(b);
    } else {
      const a = document.createElement('a'); a.className = 'web-link'; a.href = '/app/login.html'; a.textContent = 'Sign in';
      slot.append(a);
    }
  };

  /* ---------- load ---------- */
  window.AlejoReady = (async () => {
    if (document.body && document.body.dataset.page === 'login') return false;
    const dressWhenReady = () => (document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', dress) : dress());
    if (!Alejo.signedIn()) { dressWhenReady(); return false; }
    try {
      const [rows, me] = await Promise.all([fetchRows(), rest('staff_users?select=name,email,role&limit=1')]);
      if (!me || !me.length) throw new Error('This account is not on the staff list.');
      Alejo.me = me[0];
      build(rows);
      Alejo.live = true; lastUpdate = new Date();
      dressWhenReady();
      startRealtime();                                              // from here on the screens update by themselves
      return true;
    } catch (e) {
      if (e.message === 'signed-out') { location.replace('/app/login.html?expired=1'); return new Promise(() => {}); }
      window.AlejoError = e.message;
      store.clear();
      dressWhenReady();
      return false;
    }
  })();
})();
