// "Compose my booking": answer "what is my booking id?" / the My booking button, from the guest's real bookings.
// Never shows the private stay code (that is only sent at check-in).
const rows = $input.all().map(i => i.json).filter(r => r && r.id);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmt = s => { const t = new Date(Date.parse(s)); return `${DAY[t.getUTCDay()]} ${t.getUTCDate()} ${MON[t.getUTCMonth()]} ${t.getUTCFullYear()}`; };
if (!rows.length) {
  return [{ json: { markup: 'phone', text: "I can't see an upcoming booking linked to this chat. To book a room, just tell me your dates. " +
    "If you already booked by phone or with the hotel, tap the button below to share the phone number you used and I'll find it." } }];
}
const status = { booked: 'Booked', checked_in: 'Checked in' };
const blocks = rows.map(r => {
  const n = Math.round((Date.parse(r.check_out) - Date.parse(r.check_in)) / 86400000);
  return [`Reference: ${r.id.slice(0, 8).toUpperCase()}`,
    `${r.room_type || 'Room'}${r.room_number ? ' (room ' + r.room_number + ')' : ''}`,
    `${fmt(r.check_in)} to ${fmt(r.check_out)} (${n} night${n === 1 ? '' : 's'})`,
    `Status: ${status[r.status] || r.status}`].join('\n');
});
const tail = rows.some(r => r.status === 'booked') ? '\n\nWhen you arrive, tap Check in to get your private stay code.' : '';
return [{ json: { markup: 'menu', text: `📋 Your booking${rows.length > 1 ? 's' : ''}:\n\n${blocks.join('\n\n')}${tail}` } }];
