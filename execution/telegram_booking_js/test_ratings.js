// Offline tests for post-checkout ratings: the buttons, the reply, the thank-you and the weekly summary.
// Run: node execution/telegram_booking_js/test_ratings.js   (the database side is tested by execution/test_ratings.sql)
const fs = require('fs'), path = require('path'), assert = require('assert');
const load = f => fs.readFileSync(path.join(__dirname, f), 'utf8').replace('// __LANG__', fs.readFileSync(path.join(__dirname, 'lang.js'), 'utf8'))
  .replace(/__HOTEL__/g, 'BrightSide Hotel').replace(/__MODEL__/g, 'm').replace(/__STAFF__/g, '-100999');
function run(file, nodes, input) {
  const wrap = list => ({ first: () => ({ json: list[0] }), all: () => list.map(j => ({ json: j })) });
  const $ = name => { if (!(name in nodes)) throw new Error('no node ' + name); return wrap(nodes[name]); };
  return new Function('$', '$input', load(file))($, wrap(input)).map(i => i.json);
}
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok -', name); };
const ID = '0a1b2c3d-1111-4222-8333-444455556666';

// ---- the buttons
const tap = (data, chat = { id: 42, type: 'private' }) => run('classify.js', {}, [{ callback_query: { id: 'q1', data, from: { id: 42, first_name: 'Ada' }, message: { chat } } }])[0];
ok('each of the five buttons is read as a rating for that stay', () => {
  for (const k of [1, 2, 3, 4, 5]) { const r = tap(`rate:${k}:${ID}`); assert.deepStrictEqual([r.type, r.rating, r.booking_id, r.chat_id, r.query_id], ['rating', k, ID, 42, 'q1']); }
});
ok('a tampered or out-of-range button is not a rating; a group chat is ignored; other buttons still work', () => {
  assert.notStrictEqual(tap(`rate:6:${ID}`).type, 'rating'); assert.notStrictEqual(tap(`rate:0:${ID}`).type, 'rating');
  assert.strictEqual(tap(`rate:5:${ID}`, { id: -100, type: 'supergroup' }).type, 'ignore');
  for (const bad of [`rate:5:${ID}';drop table bookings`, 'rate:5:not-an-id', `rate:5:${ID}x`, 'rate:5:']) assert.notStrictEqual(tap(bad).type, 'rating', bad);
  assert.deepStrictEqual([tap('checkin:' + ID).type, tap('bkok:2026-12-11|2026-12-13|Deluxe').type, tap('fuyes:x').type], ['callback', 'booking_cb', 'booking_cb']);
});

// ---- the reply
const rec = o => ({ ok: true, rating: 5, previous: null, new_item: false, escalation_id: null, guest_name: 'Ada Obi', room_type: 'Deluxe', room_number: '204', check_in: '2026-11-20', check_out: '2026-11-22', ...o });
const reply = r => run('rating_reply.js', {}, [r])[0];
ok('a good rating is thanked and costs staff nothing', () => {
  for (const k of [4, 5]) { const x = reply(rec({ rating: k })); assert(/^Thank you, Ada!/.test(x.text) && x.alert === '' && x.escalation_id === null, x.text); }
});
ok('a low rating apologises, says the manager knows, invites detail, and alerts staff with the stay', () => {
  const x = reply(rec({ rating: 2, new_item: true, escalation_id: 'e1' }));
  assert(/really sorry, Ada/.test(x.text) && /told our manager/.test(x.text) && /tell me what went wrong/.test(x.text), x.text);
  assert(/Low stay rating: 2 out of 5/.test(x.alert) && /Ada Obi/.test(x.alert) && /Deluxe room 204, 20 Nov to 22 Nov/.test(x.alert) && /Reply to THIS message/.test(x.alert), x.alert);
  assert.strictEqual(x.escalation_id, 'e1');
  assert(/sorry we didn't get everything right/.test(reply(rec({ rating: 3, new_item: true, escalation_id: 'e2' })).text));
});
ok('tapping again does not alert staff twice, and the same score is just confirmed', () => {
  assert.strictEqual(reply(rec({ rating: 2, new_item: false, previous: 1 })).alert, '');
  assert(/already saved|is saved/.test(reply(rec({ rating: 4, previous: 4 })).text));
});
ok('refused taps get a plain explanation and never an alert', () => {
  for (const reason of ['not_yours', 'not_found', 'not_finished', 'expired', 'rating', undefined]) { const x = reply({ ok: false, reason }); assert(x.text.length > 10 && x.alert === '', reason); }
  assert(/checked out/.test(reply({ ok: false, reason: 'not_finished' }).text));
});
ok('no guest name is fine', () => { assert(/^Thank you! /.test(reply(rec({ rating: 5, guest_name: '' })).text)); });

// ---- the thank-you
const thanks = (settings, rows) => run('thanks_compose.js', { Context: [{ settings }] }, rows);
ok('the thank-you asks for a rating and goes to every guest it was found for', () => {
  const out = thanks({}, [{ id: 'b1', guests: { name: 'Ada Obi', telegram_chat_id: 42 } }, { id: 'b2', guests: { name: 'Tunde', telegram_chat_id: 43 } }, {}]);
  assert.strictEqual(out.length, 2); assert(/How was your stay\? Tap a rating below, from 1 \(poor\) to 5 \(excellent\)/.test(out[0].text) && /Ada Obi/.test(out[0].text) && /BrightSide Hotel/.test(out[0].text));
  assert.deepStrictEqual([out[0].booking_id, out[0].chat_id], ['b1', 42]);
});
ok('the public review link goes to everyone (no review gating) and is left out only when there is none', () => {
  assert(/review page: https:\/\/g\.page\/x/.test(thanks({ REVIEW_LINK: 'https://g.page/x' }, [{ id: 'b', guests: { name: 'A', telegram_chat_id: 1 } }])[0].text));
  assert(!/review page/.test(thanks({}, [{ id: 'b', guests: { name: 'A', telegram_chat_id: 1 } }])[0].text));
});

// ---- the weekly summary
const digest = s => run('digest_compose.js', {}, [s])[0];
const sum = o => ({ days: 7, rated: 12, asked: 15, average: 4.3, previous_average: 4.0, previous_rated: 9, distribution: { 1: 0, 2: 1, 3: 1, 4: 3, 5: 7 },
  low: [{ name: 'Ada Obi', room_type: 'Standard', room_number: '204', rating: 2, check_in: '2026-11-17', check_out: '2026-11-19', item_open: true },
        { name: 'Tunde', room_type: 'Suite', room_number: null, rating: 3, check_in: '2026-11-18', check_out: '2026-11-20', item_open: false }], ...o });
ok('the weekly summary reports the figures, the spread, and who needs attention', () => {
  const x = digest(sum());
  assert.strictEqual(x.send, true);
  for (const s of ['Guest ratings, last 7 days', 'Rated: 12 of 15 asked (80%)', 'Average: 4.3 out of 5 (the 7 days before: 4.0)', '5★ 7 · 4★ 3 · 3★ 1 · 2★ 1 · 1★ 0', 'Needs attention (3 or lower): 2',
    'Ada Obi, Standard 204, 2 out of 5, stayed 17 Nov to 19 Nov (still open)', 'Tunde, Suite, 3 out of 5']) assert(x.text.includes(s), s + '\n' + x.text);
  assert(!/Tunde.*still open/.test(x.text));
});
ok('a quiet week sends nothing; a week with no low scores says so; very long lists are cut', () => {
  assert.strictEqual(digest(sum({ rated: 0 })).send, false); assert.strictEqual(digest({}).send, false);
  assert(/No low scores this week/.test(digest(sum({ low: [] })).text));
  const many = Array.from({ length: 12 }, (_, i) => ({ name: 'G' + i, rating: 1, check_in: '2026-11-17', check_out: '2026-11-18' }));
  const t = digest(sum({ low: many })).text; assert(/and 4 more/.test(t) && t.length < 3000);
});
ok('the summary copes with a first-ever week (no earlier week, nobody counted as asked)', () => {
  const t = digest(sum({ previous_average: null, previous_rated: 0, asked: 0 })).text;
  assert(!/the 7 days before/.test(t) && /Rated: 12\n/.test(t), t);
});

console.log(`\n${n} rating tests passed`);
