// Offline test of the dashboard's data layer (website/app/live.js) against a FAKE backend: no network, no real login.
// Run: node execution/test_dashboard_scope.js
// Checks that, signed in, every request names the hotel on screen; that switching hotel switches every request; that writes carry the hotel;
// and that a person who is staff of one hotel only is never shown a switcher.
const fs = require('fs'), path = require('path'), assert = require('assert'), vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'website', 'app', 'live.js'), 'utf8');
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const jwt = (email, mustChange = false) => 'x.' + Buffer.from(JSON.stringify({ email, user_metadata: { must_change_password: !!mustChange } })).toString('base64url') + '.y';

async function boot({ hotels, stored, email = 'owner@test.invalid', staffRows, admin = false, page = 'overview', mustChange = false, putFails = false }) {
  const calls = [], appended = [], store = { alejo_auth: JSON.stringify({ access: jwt(email, mustChange), refresh: 'r', exp: Date.now() + 3600e3 }) };
  if (stored) store.alejo_hotel = stored;
  const slot = { children: [], append(e) { this.children.push(e); } };
  const mk = () => ({ children: [], dataset: {}, style: {}, _l: {}, setAttribute() {}, append(...e) { this.children.push(...e); }, addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); },
    replaceChildren() {}, showModal() { this.opened = true; }, close() { this.opened = false; }, remove() { this.removed = true; }, focus() {} });
  const link = (href) => ({ href, getAttribute: () => href, removed: false, remove() { this.removed = true; } });
  const anchors = ['/app/index.html', '/app/inbox.html', '/app/enquiries.html', '/app/ratings.html', '/app/bookings.html', '/app/knowledge.html', '/app/settings.html', '/app/team.html'].map(link);
  const navHead = { removed: false, remove() { this.removed = true; } }, mainEl = { replaced: null, replaceChildren(...n) { this.replaced = n; } };
  const document = { readyState: 'complete', body: { dataset: { page }, append(el) { appended.push(el); } }, hidden: false, addEventListener() {}, createElement: () => mk(),
    getElementById: (id) => (id === 'authSlot' ? slot : id === 'main' ? mainEl : null), querySelector: (q) => (q === '.nav .nav-h' ? navHead : null),
    querySelectorAll: (q) => (q === '.nav a' ? anchors : []) };
  const fetch = async (url, opts = {}) => {
    const u = String(url), m = (opts.method || 'GET').toUpperCase();
    calls.push({ url: u, method: m, body: opts.body ? JSON.parse(opts.body) : null });
    const ok = (j) => ({ ok: true, status: 200, json: async () => j });
    if (u.includes('/auth/v1/token')) return ok({ access_token: jwt(email, false), refresh_token: 'r2', expires_in: 3600 });
    if (u.includes('/auth/v1/user') && m === 'PUT') return putFails ? { ok: false, status: 422, json: async () => ({ msg: 'New password should be different from the old password.' }) } : ok({});
    if (u.includes('/functions/v1/staff-team')) return ok({ team: [], you: email });
    if (u.includes('/rest/v1/hotels?')) return ok(hotels);
    if (u.includes('/rest/v1/staff_users?')) return ok(staffRows);
    if (u.includes('/rpc/is_platform_admin')) return ok(admin);
    if (u.includes('/rest/v1/')) return ok(m === 'GET' ? [] : null);
    return ok({});
  };
  const window = { FD: {}, location: {}, addEventListener() {}, dispatchEvent() {}, supabase: undefined, FD_FACTS: {} };
  const ctx = { window, document, fetch, localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } },
    location: { href: '', reload() {}, replace() {} }, setTimeout, clearTimeout, setInterval: () => 0, console, crypto: { randomUUID: () => 'uuid' }, CustomEvent: function () {}, Intl, Date, JSON, Promise, encodeURIComponent, atob: (s) => Buffer.from(s, 'base64').toString(), Object, Array, Set, String, Number, Math, Error, Blob: undefined };
  ctx.window.localStorage = ctx.localStorage;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const readyP = ctx.window.AlejoReady;
  const ready = mustChange ? undefined : await readyP;            // a first sign-in waits for the new password, so the caller drives it
  return { calls, window: ctx.window, ready, readyP, slot, store, anchors, navHead, mainEl, appended };
}

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log('ok -', name); };
const rows = (calls) => calls.filter((c) => /\/rest\/v1\/(guests|bookings|escalations|messages|room_types|knowledge_entries|hotel_settings|booking_payments|room_blocks)\?/.test(c.url));

(async () => {
  const hotels = [{ id: A, slug: 'a', name: 'Hotel A', timezone: 'Africa/Lagos' }, { id: B, slug: 'b', name: 'Hotel B', timezone: 'Africa/Accra' }];

  await ok('every table read names the hotel on screen (the first hotel by default)', async () => {
    const t = await boot({ hotels, staffRows: [{ name: 'Ada', email: 'owner@test.invalid', role: 'owner' }] });
    assert.strictEqual(t.ready, true);
    const reads = rows(t.calls);
    assert.strictEqual(reads.length, 9);
    reads.forEach((c) => assert(c.url.includes('hotel_id=eq.' + A) && !c.url.includes(B), 'unscoped read: ' + c.url));
    assert(t.calls.find((c) => c.url.includes('/rest/v1/staff_users?')).url.includes('hotel_id=eq.' + A), 'own staff row is looked up for that hotel');
    assert(t.calls.find((c) => c.url.includes('/rest/v1/staff_users?')).url.includes('email=eq.owner%40test.invalid'), 'and only the caller\'s own row');
  });

  await ok('a remembered choice of hotel B switches every read to B', async () => {
    const t = await boot({ hotels, stored: B, staffRows: [{ name: 'Ada', email: 'owner@test.invalid', role: 'owner' }] });
    rows(t.calls).forEach((c) => assert(c.url.includes('hotel_id=eq.' + B) && !c.url.includes(A), 'wrong hotel: ' + c.url));
    assert.strictEqual(t.window.Alejo.hotel().id, B);
  });

  await ok('a remembered hotel this account may not open is ignored (falls back to an allowed one)', async () => {
    const t = await boot({ hotels: [hotels[0]], stored: B, staffRows: [{ name: 'Ada', email: 'owner@test.invalid', role: 'owner' }] });
    rows(t.calls).forEach((c) => assert(c.url.includes('hotel_id=eq.' + A), c.url));
    assert.strictEqual(t.slot.children.length, 2, 'Change password + Sign out only: a one-hotel account gets no switcher');
  });

  await ok('someone with two hotels gets a switcher before Sign out', async () => {
    const t = await boot({ hotels, staffRows: [{ name: 'Ada', email: 'owner@test.invalid', role: 'owner' }] });
    assert.strictEqual(t.slot.children.length, 3, 'switcher + Change password + Sign out');
  });

  await ok('Alejo\'s admin with no staff row at a hotel can still open it (as owner)', async () => {
    const t = await boot({ hotels, staffRows: [], admin: true, email: 'boss@test.invalid' });
    assert.strictEqual(t.ready, true);
    assert.strictEqual(t.window.Alejo.me.role, 'admin');
  });

  await ok('a person who is staff nowhere (no hotels, no staff row) is refused', async () => {
    const t = await boot({ hotels: [], staffRows: [] });
    assert.strictEqual(t.ready, false);
  });

  await ok('writes carry the hotel: settings, answers, resolve, take, bookings, blocks, reports, copilot', async () => {
    const t = await boot({ hotels, stored: B, staffRows: [{ name: 'Ada', email: 'owner@test.invalid', role: 'owner' }] });
    const A_ = t.window.Alejo; t.calls.length = 0;
    await A_.saveFact('WIFI_NAME', 'x');
    await A_.addAnswer('q', 'a');
    await A_.deleteAnswer('staff-1');
    await A_.resolve(['e1']);
    await A_.take(['e1'], 'Ada');
    await A_.manage.availability('2026-12-20', '2026-12-21');
    await A_.manage.create({ name: 'N', type: 'Deluxe', ci: '2026-12-20', co: '2026-12-21', source: 'walk-in' });
    await A_.manage.block({ type: 'Deluxe', rooms: 1, start: '2026-12-20', end: '2026-12-21' });
    await A_.ratings(7); await A_.report(7);
    await A_.ask('who is arriving?');
    const by = (frag) => t.calls.find((c) => c.url.includes(frag));
    assert(by('hotel_settings?on_conflict=hotel_id,key').body.hotel_id === B, 'saveFact');
    assert(by('knowledge_entries').method === 'POST' && by('knowledge_entries').body.hotel_id === B, 'addAnswer');
    assert(t.calls.find((c) => c.method === 'DELETE').url.includes('hotel_id=eq.' + B), 'deleteAnswer');
    t.calls.filter((c) => c.url.includes('/escalations?')).forEach((c) => assert(c.url.includes('hotel_id=eq.' + B), 'escalation change: ' + c.url));
    assert.strictEqual(by('/functions/v1/staff-copilot').body.hotel_id, B, 'copilot question');
    ['staff_availability', 'staff_create_booking', 'staff_add_block', 'ratings_report', 'enquiry_report'].forEach((fn) => assert.strictEqual(by('/rpc/' + fn).body.p_hotel, B, fn));
    assert.strictEqual(t.calls.filter((c) => c.url.includes('hotel_id') || (c.body && (c.body.hotel_id || c.body.p_hotel))).length, t.calls.length, 'a request without a hotel');
  });

  const gone = (t) => t.anchors.filter((a) => a.removed).map((a) => a.href.replace('/app/', '').replace('.html', ''));
  const as = (role, page) => boot({ hotels: [hotels[0]], page, staffRows: [{ name: 'X', email: 'owner@test.invalid', role }] });

  await ok('a STAFF account: can() follows the ranks, and the four manager pages leave the menu', async () => {
    const t = await as('staff', 'overview');
    const A_ = t.window.Alejo;
    assert(A_.can('staff') && !A_.can('manager') && !A_.can('owner') && !A_.can('admin'), 'staff ranks');
    assert.deepStrictEqual(gone(t).sort(), ['enquiries', 'knowledge', 'ratings', 'settings', 'team'], 'removed links: ' + gone(t));
    assert(t.navHead.removed, 'the "Your hotel" heading goes with them');
    assert.strictEqual(A_.denied, false, 'Today is open to staff');
    assert.strictEqual(t.mainEl.replaced, null, 'Today is not replaced');
  });

  await ok('a STAFF account opening a manager page gets the explanation, not the page', async () => {
    for (const page of ['settings', 'facts', 'ratings', 'enquiries']) {
      const t = await as('staff', page);
      assert.strictEqual(t.window.Alejo.denied, true, page);
      assert(t.mainEl.replaced && t.mainEl.replaced.length === 1, 'page content replaced: ' + page);
    }
    for (const page of ['overview', 'inbox', 'bookings']) assert.strictEqual((await as('staff', page)).window.Alejo.denied, false, page + ' stays open');
  });

  await ok('a MANAGER and an OWNER keep every page; only manager+ powers are shown', async () => {
    for (const role of ['manager', 'owner']) {
      const t = await as(role, 'settings');
      assert.strictEqual(t.window.Alejo.denied, false, role);
      assert.deepStrictEqual(gone(t), role === 'manager' ? ['team'] : [], role + ': only an owner gets the Team link');
      assert(t.window.Alejo.can('manager'), role);
    }
    assert(!(await as('manager', 'overview')).window.Alejo.can('owner'), 'a manager is not an owner');
    assert((await as('owner', 'overview')).window.Alejo.can('owner'), 'an owner is');
  });

  await ok("Alejo's admin (no staff row) is 'admin': outranks owner, sees every page", async () => {
    const t = await boot({ hotels, staffRows: [], admin: true, email: 'boss@test.invalid', page: 'settings' });
    assert.strictEqual(t.window.Alejo.me.role, 'admin');
    assert(t.window.Alejo.can('owner') && t.window.Alejo.can('admin'));
    assert.strictEqual(t.window.Alejo.denied, false);
    assert.deepStrictEqual(gone(t), []);
  });

  await ok('the Team page is for owners (and Alejo\'s admin) only: staff and managers get the explanation', async () => {
    for (const role of ['staff', 'manager']) { const t = await as(role, 'team'); assert.strictEqual(t.window.Alejo.denied, true, role); assert.strictEqual(t.window.Alejo.deniedFor, 'owner'); assert(t.mainEl.replaced, role + ' page replaced'); }
    for (const role of ['owner']) { const t = await as(role, 'team'); assert.strictEqual(t.window.Alejo.denied, false, role); assert.strictEqual(t.mainEl.replaced, null); }
    const t = await boot({ hotels, staffRows: [], admin: true, email: 'boss@test.invalid', page: 'team' });
    assert.strictEqual(t.window.Alejo.denied, false, 'admin');
  });

  await ok('Team calls go to the staff-team function with the action and the hotel on screen', async () => {
    const t = await boot({ hotels, stored: B, staffRows: [{ name: 'Ada', email: 'owner@test.invalid', role: 'owner' }] });
    t.calls.length = 0;
    await t.window.Alejo.team('add', { name: 'Tolu', email: 'tolu@h.com', role: 'staff' });
    await t.window.Alejo.team('list');
    const c = t.calls.filter((x) => x.url.includes('/functions/v1/staff-team'));
    assert.strictEqual(c.length, 2);
    assert.deepStrictEqual([c[0].body.action, c[0].body.hotel_id, c[0].body.email, c[0].body.role], ['add', B, 'tolu@h.com', 'staff']);
    assert.deepStrictEqual([c[1].body.action, c[1].body.hotel_id], ['list', B]);
  });

  await ok('a FIRST sign-in with a one-time password is stopped at "choose your own password": nothing loads until then', async () => {
    const t = await boot({ hotels, staffRows: [{ name: 'New', email: 'owner@test.invalid', role: 'staff' }], mustChange: true });
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(t.appended.length, 1, 'the password dialog is on screen');
    assert.strictEqual(t.calls.filter((c) => c.url.includes('/rest/v1/')).length, 0, 'no hotel data was requested yet');
    assert.strictEqual(t.window.Alejo.live, false);
    const dlg = t.appended[0], form = dlg.children[1], [p1, p2] = [form.children[1].children[1], form.children[2].children[1]], err = form.children[3];
    assert.strictEqual(dlg.children[0].children.length, 1, 'no Close button on the forced dialog');
    let prevented = false; dlg._l.cancel[0]({ preventDefault() { prevented = true; } });
    assert(prevented, 'Escape cannot skip it');
    const submit = () => form._l.submit[0]({ preventDefault() {} });
    p1.value = 'short'; p2.value = 'short'; await submit();
    assert(/at least 10/.test(err.textContent), 'too short: ' + err.textContent);
    p1.value = 'a-long-enough-password'; p2.value = 'a-different-one-here'; await submit();
    assert(/not the same/.test(err.textContent), 'mismatch: ' + err.textContent);
    assert.strictEqual(t.calls.filter((c) => c.method === 'PUT').length, 0, 'nothing was sent for a bad password');
    p2.value = 'a-long-enough-password'; await submit();
    const put = t.calls.find((c) => c.method === 'PUT' && c.url.includes('/auth/v1/user'));
    assert(put && put.body.password === 'a-long-enough-password' && put.body.data.must_change_password === false, 'the new password and the cleared flag were sent');
    assert(t.calls.some((c) => c.url.includes('grant_type=refresh_token')), 'a fresh token was fetched');
    assert.strictEqual(await t.readyP, true, 'the dashboard loads once the password is changed');
    assert(t.calls.some((c) => c.url.includes('/rest/v1/guests?')), 'and only then the hotel data');
    assert(dlg.removed, 'the dialog is gone');
  });

  await ok('a refused new password (for example the same as the old one) keeps the person on the dialog', async () => {
    const t = await boot({ hotels, staffRows: [{ name: 'New', email: 'owner@test.invalid', role: 'staff' }], mustChange: true, putFails: true });
    await new Promise((r) => setTimeout(r, 20));
    const form = t.appended[0].children[1], err = form.children[3];
    form.children[1].children[1].value = form.children[2].children[1].value = 'a-long-enough-password';
    await form._l.submit[0]({ preventDefault() {} });
    assert(/different/.test(err.textContent), err.textContent);
    assert.strictEqual(t.calls.filter((c) => c.url.includes('/rest/v1/')).length, 0, 'still no data');
    assert(!t.appended[0].removed, 'the dialog stays');
  });

  await ok('anyone can change their password later (a Close button, nothing forced)', async () => {
    const t = await boot({ hotels, staffRows: [{ name: 'Ada', email: 'owner@test.invalid', role: 'owner' }] });
    const before = t.appended.length, p = t.window.Alejo.changePassword();
    assert.strictEqual(t.appended.length, before + 1);
    const dlg = t.appended[before]; assert.strictEqual(dlg.children[0].children.length, 2, 'heading + Close');
    dlg.children[0].children[1]._l.click[0](); assert.strictEqual(await p, false, 'closing changes nothing');
    assert(t.slot.children.length >= 2, 'the header has Change password and Sign out');
  });

  console.log(`\n${n} dashboard scope tests passed`);
})().catch((e) => { console.error(e); process.exit(1); });
