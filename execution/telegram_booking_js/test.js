// Offline test of the Telegram booking node scripts (no n8n, no network, no AI).
// The model's JSON is faked; what is tested is everything the code decides. Run: node execution/telegram_booking_js/test.js
const fs = require('fs'), path = require('path');
const assert = require('assert');
const load = f => fs.readFileSync(path.join(__dirname, f), 'utf8').replace('// __LANG__', fs.readFileSync(path.join(__dirname, 'lang.js'), 'utf8'))
  .replace(/__MODEL__/g, 'm');

// Runs a Code-node script: `nodes` = outputs of other nodes by name, `input` = items arriving at this node.
function run(file, nodes, input) {
  const wrap = list => ({ first: () => ({ json: list[0] }), all: () => list.map(j => ({ json: j })) });
  const $ = name => { if (!(name in nodes)) throw new Error('no node ' + name); return wrap(nodes[name]); };
  const $input = wrap(input);
  return new Function('$', '$input', load(file))($, $input).map(i => i.json);
}

const TODAY = new Date(Date.now() + 3600e3).toISOString().slice(0, 10);
const plus = n => new Date(Date.parse(TODAY) + n * 86400000).toISOString().slice(0, 10);
const ROOMS = [{ name: 'Standard', rate: 35000 }, { name: 'Deluxe', rate: 55000 }, { name: 'Suite', rate: 95000 }];
const AVAIL = (over = {}) => [['Standard', 35000, 4], ['Deluxe', 55000, 2], ['Suite', 95000, 1]]
  .map(([room_type, nightly_rate, n]) => ({ room_type, nightly_rate, available_rooms: over[room_type] ?? n }));

// One full turn: model output -> Parse AI -> Plan booking -> (availability rows) -> Compose reply
function turn({ say, llm, draft = {}, guest = {}, rows = AVAIL(), open = [], services = [] }) {
  const ctx = { chat_id: 1, text: say, from_name: 'Ada', guest_id: guest.id || '', guest_name: guest.name || '', guest_phone: guest.phone || '',
    booking_id: null, room: '', today: TODAY, rooms: ROOMS, draft, hotel: 'BrightSide Hotel', open_items: open, services };
  const ai = { message: { content: [{ type: 'text', text: JSON.stringify({ can_answer: true, notify_staff: false, answer: '', ...llm }) }] } };
  const parsed = run('parse_ai.js', { 'Build prompt': [ctx] }, [ai]);
  const plan = run('plan_booking.js', { 'Parse AI': parsed }, parsed);
  const out = run('compose_reply.js', { 'Plan booking': plan }, rows)[0];
  return { out, plan: plan[0] };
}
const asDraft = o => ({ check_in: null, check_out: null, room_type: null, guest_name: null, phone: null, phone_verified: false, ...o.draft_row });
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok -', name); };

const FRI = plus(7), SUN = plus(9);
let t1, t2, t3, t4;

ok('availability question lists live rooms and rates, saves the dates', () => {
  t1 = turn({ say: 'what rooms do you have for friday to sunday?', llm: { intent: 'availability', check_in: FRI, check_out: SUN } });
  assert(/Standard: 35,000 naira per night \(about 70,000 for 2 nights\)/.test(t1.out.reply), t1.out.reply);
  assert(/Suite: 95,000/.test(t1.out.reply) && /Which room type/.test(t1.out.reply));
  assert.strictEqual(t1.out.escalate, false); assert.strictEqual(t1.out.save_draft, true);
  assert.strictEqual(t1.out.draft_row.check_in, FRI); assert.strictEqual(t1.out.draft_row.room_type, null);
});
ok('sold-out types are left out of the list', () => {
  const t = turn({ say: 'rooms?', llm: { intent: 'availability', check_in: FRI, check_out: SUN }, rows: AVAIL({ Deluxe: 0 }) });
  assert(!/Deluxe/.test(t.out.reply) && /Standard/.test(t.out.reply));
});
ok('picking a room with a draft in progress asks for the name (unknown guest)', () => {
  t2 = turn({ say: 'deluxe please', llm: { intent: 'book', room_type: 'deluxe' }, draft: asDraft(t1.out) });
  assert(/What name should the booking be under/.test(t2.out.reply), t2.out.reply);
  assert.strictEqual(t2.out.draft_row.room_type, 'Deluxe'); assert.strictEqual(t2.out.draft_row.check_in, FRI);
});
ok('then the phone number, with the share-number button', () => {
  t3 = turn({ say: 'Ada Obi', llm: { intent: 'book', guest_name: 'Ada Obi' }, draft: asDraft(t2.out) });
  assert(/phone number/.test(t3.out.reply)); assert.strictEqual(t3.out.markup, 'phone');
  assert.strictEqual(t3.out.draft_row.guest_name, 'Ada Obi');
});
ok('a typed local number is normalised and then the summary needs an explicit Confirm', () => {
  t4 = turn({ say: '0803 123 4567', llm: { intent: 'book', phone: '0803 123 4567' }, draft: asDraft(t3.out) });
  assert.strictEqual(t4.out.markup, 'confirm'); assert.strictEqual(t4.out.draft_row.phone, '+2348031234567');
  assert.strictEqual(t4.out.draft_row.phone_verified, false);
  assert(/Ada Obi, \+2348031234567/.test(t4.out.reply) && /about 110,000 naira in total/.test(t4.out.reply), t4.out.reply);
  assert.strictEqual(t4.out.confirm_data, `${FRI}|${SUN}|Deluxe`);
});
ok('saying "yes book it" in words re-shows the summary instead of booking', () => {
  const t = turn({ say: 'yes book it', llm: { intent: 'book' }, draft: asDraft(t4.out) });
  assert.strictEqual(t.out.markup, 'confirm');
});
ok('a verified (shared) number is never overwritten by a typed one', () => {
  const t = turn({ say: 'use 08011111111', llm: { intent: 'book', phone: '08011111111' }, draft: { ...asDraft(t4.out), phone: '+2348099999999', phone_verified: true } });
  assert.strictEqual(t.out.draft_row.phone, '+2348099999999');
});
ok('a linked guest is not asked for name or phone', () => {
  const t = turn({ say: 'book a suite', llm: { intent: 'book', room_type: 'Suite', check_in: FRI, check_out: SUN }, guest: { id: 'g1', name: 'Tunde', phone: '+2348020000000' } });
  assert.strictEqual(t.out.markup, 'confirm'); assert(/Tunde, \+2348020000000/.test(t.out.reply));
});
ok('chosen room sold out: apologise, list alternatives, drop the choice', () => {
  const t = turn({ say: 'book the suite', llm: { intent: 'book', room_type: 'Suite', check_in: FRI, check_out: SUN }, rows: AVAIL({ Suite: 0 }) });
  assert(/no Suite rooms free/.test(t.out.reply) && /Standard/.test(t.out.reply)); assert.strictEqual(t.out.draft_row.room_type, null);
});
ok('nothing available at all', () => {
  const t = turn({ say: 'rooms?', llm: { intent: 'availability', check_in: FRI, check_out: SUN }, rows: AVAIL({ Standard: 0, Deluxe: 0, Suite: 0 }) });
  assert(/no rooms available/.test(t.out.reply));
});
ok('a single-room availability question gets a direct answer and an offer to book', () => {
  const t = turn({ say: 'is a deluxe free friday to sunday?', llm: { intent: 'availability', room_type: 'Deluxe', check_in: FRI, check_out: SUN } });
  assert(/Good news, a Deluxe room is available/.test(t.out.reply) && /Would you like me to book it/.test(t.out.reply));
});
ok('missing dates are asked for, one thing at a time', () => {
  assert(/What date would you like to check in/.test(turn({ say: 'i want to book', llm: { intent: 'book' } }).out.reply));
  assert(/How many nights/.test(turn({ say: 'from friday', llm: { intent: 'availability', check_in: FRI } }).out.reply));
});
ok('a past check-in date is refused', () => {
  const t = turn({ say: 'book yesterday', llm: { intent: 'book', check_in: plus(-1), check_out: plus(1) } });
  assert(/already passed/.test(t.out.reply)); assert.strictEqual(t.out.draft_row.check_in, null);
});
ok('check-out before check-in is refused', () => {
  const t = turn({ say: 'x', llm: { intent: 'book', check_in: SUN, check_out: FRI } });
  assert(/after check-in/.test(t.out.reply)); assert.strictEqual(t.out.draft_row.check_out, null);
});
ok('a new check-in after the old check-out resets the check-out', () => {
  const t = turn({ say: 'actually arriving the 20th', llm: { intent: 'book', check_in: plus(20) }, draft: { check_in: FRI, check_out: SUN, room_type: null } });
  assert(/How many nights/.test(t.out.reply)); assert.strictEqual(t.out.draft_row.check_out, null);
});
ok('stays over 30 nights go to staff', () => {
  const t = turn({ say: 'x', llm: { intent: 'book', check_in: plus(5), check_out: plus(50) } });
  assert.strictEqual(t.out.escalate, true); assert(/30 nights/.test(t.out.reply));
});
ok('a room type we do not have is called out', () => {
  const t = turn({ say: 'penthouse?', llm: { intent: 'availability', room_type: 'Penthouse', check_in: FRI, check_out: SUN } });
  assert(/don't have a room type called "Penthouse"/.test(t.out.reply));
});
ok('availability lookup failure escalates to staff', () => {
  const t = turn({ say: 'rooms?', llm: { intent: 'availability', check_in: FRI, check_out: SUN }, rows: [{}] });
  assert.strictEqual(t.out.escalate, true);
});
ok('"never mind" clears the draft', () => {
  const t = turn({ say: 'never mind', llm: { intent: 'cancel_draft' }, draft: asDraft(t4.out) });
  assert(/cleared/.test(t.out.reply)); assert.strictEqual(t.out.draft_row.check_in, null); assert.strictEqual(t.out.draft_row.guest_name, null);
});
ok('sharing the phone number (no text) mid-booking continues to the summary, whatever the model says', () => {
  const draft = { check_in: FRI, check_out: SUN, room_type: 'Deluxe', guest_name: 'Ada Obi', phone: '+2348031234567', phone_verified: true };
  const t = turn({ say: '', llm: { intent: 'other', answer: 'How can I help you with your booking?' }, draft });
  assert.strictEqual(t.out.markup, 'confirm'); assert(!/How can I help/.test(t.out.reply), t.out.reply);
  assert.strictEqual(t.out.draft_row.phone_verified, true);
});
ok('sharing the phone number with no booking in progress does not invent one', () => {
  const t = turn({ say: '', llm: { intent: 'other', answer: 'Thanks!' } });
  assert.strictEqual(t.out.save_draft, false); assert.strictEqual(t.out.markup, 'none');
});
ok('"cancel my booking" with nothing in progress goes to staff, not "cleared your request"', () => {
  const t = turn({ say: 'please cancel my booking', llm: { intent: 'cancel_draft', can_answer: false } });
  assert.strictEqual(t.out.escalate, true); assert(!/cleared/.test(t.out.reply), t.out.reply); assert.strictEqual(t.out.save_draft, false);
});
ok('a side question in a booking message is answered too, but the model cannot smuggle in availability claims', () => {
  const a = turn({ say: 'is breakfast included? and rooms for fri-sun?', llm: { intent: 'availability', check_in: FRI, check_out: SUN, answer: 'Yes, breakfast is served 7am to 10am.' } });
  assert(a.out.reply.startsWith('Yes, breakfast is served 7am to 10am.') && /we have:/.test(a.out.reply), a.out.reply);
  const b = turn({ say: 'rooms fri-sun?', llm: { intent: 'availability', check_in: FRI, check_out: SUN, answer: 'Yes, plenty of Suite rooms are available for 20,000 naira.' } });
  assert(!/plenty/.test(b.out.reply) && /Suite: 95,000/.test(b.out.reply), b.out.reply);
});
ok('ordinary questions pass through untouched and do not create a draft', () => {
  const t = turn({ say: 'what time is breakfast?', llm: { intent: 'info', answer: 'Breakfast is 7 to 10.' } });
  assert.strictEqual(t.out.reply, 'Breakfast is 7 to 10.'); assert.strictEqual(t.out.save_draft, false); assert.strictEqual(t.out.escalate, false);
});
ok('unanswerable questions still escalate with the holding message, even with a draft in progress', () => {
  const t = turn({ say: 'do you allow pets?', llm: { intent: 'info', can_answer: false }, draft: asDraft(t1.out) });
  assert.strictEqual(t.out.escalate, true); assert(/checking with our team/.test(t.out.reply)); assert.strictEqual(t.out.draft_row.check_in, FRI);
});
ok('a bad model reply (not JSON) falls back to staff', () => {
  const ctx = { chat_id: 1, text: 'hi', today: TODAY, rooms: ROOMS, draft: {} };
  const p = run('parse_ai.js', { 'Build prompt': [ctx] }, [{ message: { content: [{ type: 'text', text: 'oops' }] } }])[0];
  assert.strictEqual(p.escalate, true); assert.strictEqual(p.intent, 'other');
});
ok('a message that would put markup characters in the draft does not break anything', () => {
  const t = turn({ say: 'x', llm: { intent: 'book', guest_name: '<b>Ada</b>', check_in: FRI, check_out: SUN, room_type: 'Deluxe' } });
  assert.strictEqual(t.out.draft_row.guest_name, '<b>Ada</b>');   // escaped later by the Telegram node's HTML escaping
});

// ---- confirm button
const CB = (payload, action = 'bkok') => ({ Classify: [{ chat_id: 1, action, payload }] });
const D = d => ({ chat_id: 1, updated_at: new Date().toISOString(), ...d });
const good = D({ check_in: FRI, check_out: SUN, room_type: 'Deluxe', guest_name: 'Ada Obi', phone: '+2348031234567', phone_verified: false });
ok('Confirm on the current summary books with the draft\'s details', () => {
  const r = run('check_confirm.js', CB(`${FRI}|${SUN}|Deluxe`), [good])[0];
  assert.strictEqual(r.mode, 'book'); assert.deepStrictEqual(r.body, { p_chat_id: 1, p_name: 'Ada Obi', p_phone: '+2348031234567', p_verified: false, p_room_type: 'Deluxe', p_check_in: FRI, p_check_out: SUN });
});
ok('Confirm on an out-of-date summary does not book', () => {
  assert.strictEqual(run('check_confirm.js', CB(`${FRI}|${plus(10)}|Deluxe`), [good])[0].mode, 'msg');
});
ok('Confirm with no / expired draft does not book', () => {
  assert.strictEqual(run('check_confirm.js', CB(`${FRI}|${SUN}|Deluxe`), [{}])[0].mode, 'msg');
  assert.strictEqual(run('check_confirm.js', CB(`${FRI}|${SUN}|Deluxe`), [{ ...good, updated_at: new Date(Date.now() - 7 * 3600e3).toISOString() }])[0].mode, 'msg');
});
ok('Cancel button cancels', () => assert.strictEqual(run('check_confirm.js', CB('x', 'bkno'), [good])[0].mode, 'cancel'));

// ---- booking result
const R = (r, lang = 'en') => run('booking_result.js', { Classify: [{ chat_id: 1 }], 'Check confirm': [{ lang }] }, [r])[0];
ok('successful booking: confirmation to guest and alert to staff', () => {
  const x = R({ ok: true, booking_id: 'abc', ref: 'ABCD1234', room_type: 'Deluxe', rate: 55000, nights: 2, guest_name: 'Ada Obi', guest_phone: '+2348031234567', check_in: '2026-12-11', check_out: '2026-12-13' });
  assert(/You're booked/.test(x.text) && /ABCD1234/.test(x.text) && /110,000/.test(x.text) && /Fri 11 Dec 2026/.test(x.text), x.text);
  assert(/New Telegram booking/.test(x.staff) && /Ada Obi/.test(x.staff));
});
ok('failure reasons are explained and do not alert staff; unknown failures do', () => {
  assert(/just taken/.test(R({ ok: false, reason: 'sold_out', room_type: 'Suite' }).text));
  assert.strictEqual(R({ ok: false, reason: 'limit' }).staff, '');
  const x = R({}); assert(/FAILED/.test(x.staff) && /could not save/.test(x.text));
  assert(/FAILED/.test(R({ error: 'x' }).staff));
});

// ---- Pidgin
ok('Pidgin message gets Pidgin booking replies, with the same facts', () => {
  const t = turn({ say: 'abeg una get room for friday to sunday?', llm: { intent: 'availability', check_in: FRI, check_out: SUN } });
  assert.strictEqual(t.out.draft_row.lang, 'pcm');
  assert(/we get:/.test(t.out.reply) && /Which room type you want/.test(t.out.reply), t.out.reply);
  assert(/Deluxe: 55,000 naira per night \(about 110,000 for 2 nights\)/.test(t.out.reply), 'numbers must be identical to English');
});
ok('English message stays English', () => {
  assert.strictEqual(turn({ say: 'rooms for friday to sunday please', llm: { intent: 'availability', check_in: FRI, check_out: SUN } }).out.draft_row.lang, 'en');
});
ok('a short follow-up ("Deluxe") keeps the language of the draft; a long English message switches back', () => {
  const draft = { check_in: FRI, check_out: SUN, room_type: null, lang: 'pcm' };
  const a = turn({ say: 'Deluxe', llm: { intent: 'book', room_type: 'Deluxe' }, draft });
  assert.strictEqual(a.out.draft_row.lang, 'pcm'); assert(/Which name make I put/.test(a.out.reply), a.out.reply);
  const b = turn({ say: 'Actually I would like the deluxe room please', llm: { intent: 'book', room_type: 'Deluxe' }, draft });
  assert.strictEqual(b.out.draft_row.lang, 'en');
});
ok('Pidgin summary has the same data and the Confirm prompt', () => {
  const draft = { check_in: FRI, check_out: SUN, room_type: 'Deluxe', guest_name: 'Ada Obi', phone: '+2348031234567', phone_verified: true, lang: 'pcm' };
  const t = turn({ say: '', llm: { intent: 'other' }, draft });
  assert.strictEqual(t.out.markup, 'confirm');
  assert(/Abeg check your booking well/.test(t.out.reply) && /Ada Obi, \+2348031234567/.test(t.out.reply) && /110,000/.test(t.out.reply));
  assert.strictEqual(t.out.confirm_data, `${FRI}|${SUN}|Deluxe`);
});
ok('Pidgin problems, confirm messages and booking result', () => {
  assert(/don pass/.test(turn({ say: 'abeg book am', llm: { intent: 'book', check_in: plus(-1), check_out: plus(1) } }).out.reply));
  assert(/No wahala/.test(run('check_confirm.js', CB('x', 'bkno'), [{ ...good, lang: 'pcm' }])[0].text));
  assert(/don expire/.test(run('check_confirm.js', CB('x'), [{ lang: 'pcm' }])[0].text));
  const x = R({ ok: true, booking_id: 'abc', ref: 'ABCD1234', room_type: 'Deluxe', rate: 55000, nights: 2, guest_name: 'Ada', guest_phone: '+234', check_in: '2026-12-11', check_out: '2026-12-13' }, 'pcm');
  assert(/Your booking don enter/.test(x.text) && /ABCD1234/.test(x.text) && /110,000/.test(x.text) && /New Telegram booking/.test(x.staff), x.text);
  assert(/don go/.test(R({ ok: false, reason: 'sold_out', room_type: 'Suite' }, 'pcm').text));
});
ok('every English message has a Pidgin version', () => {
  const [en, pcm] = new Function(fs.readFileSync(path.join(__dirname, 'lang.js'), 'utf8') + '; return [Object.keys(LANG.en), Object.keys(LANG.pcm)];')();
  assert.deepStrictEqual(en.sort(), pcm.sort());
});

console.log(`\n${n} tests passed`);

// ---- service recovery: kind and category travel with an escalation
ok('a broken AC is tracked as a maintenance complaint and the guest is told it is logged', () => {
  const t = turn({ say: "the AC in my room isn't working", llm: { intent: 'other', can_answer: false, notify_staff: true, kind: 'complaint', category: 'maintenance' } });
  assert.strictEqual(t.out.kind, 'complaint'); assert.strictEqual(t.out.category, 'maintenance'); assert(t.out.escalate);
  assert(/maintenance team/.test(t.out.reply) && /sorry/i.test(t.out.reply), t.out.reply);
  assert.strictEqual(t.out.alert_title, '⚠️ Guest complaint (maintenance)');
});
ok('a request in Pidgin gets a Pidgin acknowledgement', () => {
  const t = turn({ say: 'abeg I wan get extra towel for room', llm: { intent: 'other', can_answer: false, notify_staff: true, kind: 'request', category: 'housekeeping' } });
  assert.strictEqual(t.out.kind, 'request'); assert(/housekeeping/.test(t.out.reply) && /dem go/i.test(t.out.reply), t.out.reply);
  assert.strictEqual(t.out.alert_title, '🛎 Guest request (housekeeping)');
});
ok('danger words are an emergency even if the model missed it, and the reply says call 112', () => {
  const t = turn({ say: 'there is a fire on my floor', llm: { intent: 'info', can_answer: true, notify_staff: false, answer: 'Please remain calm.' } });
  assert.strictEqual(t.out.kind, 'emergency'); assert(t.out.escalate); assert(/112/.test(t.out.reply), t.out.reply);
  assert.strictEqual(t.out.alert_title, '🚨 EMERGENCY');
});
ok('"fire exit" and "smoking" are not emergencies', () => {
  const t = turn({ say: 'where is the fire exit, and can I smoke on the balcony?', llm: { intent: 'info', can_answer: true, notify_staff: false, answer: 'The fire exit is by the lift.' } });
  assert.strictEqual(t.out.kind, 'question'); assert(!t.out.escalate);
});
ok('a plain unanswered question stays a question', () => {
  const t = turn({ say: 'do you have a helipad?', llm: { intent: 'other', can_answer: false, notify_staff: true } });
  assert.strictEqual(t.out.kind, 'question'); assert.strictEqual(t.out.category, null); assert.strictEqual(t.out.alert_title, '🛎 Guest needs help');
});
ok('an invented kind or category is ignored', () => {
  const t = turn({ say: 'my room is dirty', llm: { can_answer: false, notify_staff: true, kind: 'banana', category: 'zzz' } });
  assert.strictEqual(t.out.kind, 'question'); assert.strictEqual(t.out.category, null);
});
ok('a model reply that promises "right away" is replaced by the fixed message for a request', () => {
  const t = turn({ say: 'send towels to 206', llm: { intent: 'other', can_answer: true, notify_staff: true, kind: 'request', category: 'housekeeping', answer: 'Towels are on the way right away!' } });
  assert(!/right away|on the way/.test(t.out.reply), t.out.reply); assert(/housekeeping team/.test(t.out.reply), t.out.reply); assert.strictEqual(t.out.kind, 'request');
});
console.log(n + ' tests passed (service recovery included)');

// ---- proactive follow-up: a guest replying to the evening "running late?" message
ok('an arrival time is passed to staff as a plain question and the guest gets the courteous reply', () => {
  const t = turn({ say: "I'll be arriving around 11pm", llm: { intent: 'other', can_answer: true, notify_staff: true, kind: 'question', answer: 'Thank you, I have told our team to expect you around 11 PM.' } });
  assert(t.out.escalate); assert.strictEqual(t.out.kind, 'question'); assert(/11 PM/.test(t.out.reply), t.out.reply);
  assert.strictEqual(t.out.alert_title, '🛎 Guest needs help');
});
// ---- chasing an open item
const ITEM = (over = {}) => ({ id: 'e1', kind: 'request', category: 'housekeeping', question: 'Towels to room 206', created_at: new Date(Date.now() - 25 * 60000).toISOString(), chase_count: 0, last_chased_at: null, assigned_to: 'Tunde B.', ...over });
const NEW_REQ = { intent: 'other', can_answer: false, notify_staff: true, kind: 'request', category: 'housekeeping' };
ok('"any update?" with an open request nudges staff about that item instead of creating a new one', () => {
  const t = turn({ say: 'any update on my towels?', llm: NEW_REQ, open: [ITEM()] });
  assert(t.out.chase); assert.strictEqual(t.out.chase_id, 'e1'); assert.strictEqual(t.out.chase_next, 1); assert(t.out.chase_alert); assert(t.out.escalate);
  assert(/nudged our housekeeping team/.test(t.out.reply) && /25 min/.test(t.out.reply), t.out.reply);
  assert(/Guest is chasing \(open 25 min, chased 1x\)/.test(t.out.chase_text) && /Owner: Tunde B\./.test(t.out.chase_text), t.out.chase_text);
});
ok('a chase in Pidgin gets a Pidgin reply', () => {
  const t = turn({ say: 'abeg i dey wait since', llm: NEW_REQ, open: [ITEM()] });
  assert(t.out.chase); assert(/dem go update you/i.test(t.out.reply), t.out.reply);
});
ok('a second chase within 5 minutes updates the count but does not alert the staff group again', () => {
  const t = turn({ say: 'still waiting please', llm: NEW_REQ, open: [ITEM({ chase_count: 1, last_chased_at: new Date(Date.now() - 2 * 60000).toISOString() })] });
  assert(t.out.chase); assert.strictEqual(t.out.chase_next, 2); assert.strictEqual(t.out.chase_alert, false);
});
ok('without an open item, "any update?" is an ordinary message', () => {
  const t = turn({ say: 'any update on my towels?', llm: NEW_REQ, open: [] });
  assert(!t.out.chase); assert.strictEqual(t.out.kind, 'request');
});
ok('a long or unrelated message while something is open is not treated as a chase', () => {
  const t = turn({ say: 'what time does the restaurant open for breakfast?', llm: { intent: 'info', can_answer: true, notify_staff: false, answer: 'Breakfast is 6:30 to 10:30.' }, open: [ITEM()] });
  assert(!t.out.chase); assert(/Breakfast/.test(t.out.reply));
});
ok('a new, different request while one is open is still its own item when it does not sound like a chase', () => {
  const t = turn({ say: 'my room needs a plumber now', llm: { intent: 'other', can_answer: false, notify_staff: true, kind: 'complaint', category: 'maintenance' }, open: [ITEM()] });
  assert(!t.out.chase); assert.strictEqual(t.out.kind, 'complaint');
});

// ============================================================ other services: event hall, gym, pool (sql/025 + 027)
// The bot quotes prices, says whether an exclusive service (the hall) is free from the days the database lists as taken, and passes a booking
// request to staff. It never books a service itself and never lets the model say "free", "booked" or "confirmed".
const SERV = [
  { name: 'Event hall', price: 250000, unit: 'per_event', exclusive: true, booked: [[plus(10), plus(11)], [plus(20), plus(20)]] },
  { name: 'Pool', price: 3000, unit: 'per_head', exclusive: false, booked: [] },
  { name: 'Gym membership', price: 18000, unit: 'per_month', exclusive: false, booked: [] },
  { name: 'Lounge', price: 0, unit: 'per_visit', exclusive: false, booked: [] },
];
const SVC = (over = {}) => ({ intent: 'service', service: 'Event hall', service_date: plus(15), wants_to_book: true, ...over });
const svcTurn = (say, llm, extra = {}) => turn({ say, llm: SVC(llm), services: SERV, ...extra });

ok('the hall on a free day: the guest is told it is free and the request goes to staff as a booking request', () => {
  const t = svcTurn('I want to book the event hall', {});
  assert.strictEqual(t.out.escalate, true); assert.strictEqual(t.out.kind, 'request'); assert.strictEqual(t.out.category, 'booking');
  assert(/is free on/.test(t.out.reply) && /passed your request/.test(t.out.reply) && /250,000 naira per event/.test(t.out.reply), t.out.reply);
  assert(/Event hall booking request: [A-Z][a-z]{2} \d+ [A-Z][a-z]{2}\. 250,000 naira per event/.test(t.out.staff_question) && /I want to book the event hall/.test(t.out.staff_question), t.out.staff_question);
  assert.strictEqual(t.out.question, 'I want to book the event hall'); assert.strictEqual(t.out.markup, 'none');
});
ok('the hall on a taken day: told it is taken (with the dates), nothing is sent to staff', () => {
  const t = svcTurn('book the hall', { service_date: plus(10) });
  assert.strictEqual(t.out.escalate, false); assert(/already booked/.test(t.out.reply) && /another date/.test(t.out.reply), t.out.reply);
  assert(!/passed your request/.test(t.out.reply));
});
ok('a range that touches a taken day is taken, even when it starts on a free day', () => {
  const t = svcTurn('hall for two days', { service_date: plus(9), service_end: plus(10) });
  assert(/already booked/.test(t.out.reply) && t.out.escalate === false, t.out.reply);
});
ok('the day after a taken range is free, and a long free range is passed on with its dates', () => {
  assert(/is free on/.test(svcTurn('hall', { service_date: plus(12) }).out.reply));
  const t = svcTurn('hall for three days', { service_date: plus(12), service_end: plus(14) });
  assert.strictEqual(t.out.escalate, true); assert(/ to /.test(t.out.reply));
});
ok('just asking whether the hall is free (not booking it) answers and offers to pass a request, without alerting staff', () => {
  const t = svcTurn('is the hall free that day?', { wants_to_book: false });
  assert.strictEqual(t.out.escalate, false); assert(/is free on/.test(t.out.reply) && /Would you like me to pass a booking request/.test(t.out.reply), t.out.reply);
});
ok('no date yet: the bot asks for it and alerts nobody', () => {
  const t = svcTurn('I want the hall', { service_date: null });
  assert.strictEqual(t.out.escalate, false); assert(/Which date/.test(t.out.reply), t.out.reply);
});
ok('a past date is refused politely', () => {
  const t = svcTurn('hall yesterday', { service_date: plus(-3) });
  assert.strictEqual(t.out.escalate, false); assert(/already passed/.test(t.out.reply), t.out.reply);
});
ok('no service named: the bot lists what the hotel offers', () => {
  const t = svcTurn('I want to book something', { service: null });
  assert.strictEqual(t.out.escalate, false); assert(/Event hall, Pool, Gym membership, Lounge/.test(t.out.reply), t.out.reply);
});
ok('a service the hotel does not have is not invented', () => {
  const t = svcTurn('book the helipad', { service: 'Helipad' });
  assert.strictEqual(t.out.escalate, false); assert(/don't have "Helipad"/.test(t.out.reply) && /Event hall/.test(t.out.reply), t.out.reply);
});
ok('the pool by the head: the total follows the number of people and the request goes to staff', () => {
  const t = svcTurn('pool for 5 people tomorrow', { service: 'Pool', service_date: plus(1), service_qty: 5 });
  assert.strictEqual(t.out.escalate, true); assert(/3,000 naira per person/.test(t.out.reply) && /15,000 naira for 5 people/.test(t.out.reply), t.out.reply);
  assert(/5 people/.test(t.out.staff_question), t.out.staff_question);
});
ok('a monthly gym membership: the total follows the months', () => {
  const t = svcTurn('gym for 2 months from monday', { service: 'Gym membership', service_date: plus(3), service_qty: 2 });
  assert(/18,000 naira per month/.test(t.out.reply) && /36,000 naira for 2 months/.test(t.out.reply), t.out.reply);
});
ok('a service with no fixed price says the team will confirm it, and no price is invented', () => {
  const t = svcTurn('lounge tonight', { service: 'Lounge', service_date: plus(1) });
  assert(/confirm the price/.test(t.out.reply) && !/naira/.test(t.out.reply), t.out.reply);
});
ok('a service name in other letters still matches, and a made-up quantity is ignored', () => {
  const t = svcTurn('pool', { service: 'pool', service_date: plus(2), service_qty: -4 });
  assert(/passed your request/.test(t.out.reply) && !/for -4/.test(t.out.reply), t.out.reply);
});
ok('Pidgin in, Pidgin out (prices and dates unchanged)', () => {
  const t = svcTurn('abeg i wan book the event hall', {});
  assert(/dey free/.test(t.out.reply) && /250,000 naira/.test(t.out.reply) && t.out.escalate === true, t.out.reply);
});
ok('a service request does not disturb a room booking the guest was in the middle of', () => {
  const draft = asDraft(t4.out);
  const t = svcTurn('book the hall too', {}, { draft });
  assert.strictEqual(t.out.draft_row.check_in, FRI); assert.strictEqual(t.out.draft_row.room_type, 'Deluxe'); assert.strictEqual(t.out.save_draft, false);
});
ok('a hotel with no services: "service" from the model is not trusted, the guest goes to staff as before', () => {
  const t = turn({ say: 'book the hall', llm: SVC({ can_answer: true, answer: '' }), services: [] });
  assert.strictEqual(t.out.escalate, true); assert(!/passed your request/.test(t.out.reply));
});
ok('the model can never put availability, bookings or prices in a service reply (only the code does)', () => {
  const t = svcTurn('book the hall', { answer: 'Booked! The hall is yours for 1,000 naira.', can_answer: true });
  assert(!/1,000/.test(t.out.reply) && !/Booked!/.test(t.out.reply), t.out.reply);
});
ok('the Inbox item and the staff alert use the full summary, but the guest\'s own words are what get logged', () => {
  const t = svcTurn('hall please on the 15th', {});
  assert(t.out.staff_question !== t.out.question && t.out.question === 'hall please on the 15th');
});
ok('the prompt shows the services (with price, unit and one-per-day) only to a hotel that has some', () => {
  const nodes = (services) => ({ 'Load context': [{ guest: {}, settings: {}, rooms: [], knowledge: [], services, history: [] }], 'Classify': [{ chat_id: 1, text: 'hi', from_name: 'A', hotel: { name: 'H', timezone: 'Africa/Lagos' } }] });
  const withS = run('build_prompt.js', nodes(SERV), [{}])[0], without = run('build_prompt.js', nodes([]), [{}])[0];
  const sys = withS.body.messages[0].content, sys0 = without.body.messages[0].content;
  assert(/SERVICES:/.test(sys) && /Event hall: 250,000 naira per event \(one booking per day\)/.test(sys) && /Pool: 3,000 naira per person/.test(sys) && /Lounge: price on request/.test(sys), sys.slice(sys.indexOf('SERVICES:'), sys.indexOf('SERVICES:') + 400));
  assert(/"service"/.test(sys) && /"intent" to "service"/.test(sys));
  assert(!/SERVICES:/.test(sys0) && !/"service"/.test(sys0), 'a hotel without services gets the same prompt as before');
  assert.strictEqual(withS.services.length, 4); assert.strictEqual(without.services.length, 0);
});
ok('a guest chasing an open item is not mistaken for a service request', () => {
  const t = svcTurn('any update?', { intent: 'other', can_answer: false, notify_staff: false }, { open: [ITEM()] });
  assert(t.out.chase);
});
// ============================================================ past checkout time (Scheduler part J)
const CTX = (mins, over = {}) => ({ mins, settings: { CHECKOUT_TIME: '12:00 noon', ...over } });
const STAY = (name, room_type = 'Suite', room_number = null) => ({ id: 'id-' + name, room_type, room_number, guests: { name } });
const alert = (ctx, rows) => run('overdue_compose.js', { Context: [ctx] }, rows);
ok('checkout times in free text are read the same way as on the dashboard', () => {
  // the same table as website/app/stay-core.js: 12:00 noon -> an alert only from 12:30
  const TIMES = [['12:00 noon', 720], ['12:00 PM', 720], ['12 noon', 720], ['noon', 720], ['midday', 720], ['', 720], [undefined, 720], ['11am', 660], ['11:00 AM', 660], ['11.30 a.m.', 690],
  ['2pm', 840], ['2:30 PM', 870], ['12:00 AM', 0], ['12:30 PM', 750], ['12:30 AM', 30], ['10:30', 630], ['25:00', 720], ['9:99', 720], ['by 12:00 noon', 720], ['Checkout is 1 PM', 780]];
  for (const [t, m] of TIMES) {
    const settings = t === undefined ? {} : { CHECKOUT_TIME: t };
    assert.strictEqual(alert({ mins: m + 29, settings }, [STAY('A')]).length, 0, `${t}: too early at +29`);
    assert.strictEqual(alert({ mins: m + 30, settings }, [STAY('A')]).length, 1, `${t}: due at +30`);
  }
});
ok('a guest still checked in 30 minutes after checkout time: one alert naming the guest and the room', () => {
  const [a] = alert(CTX(750), [STAY('Ada Obi', 'Suite', '302')]);
  assert(/Past checkout time \(12:00 noon\)/.test(a.text) && /Ada Obi \(Suite, room 302\)/.test(a.text) && /This guest is still marked as checked in/.test(a.text), a.text);
  assert.deepStrictEqual(a.ids, ['id-Ada Obi']);
});
ok('several overdue guests are ONE message (no flood), listing each, with their ids to stamp', () => {
  const out = alert(CTX(800), [STAY('Ada Obi', 'Suite', '302'), STAY('Bola Eze', 'Deluxe')]);
  assert.strictEqual(out.length, 1); assert(/Ada Obi.*\n.*Bola Eze \(Deluxe\)/.test(out[0].text) && /These guests are/.test(out[0].text), out[0].text);
  assert.deepStrictEqual(out[0].ids, ['id-Ada Obi', 'id-Bola Eze']);
});
ok('nothing before the checkout time plus 30 minutes, and nothing when nobody is overdue', () => {
  assert.strictEqual(alert(CTX(749), [STAY('A')]).length, 0);
  assert.strictEqual(alert(CTX(900), []).length, 0);
  assert.strictEqual(alert(CTX(900), [{}, { id: null }]).length, 0);
});
ok('an 11am hotel is told from 11:30, and a hotel with no readable time is treated as noon', () => {
  assert.strictEqual(alert(CTX(689, { CHECKOUT_TIME: '11am' }), [STAY('A')]).length, 0);
  assert.strictEqual(alert(CTX(690, { CHECKOUT_TIME: '11am' }), [STAY('A')]).length, 1);
  assert.strictEqual(alert(CTX(749, { CHECKOUT_TIME: '' }), [STAY('A')]).length, 0);
  assert(/\(midday\)/.test(alert(CTX(750, { CHECKOUT_TIME: '' }), [STAY('A')])[0].text));
});
ok('a booking with no guest name or room still produces a sensible line', () => {
  const [a] = alert(CTX(750), [{ id: 'x' }]);
  assert(/A guest \(room\)/.test(a.text), a.text);
});
console.log(n + ' tests passed (chasing, services and past-checkout alerts included)');
