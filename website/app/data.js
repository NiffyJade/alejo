/* Sample data for the Alejo staff dashboard (BrightSide Hotel, Lagos).
   It is a night shift: Tuesday 27 October 2026, 02:31. Every total is computed from the rows. */
(function () {
  'use strict';
  const NOW = { date: '2026-10-27', time: '02:31', label: 'Tue 27 Oct, 02:31' };
  const RATES = { Standard: 35000, Deluxe: 55000, Suite: 95000 };      // naira per night (sample)
  const STAGES = ['Booked', 'Reminded', 'Checked in', 'Checkout reminder', 'Thanked'];
  const STAGE_WORD = ['Booked', 'Reminder sent', 'In house', 'Checkout due', 'Thanked'];

  const day = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000;
  const nights = (b) => day(b.out) - day(b.in);
  const total = (b) => nights(b) * RATES[b.type];
  const fmtDay = (s) => new Date(s + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const NGN = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 });
  const naira = (n) => NGN.format(n);

  // stage: 0 booked, 1 reminder sent, 2 checked in, 3 checkout reminder sent, 4 thanked
  const bookings = [
    { id: 'b1',  ref: 'AL-1031', guest: 'Folake Johnson',  room: '208', type: 'Deluxe',   in: '2026-10-26', out: '2026-10-28', src: 'Telegram', stage: 2, note: 'Checked in 26 Oct, 15:20' },
    { id: 'b2',  ref: 'AL-1038', guest: 'Chinedu Okafor',  room: '301', type: 'Suite',    in: '2026-10-27', out: '2026-10-29', src: 'Telegram', stage: 1, note: 'Reminder sent 26 Oct, 10:00' },
    { id: 'b3',  ref: 'AL-1027', guest: 'Amina Bello',     room: '112', type: 'Standard', in: '2026-10-26', out: '2026-10-27', src: 'Telegram', stage: 3, note: 'Checkout reminder at 08:00' },
    { id: 'b4',  ref: 'AL-1042', guest: 'Tolu Adeyemi',    room: '204', type: 'Deluxe',   in: '2026-10-28', out: '2026-10-30', src: 'Phone',    stage: 0, note: 'Booked by phone 26 Oct, 21:48', linked: false },
    { id: 'b5',  ref: 'AL-1043', guest: 'Emeka Nwosu',     room: '115', type: 'Standard', in: '2026-10-29', out: '2026-10-31', src: 'Phone',    stage: 0, note: 'Booked by phone 26 Oct, 22:10', linked: false },
    { id: 'b6',  ref: 'AL-1019', guest: 'Hauwa Ibrahim',   room: '305', type: 'Suite',    in: '2026-10-25', out: '2026-10-27', src: 'Telegram', stage: 3, note: 'Checkout reminder at 08:00' },
    { id: 'b7',  ref: 'AL-1044', guest: 'Segun Balogun',   room: '210', type: 'Deluxe',   in: '2026-10-30', out: '2026-11-01', src: 'Phone',    stage: 0, note: 'Booked by phone 26 Oct, 18:30', linked: false },
    { id: 'b8',  ref: 'AL-1040', guest: 'Ngozi Eze',       room: '109', type: 'Standard', in: '2026-10-27', out: '2026-10-29', src: 'Telegram', stage: 1, note: 'Reminder sent 26 Oct, 10:00' },
    { id: 'b9',  ref: 'AL-1025', guest: 'Ibrahim Danjuma', room: '302', type: 'Suite',    in: '2026-10-26', out: '2026-10-29', src: 'Telegram', stage: 2, note: 'Checked in 26 Oct, 13:05' },
    { id: 'b10', ref: 'AL-1041', guest: 'Blessing Okoro',  room: '118', type: 'Standard', in: '2026-10-27', out: '2026-10-28', src: 'Phone',    stage: 0, note: 'Booked by phone today, 00:55', linked: false },
    { id: 'b11', ref: 'AL-1018', guest: 'Kunle Adebayo',   room: '211', type: 'Deluxe',   in: '2026-10-25', out: '2026-10-27', src: 'Telegram', stage: 3, note: 'Checkout reminder at 08:00' },
    { id: 'b12', ref: 'AL-1045', guest: 'Adaeze Obi',      room: '101', type: 'Standard', in: '2026-10-31', out: '2026-11-02', src: 'Phone',    stage: 0, note: 'Booked by phone 25 Oct, 16:40', linked: false },
    { id: 'b13', ref: 'AL-1009', guest: 'Musa Garba',      room: '206', type: 'Deluxe',   in: '2026-10-24', out: '2026-10-26', src: 'Telegram', stage: 4, note: 'Thank-you sent 26 Oct, 12:20' },
    { id: 'b14', ref: 'AL-1029', guest: 'Funmi Ajayi',     room: '110', type: 'Standard', in: '2026-10-26', out: '2026-10-27', src: 'Telegram', stage: 2, note: 'Late checkout agreed, until 2 PM' },
  ];
  const HUES = [212, 18, 152, 332, 58, 268, 100, 0, 190, 298, 38, 240, 128, 352];
  bookings.forEach((b, i) => { b.hue = HUES[i % HUES.length]; b.nights = nights(b); b.total = total(b); });
  const byGuest = Object.fromEntries(bookings.map((b) => [b.guest, b]));

  // conversations: role is guest | ai | staff | note
  const conversations = [
    { id: 'c1', guest: 'Folake Johnson', ch: 'Telegram', ago: '17 min', unread: true, status: 'needs', topic: 'Asked about a helipad', lang: 'English',
      suggest: 'No helipad, Ma. Free parking though.',
      why: 'Not in your facts, so the AI held it instead of guessing.',
      msgs: [
        { r: 'guest', t: '02:14', x: 'Do you have a helipad?' },
        { r: 'note', t: '02:14', x: 'Not in your facts. The AI held it instead of guessing.' },
        { r: 'ai', t: '02:14', x: "Thanks for your message. I'm checking with our team and will get back to you here shortly." },
        { r: 'note', t: '02:14', x: 'Sent to BrightSide Staff. Waiting for a reply.' },
      ] },
    { id: 'c2', guest: 'Chinedu Okafor', ch: 'Telegram', ago: '33 min', unread: true, status: 'needs', topic: 'Wants to extend to Friday', lang: 'English',
      suggest: 'Good evening, Mr Okafor. Yes, Suite 301 is free until Friday. I have extended your booking.',
      why: 'A booking change needs a person.',
      msgs: [
        { r: 'guest', t: '01:58', x: 'Good evening. I arrive later today. Please can I extend my booking to Friday?' },
        { r: 'note', t: '01:58', x: 'A booking change needs staff. Alert sent.' },
        { r: 'ai', t: '01:58', x: "Thanks, I've passed this to our team and they will confirm here. Please keep this chat open." },
      ] },
    { id: 'c3', guest: 'Ngozi Eze', ch: 'Telegram', ago: '11 min', unread: true, status: 'needs', topic: 'Asked for the Wi-Fi password', lang: 'Pidgin',
      suggest: '', fact: 'WIFI_PASSWORD',
      why: 'The Wi-Fi password is not filled in, so that answer is switched off.',
      msgs: [
        { r: 'guest', t: '02:20', x: 'abeg wetin be the wifi password' },
        { r: 'note', t: '02:20', x: 'Wi-Fi password is not filled in under Facts. The answer is held back.' },
        { r: 'ai', t: '02:20', x: "Thanks for your message. I'm checking with our team and will get back to you here shortly." },
      ] },
    { id: 'c4', guest: 'Tolu Adeyemi', ch: 'Phone', ago: '4 h', unread: false, status: 'waiting', topic: 'Booked by phone, not on Telegram yet', lang: 'Nigerian English',
      msgs: [
        { r: 'note', t: '26 Oct, 21:48', x: 'Phone call, 3 min 12 s, from +234 803 000 0000 (sample).' },
        { r: 'ai', t: '21:51', x: 'Booked. Deluxe room, 28 to 30 October, 2 nights, estimated total ₦110,000. Reference AL-1042.' },
        { r: 'note', t: '21:51', x: 'Asked the caller to open Telegram and share their number so the stay links up.' },
      ] },
    { id: 'c5', guest: 'Amina Bello', ch: 'Telegram', ago: '1 h', unread: false, status: 'ai', topic: 'Asked the checkout time', lang: 'English',
      msgs: [
        { r: 'guest', t: '01:25', x: 'What time is checkout?' },
        { r: 'ai', t: '01:25', x: 'Checkout is by 12:00 noon. If you need more time, let us know and we will check what is possible.' },
      ] },
    { id: 'c6', guest: 'Ibrahim Danjuma', ch: 'Telegram', ago: '3 h', unread: false, status: 'ai', topic: 'Asked about parking', lang: 'English',
      msgs: [
        { r: 'guest', t: '23:40', x: 'Is there parking for my car?' },
        { r: 'ai', t: '23:40', x: 'Guest parking is available on site, subject to space. Please give the front desk your vehicle details on arrival.' },
      ] },
    { id: 'c7', guest: 'Blessing Okoro', ch: 'Phone', ago: '1 h', unread: false, status: 'waiting', topic: 'Booked by phone for tonight', lang: 'Nigerian English',
      msgs: [
        { r: 'note', t: '00:55', x: 'Phone call, 2 min 40 s, from +234 805 000 0000 (sample).' },
        { r: 'ai', t: '00:58', x: 'Booked. Standard room, tonight 27 to 28 October, 1 night, estimated total ₦35,000. Reference AL-1041.' },
        { r: 'note', t: '00:58', x: 'Waiting for the guest to share their number in Telegram.' },
      ] },
    { id: 'c8', guest: 'Kunle Adebayo', ch: 'Telegram', ago: '4 h', unread: false, status: 'waiting', topic: 'Airport ride at 6', lang: 'English',
      msgs: [
        { r: 'guest', t: '22:10', x: 'Can I get a ride to the airport tomorrow at 6?' },
        { r: 'ai', t: '22:10', x: 'Yes, we can arrange airport pickup. Send us your flight number, arrival time and number of passengers. The front desk will confirm the exact price when you book.' },
        { r: 'note', t: '22:10', x: 'Waiting on the guest for a flight number.' },
      ] },
    { id: 'c9', guest: 'Funmi Ajayi', ch: 'Telegram', ago: '5 h', unread: false, status: 'done', topic: 'Late checkout, agreed', lang: 'English',
      msgs: [
        { r: 'guest', t: '21:05', x: 'Late checkout please, my flight is in the evening.' },
        { r: 'ai', t: '21:05', x: "Thanks. Late checkout depends on whether the room is needed. I've asked our team." },
        { r: 'staff', t: '21:30', x: 'Late checkout until 2 PM is approved, Ma. No charge.', by: 'Tunde B.' },
        { r: 'guest', t: '21:32', x: 'Thank you so much!' },
      ] },
    { id: 'c10', guest: 'Emeka Nwosu', ch: 'Phone', ago: '5 h', unread: false, status: 'waiting', topic: "Hasn't linked Telegram", lang: 'Pidgin',
      msgs: [
        { r: 'note', t: '26 Oct, 22:10', x: 'Phone call, 4 min 05 s, from +234 701 000 0000 (sample).' },
        { r: 'ai', t: '22:14', x: 'Booked. Standard room, 29 to 31 October, 2 nights, estimated total ₦70,000. Reference AL-1043.' },
      ] },
    { id: 'c11', guest: 'Hauwa Ibrahim', ch: 'Telegram', ago: 'Yesterday', unread: false, status: 'done', topic: 'Thanked us', lang: 'English',
      msgs: [
        { r: 'guest', t: '18:20', x: 'Thank you, the stay has been lovely.' },
        { r: 'ai', t: '18:20', x: 'You are most welcome, Ma. Let us know if you need anything before checkout.' },
      ] },
    { id: 'c12', guest: 'Segun Balogun', ch: 'Phone', ago: 'Yesterday', unread: false, status: 'waiting', topic: 'Booked by phone', lang: 'Nigerian English',
      msgs: [
        { r: 'note', t: '26 Oct, 18:30', x: 'Phone call, 3 min 50 s, from +234 809 000 0000 (sample).' },
        { r: 'ai', t: '18:34', x: 'Booked. Deluxe room, 30 October to 1 November, 2 nights, estimated total ₦110,000. Reference AL-1044.' },
      ] },
  ];

  const staff = [
    { name: 'Amaka Okafor', initials: 'AO', role: 'Front desk, nights', hue: 212 },
    { name: 'Tunde Bello', initials: 'TB', role: 'Front desk, days', hue: 38 },
    { name: 'Chidi Eze', initials: 'CE', role: 'Duty manager', hue: 152 },
  ];

  const FD = { NOW, RATES, STAGES, STAGE_WORD, bookings, byGuest, conversations, staff, nights, total, fmtDay, naira, day };
  window.FD = FD;

  // figures that must agree
  const arriving = bookings.filter((b) => b.in === NOW.date);
  const inHouse = bookings.filter((b) => b.stage >= 2 && b.stage < 4);
  const leaving = bookings.filter((b) => b.out === NOW.date && b.stage < 4);
  console.assert(arriving.length === 3 && inHouse.length === 6 && leaving.length === 4, 'stay counts');
  console.assert(conversations.filter((c) => c.status === 'needs').length === 3, 'three guests need a person');
  console.assert(bookings.every((b) => b.total === b.nights * RATES[b.type]), 'totals come from nights x rate');
})();
