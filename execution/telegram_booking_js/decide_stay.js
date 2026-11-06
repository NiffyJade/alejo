// "Decide": handle a Check in / Check out tap. The booking arrives either from the inline button (Load booking, found by id)
// or from the menu button / typed "check in" (Pick my booking, found by the guest's chat). Settings rows arrive as the input.
const c = $('Classify').first().json;
let b = {};
for (const n of ['Load booking', 'Pick my booking']) {
  try { const j = $(n).first().json; if (j && j.id) { b = j; break; } } catch (e) { /* that path did not run */ }
}
const s = Object.fromEntries($input.all().map(i => [i.json.key, (i.json.value || '').trim()]));
const today = new Date(Date.now() + 3600 * 1000).toISOString().slice(0, 10);   // Africa/Lagos (UTC+1)
const res = (text, patch) => [{ json: { chat_id: c.chat_id, text, patch: patch || null, booking_id: b.id || c.booking_id } }];
if (!b.id || !b.guests || Number(b.guests.telegram_chat_id) !== Number(c.chat_id))
  return res(c.type === 'menu' && c.action === 'checkout'
    ? "I can't find a stay in progress to check you out of. If you have already checked out, thank you for staying with us!"
    : c.type === 'menu'
    ? "I couldn't find a booking for you yet. Tell me the dates you would like and I'll check rooms for you. If you booked by phone, tap \"My booking\" and share the phone number you used."
    : "Sorry, I couldn't find that booking for this chat. Please contact the front desk.");
const now = new Date().toISOString();
if (c.action === 'checkin') {
  if (b.status === 'cancelled' || b.status === 'checked_out') return res('This booking is no longer active. Please contact the front desk.');
  if (today < b.check_in) return res(`Check-in opens on ${b.check_in}. Tap Check in again then and I'll send your stay code.`);
  const lines = ["✅ You're checked in!", b.room_number ? `Room: ${b.room_number}` : 'Your room number will be confirmed by the front desk.',
    `Your private stay code: ${b.stay_code}`];
  if (s.WIFI_NAME && s.WIFI_PASSWORD) lines.push(`Wi-Fi: ${s.WIFI_NAME} / ${s.WIFI_PASSWORD}`);
  lines.push('Keep this code private. Message me any time if you need anything.');
  return res(lines.join('\n'), b.status === 'checked_in' ? null : { status: 'checked_in', checked_in_at: now });
}
if (c.action === 'checkout') {
  if (b.status === 'checked_out') return res("You're already checked out. Safe travels!");
  if (b.status !== 'checked_in') return res("I can't check you out because you haven't checked in yet. Please see the front desk.");
  return res(`Thank you for staying with us, ${b.guests.name}! You're checked out. Please settle any outstanding charges at the front desk and drop off your key. Safe travels!`,
    { status: 'checked_out', checked_out_at: now });
}
return res("Sorry, I didn't understand that button.");
