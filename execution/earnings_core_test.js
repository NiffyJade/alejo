// Offline tests for website/app/earnings-core.js.   node execution/earnings_core_test.js
const E = require('../website/app/earnings-core.js');
let fails = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL', msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg + ' (got ' + JSON.stringify(a) + ', wanted ' + JSON.stringify(b) + ')');

// periods: Friday 27 Nov 2026
eq(E.presetRange('today', '2026-11-27'), { from: '2026-11-27', to: '2026-11-27' }, 'today');
eq(E.presetRange('week', '2026-11-27'), { from: '2026-11-23', to: '2026-11-27' }, 'the week starts on Monday');
eq(E.presetRange('week', '2026-11-23'), { from: '2026-11-23', to: '2026-11-23' }, 'on a Monday the week is one day');
eq(E.presetRange('week', '2026-11-29'), { from: '2026-11-23', to: '2026-11-29' }, 'Sunday ends the week');
eq(E.presetRange('month', '2026-11-27'), { from: '2026-11-01', to: '2026-11-27' }, 'month to date');
eq(E.presetRange('year', '2026-11-27'), { from: '2026-01-01', to: '2026-11-27' }, 'year to date');
eq(E.chartRange({ from: '2026-11-27', to: '2026-11-27' }), { from: '2026-11-14', to: '2026-11-27', focus: '2026-11-27' }, 'one day is drawn inside its fortnight');
eq(E.grainFor('2026-11-01', '2026-11-27'), 'day', 'a month is drawn by day');
eq(E.grainFor('2026-09-01', '2026-11-27'), 'week', 'a quarter by week');
eq(E.grainFor('2026-01-01', '2026-11-27'), 'month', 'a year by month');
eq(E.add('2026-03-28', 2), '2026-03-30', 'adding days across a clock change');
eq(E.rangeLabel('2026-11-01', '2026-11-27'), '1–27 Nov', 'range in one month');
eq(E.rangeLabel('2026-10-05', '2026-11-01'), '5 Oct – 1 Nov', 'range over two months');
eq(E.rangeLabel('2025-12-20', '2026-01-02'), '20 Dec 2025 – 2 Jan 2026', 'range over two years');

// grouping keeps every naira
const s = E.sample('2026-01-01', '2026-11-27');
for (const g of ['day', 'week', 'month']) {
  const b = E.bucket(s.series, g);
  ok(b.reduce((a, x) => a + x.received, 0) === s.totals.received, g + ': received adds up');
  ok(b.reduce((a, x) => a + x.rooms, 0) === s.totals.rooms_value, g + ': room sales add up');
  ok(b.reduce((a, x) => a + x.days, 0) === s.days, g + ': every day is in one bucket');
}
const months = E.bucket(s.series, 'month');
eq(months.length, 11, 'January to November');
ok(months[10].partial && !months[9].partial, 'only the running month is partial');
const weeks = E.bucket(E.sample('2026-09-01', '2026-11-27').series, 'week');
ok(weeks[0].partial && weeks[0].from === '2026-09-01' && weeks[0].key === '2026-08-31', 'a week cut by the start is marked partial and keyed by its Monday');
eq(weeks[1].days, 7, 'whole weeks have 7 days');

// sample: the splits are the totals
const sum = (l) => l.reduce((a, x) => a + x.amount, 0);
ok(sum(s.by_method) === s.totals.received, 'methods add up to received');
ok(sum(s.by_source) === s.totals.rooms_value, 'channels add up to room sales');
ok(sum(s.by_room_type) === s.totals.rooms_value, 'room types add up to room sales');
ok(sum(s.by_service) === s.totals.services_value, 'services add up');
ok(s.by_kind.rooms + s.by_kind.services === s.totals.received, 'rooms + services received = received');
ok(s.by_room_type.reduce((a, x) => a + x.nights, 0) === s.totals.nights_sold, 'nights by type add up');
const a = E.sample('2026-11-01', '2026-11-27'), b2 = E.sample('2026-11-20', '2026-11-27');
ok(a.series.find((r) => r.d === '2026-11-25').received === b2.series.find((r) => r.d === '2026-11-25').received, 'a day has the same figures in any period');
const p = E.sample('2026-10-05', '2026-10-31');
ok(p.totals.received === a.previous.received, 'the previous period is the same days asked for directly');
const occ = E.rates(s.totals).occupancy;
ok(occ > 0.3 && occ < 0.95, 'sample occupancy is believable: ' + occ);

ok(s.by_source.reduce((a, x) => a + x.nights, 0) === s.totals.nights_sold, 'nights by channel add up');

// changes
eq(E.change(110, 100), { text: '+10%', tone: 'good' }, 'up is good');
eq(E.change(95, 100), { text: '−5%', tone: 'bad' }, 'down is bad, with a real minus');
eq(E.change(100.04, 100), { text: "no change", tone: "flat" }, "a rounding wobble is no change");
eq(E.change(100.4, 100), { text: "+0.4%", tone: "good" }, "a small real rise is shown");
eq(E.change(1045, 1000), { text: '+4.5%', tone: 'good' }, 'small changes keep one decimal');
eq(E.change(5, 0), { text: 'new', tone: 'flat' }, 'from zero is new, not infinite');
eq(E.change(0, 0), { text: 'no change', tone: 'flat' }, 'zero to zero');
eq(E.change(null, 3), { text: '–', tone: 'none' }, 'nothing to compare');
eq(E.change(0.62, 0.58, 'pts'), { text: '+4 pts', tone: 'good' }, 'occupancy moves in points');

// axis
eq(E.niceTicks(0), [0, 1], 'an empty chart still has a scale');
eq(E.niceTicks(1830000), [0, 500000, 1000000, 1500000, 2000000], 'round steps, top above the max');
eq(E.niceTicks(2000000), [0, 500000, 1000000, 1500000, 2000000, 2500000], 'the top tick is never the max itself');
eq(E.niceTicks(90), [0, 25, 50, 75, 100], 'quarter steps');

// words
eq(E.money(1234567.4), '₦1,234,567', 'money');
eq(E.money(-5000), '−₦5,000', 'a refund');
eq(E.moneyShort(1250000), '₦1.3m', 'short millions');
eq(E.moneyShort(250000), '₦250k', 'short thousands');
eq(E.moneyShort(0), '₦0', 'short zero');
eq(E.methodName('POS'), 'POS (card)', 'POS');
eq(E.methodName('opay'), 'Opay', 'unknown methods are capitalised');
eq(E.sourceName('walk-in'), 'Walk-in', 'channel names');

console.log(fails ? fails + ' of ' + n + ' FAILED' : 'ALL ' + n + ' PASS');
process.exit(fails ? 1 : 0);
