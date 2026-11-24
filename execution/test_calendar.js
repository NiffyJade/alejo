// Offline test of the Calendar arithmetic (website/app/calendar-core.js). Usage:  node execution/test_calendar.js
const path = require('path');
const C = require(path.join(__dirname, '..', 'website', 'app', 'calendar-core.js'));
let fails = 0, n = 0;
const eq = (name, got, want) => { n++; const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n   got  ' + JSON.stringify(got) + '\n   want ' + JSON.stringify(want))); };

// dates
eq('addDays crosses a month and a year', [C.addDays('2026-12-31', 1), C.addDays('2026-03-01', -1)], ['2027-01-01', '2026-02-28']);
eq('Monday-first weekday (2026-11-23 is a Monday, 2026-11-29 a Sunday)', [C.dow('2026-11-23'), C.dow('2026-11-29')], [0, 6]);
const nov = C.monthDays({ y: 2026, m: 10 });
eq('November 2026 grid: whole weeks from Monday 26 Oct to Sunday 6 Dec', [nov[0], nov[nov.length - 1], nov.length % 7], ['2026-10-26', '2026-12-06', 0]);
eq('a month that starts on Monday has no days before it (Feb 2027)', [C.monthDays({ y: 2027, m: 1 })[0], C.monthDays({ y: 2027, m: 1 }).length], ['2027-02-01', 28]);
eq('shiftMonth wraps the year both ways', [C.shiftMonth({ y: 2026, m: 11 }, 1), C.shiftMonth({ y: 2026, m: 0 }, -1)], [{ y: 2027, m: 0 }, { y: 2025, m: 11 }]);

// a small hotel: 4 Standard (₦40,000), 2 Suite (₦90,000)
const T = '2026-11-24';
const ctx = {
  today: T,
  roomTypes: [{ name: 'Standard', rate: 40000, total: 4 }, { name: 'Suite', rate: 90000, total: 2 }],
  bookings: [
    { id: 'a', guest: 'A', type: 'Standard', in: '2026-11-24', out: '2026-11-26', stage: 2 },     // staying 24, 25 (leaves 26)
    { id: 'b', guest: 'B', type: 'Standard', in: '2026-11-25', out: '2026-11-27', stage: 0 },     // 25, 26
    { id: 'c', guest: 'C', type: 'Suite', in: '2026-11-26', out: '2026-11-27', stage: 0 },        // 26
    { id: 'd', guest: 'D', type: 'Standard', in: '2026-11-20', out: '2026-11-23', stage: 5 },      // history
    { id: 'e', guest: 'E', type: 'Standard', in: '2026-11-22', out: '2026-11-28', stage: 4 },      // checked out early (today)
  ],
  blocks: [{ id: 'k', type: 'Standard', rooms: 1, start: '2026-11-25', end: '2026-11-26', reason: 'paint' }],
};
const s = (d, t) => C.dayStats(d, ctx, t || '');
eq('check-out day is free for the next guest (A leaves 26, so 26 counts only B and C)', [s('2026-11-26').booked, s('2026-11-26', 'Standard').booked], [2, 1]);
eq('check-in day counts (A arrives 24)', s('2026-11-24', 'Standard').booked, 1);
eq('a block takes rooms out of sale for its nights only (25 yes, 26 no)', [s('2026-11-25', 'Standard').blocked, s('2026-11-26', 'Standard').blocked], [1, 0]);
eq('free = total - booked - blocked (Standard on the 25th: 4 - 2 - 1)', s('2026-11-25', 'Standard').free, 1);
eq('"all rooms" adds the types together (6 rooms; the 26th has 2 booked, so 4 free)', [s('2026-11-26').total, s('2026-11-26').free], [6, 4]);
eq('few left when about a fifth or fewer remain, and always when only one is left (Standard on the 25th: 1 of 4)', s('2026-11-25', 'Standard').state, 'few');
eq('2 of 4 left is still "open"', s('2026-11-26', 'Standard').free === 3 && s('2026-11-26', 'Standard').state, 'open');
eq('plenty free is "open"', s('2026-12-10', 'Standard').state, 'open');
eq('a past day is "past" and keeps its history (D and E were both in on the 22nd)', [s('2026-11-22', 'Standard').state, s('2026-11-22', 'Standard').booked], ['past', 2]);
eq('a guest who checked out early frees the room from today (E left today: not counted on the 24th, counted on the 23rd)', [s('2026-11-24', 'Standard').stays.some((b) => b.id === 'e'), s('2026-11-23', 'Standard').stays.some((b) => b.id === 'e')], [false, true]);
const full = { ...ctx, bookings: ctx.bookings.concat([{ id: 'f1', type: 'Suite', in: '2026-12-01', out: '2026-12-03', stage: 0 }, { id: 'f2', type: 'Suite', in: '2026-12-01', out: '2026-12-03', stage: 0 }]) };
eq('every room taken is "full"', C.dayStats('2026-12-01', full, 'Suite').state, 'full');
const closed = { ...ctx, blocks: [{ type: 'Suite', rooms: 2, start: '2026-12-01', end: '2026-12-03' }] };
eq('every room blocked and none booked is "closed"', C.dayStats('2026-12-01', closed, 'Suite').state, 'closed');
eq('never a negative number of free rooms (over-booked data shows 0)', C.dayStats('2026-12-01', { ...full, bookings: full.bookings.concat([{ id: 'f3', type: 'Suite', in: '2026-12-01', out: '2026-12-02', stage: 0 }]) }, 'Suite').free, 0);
eq('arrivals and departures of a day (26th: C arrives; A and nobody else leaves... B leaves 27)', [s('2026-11-26').arriving.map((b) => b.id), s('2026-11-26').leaving.map((b) => b.id)], [['c'], ['a']]);
eq('a booking for a room type the hotel no longer lists is ignored, not counted', C.dayStats('2026-11-25', { ...ctx, bookings: ctx.bookings.concat([{ id: 'z', type: 'Penthouse', in: '2026-11-25', out: '2026-11-26', stage: 0 }]) }, '').booked, 2);
eq('no room types at all: state "none", no crash', C.dayStats('2026-11-25', { today: T, roomTypes: [], bookings: [], blocks: [] }, '').state, 'none');

// event hall, gym and other service bookings on a day
const withSvc = { ...ctx, svcBookings: [
  { id: 's1', service: 'Event hall', exclusive: true, name: 'Ada', start: '2026-12-05', end: '2026-12-06' },
  { id: 's2', service: 'Pool', exclusive: false, name: 'Group', start: '2026-12-05', end: '2026-12-05' },
] };
eq('service bookings show on every day they cover (both end days included)', [C.dayStats('2026-12-05', withSvc, '').svc.length, C.dayStats('2026-12-06', withSvc, '').svc.length, C.dayStats('2026-12-07', withSvc, '').svc.length, C.dayStats('2026-12-04', withSvc, '').svc.length], [2, 1, 0, 0]);
eq('choosing one room type hides the services (they are not rooms)', C.dayStats('2026-12-05', withSvc, 'Standard').svc.length, 0);
eq('a calendar with no service bookings still works (hotels without services)', [C.dayStats('2026-12-05', ctx, '').svc, C.dayStats('2026-12-05', { ...ctx, svcBookings: undefined }, '').svc], [[], []]);
eq('services never change the room counts', C.dayStats('2026-11-25', withSvc, '').free, C.dayStats('2026-11-25', ctx, '').free);

// "is there a room for these nights": the tightest night decides
const r = C.freeForRange('2026-11-24', '2026-11-27', ctx);
eq('range 24 to 27: Standard is limited by its tightest night (the 25th, 1 free), Suite by the 26th (1 free)', r.map((x) => [x.name, x.free]), [['Standard', 1], ['Suite', 1]]);
eq('range totals use the nightly rate (3 nights Standard = 120,000)', [r[0].nights, r[0].total], [3, 120000]);
eq('a range ending on a check-out day does not count that night (27 to 28: Standard has 4 - 0... E is gone, B left)', C.freeForRange('2026-11-27', '2026-11-28', ctx)[0].free, 4);
eq('an empty or backwards range gives nothing', [C.freeForRange('2026-11-27', '2026-11-27', ctx), C.freeForRange('2026-11-28', '2026-11-27', ctx), C.freeForRange('', '', ctx)], [[], [], []]);

console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
