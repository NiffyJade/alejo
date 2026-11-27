/* Alejo admin: Hotels. Every hotel on Alejo with an on/off switch, and what each still needs before it can serve guests well.
   Signed in as an Alejo admin, the list comes from admin_hotels() and the switch calls admin_set_hotel_active() (sql/030); the database
   refuses anyone else. Switched off, a hotel's bot ignores guests and the scheduler skips it; its dashboard and data stay. */
(async () => {
  'use strict';
  if (!document.body || document.body.dataset.page !== 'hotels') return;
  const release = window.AlejoBoot ? window.AlejoBoot.hold() : () => {};
  if (window.AlejoReady) await window.AlejoReady;
  const A = window.Alejo, LIVE = !!(A && A.live);
  if (LIVE && A.denied) { release(); return; }                       // live.js has already explained that this page is for Alejo admins

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
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const ago = (iso) => {
    if (!iso) return 'never';
    const m = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60000));
    return m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago';
  };
  const when = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });

  if (!LIVE) {                                                      // the public sample has no hotels to switch
    $('#hoList').replaceChildren(h('p', { class: 'er-empty', text: 'Sign in with an Alejo admin account to see and switch every hotel.' }));
    release(); return;
  }

  let hotels = [];
  // what a hotel still needs before it serves guests well; each item says why it matters
  const needs = (x) => [
    !x.bot_token && ['No Telegram bot', 'guests have nothing to message'],
    !x.staff_group && ['Bot not in a staff group', 'questions, bookings and alerts for staff reach nobody'],
    !(x.staff.owner > 0) && ['No owner account', 'nobody can see Earnings or manage the team'],
    !(x.rooms > 0) && ['No rooms on sale', 'the bot cannot take bookings'],
    x.facts_missing > 0 && [plural(x.facts_missing, 'key fact', 'key facts') + ' not filled in', 'name, address, phone, check-in or checkout'],
  ].filter(Boolean);

  const card = (x) => {
    const gaps = needs(x), id = 'ho-' + x.slug;
    const tog = h('button', { class: 'tog', type: 'button', role: 'switch', 'aria-checked': String(!!x.active), 'aria-labelledby': id + '-n ' + id + '-s' });
    tog.addEventListener('click', () => flip(x, tog));
    const staff = x.staff || {};
    return h('article', { class: 'ho-card' + (x.active ? '' : ' off'), 'aria-labelledby': id + '-n' },
      h('div', { class: 'ho-top' },
        h('div', { class: 'ho-id' },
          h('h2', { id: id + '-n', text: x.name }),
          h('small', { text: [x.slug, x.bot_username ? '@' + x.bot_username : 'no bot yet', x.timezone].join(' · ') })),
        h('div', { class: 'ho-sw' }, h('span', { class: 'pill ' + (x.active ? 'on' : ''), id: id + '-s', text: x.active ? 'On' : 'Off' }), tog)),
      h('dl', { class: 'ho-facts' },
        h('div', {}, h('dt', { text: 'Staff accounts' }), h('dd', { text: `${staff.owner || 0} owner · ${staff.manager || 0} manager · ${staff.staff || 0} staff` })),
        h('div', {}, h('dt', { text: 'Rooms on sale' }), h('dd', { text: x.rooms ? `${x.rooms} in ${plural(x.room_types, 'type', 'types')}` : 'none' })),
        h('div', {}, h('dt', { text: 'Bookings, last 30 days' }), h('dd', { text: String(x.bookings_30d) })),
        h('div', {}, h('dt', { text: 'Last guest message' }), h('dd', { text: ago(x.last_guest_message) }))),
      gaps.length
        ? h('ul', { class: 'ho-gaps', 'aria-label': 'Still needed' }, gaps.map(([what, why]) => h('li', {}, h('b', { text: what }), ': ' + why)))
        : h('p', { class: 'ho-ready', text: 'Ready: bot, staff group, owner, rooms and key facts are all in place.' }),
      h('div', { class: 'ho-foot' },
        h('small', { text: x.active_changed_at ? `Switched ${x.active ? 'on' : 'off'} ${when(x.active_changed_at)}${x.active_changed_by ? ' by ' + x.active_changed_by : ''}` : `Added ${when(x.created_at)}` }),
        h('button', { class: 'btn line small', type: 'button', onclick: () => A.openHotel(x.id), text: 'Open dashboard' })));
  };

  const render = () => {
    const on = hotels.filter((x) => x.active).length;
    $('#hoNote').textContent = `${plural(hotels.length, 'hotel', 'hotels')}, ${on} switched on.`;
    $('#hoList').replaceChildren(...(hotels.length ? hotels.map(card) : [h('p', { class: 'er-empty', text: 'No hotels yet.' })]));
  };

  const flip = async (x, tog) => {
    const want = !x.active, gaps = needs(x);
    const ask = want
      ? `Switch on ${x.name}? Its bot will answer guests and reminders will start.` + (gaps.length ? `\n\nStill missing:\n- ${gaps.map((g) => g[0]).join('\n- ')}` : '')
      : `Switch off ${x.name}? Its bot stops answering guests, and no reminders or alerts are sent until you switch it back on. Its dashboard and data stay.`;
    if (!window.confirm(ask)) return;
    tog.disabled = true; $('#hoErr').textContent = '';
    try {
      const r = await A.setHotelActive(x.id, want);
      Object.assign(x, { active: r.active, active_changed_at: r.active_changed_at, active_changed_by: r.active_changed_by });
      render();
      $('#hoNote').textContent = `${x.name} is switched ${r.active ? 'on' : 'off'}.`;
      const again = document.querySelector(`#ho-${x.slug}-n`); if (again) again.closest('.ho-card').querySelector('.tog').focus();
    } catch (e) {
      tog.disabled = false;
      $('#hoErr').textContent = /Only Alejo admins/.test(e.message) ? 'Only Alejo admins can switch a hotel on or off.' : e.message;
    }
  };

  try { hotels = await A.keepTrying(() => A.adminHotels()) || []; render(); }
  catch (e) { $('#hoErr').textContent = /admin_hotels|Could not find the function/i.test(e.message) ? 'This page is not switched on yet (sql/030).' : e.message; }
  finally { release(); }
})();
