// Offline test of the service-booking rules (website/app/service-core.js). Usage:  node execution/test_service.js
const path = require('path');
const V = require(path.join(__dirname, '..', 'website', 'app', 'service-core.js'));
let fails = 0, n = 0;
const eq = (name, got, want) => { n++; const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n   got  ' + JSON.stringify(got) + '\n   want ' + JSON.stringify(want))); };

// months
eq('one month after the 24th is the 24th', V.addMonths('2026-11-24', 1), '2026-12-24');
eq('a month from 31 Jan lands on the last day of February, not in March', [V.addMonths('2027-01-31', 1), V.addMonths('2028-01-31', 1)], ['2027-02-28', '2028-02-29']);
eq('months cross the year', V.addMonths('2026-12-15', 2), '2027-02-15');

// the last day follows the unit
eq('a monthly membership ends the day before the same date next month', V.endFor('per_month', '2026-11-24', 1, ''), '2026-12-23');
eq('three months', V.endFor('per_month', '2026-11-24', 3, ''), '2027-02-23');
eq('a membership started on the 31st ends on the right last day', V.endFor('per_month', '2027-01-31', 1, ''), '2027-02-27');
eq('per day: 3 days starting the 24th end on the 26th', V.endFor('per_day', '2026-11-24', 3, ''), '2026-11-26');
eq('per day: one day is just that day', V.endFor('per_day', '2026-11-24', 1, ''), '2026-11-24');
eq('per head and per visit are one day', [V.endFor('per_head', '2026-11-24', 6, ''), V.endFor('per_visit', '2026-11-24', 2, '2026-12-30')], ['2026-11-24', '2026-11-24']);
eq('an event uses the end date typed, or the start day', [V.endFor('per_event', '2026-11-24', 1, '2026-11-26'), V.endFor('per_event', '2026-11-24', 1, ''), V.endFor('per_event', '2026-11-24', 1, '2026-11-20')], ['2026-11-26', '2026-11-24', '2026-11-24']);
eq('a nonsense quantity counts as one', [V.endFor('per_day', '2026-11-24', 0, ''), V.endFor('per_day', '2026-11-24', 'x', '')], ['2026-11-24', '2026-11-24']);
eq('no start date gives no end date', V.endFor('per_day', '', 3, ''), '');

// what each form asks for
eq('an event asks for end date and times, not a quantity', [V.asksQuantity('per_event'), V.asksEndDate('per_event'), V.asksTimes('per_event')], [false, true, true]);
eq('a pool (per head) asks for a quantity, one day, no times', [V.asksQuantity('per_head'), V.asksEndDate('per_head'), V.asksTimes('per_head'), V.quantityMakesEnd('per_head')], [true, false, false, false]);
eq('days and months let the quantity decide the end', [V.quantityMakesEnd('per_day'), V.quantityMakesEnd('per_month'), V.quantityMakesEnd('per_visit')], [true, true, false]);
eq('the question matches the unit', [V.unitOf('per_head').ask, V.unitOf('per_month').ask], ['How many people', 'How many months']);
eq('an unknown unit falls back to per event, no crash', V.unitOf('weird').per, 'per event');
eq('counting words', [V.countWord('per_head', 1), V.countWord('per_head', 4), V.countWord('per_month', 2)], ['1 person', '4 people', '2 months']);

// amounts
eq('amount = price x quantity', [V.amountFor(3000, 4), V.amountFor(250000, 1), V.amountFor(18000, 3)], [12000, 250000, 54000]);
eq('a free service is 0, and an odd quantity counts as one', [V.amountFor(0, 5), V.amountFor(3000, 0), V.amountFor(3000, 'x')], [0, 3000, 3000]);
eq('pennies are rounded', V.amountFor(33.333, 3), 100);

// clashes
const B = [
  { id: 'a', serviceId: 'hall', start: '2026-12-05', end: '2026-12-06' },
  { id: 'b', serviceId: 'hall', start: '2026-12-20', end: '2026-12-20' },
  { id: 'c', serviceId: 'pool', start: '2026-12-05', end: '2026-12-05' },
];
eq('the same day clashes', V.clashFor(B, 'hall', '2026-12-05', '2026-12-05').id, 'a');
eq('the last day of a booking still clashes', V.clashFor(B, 'hall', '2026-12-06', '2026-12-08').id, 'a');
eq('the day after is free', V.clashFor(B, 'hall', '2026-12-07', '2026-12-08'), null);
eq('the day before is free', V.clashFor(B, 'hall', '2026-12-03', '2026-12-04'), null);
eq('a long booking that swallows another clashes', V.clashFor(B, 'hall', '2026-12-01', '2026-12-31').id, 'a');
eq('another service is not in the way', V.clashFor(B, 'gym', '2026-12-05', '2026-12-05'), null);
eq('with several in the way the earliest is named', V.clashFor(B, 'hall', '2026-12-01', '2026-12-31').start, '2026-12-05');
eq('no bookings at all is fine', [V.clashFor([], 'hall', '2026-12-05', '2026-12-05'), V.clashFor(null, 'hall', '2026-12-05', '2026-12-05')], [null, null]);

// covers and owed
eq('covers includes both end days', [V.covers(B[0], '2026-12-05'), V.covers(B[0], '2026-12-06'), V.covers(B[0], '2026-12-07'), V.covers(B[0], '2026-12-04')], [true, true, false, false]);
eq('owed is amount minus paid, never negative', [V.owed({ amount: 100, paid: 30 }), V.owed({ amount: 100, paid: 130 }), V.owed({ amount: 0, paid: 0 })], [70, 0, 0]);

console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
