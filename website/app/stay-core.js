/* Alejo dashboard: Bookings, the rules behind the stay panel. No screen code, so it is tested in Node (execution/test_stay.js).
   A stay is at one of six journey stages (0 booked, 1 reminder sent, 2 checked in, 3 checkout reminder sent, 4 checked out, 5 thanked).
   Only two stage changes are made by a person: check in and check out. The reminders and the thank-you are sent by the scheduler,
   so the panel never offers buttons for them. */
(function (root) {
  'use strict';
  const STEPS = ['Booked', 'Reminder sent', 'Checked in', 'Checkout reminder', 'Checked out', 'Thanked'];

  // what the one main button does for this stay (null: nothing for a person to do)
  const primary = (b, today) => {
    if (b.stage >= 4) return null;
    if (b.stage >= 2) return { act: 'checkout', label: 'Check out guest', early: false };
    return b.in > today ? { act: 'checkin', label: 'Check in early', early: true } : { act: 'checkin', label: 'Check in guest', early: false };
  };

  // money on the stay: nothing recorded yet and fully paid look different from part paid
  const pay = (b) => {
    const total = Number(b.total) || 0, paid = Number(b.paid) || 0;
    if (!(total > 0)) return { state: 'none', paid, total, balance: 0, pct: 0 };
    const balance = Math.max(0, total - paid);
    return { state: paid >= total ? 'paid' : paid > 0 ? 'part' : 'unpaid', paid, total, balance, pct: Math.min(100, Math.round((paid / total) * 100)) };
  };

  // the one sentence a desk person needs about the stay code, and who it applies to
  const note = (b) => {
    if (b.stage >= 4) return { tone: 'done', text: 'This stay is over, so its stay code no longer works.' };
    if (b.linked === false) return { tone: 'warn', text: 'Booked by phone and not on Telegram, so there is no stay code. Check their ID and reference ' + b.ref + ' instead.' };
    return { tone: 'info', text: 'The stay code goes to the guest on Telegram from the day they check in. Ask for it before handing over a key.' };
  };

  // the vertical checklist: a thanked stay is finished, so every step is done
  const steps = (b) => STEPS.map((label, i) => {
    const state = b.stage >= 5 ? 'done' : i < b.stage ? 'done' : i === b.stage ? 'now' : 'todo';
    return { label, state, tag: state === 'now' ? 'Now' : state === 'done' ? 'Done' : '' };
  });

  // the row after the selected one, for the arrow keys (stays on the ends)
  const neighbour = (ids, current, delta) => {
    if (!ids.length) return null;
    const i = ids.indexOf(current);
    if (i < 0) return ids[0];
    return ids[Math.max(0, Math.min(ids.length - 1, i + delta))];
  };

  // the selection must always be a stay that is on screen: keep it if it still is, else the first one
  const keepSelection = (ids, current) => (ids.includes(current) ? current : ids[0] || null);

  const api = { STEPS, primary, pay, note, steps, neighbour, keepSelection };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.AlejoStay = api;
})(typeof window !== 'undefined' ? window : globalThis);
