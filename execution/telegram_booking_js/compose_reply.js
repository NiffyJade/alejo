// "Compose reply": decide what to say. Booking and availability answers come ONLY from live room data (the Availability RPC
// items arriving here); the AI never states availability. Everything else passes through the knowledge-base answer.
// __LANG__
const p = $('Plan booking').first().json;
const rows = $input.all().map(i => i.json).filter(r => r && r.room_type);
const d = { ...p.draft_new };
const lang = p.lang || 'en';
const T = (key, ...a) => tr(lang, key, ...a);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmt = (s, year) => { const t = new Date(Date.parse(s)); return `${DAY[t.getUTCDay()]} ${t.getUTCDate()} ${MON[t.getUTCMonth()]}${year ? ' ' + t.getUTCFullYear() : ''}`; };
const hasRate = r => r !== null && r !== undefined;

let reply = p.reply, escalate = p.escalate, ai = p.ai_answered, markup = 'none', confirm = '';

if (p.booking_flow) {
  escalate = false; ai = true;
  const name = p.guest_name || d.guest_name;               // a linked guest's own name and number win
  const phone = p.guest_phone || d.phone;
  const range = d.check_in && d.check_out ? `${fmt(d.check_in)} to ${fmt(d.check_out)}` : '';
  const line = r => `• ${r.room_type}${hasRate(r.nightly_rate) ? ': ' + NGN(r.nightly_rate) + ' naira per night' + (p.nights > 1 ? ' (about ' + NGN(r.nightly_rate * p.nights) + ' for ' + nt(p.nights) + ')' : '') : ''}`;

  if (p.draft_cleared) {
    reply = T('cleared');
  } else if (p.long_stay) {
    reply = T('long_stay');
    escalate = true;
  } else if (p.problem) {
    reply = p.problem === 'past' ? T('past', p.problem_arg) : T('order');
  } else if (!d.check_in) {
    reply = T('ask_dates');
  } else if (!d.check_out) {
    reply = T('ask_checkout', fmt(d.check_in));
  } else if (!rows.length) {
    reply = T('lookup_failed');
    escalate = true;
  } else {
    const avail = rows.filter(r => r.available_rooms > 0);
    // for a plain availability question, only look at one room type if the guest named it in this message
    const wanted = p.intent === 'book' || p.room_type_said ? d.room_type : null;
    const want = wanted ? rows.find(r => r.room_type === wanted) : null;
    const pre = p.unknown_room ? T('unknown_room', p.unknown_room) : '';
    if (!avail.length) {
      d.room_type = null;
      reply = T('none_free', pre, range);
    } else if (want && want.available_rooms < 1) {
      d.room_type = null;
      reply = T('type_sold', want.room_type, range, avail.map(line).join('\n'));
    } else if (!want) {
      reply = T('list', pre, p.nights, range, avail.map(line).join('\n'));
    } else if (p.intent === 'availability') {
      reply = T('good_news', want.room_type, p.nights, range, want.nightly_rate, hasRate(want.nightly_rate) ? want.nightly_rate * p.nights : null);
    } else if (!name) {
      reply = T('ask_name', want.room_type, range);
    } else if (!phone) {
      reply = T('ask_phone', name);
      markup = 'phone';
    } else {
      const money = hasRate(want.nightly_rate) ? T('money', want.nightly_rate, want.nightly_rate * p.nights) : '';
      reply = T('summary', want.room_type, p.hotel, fmt(d.check_in, true), fmt(d.check_out, true), p.nights, `${name}, ${phone}`, money);
      markup = 'confirm';
      confirm = `${d.check_in}|${d.check_out}|${d.room_type.slice(0, 20)}`;
    }
  }
}

if (p.booking_flow && p.info_answer && !p.draft_cleared) reply = p.info_answer + '\n\n' + reply;   // answer to a side question asked in the same message

const row = { chat_id: p.chat_id, check_in: d.check_in, check_out: d.check_out, room_type: d.room_type,
  guest_name: d.guest_name, phone: d.phone, phone_verified: !!d.phone_verified, lang, updated_at: new Date().toISOString() };
return [{ json: { chat_id: p.chat_id, guest_id: p.guest_id || null, booking_id: p.booking_id || null, room: p.room,
  guest_name: p.guest_name || (p.from_name ? p.from_name + ' (not linked to a booking)' : 'Unknown guest'),
  question: p.question, reply, escalate, ai_answered: ai, markup, confirm_data: confirm,
  save_draft: !!(p.booking_flow || p.draft_changed), draft_row: row } }];
