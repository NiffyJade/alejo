// Offline tests for enquiry logging and the follow-up of unfinished bookings.
// Run: node execution/telegram_booking_js/test_followup.js   (other bot tests: test.js, test_menu.js)
const fs = require('fs'), path = require('path'), assert = require('assert');
const load = f => fs.readFileSync(path.join(__dirname, f), 'utf8').replace('// __LANG__', fs.readFileSync(path.join(__dirname, 'lang.js'), 'utf8'))
  .replace(/__MODEL__/g, 'm');
const HOTEL = { id: 'h-test', slug: 'test', name: 'BrightSide Hotel', timezone: 'Africa/Lagos', staff_chat_id: -100999 };   // the hotel every update carries
function run(file, nodes, input) {
  const wrap = list => ({ first: () => ({ json: list[0] }), all: () => list.map(j => ({ json: j })) });
  const $ = name => { if (!(name in nodes)) throw new Error('no node ' + name); return wrap(nodes[name]); };
  return new Function('$', '$input', load(file))($, wrap(input)).map(i => i.json);
}
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok -', name); };

// ---- the follow-up buttons
const cb = (data, chat = { id: 42, type: 'private' }) => run('classify.js', {}, [{ callback_query: { id: 'q1', data, from: { id: 42, first_name: 'Ada', last_name: 'Obi' }, message: { chat } } }])[0];
ok('"Yes, continue" re-enters the bot as a normal message from the guest', () => {
  const r = cb('fuyes:x');
  assert.deepStrictEqual([r.type, r.action, r.chat_id, r.from_name], ['booking_cb', 'bkcont', 42, 'Ada Obi']);
  assert(/continue my booking/.test(r.text) && r.query_id === 'q1');
});
ok('"No, thanks" uses the existing cancel path (clears the draft)', () => {
  const r = cb('funo:x'); assert.deepStrictEqual([r.type, r.action], ['booking_cb', 'bkno']);
});
ok('follow-up buttons from a group chat are ignored; the older buttons still work', () => {
  assert.strictEqual(cb('fuyes:x', { id: -100, type: 'supergroup' }).type, 'ignore');
  assert.deepStrictEqual([cb('bkok:2026-12-11|2026-12-13|Deluxe').type, cb('checkin:0a1b2c3d-0000-4000-8000-000000000001').type], ['booking_cb', 'callback']);
});
ok('Check confirm sends "continue" back into the conversation without touching the draft', () => {
  const r = run('check_confirm.js', { Classify: [{ action: 'bkcont', chat_id: 42, payload: '' }] }, [{ chat_id: 42, lang: 'pcm', updated_at: new Date().toISOString() }])[0];
  assert.deepStrictEqual([r.mode, r.lang], ['cont', 'pcm']);
});

// ---- the follow-up message
const TODAY = new Date(Date.now() + 3600e3).toISOString().slice(0, 10);
const plus = k => new Date(Date.parse(TODAY) + k * 86400000).toISOString().slice(0, 10);
const compose = drafts => run('followup_compose.js', {}, drafts);
ok('a follow-up names the room and dates, uses the first name, and offers two buttons', () => {
  const [m] = compose([{ chat_id: 42, check_in: plus(10), check_out: plus(12), room_type: 'Deluxe', guest_name: 'Ada Obi', tg_name: 'Adaeze', lang: 'en' }]);
  assert(/^Hi Ada! /.test(m.text) && /Deluxe room for/.test(m.text), m.text);
  assert.deepStrictEqual([m.chat_id, m.yes_label, m.no_label], [42, 'Yes, continue', 'No, thanks']);
});
ok('it falls back to the Telegram name, and to no name at all', () => {
  assert(/^Hi Lola! /.test(compose([{ chat_id: 1, check_in: plus(3), check_out: plus(4), room_type: 'Suite', tg_name: 'Lola K' }])[0].text));
  assert(/^Hi! /.test(compose([{ chat_id: 1, check_in: plus(3), check_out: plus(4), room_type: 'Suite' }])[0].text));
});
ok('it speaks Pidgin to a guest who was using Pidgin', () => {
  const [m] = compose([{ chat_id: 1, check_in: plus(3), check_out: plus(4), room_type: 'Suite', lang: 'pcm' }]);
  assert(/You dey look Suite room/.test(m.text) && m.no_label === 'No, thank you', m.text);
});
ok('it never promises the room is still available or pushes with scarcity', () => {
  for (const lang of ['en', 'pcm']) {
    const t = compose([{ chat_id: 1, check_in: plus(3), check_out: plus(4), room_type: 'Suite', lang }])[0].text;
    assert(!/\b(available|vacan\w*|last room|hurry|going fast|only \d|limited)\b/i.test(t.replace(/check the room again|check the room/gi, '')), t);
  }
});
ok('drafts without a room type or dates are skipped (nothing concrete to follow up)', () => {
  assert.strictEqual(compose([{ chat_id: 1, room_type: 'Suite' }, { chat_id: 2, check_in: plus(1), check_out: plus(2) }, { chat_id: 3 }, {}]).length, 0);
  assert.strictEqual(compose([{ chat_id: 1, check_in: plus(1), check_out: plus(2), room_type: 'Suite' }, { chat_id: 2 }]).length, 1);
});
ok('a hostile profile name cannot break the message', () => {
  const [m] = compose([{ chat_id: 1, check_in: plus(3), check_out: plus(4), room_type: 'Suite', tg_name: '<b>x</b>'.repeat(30) }]);
  assert(m.text.length < 400);
});

// ---- what the bot logs for every message
const ROOMS = [{ name: 'Standard', rate: 35000 }, { name: 'Deluxe', rate: 55000 }];
const turn = (llm, extra = {}) => {
  const ctx = { chat_id: 42, text: 'rooms?', from_name: 'Ada Obi', guest_id: '', guest_name: '', guest_phone: '', booking_id: null, room: '', today: TODAY, rooms: ROOMS, draft: {}, hotel: 'BrightSide Hotel', ...extra };
  const ai = { message: { content: [{ type: 'text', text: JSON.stringify({ can_answer: true, notify_staff: false, answer: '', ...llm }) }] } };
  const parsed = run('parse_ai.js', { 'Build prompt': [ctx] }, [ai]);
  const plan = run('plan_booking.js', { 'Parse AI': parsed }, parsed);
  return run('compose_reply.js', { 'Plan booking': plan }, [{ room_type: 'Standard', available_rooms: 4, nightly_rate: 35000 }, { room_type: 'Deluxe', available_rooms: 2, nightly_rate: 55000 }])[0];
};
ok('the intent of each message is passed on so it can be logged', () => {
  assert.strictEqual(turn({ intent: 'availability', check_in: plus(5), check_out: plus(7) }).intent, 'availability');
  assert.strictEqual(turn({ intent: 'info', answer: 'Breakfast is 7 to 10.' }).intent, 'info');
  assert.strictEqual(turn({ intent: 'book', check_in: plus(5), check_out: plus(7) }).intent, 'book');
});
ok('the Telegram name is stored on the draft (so the follow-up and dashboard can name the person), but never overwritten with nothing', () => {
  assert.strictEqual(turn({ intent: 'availability', check_in: plus(5), check_out: plus(7) }).draft_row.tg_name, 'Ada Obi');
  assert(!('tg_name' in turn({ intent: 'availability', check_in: plus(5), check_out: plus(7) }, { from_name: '' }).draft_row));
});

console.log(`\n${n} follow-up tests passed`);
