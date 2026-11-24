/* Alejo dashboard: Calendar, the arithmetic. No screen code here, so it can be tested in Node (execution/test_calendar.js).
   One rule everywhere: a stay occupies the nights from check-in up to, but not including, the check-out day (like a hotel does),
   and a block works the same. This matches the database function rooms_free(), which is what actually decides if a room can be booked.
   A stay that has already checked out frees its room from today on (so a guest who leaves early reopens the room), but still counts on past days, so the calendar is also a history. */
(function (root) {
  'use strict';
  const DAY = 86400000;
  const toNum = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY;
  const fromNum = (n) => new Date(n * DAY).toISOString().slice(0, 10);
  const addDays = (s, n) => fromNum(toNum(s) + n);
  const dow = (s) => (new Date(toNum(s) * DAY).getUTCDay() + 6) % 7;                 // Monday = 0 ... Sunday = 6
  const monthStart = (y, m) => y + '-' + String(m + 1).padStart(2, '0') + '-01';      // m = 0..11
  const monthOf = (s) => ({ y: +s.slice(0, 4), m: +s.slice(5, 7) - 1 });
  const shiftMonth = (v, n) => { const t = v.y * 12 + v.m + n; return { y: Math.floor(t / 12), m: ((t % 12) + 12) % 12 }; };

  // every date shown for a month: whole weeks, Monday to Sunday
  const monthDays = (v) => {
    const first = monthStart(v.y, v.m), nextFirst = monthStart(shiftMonth(v, 1).y, shiftMonth(v, 1).m);
    const start = addDays(first, -dow(first)), last = addDays(nextFirst, -1), end = addDays(last, 6 - dow(last));
    const out = []; for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
    return out;
  };

  const stageOf = (b) => (b.stage == null ? (b.status === 'checked_out' ? 4 : b.status === 'checked_in' ? 2 : 0) : b.stage);
  const occupies = (b, d, today) => b.in <= d && d < b.out && (stageOf(b) < 4 || d < today);

  // ctx = { bookings, roomTypes: [{name, rate, total}], blocks: [{type, rooms, start, end, reason}], svcBookings: [{service, name, start, end, ...}], today }
  const typesOf = (ctx, type) => (ctx.roomTypes || []).filter((t) => !type || t.name === type);

  const FEW = 0.2;                                                                    // 20% of the rooms or fewer left counts as "few left"
  const dayStats = (d, ctx, type) => {
    const types = typesOf(ctx, type), names = new Set(types.map((t) => t.name));
    const total = types.reduce((n, t) => n + (Number(t.total) || 0), 0);
    const stays = (ctx.bookings || []).filter((b) => names.has(b.type) && occupies(b, d, ctx.today));
    const blocks = (ctx.blocks || []).filter((k) => names.has(k.type) && k.start <= d && d < k.end);
    const blocked = blocks.reduce((n, k) => n + k.rooms, 0);
    const svc = type ? [] : (ctx.svcBookings || []).filter((b) => b.start <= d && d <= b.end);       // event hall, gym ... booked that day (not shown when one room type is chosen)
    const booked = stays.length;
    const free = Math.max(0, total - booked - blocked);
    const arriving = (ctx.bookings || []).filter((b) => names.has(b.type) && b.in === d);
    const leaving = (ctx.bookings || []).filter((b) => names.has(b.type) && b.out === d && b.in < d);
    const past = d < ctx.today;
    let state;
    if (!total) state = 'none';
    else if (past) state = 'past';
    else if (free === 0) state = booked === 0 ? 'closed' : 'full';
    else if (free <= Math.max(1, Math.ceil(total * FEW))) state = 'few';
    else state = 'open';
    const byType = types.map((t) => {
      const bk = stays.filter((b) => b.type === t.name).length, bl = blocks.filter((k) => k.type === t.name).reduce((n, k) => n + k.rooms, 0);
      return { name: t.name, rate: t.rate, total: Number(t.total) || 0, booked: bk, blocked: bl, free: Math.max(0, (Number(t.total) || 0) - bk - bl) };
    });
    return { date: d, total, booked, blocked, free, state, past, stays, arriving, leaving, blocks, byType, svc };
  };

  // the one rule behind "is there a room for these nights?": the fewest free rooms on any night of the stay (as the database does)
  const freeForRange = (ci, co, ctx) => {
    if (!ci || !co || co <= ci) return [];
    const nights = toNum(co) - toNum(ci);
    const days = []; for (let d = ci; d < co; d = addDays(d, 1)) days.push(dayStats(d, ctx, ''));
    return (ctx.roomTypes || []).map((t) => {
      const free = Math.min(...days.map((s) => s.byType.find((x) => x.name === t.name).free));
      return { name: t.name, free, rate: t.rate, nights, total: (Number(t.rate) || 0) * nights };
    });
  };

  const api = { toNum, fromNum, addDays, dow, monthStart, monthOf, shiftMonth, monthDays, stageOf, occupies, dayStats, freeForRange, FEW };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.AlejoCal = api;
})(typeof window !== 'undefined' ? window : globalThis);
