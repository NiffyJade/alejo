// Offline tests for the daily manager summary text. Run: node execution/telegram_booking_js/test_daily_digest.js
// (the database side is tested by execution/test_daily_digest.sql)
const fs = require('fs'), path = require('path'), assert = require('assert');
const load = f => fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/__STAFF__/g, '-100999');
const run = (d, settings = { HOTEL_NAME: 'BrightSide Hotel' }) =>
  new Function('$', '$input', load('daily_digest_compose.js'))(() => ({ first: () => ({ json: { settings } }) }), { first: () => ({ json: d }) });
const compose = (d, settings) => run(d, settings)[0].json;
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok -', name); };

const busy = { today: '2026-11-24', rooms_total: 19, in_house: 6,
  free_tonight: [{ room_type: 'Standard', free: 4 }, { room_type: 'Deluxe', free: 2 }, { room_type: 'Suite', free: 1 }],
  arriving: [{ name: 'Ada Obi', room_type: 'Deluxe', room_number: null, balance: 80000 }, { name: 'Tunde', room_type: 'Standard', room_number: '204', balance: 0 }],
  leaving: [{ name: 'Chidi Eze Nwosu', room_type: 'Standard', room_number: '101', balance: 70000 }],
  unpaid_count: 2, unpaid_sum: 150000, new_bookings: 4, new_value: 285000, by_source: { telegram: 2, phone: 1, 'walk-in': 1 }, cancelled: 1, payments: 120000,
  people_messaged: 11, people_asked_rooms: 7, needed_person: 2, open_items: 2, open_service: 1, oldest_open_minutes: 185 };

ok('a busy day reads as three short sections with the right figures', () => {
  const { text, chat_id } = compose(busy);
  for (const s of ['☀️ BrightSide Hotel, Tue 24 Nov', 'TODAY', 'Arriving (2): Ada O. Deluxe (owes ₦80,000) · Tunde 204', 'Leaving (1): Chidi N. 101 (owes ₦70,000)',
    'In house: 6 of 19 rooms (32%)', 'Free tonight: Standard 4 · Deluxe 2 · Suite 1', 'LAST 24 HOURS', 'New bookings: 4, worth ₦285,000 (Telegram 2 · Phone 1 · Walk-in 1)',
    'Cancelled: 1', 'Payments recorded: ₦120,000', 'Messages from 11 people, 7 asked about rooms, 2 needed a person', 'NEEDS YOU',
    '2 open items (1 is a request or complaint), the oldest waiting 3 h', 'Unpaid: 2 stays, ₦150,000 in total']) assert(text.includes(s), s + '\n' + text);
  assert.strictEqual(chat_id, -100999, 'defaults to the staff group');
  assert(text.split('\n').length <= 20 && text.length < 1500, 'stays short: ' + text.length);
});
ok('a quiet day is short and says so, without invented figures', () => {
  const { text } = compose({ today: '2026-11-24', rooms_total: 19, in_house: 0, free_tonight: [{ room_type: 'Standard', free: 10 }], arriving: [], leaving: [], unpaid_count: 0, unpaid_sum: 0,
    new_bookings: 0, new_value: 0, by_source: {}, cancelled: 0, payments: 0, people_messaged: 0, people_asked_rooms: 0, needed_person: 0, open_items: 0, open_service: 0, oldest_open_minutes: null });
  for (const s of ['Arriving: nobody', 'Leaving: nobody', 'In house: 0 of 19 rooms (0%)', 'New bookings: none', 'No messages from guests', 'Nothing is waiting on you. ✅']) assert(text.includes(s), s + '\n' + text);
  assert(!/Cancelled|Payments recorded|Unpaid|NaN|undefined|null|Infinity/.test(text), text);
});
ok('long lists are cut, not dumped', () => {
  const many = Array.from({ length: 15 }, (_, i) => ({ name: 'Guest Number' + i, room_type: 'Standard', room_number: null, balance: 0 }));
  const t = compose({ ...busy, arriving: many }).text;
  assert(/Arriving \(15\):/.test(t) && /\+9 more/.test(t) && t.length < 1500, t);
});
ok('singular and plural wording, and ages in minutes, hours and days', () => {
  assert(/1 open item \(1 is a request or complaint\), the oldest waiting 12 min/.test(compose({ ...busy, open_items: 1, open_service: 1, oldest_open_minutes: 12 }).text));
  assert(/the oldest waiting 2 d/.test(compose({ ...busy, oldest_open_minutes: 2900 }).text));
  assert(/Unpaid: 1 stay,/.test(compose({ ...busy, unpaid_count: 1 }).text) && /Messages from 1 person/.test(compose({ ...busy, people_messaged: 1 }).text));
  assert(/3 open items \(2 are requests or complaints\)/.test(compose({ ...busy, open_items: 3, open_service: 2 }).text));
});
ok('it goes to MANAGER_CHAT_ID when that is a real chat id, otherwise to the staff group', () => {
  assert.strictEqual(compose(busy, { MANAGER_CHAT_ID: '8804052564' }).chat_id, 8804052564);
  assert.strictEqual(compose(busy, { MANAGER_CHAT_ID: '-1001234567890' }).chat_id, -1001234567890);
  for (const bad of ['', 'abc', '12', '5; drop table', ' ']) assert.strictEqual(compose(busy, { MANAGER_CHAT_ID: bad }).chat_id, -100999, JSON.stringify(bad));
});
ok('odd guest names cannot break the message', () => {
  const t = compose({ ...busy, arriving: [{ name: '', room_type: null, room_number: null, balance: 0 }, { name: '  ', balance: 'x' }, { name: '<b>x</b>', room_type: 'Deluxe' }] }).text;
  assert(!/undefined|NaN/.test(t), t);
});
ok('a missing hotel name still gives a sensible title', () => assert(/^☀️ Your hotel, Tue 24 Nov/.test(compose(busy, {}).text)));

ok('if the figures could not be fetched, nothing is sent (and so nothing is marked done)', () => {
  assert.deepStrictEqual(run({}), []); assert.deepStrictEqual(run({ error: 'timeout' }), []); assert.deepStrictEqual(run(null), []);
});

console.log(`\n${n} daily summary tests passed`);
