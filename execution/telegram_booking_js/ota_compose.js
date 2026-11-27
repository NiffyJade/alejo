// "Compose Booking.com update" (Scheduler, part K): tell the staff group which room counts to change on Booking.com.
// The input is ota_check() (sql/031): { enabled, first, today, changes: [{ room_type, night, rooms, was }], tonight }.
// Nights in a row with the same new count become one line. At most MAX lines go in one message; the rest come in the next run
// (they stay "not told" because only what is in the message is marked as told by the next node, ota_mark).
const r = $input.first().json || {};
const MAX = 25;
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (iso) => { const d = new Date(iso + 'T00:00:00Z'); return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
const next = (iso) => new Date(Date.parse(iso + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
const rooms = (n) => (n === 0 ? '0 rooms (close it)' : n === 1 ? '1 room' : `${n} rooms`);

if (!r.enabled) return [];

if (r.first) {
  const tonight = (r.tonight || []).map((x) => `• ${x.room_type}: ${rooms(Number(x.rooms))}`).join('\n');
  return [{ json: { items: [], text:
    `🏨 Booking.com room counts: on\n` +
    `From now on Alejo tells you here whenever a room count on Booking.com needs changing, with the exact number to set.\n\n` +
    (tonight ? `Free in Alejo tonight:\n${tonight}\n\nIf Booking.com shows different numbers now, set these once.\n\n` : '') +
    `When a booking comes from Booking.com, add it in Alejo with the source "Booking.com". Alejo then knows Booking.com already counted it.` } }];
}

const ch = (r.changes || []).filter((c) => c && c.room_type && c.night && c.rooms != null)
  .map((c) => ({ room_type: String(c.room_type), night: String(c.night).slice(0, 10), rooms: Number(c.rooms) }))
  .sort((a, b) => (a.room_type === b.room_type ? (a.night < b.night ? -1 : 1) : a.room_type < b.room_type ? -1 : 1));
if (!ch.length) return [];

// nights in a row, same room type, same new count: one line
const runs = [];
for (const c of ch) {
  const last = runs[runs.length - 1];
  if (last && last.room_type === c.room_type && last.rooms === c.rooms && next(last.to) === c.night) { last.to = c.night; last.items.push(c); }
  else runs.push({ room_type: c.room_type, rooms: c.rooms, from: c.night, to: c.night, items: [c] });
}
const shown = runs.slice(0, MAX), rest = runs.length - shown.length;
const line = (x) => `• ${x.room_type}, ${x.from === x.to ? day(x.from) : day(x.from) + ' – ' + day(x.to)}: ${rooms(x.rooms)}`;
return [{ json: {
  items: shown.flatMap((x) => x.items),
  text: `🏨 Booking.com: change these room counts\n${shown.map(line).join('\n')}` +
    (rest > 0 ? `\n…and ${rest} more, in the next message.` : '') +
    `\n\nThese are the rooms Alejo has free (nights, not checkout days). Set the same numbers on Booking.com (extranet or the Pulse app, Rates & availability).` } }];
