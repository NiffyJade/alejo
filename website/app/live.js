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
  const HKEY = 'alejo_hotel';                                        // which hotel this browser last looked at
  let TZ = 'Africa/Lagos';                                           // replaced by the hotel's own timezone once the hotel is known
  let HOTEL = null, HOTELS = [];                                     // the hotel on screen, and every hotel this account may open
  const hq = (path) => path + (path.includes('?') ? '&' : '?') + 'hotel_id=eq.' + HOTEL.id;     // every read and change names its hotel

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

  const emailOf = (jwt) => { try { return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email.toLowerCase(); } catch (e) { return ''; } };
  const chooseHotel = async () => {                                   // staff see their own hotel(s); a platform admin sees all of them
    HOTELS = await rest('hotels?select=id,slug,name,timezone&order=name');
    if (!HOTELS || !HOTELS.length) throw new Error('This account is not on the staff list.');
    let want = null; try { want = localStorage.getItem(HKEY); } catch (e) { /* private mode */ }
    HOTEL = HOTELS.find((h) => h.id === want) || HOTELS[0];
    TZ = HOTEL.timezone || TZ;
  };
  const loadMe = async () => {
    const email = emailOf(await token());
    const rows = await rest('staff_users?select=name,email,role&hotel_id=eq.' + HOTEL.id + '&email=eq.' + encodeURIComponent(email) + '&limit=1');
    if (rows && rows.length) return rows[0];
    if ((await rest('rpc/is_platform_admin', { method: 'POST', body: '{}' })) === true) return { name: email.split('@')[0], email, role: 'admin' };   // Alejo's own admin looking after a hotel
    throw new Error('This account is not on the staff list.');
  };
  const fetchRows = async () => {
    const [guests, bookings, escalations, messages, rooms, kb, settings, payments, blocks] = await Promise.all([
      rest(hq('guests?select=id,name,phone,telegram_chat_id&limit=1000')),
      rest(hq('bookings?select=*&order=check_in.desc&limit=1000')),
      rest(hq('escalations?select=*&order=created_at.desc&limit=500')),
      rest(hq('messages?select=guest_id,direction,text,created_at&guest_id=not.is.null&order=created_at.desc&limit=1000')),   // people who have not booked yet are counted on the Enquiries page, not shown as conversations
      rest(hq('room_types?select=name,nightly_rate,total_rooms,active')),
      rest(hq('knowledge_entries?select=id,category,question,answer,source&limit=1000')),
      rest(hq('hotel_settings?select=key,value&limit=500')),
      rest(hq('booking_payments?select=id,booking_id,amount,method,note,created_at&order=created_at.asc&limit=5000')),
      rest(hq('room_blocks?select=*&order=start_date.asc&limit=500')),
    ]);
    return { guests, bookings, escalations, messages, rooms, kb, settings, payments, blocks };
  };

    /* ---------- the hotel's own time ---------- */
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

    const SRC = { telegram: 'Telegram', phone: 'Phone', 'walk-in': 'Walk-in', online: 'Online', other: 'Other' };
    const HOW = (b) => ({ 'walk-in': 'at the desk', online: 'online', other: 'by staff' }[b.source] || 'by phone');
    const paidBy = {};
    (rows.payments || []).forEach((p) => { (paidBy[p.booking_id] = paidBy[p.booking_id] || []).push({ id: p.id, amount: Number(p.amount), method: p.method || '', note: p.note || '', at: p.created_at }); });
    const bookings = rows.bookings.filter((b) => b.status !== 'cancelled' && guests[b.guest_id]).map((b) => {
      const g = guests[b.guest_id];
      // 4 = checked out (guest tapped Check out, or the scheduler closed the stay); 5 = thanked. A checked-out guest is no longer in house.
      const stage = b.thanks_sent_at ? 5 : b.status === 'checked_out' ? 4 : b.checkout_reminder_sent_at ? 3 : b.checked_in_at ? 2 : b.reminder_sent_at ? 1 : 0;
      const when = [b.thanks_sent_at && ['Thank-you sent', b.thanks_sent_at], b.status === 'checked_out' && ['Checked out', b.checked_out_at || b.created_at], b.checkout_reminder_sent_at && ['Checkout reminder', b.checkout_reminder_sent_at], b.checked_in_at && ['Checked in', b.checked_in_at], b.reminder_sent_at && ['Reminder sent', b.reminder_sent_at], ['Booked', b.created_at]].find(Boolean);
      const nights = dayNum(b.check_out) - dayNum(b.check_in);
      const pays = paidBy[b.id] || [];
      return { id: b.id, ref: b.id.slice(0, 8).toUpperCase(), code: String(b.stay_code || ''), guest: g.name, guestId: g.id, room: b.room_number || 'not assigned', type: b.room_type || 'Room', in: b.check_in, out: b.check_out,
        created: b.created_at, src: SRC[b.source] || (g.telegram_chat_id ? 'Telegram' : 'Phone'), source: b.source || '', status: b.status, rating: b.rating || null, roomNo: b.room_number || '',
        payments: pays, paid: pays.reduce((s, p) => s + p.amount, 0), stage, note: when[0] + ' ' + stamp(when[1]), linked: !!g.telegram_chat_id, hue: hue(g.name), nights, total: nights * (RATES[b.room_type] || 0) };
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
      put(e.guest_id, { at: e.created_at, r: 'note', x: e.kind && e.kind !== 'question' ? 'Logged as a ' + (e.category ? e.category + ' ' : '') + e.kind + '. Alert sent to the staff group.' : e.status === 'open' ? 'Not in your facts, so the AI held it instead of guessing. Sent to staff, waiting for a reply.' : 'Sent to staff.' });
      if (e.status === 'answered' && e.staff_answer) put(e.guest_id, { at: e.answered_at || e.created_at, r: 'staff', by: 'Staff', x: e.staff_answer });
      if (e.status === 'answered' && e.staff_answer && saved.has('staff-' + e.id)) put(e.guest_id, { at: new Date(new Date(e.answered_at || e.created_at).getTime() + 1).toISOString(), r: 'note', x: 'Saved to Facts as an answer for next time.' });
    });
    const conversations = [];
    Object.keys(byG).forEach((gid) => {
      const g = guests[gid]; if (!g) return;
      const evs = byG[gid].sort((a, b) => new Date(a.at) - new Date(b.at));
      const open = rows.escalations.filter((e) => e.guest_id === gid && e.status === 'open').sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      const lastGuest = [...evs].reverse().find((e) => e.r === 'guest');
      // a question a person answered counts as resolved, and how long it took is what the Today screen reports
      const solved = rows.escalations.filter((e) => e.guest_id === gid && e.status === 'answered' && e.answered_at).sort((a, b) => new Date(b.answered_at) - new Date(a.answered_at))[0];
      const waitMin = open.length ? Math.max(0, Math.round((Date.now() - new Date(open[open.length - 1].created_at).getTime()) / 60000)) : null;
      const rankK = { emergency: 3, complaint: 2, request: 1, question: 0 }, top = (list) => list.slice().sort((a, b) => (rankK[b.kind] || 0) - (rankK[a.kind] || 0))[0];
      const svcRow = open.length ? top(open) : solved;
      const owner = (open.find((e) => e.assigned_to) || {}).assigned_to || null, chased = open.reduce((n, e) => n + (e.chase_count || 0), 0);
      const kindWhy = { emergency: 'Danger words were used. Staff were alerted at once.', complaint: 'A complaint needs a person. Staff were alerted.', request: 'A request needs a person. Staff were alerted.' };
      const resolvedIn = solved ? Math.max(1, Math.round((new Date(solved.answered_at) - new Date(solved.created_at)) / 60000)) : null;
      conversations.push({ id: gid, chased, guest: g.name, ch: g.telegram_chat_id ? 'Telegram' : 'Phone', ago: open.length ? ago(open[open.length - 1].created_at) : ago(evs[evs.length - 1].at), waitMins: waitMin, kind: (svcRow && svcRow.kind) || 'question', category: (svcRow && svcRow.category) || null, unread: open.length > 0, status: open.length ? 'needs' : solved ? 'done' : 'ai', resolvedIn,
        topic: open.length ? 'Asked: ' + open[0].question.slice(0, 70) : lastGuest ? lastGuest.x.slice(0, 70) : 'Conversation', lang: '', suggest: '',
        owner, why: open.length ? (kindWhy[svcRow.kind] || 'Not in your facts, so the AI held it instead of guessing.') : '', escId: open.length ? open[0].id : null, escIds: open.map((e) => e.id),
        msgs: evs.map((e) => ({ r: e.r, t: stamp(e.at), x: e.x, by: e.by })), last: evs[evs.length - 1].at });
    });
    rows.escalations.filter((e) => !e.guest_id).forEach((e) => {       // a phone caller's request: no Telegram chat, closed here with Resolve after the call-back
      const isOpen = e.status === 'open', at = isOpen ? e.created_at : (e.answered_at || e.created_at);
      conversations.push({ id: 'esc-' + e.id, guest: e.caller_name || 'Phone caller', ch: 'Phone', phone: e.caller_phone || '', ago: ago(isOpen ? e.created_at : at), waitMins: isOpen ? Math.max(0, Math.round((Date.now() - new Date(e.created_at).getTime()) / 60000)) : null,
        kind: e.kind || 'question', category: e.category || null, owner: e.assigned_to || null, unread: isOpen, status: isOpen ? 'needs' : 'done',
        resolvedIn: !isOpen && e.answered_at ? Math.max(1, Math.round((new Date(e.answered_at) - new Date(e.created_at)) / 60000)) : null,
        topic: (e.kind && e.kind !== 'question' ? 'Phone: ' : 'Asked by phone: ') + e.question.slice(0, 70), lang: '', suggest: '',
        why: isOpen ? 'Call them back' + (e.caller_phone ? ' on ' + e.caller_phone : '') + ', then press Resolve.' : '', escId: null, escIds: isOpen ? [e.id] : [],
        msgs: [{ r: 'note', t: stamp(e.created_at), x: 'Phone call' + (e.caller_phone ? ' from ' + e.caller_phone : '') + '.' }, { r: 'guest', t: stamp(e.created_at), x: e.question },
          { r: 'note', t: stamp(e.created_at), x: 'Logged as a ' + (e.category ? e.category + ' ' : '') + (e.kind || 'question') + '. Alert sent to the staff group.' }].concat(isOpen ? [] : [{ r: 'note', t: stamp(at), x: 'Resolved by staff.' }]),
        last: at });
    });
    bookings.filter((b) => !b.linked && !byG[b.guestId] && b.stage < 4).forEach((b) => conversations.push({ id: b.guestId, guest: b.guest, ch: 'Phone', ago: ago(b.created || new Date().toISOString()), unread: false, status: 'waiting',
      topic: 'Booked ' + HOW(b) + ', not on Telegram yet', lang: '', suggest: '', why: '', escId: null, escIds: [],
      msgs: [{ r: 'note', t: '', x: 'Booked ' + HOW(b) + '. Reference ' + b.ref + '. Waiting for the guest to open Telegram and share their number.' }], last: '1970-01-01' }));
    conversations.sort((a, b) => (b.status === 'needs') - (a.status === 'needs') || new Date(b.last) - new Date(a.last));
    conversations.forEach((c) => { if (!byGuest[c.guest]) byGuest[c.guest] = fallback(c.guest); });

    const settings = Object.fromEntries(rows.settings.filter((s) => s.value).map((s) => [s.key, s.value]));
    const kb = rows.kb.map((e) => ({ id: e.id, c: e.category, q: e.question, a: e.answer, k: KEYS(e.answer), s: e.source === 'staff' ? 'staff' : 'seed' }));

    Object.assign(FD, { NOW: nowInfo(), RATES, bookings, byGuest, conversations, staff: [],
      roomTypes: rows.rooms.filter((r) => r.active !== false).map((r) => ({ name: r.name, rate: Number(r.nightly_rate) || 0, total: r.total_rooms })),
      blocks: (rows.blocks || []).map((k) => ({ id: k.id, type: k.room_type, rooms: k.rooms, start: k.start_date, end: k.end_date, reason: k.reason || '' })) });
    window.FD_KB = kb;
    window.FD_FACTS = settings;
  };

  /* ---------- managing bookings: every change is a database function that checks availability and that the caller is staff ---------- */
  const REASONS = {
    name: () => "Enter the guest's name.",
    dates: () => 'Check the dates: check-out must be after check-in, check-in cannot be in the past, and a stay can be at most 90 nights (a block, 365).',
    room_type: () => 'Choose a room type.',
    sold_out: (r) => 'No ' + (r.room_type || '') + ' rooms are free for those dates.',
    room_taken: () => 'That room number is already used by another stay on those dates.',
    amount: () => 'Enter a valid amount.',
    not_today: () => 'A guest can only be checked in now when they arrive today.',
    already: () => 'This booking is already cancelled.',
    in_house: () => 'This guest is checked in. Check them out instead of cancelling.',
    done: () => 'This stay is already finished.',
    not_found: () => 'That record no longer exists. Refresh the page.',
    not_booked: () => 'This booking is not waiting to check in.',
    not_in_house: () => 'This guest is not checked in.',
    closed: () => 'This booking is closed, so its room cannot change.',
    rooms: () => 'The number of rooms must be between 1 and the number the hotel has of that type.',
    conflict: (r) => 'Only ' + r.free + ' ' + (r.room_type || '') + ' room' + (r.free === 1 ? ' is' : 's are') + ' free for those dates. Existing bookings already use the rest.',
  };
  const call = async (fn, args) => {
    let r;
    try { r = await rest('rpc/' + fn, { method: 'POST', body: JSON.stringify(args) }); }
    catch (e) { throw new Error(/not allowed/i.test(e.message) ? 'Your account is not allowed to do this.' : e.message); }
    if (r && r.ok === false) { const e = new Error((REASONS[r.reason] || (() => 'That could not be done.'))(r)); e.reason = r.reason; throw e; }
    return r;
  };
  const manage = {
    availability: (ci, co) => rest('rpc/staff_availability', { method: 'POST', body: JSON.stringify({ p_hotel: HOTEL.id, p_check_in: ci, p_check_out: co }) }),
    create: (a) => call('staff_create_booking', { p_hotel: HOTEL.id, p_name: a.name, p_phone: a.phone || null, p_room_type: a.type, p_check_in: a.ci, p_check_out: a.co, p_source: a.source,
      p_room_number: a.room || null, p_check_in_now: !!a.checkInNow, p_paid: a.paid || 0, p_payment_method: a.method || null }),
    cancel: (id, reason) => call('staff_cancel_booking', { p_id: id, p_reason: reason || null }),
    status: (id, action) => call('staff_set_status', { p_id: id, p_action: action }),
    room: (id, room) => call('staff_set_room', { p_id: id, p_room: room }),
    pay: (id, amount, method, note) => call('staff_record_payment', { p_id: id, p_amount: amount, p_method: method || null, p_note: note || null }),
    block: (a) => call('staff_add_block', { p_hotel: HOTEL.id, p_room_type: a.type, p_rooms: a.rooms, p_start: a.start, p_end: a.end, p_reason: a.reason || null }),
    unblock: (id) => call('staff_remove_block', { p_id: id }),
  };

  /* ---------- passwords: a one-time password must be replaced at first sign-in; anyone can change theirs later ---------- */
  const claims = async () => { try { return JSON.parse(atob((await token()).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch (e) { return {}; } };
  const putPassword = async (password) => {
    const a = store.get(); if (!a) throw new Error('signed-out');
    const r = await fetch(SB + '/auth/v1/user', { method: 'PUT', headers: { apikey: ANON, authorization: 'Bearer ' + (await token()), 'content-type': 'application/json' }, body: JSON.stringify({ password, data: { must_change_password: false } }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.msg || j.error_description || j.message || 'Could not change the password.');
    store.set(await authCall('refresh_token', { refresh_token: a.refresh }));        // a fresh token without the "must change" flag
  };
  const passwordDialog = (forced) => new Promise((resolve) => {
    const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
    const dlg = mk('dialog', 'mdlg'), head = mk('div', 'mhead'), h2 = mk('h2', '', forced ? 'Choose your own password' : 'Change your password');
    dlg.setAttribute('aria-labelledby', 'pwt'); h2.id = 'pwt'; head.append(h2);
    const done = (ok) => { try { dlg.close(); } catch (e) { /* not open */ } dlg.remove(); resolve(ok); };
    if (!forced) { const c = mk('button', 'btn line small', 'Close'); c.type = 'button'; c.addEventListener('click', () => done(false)); head.append(c); }
    const form = mk('form', 'msec'); form.style.padding = '16px 20px 20px';
    const field = (label, id) => { const l = mk('label', 'mfield'), i = mk('input', 'minput'); i.type = 'password'; i.id = id; i.setAttribute('autocomplete', 'new-password'); i.required = true; l.append(mk('span', '', label), i); return [l, i]; };
    const [l1, p1] = field('New password', 'pw1'), [l2, p2] = field('Type it again', 'pw2');
    const err = mk('p', 'merr'); err.setAttribute('role', 'alert');
    const go = mk('button', 'btn', 'Save password'); go.type = 'submit';
    form.append(mk('p', 'mhint', forced ? 'You signed in with a one-time password. Choose a password only you know (at least 10 characters) to carry on.' : 'Choose a new password (at least 10 characters).'), l1, l2, err, go);
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); err.textContent = '';
      if (p1.value.length < 10) { err.textContent = 'Use at least 10 characters.'; return; }
      if (p1.value !== p2.value) { err.textContent = 'The two passwords are not the same.'; return; }
      go.disabled = true;
      try { await putPassword(p1.value); done(true); } catch (x) { err.textContent = x.message; go.disabled = false; }
    });
    dlg.append(head, form);
    if (forced) dlg.addEventListener('cancel', (e) => e.preventDefault());           // Escape must not skip it
    document.body.append(dlg); dlg.showModal(); p1.focus();
  });

  /* ---------- the public object app.js uses ---------- */
  const RANK = { staff: 1, manager: 2, owner: 3, admin: 4 };
  const NEEDS = { enquiries: 'manager', ratings: 'manager', facts: 'manager', settings: 'manager', team: 'owner' };   // each restricted page and the lowest role that may open it
  const Alejo = {
    live: false, me: null, denied: false,
    can: (min) => !!Alejo.me && (RANK[Alejo.me.role] || 0) >= (RANK[min] || 99),
    signedIn: () => !!store.get(),
    async signIn(email, password) { store.set(await authCall('password', { email, password })); },
    signOut() { store.clear(); location.href = '/app/index.html'; },
    async reply(escId, answer, learn) {
      const t = await token();
      const r = await fetch(SB + '/functions/v1/staff-reply', { method: 'POST', headers: { apikey: ANON, authorization: 'Bearer ' + t, 'content-type': 'application/json' }, body: JSON.stringify({ escalation_id: escId, answer, learn: !!learn }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not send the reply.');
    },
    resolve: (ids) => rest(hq('escalations?id=in.(' + ids.join(',') + ')&status=eq.open'), { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ status: 'answered', staff_answer: '', answered_at: new Date().toISOString() }) }),
    saveFact: (key, value) => rest('hotel_settings?on_conflict=hotel_id,key', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ hotel_id: HOTEL.id, key, value, updated_at: new Date().toISOString() }) }),
    deleteAnswer: (id) => rest(hq('knowledge_entries?id=eq.' + encodeURIComponent(id)), { method: 'DELETE', headers: { prefer: 'return=minimal' } }),
    addAnswer: (q, a) => rest('knowledge_entries', { method: 'POST', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ hotel_id: HOTEL.id, id: 'staff-' + (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())), category: 'staff', question: q, answer: a, source: 'staff' }) }),
    take: (ids, name) => rest(hq('escalations?id=in.(' + ids.join(',') + ')&status=eq.open'), { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ assigned_to: name, assigned_at: name ? new Date().toISOString() : null }) }),   // name = null releases it
    clock: () => clock(new Date()),
    manage,
    team: async (action, a) => {                                    // the owner's Team screen (edge function staff-team; it checks the caller is this hotel's owner)
      const t = await token();
      const r = await fetch(SB + '/functions/v1/staff-team', { method: 'POST', headers: { apikey: ANON, authorization: 'Bearer ' + t, 'content-type': 'application/json' }, body: JSON.stringify(Object.assign({ action, hotel_id: HOTEL.id }, a || {})) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'That could not be done.');
      return j;
    },
    changePassword: () => passwordDialog(false),
    ratings: (days) => rest('rpc/ratings_report', { method: 'POST', body: JSON.stringify({ p_hotel: HOTEL.id, p_days: days }) }),
    report: (days) => rest('rpc/enquiry_report', { method: 'POST', body: JSON.stringify({ p_hotel: HOTEL.id, p_days: days }) }),
    hotel: () => HOTEL, hotels: () => HOTELS,
    async ask(question) {                                           // the staff copilot: answers from the hotel's live records (edge function staff-copilot)
      const t = await token();
      const r = await fetch(SB + '/functions/v1/staff-copilot', { method: 'POST', headers: { apikey: ANON, authorization: 'Bearer ' + t, 'content-type': 'application/json' }, body: JSON.stringify({ question, hotel_id: HOTEL.id }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'The assistant could not answer just now.');
      return j.answer;
    },
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

  const TABLES = ['messages', 'escalations', 'bookings', 'guests', 'knowledge_entries', 'hotel_settings', 'booking_payments', 'room_blocks'];
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
      TABLES.forEach((table) => ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: 'hotel_id=eq.' + HOTEL.id }, (p) => onChange(table, p)));
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
        if (role) role.textContent = Alejo.me.role === 'admin' ? 'Alejo admin' : Alejo.me.role.charAt(0).toUpperCase() + Alejo.me.role.slice(1);
      }
      document.querySelectorAll('.nav a').forEach((a) => {          // links to pages this role cannot open leave the menu
        const m = (a.getAttribute('href') || '').match(/\/(enquiries|ratings|knowledge|settings|team)\.html/);
        if (m && !Alejo.can(m[1] === 'team' ? 'owner' : 'manager')) a.remove();
      });
      if (!Alejo.can('manager')) { const hd = document.querySelector('.nav .nav-h'); if (hd) hd.remove(); }
      if (Alejo.denied) {                                           // landing on one anyway explains why, instead of an empty or failing page
        const main = document.getElementById('main');
        if (main) {
          const box = document.createElement('div'), t = document.createElement('h1'), p = document.createElement('p');
          box.className = 'title-row'; t.textContent = Alejo.deniedFor === 'owner' ? 'This page is for the hotel owner' : 'This page is for managers'; p.className = 'sub';
          p.textContent = 'Your account cannot open this page. Ask ' + (Alejo.deniedFor === 'owner' ? 'the owner' : 'a manager or the owner') + ' if you need something changed here.';
          const d = document.createElement('div'); d.append(t, p); box.append(d); main.replaceChildren(box);
        }
      }
      const scope = document.querySelector('.scope');
      if (scope && HOTEL) {
        const nm2 = scope.querySelector('b'), where = scope.querySelector('span');
        if (nm2) nm2.textContent = HOTEL.name;
        if (where) where.textContent = (window.FD_FACTS && window.FD_FACTS.HOTEL_ADDRESS ? String(window.FD_FACTS.HOTEL_ADDRESS).slice(0, 38) : String(HOTEL.timezone || '').replace(/^.*\//, '').replace(/_/g, ' '));
        document.querySelectorAll('.sub').forEach((el) => { el.textContent = el.textContent.replace('BrightSide Hotel', HOTEL.name); });
      }
      if (HOTELS.length > 1) {                                       // someone who works at several hotels (or Alejo's admin) picks which one is on screen
        const pick = document.createElement('select'); pick.setAttribute('aria-label', 'Hotel'); pick.className = 'web-link';
        HOTELS.forEach((h) => { const o = document.createElement('option'); o.value = h.id; o.textContent = h.name; if (h.id === HOTEL.id) o.selected = true; pick.append(o); });
        pick.addEventListener('change', () => { try { localStorage.setItem(HKEY, pick.value); } catch (e) { /* private mode */ } location.reload(); });
        slot.append(pick);
      }
      const pw = document.createElement('button'); pw.type = 'button'; pw.className = 'web-link'; pw.textContent = 'Change password'; pw.addEventListener('click', () => { passwordDialog(false); });
      slot.append(pw);
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
      if (((await claims()).user_metadata || {}).must_change_password === true) await passwordDialog(true);     // nothing loads until they choose their own password
      await chooseHotel();
      const [rows, me] = await Promise.all([fetchRows(), loadMe()]);
      Alejo.me = me;
      const pageNeed = NEEDS[document.body && document.body.dataset.page];
      Alejo.denied = !!pageNeed && !Alejo.can(pageNeed); Alejo.deniedFor = pageNeed;
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
