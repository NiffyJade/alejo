// "Compose thank-yous" (Scheduler): the thank-you after checkout, now with a request to rate the stay (the 1-5 buttons are on the Send node).
// The public review link goes to EVERY guest, not only to those who rate highly: sending only happy guests to a review site is
// "review gating", which Google's policies forbid.
const s = $('Context').first().json.settings;
return $input.all().filter(i => i.json.id).map(i => ({ json: { booking_id: i.json.id, chat_id: i.json.guests.telegram_chat_id,
  text: `Thank you for staying with us, ${i.json.guests.name}! 🙏 We hope you had a wonderful time at __HOTEL__.\n\n` +
    `How was your stay? Tap a rating below, from 1 (poor) to 5 (excellent). It takes a second and helps us look after our guests better.` +
    (s.REVIEW_LINK ? `\n\nIf you would like to share your experience publicly, here is our review page: ${s.REVIEW_LINK}` : '') +
    `\n\nSafe travels, and we hope to see you again soon!` } }));
