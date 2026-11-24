// Tests the Team screen's rules (supabase/functions/staff-team) in Node, no network. Run: node execution/test_staff_team.js
const fs = require('fs'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../supabase/functions/staff-team/index.ts', 'utf8');
const block = src.slice(src.indexOf('// ---- pure:start'), src.indexOf('// ---- pure:end'));
const { decide, newPassword, ROLES } = new Function('crypto', block + '\nreturn { decide, newPassword, ROLES };')(require('crypto').webcrypto);

const team = [{ email: 'owner@h.com', role: 'owner' }, { email: 'boss2@h.com', role: 'owner' }, { email: 'mgr@h.com', role: 'manager' }, { email: 'desk@h.com', role: 'staff' }];
const one = [{ email: 'owner@h.com', role: 'owner' }, { email: 'desk@h.com', role: 'staff' }];
const owner = { email: 'owner@h.com', role: 'owner' }, admin = { email: 'boss@alejo.com', role: 'admin' };
const t = (email, extra = {}) => ({ email, isAdmin: false, otherHotels: 0, ...extra });
const d = (o) => decide({ team, caller: owner, ...o });
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok -', name); };
const refused = (r, status, re) => { assert(r.error, 'should be refused'); assert.strictEqual(r.status, status); if (re) assert(re.test(r.error), r.error); };

ok('only an owner or Alejo\'s admin may manage the team', () => {
  for (const role of ['staff', 'manager', null, undefined, 'anything'])
    for (const action of ['list', 'add', 'set_role', 'remove', 'reset_password'])
      refused(decide({ action, team, caller: role ? { email: 'x@h.com', role } : null, target: t('desk@h.com'), role: 'staff' }), 403, /owner/i);
  assert(d({ action: 'list' }).ok); assert(decide({ action: 'list', team, caller: admin }).ok);
});
ok('adding: valid email, a real role, and not already on the team', () => {
  assert(d({ action: 'add', target: t('new@h.com'), role: 'staff' }).ok && d({ action: 'add', target: t('new@h.com'), role: 'manager' }).ok && d({ action: 'add', target: t('new@h.com'), role: 'owner' }).ok);
  for (const bad of ['', 'nope', 'a@b', 'a b@c.com', "x'y@c.com", '<a@c.com>', 'a@c.com,b@c.com', 'a'.repeat(130) + '@c.com']) refused(d({ action: 'add', target: t(bad), role: 'staff' }), 400, /email/i);
  for (const bad of ['admin', 'superuser', '', 'OWNER', undefined]) refused(d({ action: 'add', target: t('new@h.com'), role: bad }), 400, /choose/i);
  refused(d({ action: 'add', target: t('desk@h.com'), role: 'staff' }), 409);
});
ok('nobody can make an admin from here (admin is not a role this screen can give)', () => {
  assert.deepStrictEqual(ROLES, ['staff', 'manager', 'owner']);
  refused(d({ action: 'set_role', target: t('desk@h.com'), role: 'admin' }), 400);
  refused(decide({ action: 'add', team, caller: admin, target: t('new@h.com'), role: 'admin' }), 400);
});
ok('changing a role: only for people on the team, never your own, never the last owner', () => {
  assert(d({ action: 'set_role', target: t('desk@h.com'), role: 'manager' }).ok);
  assert(d({ action: 'set_role', target: t('mgr@h.com'), role: 'staff' }).ok);
  refused(d({ action: 'set_role', target: t('nobody@h.com'), role: 'staff' }), 404);
  refused(d({ action: 'set_role', target: t('owner@h.com'), role: 'staff' }), 400, /own role/);
  assert(d({ action: 'set_role', target: t('boss2@h.com'), role: 'manager' }).ok, 'with two owners one may be demoted');
  refused(decide({ action: 'set_role', team: one, caller: admin, target: t('owner@h.com'), role: 'staff' }), 400, /at least one owner/);
});
ok('removing: not yourself, not the last owner, not someone off the team', () => {
  assert(d({ action: 'remove', target: t('desk@h.com') }).ok && d({ action: 'remove', target: t('boss2@h.com') }).ok);
  refused(d({ action: 'remove', target: t('owner@h.com') }), 400, /yourself/);
  refused(d({ action: 'remove', target: t('nobody@h.com') }), 404);
  refused(decide({ action: 'remove', team: one, caller: admin, target: t('owner@h.com') }), 400, /at least one owner/);
});
ok('a password reset is refused for yourself, and for anyone who also works at another hotel', () => {
  assert(d({ action: 'reset_password', target: t('desk@h.com') }).ok);
  refused(d({ action: 'reset_password', target: t('owner@h.com') }), 400, /Change password/);
  refused(d({ action: 'reset_password', target: t('desk@h.com', { otherHotels: 1 }) }), 403, /another hotel/);
  refused(d({ action: 'reset_password', target: t('desk@h.com', { otherHotels: 3 }) }), 403, /another hotel/);
});
ok("Alejo's own admin accounts cannot be touched by a hotel's owner, but can by Alejo's admin", () => {
  const withAdmin = [...team, { email: 'boss@alejo.com', role: 'manager' }];
  for (const action of ['set_role', 'remove', 'reset_password'])
    refused(decide({ action, team: withAdmin, caller: owner, target: t('boss@alejo.com', { isAdmin: true }), role: 'staff' }), 403, /Alejo's own team/);
  assert(decide({ action: 'remove', team: withAdmin, caller: { email: 'founder@alejo.com', role: 'admin' }, target: t('boss@alejo.com', { isAdmin: true }) }).ok);
});
ok('an unknown action is refused', () => refused(d({ action: 'make_me_admin', target: t('desk@h.com') }), 400));
ok('one-time passwords: 14 characters, no look-alike characters, never repeated', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) { const p = newPassword(); assert(/^[A-HJ-NP-Za-km-z2-9]{14}$/.test(p), p); seen.add(p); }
  assert.strictEqual(seen.size, 2000, 'passwords repeated');
  const chars = new Set(Array.from(seen).join('')); assert(chars.size > 45, 'too few distinct characters used: ' + chars.size);
});
console.log(`\n${n} team rule tests passed`);
