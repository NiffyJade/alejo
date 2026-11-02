/* Alejo: marketing site behaviour (version 2).
   1. header menu and current section   2. reveal on scroll   3. the live chat (sample answers, runs in the browser)
   4. the live reply row                5. the command list     6. the slow crossfade   7. clock and demo request */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 0. page progress ---------- */
  const bar = $('#progress');
  let queued = false;
  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { const max = document.documentElement.scrollHeight - innerHeight; bar.style.setProperty('--p', max > 0 ? (scrollY / max).toFixed(4) : '0'); queued = false; });
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- 1. header ---------- */
  const nav = $('#nav'), menuBtn = $('#menuBtn');
  const setMenu = (open) => { nav.classList.toggle('open', open); menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false'); menuBtn.textContent = open ? 'Close' : 'Menu'; };
  menuBtn.addEventListener('click', () => setMenu(!nav.classList.contains('open')));
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('open')) { setMenu(false); menuBtn.focus(); } });

  const links = $$('a[href^="#"]:not(.nav-extra)', nav);
  if ('IntersectionObserver' in window) {
    const seen = new Map();
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((e) => seen.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0));
      let best = null, top = 0;
      seen.forEach((v, id) => { if (v > top) { top = v; best = id; } });
      links.forEach((a) => { if (a.getAttribute('href') === '#' + best) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
    }, { rootMargin: '-30% 0px -50% 0px', threshold: [0, 0.1, 0.5, 1] });
    links.forEach((a) => { const t = $(a.getAttribute('href')); if (t) spy.observe(t); });
  }

  /* a placeholder that fits a narrow phone */
  const askBox = $('#chatInput'), staffBox = $('#staffInput');
  const fitPlaceholders = () => {
    const narrow = matchMedia('(max-width: 480px)').matches, tiny = matchMedia('(max-width: 360px)').matches;
    if (askBox) askBox.placeholder = tiny ? 'Ask here…' : narrow ? 'Ask anything…' : 'Ask in Pidgin or English…';
    if (staffBox) staffBox.placeholder = narrow ? 'Reply as staff…' : 'Reply as staff. Start with #kb to save it…';
  };
  fitPlaceholders();
  matchMedia('(max-width: 480px)').addEventListener('change', fitPlaceholders);
  matchMedia('(max-width: 360px)').addEventListener('change', fitPlaceholders);

  /* ---------- 2. reveal ---------- */
  const revealSel = '.block > h2, .split-head > *, .field, .state, .plan, .faq > h2, .tile, details, .cta-field, .foot-row > *, .plain > div, .slides, .ex-item, .ex-stage';
  const countUp = (el) => {
    const node = el && Array.from(el.childNodes).find((n) => n.nodeType === 3);
    const m = node && node.textContent.match(/^₦([\d,]+)$/);
    if (!m || reduce) return;
    const end = parseInt(m[1].replace(/,/g, ''), 10), fmt = new Intl.NumberFormat('en-NG'), t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / 1000), eased = 1 - Math.pow(1 - k, 3);
      node.textContent = '₦' + fmt.format(Math.round(end * eased));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  const targets = $$(revealSel);
  targets.forEach((el) => {
    const sibs = Array.from(el.parentElement.children).filter((c) => c.matches(revealSel));
    el.style.setProperty('--i', String(Math.min(sibs.indexOf(el), 5)));
    el.setAttribute('data-reveal', '');
  });
  if ('IntersectionObserver' in window && !reduce) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) {
        const el = e.target;
        el.classList.add('is-in'); io.unobserve(el);
        if (el.matches('.plan')) countUp($('.price', el));
        setTimeout(() => { el.removeAttribute('data-reveal'); el.style.removeProperty('--i'); }, 1400);   // hand control back to the element's own hover and focus styles
      }
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 });
    targets.forEach((el) => io.observe(el));
  } else {
    targets.forEach((el) => el.classList.add('is-in'));
  }

  /* ---------- 3. the live chat ---------- */
  const log = $('#chatLog'), form = $('#chatForm'), input = $('#chatInput'), chips = $('#chips');
  const pane = $('#staffPane'), staffQ = $('#staffQ'), staffForm = $('#staffForm'), staffInput = $('#staffInput'), staffState = $('#staffState');

  // answers taken from the hotel's own facts (sample hotel: BrightSide Hotel)
  const FACTS = [
    { re: /wi-?fi|wifi|internet|pass ?word/i, a: 'The Wi-Fi network is BrightSide_Guest and the password is brightside2026.' },
    { re: /check ?-?out|leaving|leave the (room|hotel)/i, a: 'Checkout is by 12:00 noon. If you need more time, let us know and we will check what is possible.' },
    { re: /check ?-?in|arriv|early/i, a: 'Check-in starts from 2:00 PM. If you arrive earlier, we will store your luggage and check you in as soon as your room is ready.' },
    { re: /breakfast|restaurant|food|eat|chop/i, a: 'Breakfast is served from 6:30 AM to 10:30 AM daily. The restaurant is open from 7:00 AM to 10:00 PM.' },
    { re: /park/i, a: 'Guest parking is available on site, subject to space. Please give the front desk your vehicle details on arrival.' },
    { re: /airport|pick ?-?up|transfer/i, a: 'Yes, we can arrange airport pickup. Send us your flight number, arrival time and number of passengers. The front desk will confirm the exact price when you book.' },
    { re: /light|nepa|generator|power|current|electric/i, a: 'Our generator takes over, usually within moments, so you should have light and Wi-Fi. If an outage lasts, tell the front desk your room number.' },
    { re: /\bid\b|\bnin\b|passport|licen[cs]e|document/i, a: "Every guest must present a valid government-issued photo ID at check-in: a National ID or NIN slip, international passport, driver's licence or voter's card." },
    { re: /laundry|wash|clothes/i, a: 'Yes. Hand your items to housekeeping or tell us your room number. Housekeeping will share the price list when you request the service.' },
    { re: /emergency|police|fire|doctor|ambulance/i, a: 'In an emergency call the front desk at once. The national emergency number in Nigeria is 112. I am alerting our staff now.' },
  ];
  const HOLD = "Thanks for your message. I'm checking with our team and will get back to you here shortly.";

  const say = (kind, text, kicker) => {
    const p = document.createElement('p');
    p.className = 'msg ' + kind;
    if (kicker) { const k = document.createElement('span'); k.className = 'k'; k.textContent = kicker; p.appendChild(k); }
    p.appendChild(document.createTextNode(text));
    log.appendChild(p);
    log.scrollTop = log.scrollHeight;
    return p;
  };
  let busy = false;
  let waiting = null;                                          // the question waiting for staff

  const ask = (raw) => {
    const q = raw.trim();
    if (!q || busy) return;
    busy = true;
    say('out', q);
    const typing = document.createElement('p');
    typing.className = 'msg in typing'; typing.setAttribute('aria-label', 'Typing');
    typing.innerHTML = '<i></i><i></i><i></i>';
    log.appendChild(typing); log.scrollTop = log.scrollHeight;
    setTimeout(() => {
      typing.remove();
      const hit = FACTS.find((f) => f.re.test(q));
      if (hit) {
        say('in', hit.a);
        if (/emergency|police|fire|doctor|ambulance/i.test(q)) handOff(q, 'Emergency: alert staff');
      } else {
        say('in', HOLD);
        handOff(q, 'Guest needs help');
      }
      busy = false;
    }, reduce ? 0 : 750);
  };

  function handOff(q, state) {
    waiting = q;
    staffQ.textContent = '“' + q + '”';
    staffState.textContent = state;
    staffInput.value = /helipad/i.test(q) ? 'No helipad, Ma. Free parking though.' : '';
    pane.hidden = false;
    log.scrollTop = log.scrollHeight;
  }

  if (form) form.addEventListener('submit', (e) => { e.preventDefault(); const v = input.value; input.value = ''; ask(v); });
  if (chips) chips.addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (b) ask(b.dataset.q); });
  if (staffForm) staffForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!waiting) return;
    let text = staffInput.value.trim();
    if (!text) return;
    const learn = /^#kb\s+/i.test(text);
    text = text.replace(/^#kb\s+/i, '');
    say('in', text, 'Update from our team');
    if (learn) {
      say('note', 'Saved as an answer for next time. Ask it again.');
      const esc = waiting.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      FACTS.unshift({ re: new RegExp(esc, 'i'), a: text });        // the next guest who asks gets this answer straight away
    }
    waiting = null; staffInput.value = ''; pane.hidden = true;
  });

  /* ---------- 4. the live reply row ---------- */
  const liveRow = $('#liveRow'), liveForm = $('#liveForm'), livePill = $('#livePill'), liveDone = $('#liveDone');
  if (liveForm) liveForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('#liveInput').value.trim();
    if (!text) return;
    liveRow.classList.add('is-done');
    $('.irow-t span', liveRow).textContent = text;
    livePill.textContent = 'Answered'; livePill.className = 'pill pill-ok';
    liveDone.hidden = false;
    liveDone.setAttribute('role', 'status');
  });

  /* ---------- 5. the explorer: pick a capability, see it work. It also plays itself until someone takes over ---------- */
  const ex = $('#explore');
  if (ex) {
    const items = $$('.ex-item', ex), tabs = items.map((i) => $('.ex-tab', i)), panels = $$('.ex-panel', ex);
    let cur = 0;
    const go = (n, focus) => {
      cur = n;
      items.forEach((it, i) => {
        const on = i === n;
        it.classList.toggle('is-sel', on);
        tabs[i].setAttribute('aria-selected', on ? 'true' : 'false'); tabs[i].tabIndex = on ? 0 : -1;
        panels[i].classList.toggle('is-on', on);
      });
      if (focus) tabs[n].focus();
    };
    const takeOver = () => ex.classList.add('manual');
    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => { takeOver(); go(i); });
      tab.addEventListener('keydown', (e) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault(); takeOver();
        go(e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (cur + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length, true);
      });
    });
    items.forEach((it) => $('.ex-fill', it).addEventListener('animationend', () => { if (!ex.classList.contains('manual')) go((cur + 1) % items.length); }));
    if (!reduce && 'IntersectionObserver' in window) {
      new IntersectionObserver((es) => es.forEach((e) => ex.classList.toggle('is-live', e.isIntersecting)), { threshold: 0.4 }).observe(ex);
    }
  }

  /* ---------- 6. the slow crossfade ---------- */
  const slides = $$('#slides img'), cap = $('#slideCap');
  let at = 0, timer = null;
  const show = (n) => { slides[at].classList.remove('is-on'); at = n; slides[at].classList.add('is-on'); cap.textContent = slides[at].dataset.cap; };
  const start = () => { if (!timer && slides.length > 1 && !reduce) timer = setInterval(() => show((at + 1) % slides.length), 5600); };
  const stop = () => { clearInterval(timer); timer = null; };
  start();
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));

  /* ---------- 7. clock and demo request ---------- */
  const clock = $('#lagosTime');
  const tick = () => { try { clock.textContent = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit' }).format(new Date()) + ' WAT'; } catch (_) { /* keeps "WAT" */ } };
  if (clock) { tick(); setInterval(tick, 30000); }

  const DEMO_URL = 'https://uavlejanscnsvjdxfslh.supabase.co/functions/v1/demo-request';
  const demo = $('#demoForm');
  if (demo) demo.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type="submit"]', demo), status = $('#demoStatus');
    const email = $('#demoEmail').value.trim();
    const hotel = $('#demoHotel').value.trim();
    const rooms = (demo.querySelector('input[name="rooms"]:checked') || {}).value || '';
    const website = (demo.querySelector('input[name="website"]') || {}).value || '';      // honeypot: people never see it
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Sending…'; status.textContent = '';
    try {
      const res = await fetch(DEMO_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, hotel, rooms, website }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { status.textContent = data.error || 'Something went wrong. Please try again.'; btn.disabled = false; btn.textContent = label; return; }
      const done = document.createElement('div');
      done.className = 'dialog-done'; done.setAttribute('role', 'status');
      const h = document.createElement('h3'); h.textContent = 'Thank you.';
      const p = document.createElement('p'); p.textContent = 'We will email ' + email + ' within one working day to set up your demo.';
      done.append(h, p);
      demo.replaceChildren(done);
    } catch (err) {                                           // offline or blocked: hand the request to the visitor's email app instead
      const subject = encodeURIComponent('Demo request: Alejo');
      const body = encodeURIComponent('Hello,\n\nPlease book a demo of Alejo for my hotel.\n\nHotel: ' + hotel + '\nRooms: ' + rooms + '\nMy email: ' + email + '\n\nThank you.');
      status.textContent = 'We could not reach our server, so we are opening your email app instead.';
      btn.disabled = false; btn.textContent = label;
      location.href = 'mailto:demo@alejo.example?subject=' + subject + '&body=' + body;
    }
  });
})();
