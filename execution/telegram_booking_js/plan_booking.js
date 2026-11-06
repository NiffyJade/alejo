// "Plan booking": merge what the guest just said into the booking draft and validate it.
// Output carries `rpc` (the date range to look up in the Availability RPC node that follows).
const a = $('Parse AI').first().json;
const today = a.today;
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const addDays = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmt = d => { const t = new Date(Date.parse(d)); return `${DAY[t.getUTCDay()]} ${t.getUTCDate()} ${MON[t.getUTCMonth()]}`; };

const old = a.draft || {};
const rooms = a.rooms || [];
const bookingIntent = a.intent === 'availability' || a.intent === 'book';
const hadDraft = !!(old.check_in || old.check_out || old.room_type || old.guest_name || old.phone);
const d = { check_in: old.check_in || null, check_out: old.check_out || null, room_type: old.room_type || null,
  guest_name: old.guest_name || null, phone: old.phone || null, phone_verified: !!old.phone_verified };
let cleared = false, unknownRoom = '', problem = '', problemArg = '', longStay = false;

if (a.intent === 'cancel_draft') {
  Object.assign(d, { check_in: null, check_out: null, room_type: null, guest_name: null, phone: null, phone_verified: false });
  cleared = true;
} else if (bookingIntent || hadDraft) {
  if (isDate(a.check_in)) d.check_in = a.check_in;
  if (isDate(a.check_out)) d.check_out = a.check_out;
  // a new arrival date that is not before the old departure date: the old departure no longer makes sense
  if (d.check_in && d.check_out && d.check_out <= d.check_in && !isDate(a.check_out)) d.check_out = null;
  if (a.room_type_said) {
    const rt = rooms.find(r => r.name.toLowerCase() === a.room_type_said.toLowerCase());
    if (rt) d.room_type = rt.name; else unknownRoom = a.room_type_said;
  }
  const nm = (a.name_said || '').replace(/\s+/g, ' ').slice(0, 80);
  if (nm.length >= 2 && !/\d/.test(nm)) d.guest_name = nm;
  if (!d.phone_verified && a.phone_said) {                 // a typed number; a number shared with the Telegram button is never overwritten
    let n = a.phone_said.replace(/\D/g, '');
    if (n.length === 11 && n[0] === '0') n = '234' + n.slice(1);
    if (n.length >= 10 && n.length <= 15) d.phone = '+' + n;
  }
}

if (d.check_in && d.check_in < today) {
  problem = 'past'; problemArg = fmt(d.check_in);
  d.check_in = null; d.check_out = null;
} else if (d.check_in && d.check_out && d.check_out <= d.check_in) {
  problem = 'order';
  d.check_out = null;
}
const nights = d.check_in && d.check_out ? Math.round((Date.parse(d.check_out) - Date.parse(d.check_in)) / 86400000) : 0;
if (nights > 30) {
  longStay = true;
  d.check_out = null;
}
const ready = !!(d.check_in && d.check_out);
const sameDraft = JSON.stringify([d.check_in, d.check_out, d.room_type, d.guest_name, d.phone, d.phone_verified]) ===
  JSON.stringify([old.check_in || null, old.check_out || null, old.room_type || null, old.guest_name || null, old.phone || null, !!old.phone_verified]);
return [{ json: { ...a, draft_new: d, draft_cleared: cleared, draft_changed: !sameDraft, booking_flow: bookingIntent || cleared,
  problem, problem_arg: problemArg, unknown_room: unknownRoom, long_stay: longStay, nights, ready,
  rpc: { p_check_in: ready ? d.check_in : today, p_check_out: ready ? d.check_out : addDays(today, 1), p_room_type: null } } }];
