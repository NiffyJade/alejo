// Offline tests for the menu shortcuts, My booking, Check in / Check out and the single-call prompt builder.
// Run: node execution/telegram_booking_js/test_menu.js   (the booking conversation tests are in test.js)
const fs = require('fs'), path = require('path'), assert = require('assert');
const load = f => fs.readFileSync(path.join(__dirname, f), 'utf8').replace('// __LANG__', fs.readFileSync(path.join(__dirname, 'lang.js'), 'utf8'))
  .replace(/__HOTEL__/g, 'BrightSide Hotel').replace(/__MODEL__/g, 'm').replace(/__STAFF__/g, '-100999');
function run(file, nodes, input) {
  const wrap = list => ({ first: () => ({ json: list[0] }), all: () => list.map(j => ({ json: j })) });
  const $ = name => { if (!(name in nodes)) throw new Error('no node ' + name); return wrap(nodes[name]); };
  return new Function('$', '$input', load(file))($, wrap(input)).map(i => i.json);
}
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok -', name); };
const TODAY = new Date(Date.now() + 3600e3).toISOString().slice(0, 10);
const plus = k => new Date(Date.parse(TODAY) + k * 86400000).toISOString().slice(0, 10);

const classify = text => run('classify.js', {}, [{ message: { message_id: 1, chat: { id: 42, type: 'private' }, from: { id: 42, first_name: 'Ada' }, text } }])[0];
ok('typed and button shortcuts are recognised exactly', () => {
  for (const s of ["What's my booking id?", '📋 My booking', 'booking reference?', 'my reservation', 'wetin be my booking id', 'send my booking details', 'what is my reference number'])
    assert.strictEqual(classify(s).type, 'mybooking', s);
  for (const s of ['✅ Check in', 'check in', 'Checkin', 'check me in please']) { const r = classify(s); assert.deepStrictEqual([r.type, r.action], ['menu', 'checkin'], s); }
  for (const s of ['🚪 Check out', 'Check-out', 'checkout now', 'check me out']) { const r = classify(s); assert.deepStrictEqual([r.type, r.action], ['menu', 'checkout'], s); }
  for (const s of ['menu', '/start', 'Menu', 'help']) assert.strictEqual(classify(s).type, 'hello', s);
});
ok('questions and changes still go to the assistant, not a shortcut', () => {
  for (const s of ['Cancel my booking', 'please change my booking id', 'extend my booking', 'What time is check in?', 'what time is checkout',
    'can I check in early?', '🛏 Check availability', 'Do you have a room this weekend?', 'I want to book a room'])
    assert.strictEqual(classify(s).type, 'guest_message', s);
});
ok('a /start link still links the booking; the staff group is never a guest shortcut', () => {
  assert.deepStrictEqual([classify('/start abc123').type, classify('/start abc123').token], ['start', 'abc123']);
  const r = run('classify.js', {}, [{ message: { message_id: 1, chat: { id: -100999, type: 'supergroup' }, from: { id: 1, first_name: 'S' }, text: 'check in' } }])[0];
  assert.strictEqual(r.type, 'ignore');
});

const bk = o => ({ id: 'abcd1234-0000-4000-8000-000000000000', room_type: 'Deluxe', room_number: null, check_in: TODAY, check_out: plus(2), status: 'booked', stay_code: '123456', guests: { name: 'Ada', telegram_chat_id: 42 }, ...o });
const pick = (action, rows) => run('pick_booking.js', { Classify: [{ action, chat_id: 42 }] }, rows)[0];
ok('check in picks the open booked stay first, else the next upcoming; check out picks the stay in progress', () => {
  const later = bk({ id: 'later', check_in: plus(10), check_out: plus(12) }), open = bk({ id: 'open' }), inn = bk({ id: 'inn', status: 'checked_in', check_in: plus(-1) });
  assert.strictEqual(pick('checkin', [later, open]).id, 'open');
  assert.strictEqual(pick('checkin', [later]).id, 'later');
  assert.strictEqual(pick('checkout', [later, inn]).id, 'inn');
  assert.strictEqual(pick('checkout', [later]).id, undefined);
  assert.deepStrictEqual(pick('checkin', [{}]), {});
});
const decide = (action, booking, type = 'menu', viaButton = false) => {
  const nodes = { Classify: [{ type, action, chat_id: 42, booking_id: booking && booking.id }] };
  nodes[viaButton ? 'Load booking' : 'Pick my booking'] = [booking || {}];
  return run('decide_stay.js', nodes, [{ key: 'WIFI_NAME', value: 'Net' }, { key: 'WIFI_PASSWORD', value: 'pw' }])[0];
};
ok('menu check-in gives the stay code and marks the booking checked in; too early does not', () => {
  const r = decide('checkin', bk());
  assert(/checked in/.test(r.text) && /123456/.test(r.text) && /Net \/ pw/.test(r.text)); assert.strictEqual(r.patch.status, 'checked_in'); assert.strictEqual(r.booking_id, bk().id);
  const early = decide('checkin', bk({ check_in: plus(5), check_out: plus(7) }));
  assert(/Check-in opens on/.test(early.text)); assert(!/123456/.test(early.text)); assert.strictEqual(early.patch, null);
});
ok('menu check-out works only after check-in; no booking gives a helpful message; old inline buttons still work', () => {
  assert.strictEqual(decide('checkout', bk({ status: 'checked_in' })).patch.status, 'checked_out');
  assert(/haven't checked in/.test(decide('checkout', bk()).text));
  assert(/couldn't find a booking for you yet/.test(decide('checkin', null).text));
  assert(/no stay in progress|can't find a stay in progress/.test(decide('checkout', null).text));
  assert.strictEqual(decide('checkin', bk(), 'callback', true).patch.status, 'checked_in');
  assert(/couldn't find that booking for this chat/.test(decide('checkin', null, 'callback', true).text));
});
ok("someone else's booking can never be checked in from this chat", () => {
  assert(/couldn't find/.test(decide('checkin', bk({ guests: { name: 'X', telegram_chat_id: 99 } })).text));
});
const mine = rows => run('my_booking.js', {}, rows)[0];
ok('My booking shows the reference and dates but never the stay code', () => {
  const r = mine([bk({ room_number: '204' })]);
  assert(/Reference: ABCD1234/.test(r.text) && /Deluxe \(room 204\)/.test(r.text) && /Status: Booked/.test(r.text) && /tap Check in/.test(r.text), r.text);
  assert(!/123456/.test(r.text)); assert.strictEqual(r.markup, 'menu');
  assert(/Your bookings:/.test(mine([bk(), bk({ id: 'ffff0000-0000-4000-8000-000000000000', check_in: plus(9), check_out: plus(10) })]).text));
});
ok('My booking with nothing found offers the share-number button', () => {
  const r = mine([{}]); assert.strictEqual(r.markup, 'phone'); assert(/share the phone number/.test(r.text));
});

ok('Build prompt reads everything from the single context result', () => {
  const data = { guest: null, draft: null, history: [], rooms: [{ name: 'Standard', nightly_rate: 35000 }, { name: 'Deluxe', nightly_rate: 55000 }],
    settings: { HOTEL_NAME: 'BrightSide Hotel', CHECKOUT_TIME: '12:00 PM' },
    knowledge: [{ id: 'a', question: 'Checkout?', answer: 'Checkout is at [[CHECKOUT_TIME]].' }, { id: 'b', question: 'Wifi?', answer: 'Password [[WIFI_PASSWORD]]' }] };
  const o = run('build_prompt.js', { 'Load context': [data], Classify: [{ chat_id: 42, text: 'rooms friday?', from_name: 'Ada Obi' }] }, [{}])[0];
  const sys = o.body.messages[0].content;
  assert(/Not linked to a booking yet \(Telegram name: Ada Obi\)/.test(sys) && /ROOM TYPES: Standard, Deluxe/.test(sys) && /Checkout is at 12:00 PM/.test(sys) && !/Password/.test(sys));
  assert.strictEqual(o.guest_id, ''); assert.strictEqual(o.rooms.length, 2);
  const g = run('build_prompt.js', { 'Load context': [{ ...data, guest: { id: 'g1', name: 'Tunde', phone: '+234', bookings: [{ id: 'b1', room_type: 'Suite', check_in: '2026-12-01', check_out: '2026-12-03', status: 'booked' }] },
    draft: { chat_id: 42, check_in: '2026-12-11', room_type: 'Deluxe', phone: '+234', lang: 'pcm', updated_at: new Date().toISOString() },
    history: [{ direction: 'out', text: 'second' }, { direction: 'in', text: 'first' }] }], Classify: [{ chat_id: 42, text: 'hi' }] }, [{}])[0];
  assert(/Guest: Tunde\. Booking: Suite/.test(g.body.messages[0].content) && /room_type=Deluxe, name=, phone=given/.test(g.body.messages[0].content));
  assert.strictEqual(g.draft.lang, 'pcm'); assert(g.body.messages[1].content.indexOf('first') < g.body.messages[1].content.indexOf('second'), 'history oldest first');
  const stale = run('build_prompt.js', { 'Load context': [{ ...data, draft: { chat_id: 42, check_in: '2026-12-11', updated_at: new Date(Date.now() - 8 * 3600e3).toISOString() } }], Classify: [{ chat_id: 42, text: 'hi' }] }, [{}])[0];
  assert(/BOOKING IN PROGRESS: none/.test(stale.body.messages[0].content));
});

console.log(`\n${n} menu tests passed`);
