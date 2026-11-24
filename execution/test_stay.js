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

console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
