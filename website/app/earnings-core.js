/* Alejo dashboard: Earnings, the parts with no screen in them (periods, grouping, rates, changes, axis steps, sample figures).
   Used by earnings.js in the browser and by execution/earnings_core_test.js in Node. Dates are 'YYYY-MM-DD' strings in the hotel's
   own time zone; arithmetic on them is done on whole UTC days so a clock change can never move a day. */
(function (root) {
  'use strict';
  const DAY = 86400000;
  const dnum = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY;
  const iso = (n) => new Date(n * DAY).toISOString().slice(0, 10);
  const add = (s, k) => iso(dnum(s) + k);
  const span = (from, to) => dnum(to) - dnum(from) + 1;
  const weekday = (s) => (new Date(dnum(s) * DAY).getUTCDay() + 6) % 7;      // Monday 0 ... Sunday 6

  /* ---------- periods ---------- */
  const PRESETS = ['today', 'week', 'month', 'year'];
  const presetRange = (preset, today) => {
    if (preset === 'today') return { from: today, to: today };
    if (preset === 'week') return { from: add(today, -weekday(today)), to: today };
    if (preset === 'month') return { from: today.slice(0, 8) + '01', to: today };
    if (preset === 'year') return { from: today.slice(0, 5) + '01-01', to: today };
    throw new Error('unknown period ' + preset);
  };
  // one day has nothing to draw over time, so its chart shows the fortnight that ends with it
  const chartRange = (r) => (r.from === r.to ? { from: add(r.to, -13), to: r.to, focus: r.to } : { from: r.from, to: r.to, focus: null });
  const grainFor = (from, to) => { const n = span(from, to); return n <= 31 ? 'day' : n <= 120 ? 'week' : 'month'; };

  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const dayLabel = (s) => +s.slice(8, 10) + ' ' + MON[+s.slice(5, 7) - 1];
  const longDay = (s) => WD[weekday(s)] + ' ' + dayLabel(s);
  const rangeLabel = (from, to) => {
    if (from === to) return longDay(from);
    const sameYear = from.slice(0, 4) === to.slice(0, 4);
    if (sameYear && from.slice(5, 7) === to.slice(5, 7)) return +from.slice(8, 10) + '–' + dayLabel(to);
    return dayLabel(from) + (sameYear ? '' : ' ' + from.slice(0, 4)) + ' – ' + dayLabel(to) + (sameYear ? '' : ' ' + to.slice(0, 4));
  };

  /* ---------- grouping the daily rows ---------- */
  const FIELDS = ['received', 'rooms', 'services', 'nights'];
  const bucket = (series, grain) => {
    const out = [];
    for (const r of series) {
      const key = grain === 'day' ? r.d : grain === 'week' ? add(r.d, -weekday(r.d)) : r.d.slice(0, 7);
      let b = out[out.length - 1];
      if (!b || b.key !== key) {
        b = { key, from: r.d, to: r.d, days: 0, received: 0, rooms: 0, services: 0, nights: 0 };
        out.push(b);
      }
      b.to = r.d; b.days += 1;
      for (const f of FIELDS) b[f] += Number(r[f]) || 0;
    }
    for (const b of out) {
      b.label = grain === 'day' ? dayLabel(b.from) : grain === 'week' ? dayLabel(b.key) : MON[+b.key.slice(5, 7) - 1];
      b.title = grain === 'day' ? longDay(b.from) : grain === 'week' ? 'Week of ' + dayLabel(b.key) : MON[+b.key.slice(5, 7) - 1] + ' ' + b.key.slice(0, 4);
      const full = grain === 'day' ? 1 : grain === 'week' ? 7 : new Date(Date.UTC(+b.key.slice(0, 4), +b.key.slice(5, 7), 0)).getUTCDate();
      b.partial = b.days < full;                                    // a week or month cut by the period's edge
    }
    return out;
  };

  /* ---------- the hotel's ratios ---------- */
  const rates = (t) => ({
    occupancy: t.room_nights ? t.nights_sold / t.room_nights : null,
    adr: t.nights_sold ? t.rooms_value / t.nights_sold : null,
    revpar: t.room_nights ? t.rooms_value / t.room_nights : null,
  });

  /* A change against the period before. More money and fuller rooms are good, so up is good for every figure here.
     Nothing to compare with gives a grey dash; growth from zero says "new" instead of an infinite percentage. */
  const change = (cur, prev, kind) => {
    if (cur == null || prev == null) return { text: '–', tone: 'none' };
    if (kind === 'pts') {
      const d = Math.round((cur - prev) * 100);
      return d === 0 ? { text: 'no change', tone: 'flat' } : { text: (d > 0 ? '+' : '−') + Math.abs(d) + ' pts', tone: d > 0 ? 'good' : 'bad' };
    }
    if (prev === 0) return cur === 0 ? { text: 'no change', tone: 'flat' } : { text: 'new', tone: 'flat' };
    const p = ((cur - prev) / Math.abs(prev)) * 100;
    const r = Math.abs(p) < 10 ? Math.round(p * 10) / 10 : Math.round(p);
    if (r === 0) return { text: 'no change', tone: 'flat' };
    return { text: (r > 0 ? '+' : '−') + Math.abs(r) + '%', tone: r > 0 ? 'good' : 'bad' };
  };

  /* ---------- axis steps: round, even, the top one above the largest bar ---------- */
  const niceTicks = (max, want = 4) => {
    if (!(max > 0)) return [0, 1];
    const raw = max / want, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    const ticks = [];
    for (let v = 0; v <= max + step * 0.999; v += step) ticks.push(Math.round(v));
    if (ticks[ticks.length - 1] <= max) ticks.push(Math.round(ticks[ticks.length - 1] + step));
    return ticks;
  };

  /* ---------- words and money ---------- */
  const NGN = (n) => '₦' + Math.round(Number(n) || 0).toLocaleString('en-NG');
  const money = (n) => (n < 0 ? '−' : '') + NGN(Math.abs(n));
  const moneyShort = (n) => {
    const a = Math.abs(n), s = n < 0 ? '−₦' : '₦';
    if (a >= 1e6) return s + (Math.round(a / 1e5) / 10).toString().replace(/\.0$/, '') + 'm';
    if (a >= 1e3) return s + (Math.round(a / 100) / 10).toString().replace(/\.0$/, '') + 'k';
    return s + Math.round(a);
  };
  const METHOD = { cash: 'Cash', transfer: 'Bank transfer', 'bank transfer': 'Bank transfer', pos: 'POS (card)', card: 'Card', 'not recorded': 'Method not recorded', 'recorded at booking': 'Paid at booking' };
  const SOURCE = { telegram: 'Telegram (Alejo)', phone: 'Phone call', 'walk-in': 'Walk-in', 'booking.com': 'Booking.com', online: 'Online', other: 'Other or not set' };
  const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
  const methodName = (m) => METHOD[String(m || '').toLowerCase()] || cap(m);
  const sourceName = (s) => SOURCE[String(s || '').toLowerCase()] || cap(s);

  /* ---------- sample figures for the public demo (BrightSide Hotel, 19 rooms) ----------
     Built day by day from a seeded generator, so the same day always has the same figures whatever period is asked for,
     and every total, split and comparison is a sum of the days: nothing is typed in separately. */
  const ROOMS = [{ name: 'Standard', rate: 35000, total: 10 }, { name: 'Deluxe', rate: 55000, total: 6 }, { name: 'Suite', rate: 95000, total: 3 }];
  const ROOMS_ON_SALE = ROOMS.reduce((s, r) => s + r.total, 0);
  const rnd = (n, k) => { let x = Math.sin(n * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
  const sampleDay = (d) => {
    const n = dnum(d), wd = weekday(d), season = 0.85 + 0.15 * Math.sin((n / 365) * 2 * Math.PI + 1.2);
    const busy = (wd >= 4 ? 0.82 : wd === 0 ? 0.5 : 0.62) * season;
    const byType = ROOMS.map((r, i) => Math.min(r.total, Math.round(r.total * Math.min(1, busy * (0.75 + 0.5 * rnd(n, i + 1))))));
    const rooms = byType.reduce((s, k, i) => s + k * ROOMS[i].rate, 0);
    const svc = [];
    if (rnd(n, 7) < 0.11) svc.push(['Event hall', 250000]);
    const heads = wd >= 5 ? Math.round(4 + 10 * rnd(n, 8)) : Math.round(3 * rnd(n, 8));
    if (heads) svc.push(['Pool', heads * 3000]);
    const passes = Math.round(4 * rnd(n, 9));
    if (passes) svc.push(['Gym day pass', passes * 2000]);
    if (rnd(n, 10) < 0.04) svc.push(['Gym membership', 18000]);
    const services = svc.reduce((s, x) => s + x[1], 0);
    const roomsPaid = Math.round((rooms * (0.78 + 0.34 * rnd(n, 11))) / 500) * 500;
    const split = [0.52, 0.28];                                     // transfer, POS; cash is what is left
    const m = { transfer: Math.round((roomsPaid * split[0]) / 500) * 500, pos: Math.round((roomsPaid * split[1]) / 500) * 500 };
    m.cash = roomsPaid - m.transfer - m.pos;
    m.pos += services;                                              // services are mostly paid on the spot, by card
    const src = [0.38, 0.24, 0.22];                                 // telegram, walk-in, phone; online is what is left
    const s = { telegram: Math.round(rooms * src[0]), 'walk-in': Math.round(rooms * src[1]), phone: Math.round(rooms * src[2]) };
    s.online = rooms - s.telegram - s['walk-in'] - s.phone;
    const nt = byType.reduce((a, b) => a + b, 0), sn = { telegram: Math.round(nt * src[0]), 'walk-in': Math.round(nt * src[1]), phone: Math.round(nt * src[2]) };
    sn.online = nt - sn.telegram - sn['walk-in'] - sn.phone;
    return { d, rooms, sn, services, received: roomsPaid + services, roomsPaid, nights: byType.reduce((a, b) => a + b, 0), byType, svc, m, s };
  };
  const sumBy = (rows, pick) => { const t = new Map(); for (const r of rows) for (const [k, v] of pick(r)) t.set(k, (t.get(k) || 0) + v); return t; };
  const listOf = (map, extra) => [...map].map(([name, amount]) => Object.assign({ name, amount }, extra ? extra(name) : {})).filter((x) => x.amount !== 0).sort((a, b) => b.amount - a.amount);
  const totalsOf = (days) => ({
    received: days.reduce((a, r) => a + r.received, 0), refunds: 0, payments: days.length * 3,
    rooms_value: days.reduce((a, r) => a + r.rooms, 0), nights_sold: days.reduce((a, r) => a + r.nights, 0), stays: Math.round(days.reduce((a, r) => a + r.nights, 0) / 2.1),
    services_value: days.reduce((a, r) => a + r.services, 0), room_nights: ROOMS_ON_SALE * days.length,
  });
  const sample = (from, to) => {
    const n = span(from, to), days = [], prev = [];
    for (let i = 0; i < n; i++) days.push(sampleDay(add(from, i)));
    for (let i = 0; i < n; i++) prev.push(sampleDay(add(from, i - n)));
    const nightsBy = sumBy(days, (r) => r.byType.map((k, i) => [ROOMS[i].name, k]));
    const svcCount = sumBy(days, (r) => r.svc.map((x) => [x[0], 1]));
    const owedTop = [
      { kind: 'stay', name: 'Ibrahim Musa', what: 'Suite', until: add(to, 2), owed: 190000 },
      { kind: 'service', name: 'Adeyemi wedding party', what: 'Event hall', until: add(to, -3), owed: 125000 },
      { kind: 'stay', name: 'Grace Eze', what: 'Deluxe', until: add(to, 1), owed: 55000 },
      { kind: 'stay', name: 'Tunde Bakare', what: 'Standard', until: to, owed: 35000 },
    ];
    return {
      sample: true, from, to, days: n, today: to, timezone: 'Africa/Lagos', rooms_on_sale: ROOMS_ON_SALE,
      totals: totalsOf(days), previous: Object.assign(totalsOf(prev), { from: add(from, -n), to: add(from, -1) }),
      series: days.map((r) => ({ d: r.d, received: r.received, rooms: r.rooms, services: r.services, nights: r.nights })),
      by_method: listOf(sumBy(days, (r) => Object.entries(r.m))),
      by_source: listOf(sumBy(days, (r) => Object.entries(r.s)), (name) => ({ nights: sumBy(days, (r) => Object.entries(r.sn)).get(name) })),
      by_room_type: listOf(sumBy(days, (r) => r.byType.map((k, i) => [ROOMS[i].name, k * ROOMS[i].rate])), (name) => ({ nights: nightsBy.get(name) })),
      by_service: listOf(sumBy(days, (r) => r.svc), (name) => ({ count: svcCount.get(name) })),
      by_kind: { rooms: days.reduce((a, r) => a + r.roomsPaid, 0), services: days.reduce((a, r) => a + r.services, 0) },
      owed: { total: owedTop.reduce((a, o) => a + o.owed, 0), count: owedTop.length, top: owedTop },
    };
  };

  const API = { DAY, dnum, iso, add, span, weekday, PRESETS, presetRange, chartRange, grainFor, dayLabel, longDay, rangeLabel, bucket, rates, change, niceTicks, money, moneyShort, methodName, sourceName, sample, ROOMS_ON_SALE };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.EarnCore = API;
})(typeof window !== 'undefined' ? window : globalThis);
