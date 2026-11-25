// Offline test of the Bookings stay-panel rules (website/app/stay-core.js). Usage:  node execution/test_stay.js
const path = require('path');
const S = require(path.join(__dirname, '..', 'website', 'app', 'stay-core.js'));
let fails = 0, n = 0;
const eq = (name, got, want) => { n++; const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n   got  ' + JSON.stringify(got) + '\n   want ' + JSON.stringify(want))); };

const T = '2026-11-24';
const stay = (o) => Object.assign({ ref: 'AL-1', stage: 0, in: T, out: '2026-11-26', total: 100000, paid: 0 }, o);

// the main button
eq('a stay arriving today is checked in with "Check in guest"', S.primary(stay({ stage: 0 }), T), { act: 'checkin', label: 'Check in guest', early: false });
eq('a reminded stay arriving today is also checked in', S.primary(stay({ stage: 1 }), T).act, 'checkin');
eq('a stay arriving tomorrow says "Check in early" and asks for confirmation', S.primary(stay({ in: '2026-11-25' }), T), { act: 'checkin', label: 'Check in early', early: true });
eq('a stay that should have arrived yesterday can still be checked in', S.primary(stay({ in: '2026-11-23' }), T).early, false);
eq('a guest in the house is checked out', S.primary(stay({ stage: 2 }), T), { act: 'checkout', label: 'Check out guest', early: false });
eq('a guest who was sent the checkout reminder is checked out', S.primary(stay({ stage: 3 }), T).act, 'checkout');
eq('a checked-out stay has no main button', S.primary(stay({ stage: 4 }), T), null);
eq('a thanked stay has no main button', S.primary(stay({ stage: 5 }), T), null);

// money
eq('nothing paid: unpaid, the whole total is the balance', S.pay(stay({ paid: 0 })), { state: 'unpaid', paid: 0, total: 100000, balance: 100000, pct: 0 });
eq('part paid shows the share', S.pay(stay({ paid: 25000 })), { state: 'part', paid: 25000, total: 100000, balance: 75000, pct: 25 });
eq('fully paid has no balance', S.pay(stay({ paid: 100000 })), { state: 'paid', paid: 100000, total: 100000, balance: 0, pct: 100 });
eq('an overpayment never shows a negative balance or more than 100%', [S.pay(stay({ paid: 120000 })).balance, S.pay(stay({ paid: 120000 })).pct], [0, 100]);
eq('a stay with no rate has no payment state (no divide by zero)', S.pay(stay({ total: 0 })).state, 'none');

// the stay code note
eq('a guest on Telegram is told when the code arrives', S.note(stay({ linked: true })).tone, 'info');
eq('demo stays without a "linked" flag count as on Telegram', S.note(stay({})).tone, 'info');
eq('a phone booking is warned there is no code, with its reference', [S.note(stay({ linked: false, ref: 'AL-1041' })).tone, /AL-1041/.test(S.note(stay({ linked: false, ref: 'AL-1041' })).text)], ['warn', true]);
eq('a finished stay says the code no longer works, even for a phone booking', S.note(stay({ linked: false, stage: 4 })).tone, 'done');

// the checklist
eq('a booked stay: first step "Now", the rest to do', S.steps(stay({ stage: 0 })).map((x) => x.state), ['now', 'todo', 'todo', 'todo', 'todo', 'todo']);
eq('in house: two done, "Checked in" is now', S.steps(stay({ stage: 2 })).map((x) => x.state), ['done', 'done', 'now', 'todo', 'todo', 'todo']);
eq('a thanked stay is finished: every step done, nothing "Now"', S.steps(stay({ stage: 5 })).map((x) => x.state), ['done', 'done', 'done', 'done', 'done', 'done']);
eq('step names and tags', [S.steps(stay({ stage: 3 }))[3].label, S.steps(stay({ stage: 3 }))[3].tag, S.steps(stay({ stage: 3 }))[0].tag, S.steps(stay({ stage: 3 }))[5].tag], ['Checkout reminder', 'Now', 'Done', '']);
eq('six steps, in the journey order', S.STEPS, ['Booked', 'Reminder sent', 'Checked in', 'Checkout reminder', 'Checked out', 'Thanked']);

// selection and arrow keys
const ids = ['a', 'b', 'c'];
eq('down moves to the next stay', S.neighbour(ids, 'a', 1), 'b');
eq('up from the first stays on the first', S.neighbour(ids, 'a', -1), 'a');
eq('down from the last stays on the last', S.neighbour(ids, 'c', 1), 'c');
eq('an unknown selection goes to the first stay', S.neighbour(ids, 'zzz', 1), 'a');
eq('an empty list has no neighbour', S.neighbour([], 'a', 1), null);
eq('the selection stays when it is still listed', S.keepSelection(ids, 'b'), 'b');
eq('a filtered-out selection falls back to the first listed stay', S.keepSelection(['x', 'y'], 'b'), 'x');
eq('nothing listed means nothing selected', S.keepSelection([], 'b'), null);

// the hotel's checkout time, read from free text (the same table is used on the bot's side)
const TIMES = [['12:00 noon', 720], ['12:00 PM', 720], ['12 noon', 720], ['noon', 720], ['midday', 720], ['', 720], [undefined, 720], ['11am', 660], ['11:00 AM', 660], ['11.30 a.m.', 690],
  ['2pm', 840], ['2:30 PM', 870], ['12:00 AM', 0], ['12:30 PM', 750], ['12:30 AM', 30], ['10:30', 630], ['25:00', 720], ['9:99', 720], ['by 12:00 noon', 720], ['Checkout is 1 PM', 780]];
eq('checkout times in free text are read correctly', TIMES.map(([t]) => S.deadlineMinutes(t)), TIMES.map(([, m]) => m));
eq('"HH:MM" from the dashboard clock becomes minutes', [S.minutesOf('12:30'), S.minutesOf('02:05'), S.minutesOf(''), S.minutesOf('x')], [750, 125, 0, 0]);

// who is overdue: checked in and past the checkout time (plus 30 minutes), or still checked in after the checkout day
const OD = (o, now, deadline = 720, today = T) => S.overdue(stay(o), today, now, deadline);
eq('not overdue until 30 minutes after the checkout time (12:29 no, 12:30 yes)', [OD({ stage: 2, out: T }, 749), OD({ stage: 2, out: T }, 750)], [false, true]);
eq('a guest who was sent the checkout reminder (stage 3) is overdue too', OD({ stage: 3, out: T }, 800), true);
eq('a stay that has not checked in is never "overdue for checkout"', [OD({ stage: 0, out: T }, 900), OD({ stage: 1, out: T }, 900)], [false, false]);
eq('a guest already checked out or thanked is not overdue', [OD({ stage: 4, out: T }, 900), OD({ stage: 5, out: T }, 900)], [false, false]);
eq('still checked in after the checkout DAY is overdue at any time of day', OD({ stage: 2, out: '2026-11-23' }, 60), true);
eq('leaving tomorrow is not overdue', OD({ stage: 2, out: '2026-11-25' }, 900), false);
eq('an 11am hotel flags at 11:30, not before', [OD({ stage: 2, out: T }, 689, 660), OD({ stage: 2, out: T }, 690, 660)], [false, true]);
eq('the grace is 30 minutes', S.GRACE, 30);

console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
