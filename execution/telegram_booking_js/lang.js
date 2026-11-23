// Shared message templates ('en' and 'pcm' = Nigerian Pidgin). The builder pastes this file into every Code node that writes
// guest-facing booking text (each marks the spot with a LANG comment line), so there is one place to change wording.
// Only wording differs between languages: every fact (dates, prices, names, references) is filled in by code.
const NGN = n => Number(n).toLocaleString('en-US');
const nt = n => `${n} night${n === 1 ? '' : 's'}`;
const LANG = {
  en: {
    cleared: "No problem, I've cleared that booking request. Is there anything else I can help you with?",
    long_stay: 'For stays longer than 30 nights our team will arrange things with you personally. I have let them know and they will contact you here.',
    ask_dates: 'Happy to help! What date would you like to check in, and when will you check out? For example: "Friday to Sunday" or "12 December for 3 nights".',
    ask_checkout: d => `Got it, check-in on ${d}. How many nights will you stay, or what is your check-out date?`,
    lookup_failed: "I can't check room availability right now. I have asked our team to help you and they will reply here shortly.",
    unknown_room: x => `We don't have a room type called "${x}". `,
    none_free: (pre, range) => `${pre}Sorry, we have no rooms available from ${range}. Would you like to try different dates?`,
    type_sold: (type, range, list) => `Sorry, there are no ${type} rooms free from ${range}. Available instead:\n${list}\n\nWhich would you like?`,
    list: (pre, n, range, list) => `${pre}For ${nt(n)} (${range}) we have:\n${list}\n\nWhich room type would you like? Tell me and I'll set up the booking.`,
    good_news: (type, n, range, rate, total) => `Good news, a ${type} room is available for ${nt(n)} (${range})` +
      (rate !== null && rate !== undefined ? ` at ${NGN(rate)} naira per night` + (n > 1 ? `, about ${NGN(total)} naira in total` : '') : '') + '. Would you like me to book it?',
    ask_name: (type, range) => `A ${type} room is available for ${range}. What name should the booking be under?`,
    ask_phone: name => `Thanks, ${name}. What phone number can the hotel reach you on? Tap the button below to share your number, or type it here.`,
    summary: (type, hotel, ci, co, n, who, money) => `Please check your booking:\n\n🏨 ${type} room at ${hotel}\n📅 ${ci} to ${co} (${nt(n)})\n👤 ${who}${money}\n\nTap Confirm to book it.`,
    money: (rate, total) => `\n💰 ${NGN(rate)} naira per night, about ${NGN(total)} naira in total`,
    past: d => `That check-in date (${d}) has already passed. What date would you like to arrive?`,
    order: 'Check-out has to be after check-in. Could you tell me your check-in and check-out dates again?',
    booked: (ref, type, ci, co, n, total) => `✅ You're booked!\n\nReference: ${ref}\n${type} room, ${ci} to ${co} (${nt(n)}).` +
      (total ? ` The estimated total is ${NGN(total)} naira.` : '') +
      `\n\nI'll remind you the day before you arrive and send your private stay code when it's time to check in. Message me here any time if you need anything.`,
    sold_out: type => `Sorry, the last ${type || 'room'} for those dates was just taken. Tell me different dates or another room type and I will check again.`,
    dates: 'Those dates are no longer valid. Please tell me your check-in and check-out dates again.',
    room_type: 'I could not match that room type. Please tell me which room type you would like.',
    name: 'I still need the name for the booking. What name should it be under?',
    limit: 'You already have three upcoming reservations with us, so I cannot add another here. Please contact the front desk.',
    failed: 'Sorry, I could not save that booking. Please do not rely on it. I have told our team and they will contact you here.',
    expired: 'That booking request has expired. Tell me the dates and room type you would like and I will set it up again.',
    changed: 'Those details have changed since that summary. Please tap Confirm on my latest summary, or tell me what you would like.',
    cancelled: 'No problem, I have cancelled that. Tell me whenever you would like to look at rooms or book.',
    followup: (name, type, range) => `Hi${name ? ' ' + name : ''}! 👋 You were looking at a ${type} room for ${range}. Would you like to carry on with your booking? I can pick up where we stopped and check the room again for you.`,
    followup_yes: 'Yes, continue',
    followup_no: 'No, thanks',
  },
  pcm: {
    cleared: 'No wahala, I don clear that booking request. Anything else wey I fit help you with?',
    long_stay: 'For stay wey pass 30 nights, our team go arrange am with you personally. I don tell dem, dem go contact you here.',
    ask_dates: 'Make I help you! Which date you wan check in, and when you go check out? Example: "Friday to Sunday" or "12 December for 3 nights".',
    ask_checkout: d => `I don see say you wan check in on ${d}. How many nights you wan stay, or which date you go check out?`,
    lookup_failed: 'I no fit check room availability now. I don tell our team make dem help you, dem go reply you here soon.',
    unknown_room: x => `We no get room type wey dem call "${x}". `,
    none_free: (pre, range) => `${pre}Sorry, we no get any room for ${range}. You wan try another date?`,
    type_sold: (type, range, list) => `Sorry, we no get ${type} room for ${range}. Na wetin we get be this:\n${list}\n\nWhich one you want?`,
    list: (pre, n, range, list) => `${pre}For ${nt(n)} (${range}), we get:\n${list}\n\nWhich room type you want? Tell me and I go set up the booking.`,
    good_news: (type, n, range, rate, total) => `Good news o, ${type} room dey available for ${nt(n)} (${range})` +
      (rate !== null && rate !== undefined ? ` at ${NGN(rate)} naira per night` + (n > 1 ? `, about ${NGN(total)} naira in total` : '') : '') + '. You wan make I book am?',
    ask_name: (type, range) => `${type} room dey available for ${range}. Which name make I put for the booking?`,
    ask_phone: name => `Thank you, ${name}. Which phone number we fit reach you on? Tap the button below to share your number, or type am here.`,
    summary: (type, hotel, ci, co, n, who, money) => `Abeg check your booking well:\n\n🏨 ${type} room for ${hotel}\n📅 ${ci} to ${co} (${nt(n)})\n👤 ${who}${money}\n\nTap Confirm make I book am.`,
    money: (rate, total) => `\n💰 ${NGN(rate)} naira per night, about ${NGN(total)} naira in total`,
    past: d => `That check-in date (${d}) don pass. Which date you wan arrive?`,
    order: 'Check-out must come after check-in. Abeg tell me your check-in and check-out dates again.',
    booked: (ref, type, ci, co, n, total) => `✅ Your booking don enter!\n\nReference: ${ref}\n${type} room, ${ci} to ${co} (${nt(n)}).` +
      (total ? ` The estimated total na ${NGN(total)} naira.` : '') +
      `\n\nI go remind you the day before you arrive, and send your private stay code when time reach to check in. Message me here anytime if you need anything.`,
    sold_out: type => `Sorry, the last ${type || 'room'} for those dates don go. Tell me another date or another room type make I check again.`,
    dates: 'Those dates no valid again. Abeg tell me your check-in and check-out dates again.',
    room_type: 'I no fit match that room type. Abeg tell me which room type you want.',
    name: 'I still need the name for the booking. Which name make I put?',
    limit: 'You don get three upcoming reservations with us already, so I no fit add another one here. Abeg contact the front desk.',
    failed: 'Sorry, I no fit save that booking. No rely on am. I don tell our team, dem go contact you here.',
    expired: 'That booking request don expire. Tell me the dates and room type wey you want make I set am up again.',
    changed: 'Those details don change since that summary. Abeg tap Confirm for my latest summary, or tell me wetin you want.',
    cancelled: 'No wahala, I don cancel am. Tell me anytime you wan check rooms or book.',
    followup: (name, type, range) => `Hi${name ? ' ' + name : ''}! 👋 You dey look ${type} room for ${range}. You still wan carry on with the booking? I fit continue from where we stop, and check the room again for you.`,
    followup_yes: 'Yes, continue',
    followup_no: 'No, thank you',
  },
};
const tr = (lang, key, ...a) => { const v = (LANG[lang] || LANG.en)[key]; return typeof v === 'function' ? v(...a) : v; };
