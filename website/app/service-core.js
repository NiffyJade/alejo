/* Alejo dashboard: bookings for services (event hall, gym, pool ...), the rules. No screen code, so it is tested in Node (execution/test_service.js).
   The database (sql/025_services.sql) is the judge of what can be booked; these rules only help the screen fill the form in and warn early.
   A booking holds WHOLE DAYS, first and last day both included. What the price is "per" decides how the last day and the amount follow the quantity. */
(function (root) {
  'use strict';
  const DAY = 86400000;
  const toNum = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY;
  const fromNum = (n) => new Date(n * DAY).toISOString().slice(0, 10);
  const addDays = (s, n) => fromNum(toNum(s) + n);

  // the same date next month, or the last day of that month when it has no such day (31 Jan + 1 month = 28/29 Feb)
  const addMonths = (s, n) => {
    const y = +s.slice(0, 4), m = +s.slice(5, 7) - 1, d = +s.slice(8, 10);
    const t = y * 12 + m + n, ny = Math.floor(t / 12), nm = ((t % 12) + 12) % 12;
    const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
    return fromNum(Date.UTC(ny, nm, Math.min(d, last)) / DAY);
  };

  // words for the form: what the price is per, and what to ask for ("how many ...")
  const UNITS = {
    per_event: { per: 'per event', one: 'event', many: 'events', ask: 'How many events' },
    per_day:   { per: 'per day', one: 'day', many: 'days', ask: 'How many days' },
    per_head:  { per: 'per head', one: 'person', many: 'people', ask: 'How many people' },
    per_month: { per: 'per month', one: 'month', many: 'months', ask: 'How many months' },
    per_visit: { per: 'per visit', one: 'visit', many: 'visits', ask: 'How many visits' },
  };
  const unitOf = (u) => UNITS[u] || UNITS.per_event;
  const countWord = (u, n) => n + ' ' + (n === 1 ? unitOf(u).one : unitOf(u).many);

  // does the form ask for a quantity, and does the quantity decide the last day?
  const asksQuantity = (unit) => unit !== 'per_event';
  const quantityMakesEnd = (unit) => unit === 'per_day' || unit === 'per_month';
  const asksEndDate = (unit) => unit === 'per_event';                      // an event can last several days; everything else is one day or follows the quantity
  const asksTimes = (unit) => unit === 'per_event';

  // the last day of a booking
  const endFor = (unit, start, qty, endInput) => {
    if (!start) return '';
    const q = Math.max(1, Math.floor(Number(qty) || 1));
    if (unit === 'per_day') return addDays(start, q - 1);
    if (unit === 'per_month') return addDays(addMonths(start, q), -1);
    if (unit === 'per_event') return endInput && endInput >= start ? endInput : start;
    return start;
  };

  // the amount the form starts with (staff may change it for a negotiated price)
  const amountFor = (price, qty) => Math.round((Number(price) || 0) * Math.max(1, Math.floor(Number(qty) || 1)) * 100) / 100;

  // does a booking cover this date?
  const covers = (b, d) => b.start <= d && d <= b.end;

  // the first booking that blocks an exclusive service on these days, or null
  const clashFor = (bookings, serviceId, start, end) => {
    const hit = (bookings || []).filter((b) => b.serviceId === serviceId && b.start <= end && b.end >= start).sort((a, b) => a.start.localeCompare(b.start))[0];
    return hit || null;
  };

  // how much is still owed
  const owed = (b) => Math.max(0, (Number(b.amount) || 0) - (Number(b.paid) || 0));

  const api = { addDays, addMonths, UNITS, unitOf, countWord, asksQuantity, quantityMakesEnd, asksEndDate, asksTimes, endFor, amountFor, covers, clashFor, owed };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.AlejoSvc = api;
})(typeof window !== 'undefined' ? window : globalThis);
