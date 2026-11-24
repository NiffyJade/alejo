/* Alejo dashboard: Team. The hotel's owner adds people, changes their role, resets a password or removes them.
   Everything goes through the staff-team edge function (it checks the caller is THIS hotel's owner, or Alejo's admin); the browser itself
   cannot create logins. A new or reset login gets a one-time password shown here once: the person must choose their own at first sign-in. */
(async () => {
  'use strict';
  if (!document.body || document.body.dataset.page !== 'team') return;
  if (window.AlejoReady) await window.AlejoReady;
  const A = window.Alejo, LIVE = !!(A && A.live);

  const $ = (s, r = document) => r.querySelector(s);
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  };
  const ROLES = [['staff', 'Staff'], ['manager', 'Manager'], ['owner', 'Owner']];
  const initials = (n) => String(n || '?').split(/[ @.]/).filter(Boolean).map((p) => p[0].toUpperCase()).slice(0, 2).join('');

  if (!LIVE) {                                                   // the public sample dashboard has no team to manage
    $('#tlist').replaceChildren(h('p', { class: 'foot-note', text: 'Sign in as the hotel owner to manage your team.' }));
    $('#tadd').hidden = true;
    return;
  }
  if (A.denied) return;                                          // live.js has already explained that this page is for the owner

  const dlg = $('#mdlg'), body = $('#mbody'), title = $('#mdt');
  const show = (t, ...nodes) => { title.textContent = t; body.replaceChildren(...nodes.filter(Boolean)); if (!dlg.open) dlg.showModal(); };
  $('#mclose').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  const say = (t) => { const s = $('#tstatus'); s.textContent = ''; setTimeout(() => { s.textContent = t; }, 40); };
  const fail = (e) => { $('#terr').textContent = e && e.message ? e.message : String(e); };
  const clearFail = () => { $('#terr').textContent = ''; };

  let team = [], you = '';
  const load = async () => {
    clearFail();
    try { const r = await A.team('list'); team = r.team || []; you = r.you || ''; render(); }
    catch (e) { fail(e); }
  };

  // shows a one-time password to hand over (never stored anywhere on this page after the dialog closes)
  const showPassword = (who, password, why) => {
    const box = h('input', { class: 'minput secret', type: 'text', readonly: true, value: password, 'aria-label': 'One-time password', onclick: (e) => e.target.select() });
    const copy = h('button', { class: 'btn', type: 'button', text: 'Copy password' });
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(password); copy.textContent = 'Copied'; } catch (e) { box.select(); copy.textContent = 'Press Ctrl+C to copy'; }
    });
    show(why, h('div', { class: 'msec' },
      h('p', { text: `Give ${who} this one-time password, and tell them to sign in at the Alejo login page with their email.` }),
      box,
      h('p', { class: 'mhint', text: 'It is shown only now. The first time they sign in they will be asked to choose their own password, so this one stops working straight away. If you lose it, use Reset password.' }),
      h('div', { class: 'mact' }, copy, h('button', { class: 'btn line', type: 'button', text: 'Done', onclick: () => dlg.close() }))));
    box.select();
  };

  const act = async (btn, fn) => {
    clearFail(); btn.disabled = true;
    try { await fn(); } catch (e) { fail(e); } finally { btn.disabled = false; }
  };

  const render = () => {
    const rows = team.map((m) => {
      const self = m.email === you;
      const sel = h('select', { class: 'minput', 'aria-label': 'Role of ' + (m.name || m.email) }, ROLES.map(([v, t]) => h('option', Object.assign({ value: v, text: t }, v === m.role ? { selected: true } : {}))));
      if (self) sel.disabled = true;
      sel.addEventListener('change', () => act(sel, async () => {
        const was = m.role;
        try { await A.team('set_role', { email: m.email, role: sel.value }); say(`${m.name || m.email} is now ${sel.value}.`); await load(); }
        catch (e) { sel.value = was; throw e; }
      }));
      const reset = h('button', { class: 'btn line small', type: 'button', text: 'Reset password', 'aria-label': 'Reset the password of ' + (m.name || m.email) });
      reset.addEventListener('click', () => {
        if (!window.confirm(`Reset the password of ${m.name || m.email}? Their current password stops working at once.`)) return;
        act(reset, async () => { const r = await A.team('reset_password', { email: m.email }); showPassword(m.name || m.email, r.password, 'New one-time password'); });
      });
      const remove = h('button', { class: 'btn line small', type: 'button', text: 'Remove', 'aria-label': 'Remove ' + (m.name || m.email) });
      remove.addEventListener('click', () => {
        if (!window.confirm(`Remove ${m.name || m.email} from the team? They will no longer be able to sign in to this hotel.`)) return;
        act(remove, async () => { await A.team('remove', { email: m.email }); say(`${m.name || m.email} was removed.`); await load(); });
      });
      return h('div', { class: 'tr team-cols', role: 'row' },
        h('div', { class: 'id' }, h('span', { class: 'av', 'aria-hidden': 'true', text: initials(m.name || m.email) }), h('div', {}, h('b', { text: (m.name || m.email) + (self ? ' (you)' : '') }), h('small', { text: m.email }))),
        h('div', {}, sel),
        h('div', { class: 'mact' }, self ? null : [reset, remove]));
    });
    $('#tlist').replaceChildren(...(rows.length ? rows : [h('p', { class: 'foot-note', text: 'Nobody is on the team yet.' })]));
  };

  $('#tadd').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector('button[type=submit]');
    act(btn, async () => {
      const name = f.elements.pname.value.trim(), email = f.elements.pemail.value.trim().toLowerCase(), role = f.elements.prole.value;
      if (!name || !email) throw new Error('Enter the person\'s name and email.');
      const r = await A.team('add', { name, email, role });
      f.reset(); await load();
      if (r.password) showPassword(name, r.password, 'Login created');
      else show('Added to the team', h('div', { class: 'msec' }, h('p', { text: `${name} already has an Alejo login, so they sign in with their existing password. Nothing was changed on their account.` }), h('div', { class: 'mact' }, h('button', { class: 'btn', type: 'button', text: 'Done', onclick: () => dlg.close() }))));
      say(`${name} was added as ${role}.`);
    });
  });

  load();
})();
