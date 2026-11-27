/* Alejo dashboard: the loading state. Loaded in <head> on every dashboard page (not the login page).
   Signed out, it does nothing and the page shows the public sample hotel. Signed in, it marks the page as booting before anything is
   painted, so the sample names, counts and figures written into the page are never shown to a real hotel. Each block marked
   data-skel="kind:count" gets a grey outline of its real layout (cards, rows, a chart, a month) that breathes until the hotel's
   own data is on screen; nothing moves when the data lands, because the outlines have the real blocks' sizes.
   live.js calls AlejoBoot.ready() when the hotel's rows have arrived. A page that fetches more before it can draw (Earnings)
   takes a hold first and releases it after its first render. There is no time limit: without a network the loading screen stays,
   says so, and live.js keeps trying; the sample hotel is never shown to someone who is signed in. */
(function () {
  'use strict';
  var root = document.documentElement, signed = false;
  try { signed = !!localStorage.getItem('alejo_auth'); } catch (e) { /* private mode: treat as signed out */ }
  var noop = function () {};
  if (!signed || /\/login(\.html)?$/.test(location.pathname)) { window.AlejoBoot = { hold: function () { return noop; }, ready: noop, fill: noop, done: noop, waiting: noop }; return; }
  root.classList.add('booting');

  var holds = 0, ready = false, done = false, filled = false;
  var el = function (cls, style) { var d = document.createElement('div'); d.className = 'sk ' + cls; if (style) d.setAttribute('style', style); d.setAttribute('aria-hidden', 'true'); return d; };
  var bar = function (w, hgt, i) { return el('sk-b', 'width:' + w + ';height:' + hgt + 'px;--i:' + (i || 0)); };
  var HEIGHTS = [46, 62, 54, 78, 58, 70, 88, 64, 52, 74, 92, 68, 60, 82, 56, 72, 86, 66];
  var SHAPES = {
    tiles: function (n) { var out = []; for (var i = 0; i < n; i++) { var t = el('sk-tile'); t.append(bar('44%', 12, i), bar('64%', 30, i), bar('52%', 11, i)); out.push(t); } return out; },
    rows: function (n) { var out = []; for (var i = 0; i < n; i++) { var r = el('sk-row'), l = el('sk-lines'); l.append(bar((52 + (i * 13) % 30) + '%', 14, i), bar((30 + (i * 7) % 20) + '%', 11, i)); r.append(el('sk-c sk-b', '--i:' + i), l, bar('72px', 14, i)); out.push(r); } return out; },
    bars: function (n) { var out = []; for (var i = 0; i < n; i++) { var r = el('sk-barrow'); r.append(bar((36 + (i * 11) % 30) + '%', 13, i), bar((92 - i * 14) + '%', 8, i)); out.push(r); } return out; },
    chart: function (n) { var c = el('sk-chart'); for (var i = 0; i < (n || 18); i++) c.append(el('sk-col sk-b', 'height:' + HEIGHTS[i % HEIGHTS.length] + '%;--i:' + i)); return [c]; },
    cal: function () { var g = el('sk-cal'); for (var i = 0; i < 35; i++) g.append(el('sk-cell sk-b', '--i:' + (i % 7))); return [g]; },
    pills: function (n) { var out = []; for (var i = 0; i < n; i++) out.push(el('sk-pill sk-b', '--i:' + i)); return out; },
    block: function (n) { return [el('sk-block sk-b', 'height:' + (n || 160) + 'px')]; },
  };

  // the bell from Alejo's mark, ringing, in place of the "Sample data" pill
  var bell = function () {
    var n = document.getElementById('demoNote');
    if (!n) return;
    n.classList.add('boot-note');
    n.innerHTML = '<svg class="boot-bell" viewBox="0 0 24 24" aria-hidden="true"><g class="dome"><path d="M3 17a9 9 0 0 1 18 0z" fill="currentColor"/><circle class="dot" cx="12" cy="6.2" r="2" fill="#16a34a"/></g><rect x="2" y="18.5" width="20" height="2.5" rx="1" fill="currentColor"/></svg><span class="boot-note-t">Loading your hotel</span>';
  };

  // The sample hotel's words are taken out of the page, not just hidden, so a screen reader never reads them either. Each keeps its
  // width (non-breaking spaces) for the grey bar. live.js writes the real name, role and hotel into them; a page subtitle that
  // nothing rewrites gets its own words back, with the hotel's real name in place of the sample's.
  var stash = [];
  var blank = function () {
    document.querySelectorAll('.scope b, .scope span, #meName, #meRole, #acct, #needCount, .title-row .sub').forEach(function (el) {
      var t = el.textContent, ph = t.replace(/[^\s]/g, '\u00a0');
      stash.push({ el: el, text: t, ph: ph, sub: el.classList.contains('sub') });
      el.textContent = ph;
      if (el.hasAttribute('title')) el.removeAttribute('title');
    });
  };
  var restore = function () {
    var name = window.Alejo && window.Alejo.hotel && window.Alejo.hotel() ? window.Alejo.hotel().name : '';
    stash.forEach(function (s) { if (s.sub && s.el.textContent === s.ph) s.el.textContent = name ? s.text.replace('BrightSide Hotel', name) : s.text; });
  };

  var fill = function () {
    if (filled || done || !document.body) return;
    filled = true;
    blank();
    bell();
    var main = document.getElementById('main');
    if (main) main.setAttribute('aria-busy', 'true');
    document.querySelectorAll('[data-skel]').forEach(function (box) {
      if (box.querySelector('.sk')) return;
      var spec = String(box.getAttribute('data-skel')).split(':'), make = SHAPES[spec[0]];
      if (make) make(Number(spec[1]) || 3).forEach(function (k) { box.append(k); });
    });
  };

  var finish = function () {
    if (done) return;
    done = true;
    restore();
    root.classList.remove('booting');
    document.querySelectorAll('.sk').forEach(function (k) { k.remove(); });
    var main = document.getElementById('main');
    if (main) main.removeAttribute('aria-busy');
    var n = document.getElementById('demoNote');
    if (n) { n.classList.remove('boot-note'); if (n.querySelector('.boot-bell')) n.textContent = ''; }   // live.js has normally put "Live, updated …" there already
  };
  // a page this account may not open shows live.js's explanation at once, whatever holds its script took
  // setTimeout, not an animation frame: a tab opened in the background gets no frames, and the pages draw before any timer fires
  var maybe = function () { if (ready && window.Alejo && window.Alejo.live && (holds <= 0 || window.Alejo.denied)) setTimeout(finish, 30); };

  window.AlejoBoot = {
    fill: fill,
    hold: function () { holds++; var once = false; return function () { if (once) return; once = true; holds--; maybe(); }; },
    ready: function () { ready = true; maybe(); },
    done: finish,
    waiting: function (text) {                                      // what the top bar says while it waits
      var n = document.getElementById('demoNote'), t = n && n.querySelector('.boot-note-t');
      if (t) t.textContent = text;
      if (n) n.classList.toggle('offline', text !== 'Loading your hotel');
    },
  };
  document.addEventListener('DOMContentLoaded', fill);
})();
