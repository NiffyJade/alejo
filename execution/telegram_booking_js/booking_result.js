// "Booking result": turn the telegram_book_room answer into the message for the guest (and an alert for staff; staff text stays English).
// __LANG__
const c = $('Classify').first().json;
const lang = ($('Check confirm').first().json || {}).lang || 'en';
const r = $input.first().json || {};
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmt = s => { const t = new Date(Date.parse(s)); return `${DAY[t.getUTCDay()]} ${t.getUTCDate()} ${MON[t.getUTCMonth()]} ${t.getUTCFullYear()}`; };
if (r.ok === true && r.booking_id) {
  const n = Number(r.nights);
  const total = r.rate !== null && r.rate !== undefined ? r.rate * n : 0;
  return [{ json: { text: tr(lang, 'booked', r.ref, r.room_type, fmt(r.check_in), fmt(r.check_out), n, total),
    staff: `📱 New Telegram booking\nRef: ${r.ref}\nGuest: ${r.guest_name}${r.guest_phone ? ' (' + r.guest_phone + ')' : ''}\n${r.room_type}, ${r.check_in} to ${r.check_out} (${n} night${n === 1 ? '' : 's'})` } }];
}
if (r.reason === 'sold_out') return [{ json: { text: tr(lang, 'sold_out', r.room_type), staff: '' } }];
if (['dates', 'room_type', 'name', 'limit'].includes(r.reason)) return [{ json: { text: tr(lang, r.reason), staff: '' } }];
return [{ json: { text: tr(lang, 'failed'),
  staff: `⚠️ Telegram booking FAILED to save\nChat: ${c.chat_id}\nPlease contact the guest. Their details are in the booking_drafts table.` } }];
