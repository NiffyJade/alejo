// "Parse AI": turn Cohere's JSON into a normalised result (reply for the knowledge-base path, plus intent and booking slots).
const r = $input.first().json, ctx = $('Build prompt').first().json;
let p = null;
try {
  const t = r.message.content.find(c => c.type === 'text').text.replace(/^```(?:json)?|```$/g, '').trim();
  p = JSON.parse(t);
} catch (e) { p = null; }
if (!p || typeof p.answer !== 'string') p = { intent: 'other', can_answer: false, notify_staff: true, answer: '' };
const ok = p.can_answer === true && p.answer.trim() !== '';
const pidgin = /\b(abeg|wetin|wahala|dey|una|oga|sabi|chop|comot|pikin|wey|sef|abi|na|how far|i wan|make i|no be|e don|dem go)\b/i.test(ctx.text || '');
const holding = pidgin ? "Thank you o. I dey check with our team, dem go reply you here soon." : "Thanks for your message. I'm checking with our team and will get back to you here shortly.";
// Language of the replies the code writes: Pidgin if this message is Pidgin; a very short message ("Deluxe", "yes") or a shared contact keeps the draft's language.
const nWords = (ctx.text || '').trim().split(/\s+/).filter(Boolean).length;
const lang = pidgin ? 'pcm' : (!ctx.text || nWords <= 3) ? ((ctx.draft && ctx.draft.lang) || 'en') : 'en';
let intent = ['info', 'availability', 'book', 'cancel_draft', 'other'].includes(p.intent) ? p.intent : 'other';
const s = v => (typeof v === 'string' ? v.trim() : '');
const dd = ctx.draft || {};
const inProgress = !!(dd.check_in || dd.check_out || dd.room_type || dd.guest_name || dd.phone);
let escalate = !ok || p.notify_staff === true;
// Dropping an unfinished booking request is for the bot; "cancel my booking" about an existing booking is for staff.
if (intent === 'cancel_draft' && !inProgress) { intent = 'other'; escalate = true; }
// No text means the guest tapped "Share my phone number": carry on with the booking they were in the middle of.
const sharedContact = !ctx.text;
if (sharedContact && inProgress) { intent = 'book'; escalate = false; }
// If a booking/availability message also asked something the knowledge answers, keep that answer, but never let the model
// state availability, prices or bookings itself (those come only from live room data).
const extra = ['availability', 'book'].includes(intent) && ok && !sharedContact &&!/\b(available|availability|vacan\w*|book(ed|ing)?|reserv\w*|sold out|naira|rooms?)\b|₦|\d{2},\d{3}/i.test(p.answer) ? p.answer.trim() : '';
return [{ json: { ...ctx, intent, lang,
  check_in: s(p.check_in), check_out: s(p.check_out), room_type_said: s(p.room_type), name_said: s(p.guest_name), phone_said: s(p.phone),
  question: ctx.text || '(shared their phone number)', reply: ok ? p.answer.trim() : holding, info_answer: extra,
  escalate, ai_answered: ok } }];
