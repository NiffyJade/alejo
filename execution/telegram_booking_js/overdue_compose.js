// "Compose overdue alert" (Scheduler, part J): tell the staff group, ONCE per stay, about guests still marked "checked in" after the hotel's
// checkout time. Runs every 15 minutes; the input items are the stays due out today that have not been announced yet (the next node stamps them).
// Nothing is sent before the checkout time plus 30 minutes, and nobody is checked out by this: staff decide. The same rule (and the same
// reading of "12:00 noon" or "11am") is in website/app/stay-core.js, which colours the stay red on the dashboard; both are tested on one table.
const c = $('Context').first().json, s = c.settings || {};
const deadlineMinutes = (text) => {
  const m = /(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?|noon|midday)?/i.exec(String(text || ''));
  if (!m) return 720;                                         // "noon", "midday" or nothing readable: 12:00
  let h = Number(m[1]); const min = m[2] ? Number(m[2]) : 0, w = (m[3] || '').toLowerCase().replace(/\./g, '');
  if (w === 'pm' && h < 12) h += 12;
  if (w === 'am' && h === 12) h = 0;
  return h > 23 || min > 59 ? 720 : h * 60 + min;
};
const GRACE = 30;
if ((Number(c.mins) || 0) < deadlineMinutes(s.CHECKOUT_TIME) + GRACE) return [];
const rows = $input.all().map(i => i.json).filter(r => r && r.id);
if (!rows.length) return [];
const when = s.CHECKOUT_TIME || 'midday';
const line = r => `• ${(r.guests && r.guests.name) || 'A guest'} (${r.room_type || 'room'}${r.room_number ? ', room ' + r.room_number : ''})`;
return [{ json: { ids: rows.map(r => r.id),
  text: `⏰ Past checkout time (${when})\n${rows.map(line).join('\n')}\n\n` +
    `${rows.length === 1 ? 'This guest is' : 'These guests are'} still marked as checked in. If they have left, check them out in the Alejo dashboard. If they are staying on, tell the front desk.` } }];
