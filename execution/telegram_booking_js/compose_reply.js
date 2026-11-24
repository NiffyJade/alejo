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

// ---- other services (event hall, gym, pool ...). Everything said here comes from code and live data, never from the model.
// A guest who wants one gets a staff REQUEST (the team confirms any deposit and books it in the dashboard); the bot never books a service.
let staffQuestion = '', svcKind = false;
if (p.intent === 'service' && p.svc_plan) {
  const sp = p.svc_plan, svc = sp.svc, names = (p.services || []).map(x => x.name).join(', ');
  escalate = false; ai = true;
  const range = sp.date ? (sp.end ? `${fmt(sp.date)} to ${fmt(sp.end)}` : fmt(sp.date)) : '';
  if (!svc) {
    reply = sp.unknown ? T('svc_unknown', sp.unknown, names) : T('svc_which', names);
  } else if (sp.problem === 'past') {
    reply = T('svc_past', sp.problem_arg);
  } else if (!sp.date) {
    reply = T('svc_ask_date', svc.name);
  } else if (sp.clash) {
    reply = T('svc_taken', svc.name, range, sp.clash);
  } else {
    const perWord = SVC_PER[svc.unit] || '', byCount = svc.unit !== 'per_event' && sp.qty > 0, total = byCount ? svc.price * sp.qty : 0;
    const cost = T('svc_cost', svc.price, perWord, total, svcQty(svc.unit, sp.qty));
    const free = svc.exclusive ? T('svc_free', svc.name, range) + ' ' : '';
    if (p.wants_to_book) {
      reply = free + T('svc_pass', svc.name, cost, svc.exclusive ? '' : range);
      escalate = true; svcKind = true;
      staffQuestion = `${svc.name} booking request: ${range}${byCount ? ', ' + svcQty(svc.unit, sp.qty) : ''}. ${svc.price > 0 ? NGN(svc.price) + ' naira ' + perWord + (total ? ', ' + NGN(total) + ' naira in total' : '') : 'No fixed price'}. Guest wrote: "${p.question}"`;
    } else {
      reply = (free || T('svc_free', svc.name, range) + ' ') + cost + T('svc_offer');
    }
  }
}

if (p.booking_flow && p.info_answer && !p.draft_cleared) reply = p.info_answer + '\n\n' + reply;   // answer to a side question asked in the same message

// Service recovery: what staff are being asked to handle, tracked in `escalations` until it is settled.
const kind = escalate ? (svcKind ? 'request' : (p.kind || 'question')) : 'question', category = escalate ? (svcKind ? 'booking' : (p.category || null)) : null;
const TITLE = { emergency: '🚨 EMERGENCY', complaint: '⚠️ Guest complaint', request: '🛎 Guest request' };
const alert_title = (TITLE[kind] || '🛎 Guest needs help') + (['request', 'complaint'].includes(kind) && category ? ` (${category})` : '');
const row = { chat_id: p.chat_id, check_in: d.check_in, check_out: d.check_out, room_type: d.room_type,
  guest_name: d.guest_name, phone: d.phone, phone_verified: !!d.phone_verified, lang, updated_at: new Date().toISOString(),
  ...(p.from_name ? { tg_name: p.from_name } : {}) };
return [{ json: { chat_id: p.chat_id, intent: p.intent || null, guest_id: p.guest_id || null, booking_id: p.booking_id || null, room: p.room,
  guest_name: p.guest_name || (p.from_name ? p.from_name + ' (not linked to a booking)' : 'Unknown guest'),
  question: p.question, staff_question: staffQuestion, reply, escalate, ai_answered: ai, markup, confirm_data: confirm,
  kind, category, alert_title, chase: !!p.chase, chase_id: p.chase_id || null, chase_next: p.chase_next || 0, chase_alert: !!p.chase_alert, chase_text: p.chase_text || '',
  save_draft: !!(p.booking_flow || p.draft_changed), draft_row: row } }];
