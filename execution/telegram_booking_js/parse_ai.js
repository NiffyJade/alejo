// "Parse AI": turn Cohere's JSON into a normalised result (reply for the knowledge-base path, plus intent and booking slots).
const r = $input.first().json, ctx = $('Build prompt').first().json;
let p = null;
try {
  const t = r.message.content.find(c => c.type === 'text').text.replace(/^```(?:json)?|```$/g, '').trim();
  p = JSON.parse(t);
} catch (e) { p = null; }
if (!p || typeof p.answer !== 'string') p = { intent: 'other', can_answer: false, notify_staff: true, answer: '' };
const ok = p.can_answer === true && p.answer.trim() !== '';
// What kind of thing staff are being asked to handle, so it can be tracked until it is settled (service recovery).
const KINDS = ['question', 'request', 'complaint', 'emergency'], CATS = ['maintenance', 'housekeeping', 'food', 'transport', 'booking', 'other'];
let kind = KINDS.includes(p.kind) ? p.kind : 'question';
let category = CATS.includes(p.category) ? p.category : null;
// Safety net in plain code: danger words are an emergency whatever the model said.
const danger = /\b(on fire|caught fire|fire (broke|started|alarm)|there('s| is) (a )?fire|gunshots?|armed (men|robbers?)|robbery|robbers?|kidnap\w*|bleeding|unconscious|heart attack|can'?t breathe|cannot breathe|need (an? )?(doctor|ambulance))\b/i.test(ctx.text || '');
if (danger) { kind = 'emergency'; p.notify_staff = true; }
const pidgin = /\b(abeg|wetin|wahala|dey|una|oga|sabi|chop|comot|pikin|wey|sef|abi|na|how far|i wan|make i|no be|e don|dem go)\b/i.test(ctx.text || '');
const CAT_EN = { maintenance: 'maintenance', housekeeping: 'housekeeping', food: 'restaurant', transport: 'transport', booking: 'booking', other: 'service' };
let holding = pidgin ? "Thank you o. I dey check with our team, dem go reply you here soon." : "Thanks for your message. I'm checking with our team and will get back to you here shortly.";
if (kind === 'emergency') holding = pidgin ? "Call 112 now o. I don alert our staff, dem dey come." : "Please call 112 now if anyone is in danger. I have alerted our staff and they are on their way.";
else if (kind === 'request' || kind === 'complaint') holding = pidgin
  ? `Sorry o, I don note am as ${CAT_EN[category] || 'service'} ${kind === 'complaint' ? 'matter' : 'request'} and I don tell our team. Dem go update you here.`
  : `${kind === 'complaint' ? "I'm sorry about that. " : 'Of course. '}I have logged this with our ${CAT_EN[category] || 'service'} team and they will update you here.`;
// Language of the replies the code writes: Pidgin if this message is Pidgin; a very short message ("Deluxe", "yes") or a shared contact keeps the draft's language.
const nWords = (ctx.text || '').trim().split(/\s+/).filter(Boolean).length;
const lang = pidgin ? 'pcm' : (!ctx.text || nWords <= 3) ? ((ctx.draft && ctx.draft.lang) || 'en') : 'en';
const hasServices = (ctx.services || []).length > 0;         // "service" is only believed from a hotel that sells some
let intent = ['info', 'availability', 'book', 'cancel_draft', 'other'].concat(hasServices ? ['service'] : []).includes(p.intent) ? p.intent : 'other';
const s = v => (typeof v === 'string' ? v.trim() : '');
const dd = ctx.draft || {};
const inProgress = !!(dd.check_in || dd.check_out || dd.room_type || dd.guest_name || dd.phone);
let escalate = !ok || p.notify_staff === true;
if (!escalate) { kind = 'question'; category = null; }
// Requests and complaints get the fixed 'logged, the team will follow up' message, never the model's wording, so nothing is promised that staff have not agreed to.
const useAnswer = ok && (kind === 'question' || (kind === 'emergency' && /112/.test(p.answer)));
// Dropping an unfinished booking request is for the bot; "cancel my booking" about an existing booking is for staff.
if (intent === 'cancel_draft' && !inProgress) { intent = 'other'; escalate = true; }
// No text means the guest tapped "Share my phone number": carry on with the booking they were in the middle of.
const sharedContact = !ctx.text;
if (sharedContact && inProgress) { intent = 'book'; escalate = false; }
// If a booking/availability message also asked something the knowledge answers, keep that answer, but never let the model
// state availability, prices or bookings itself (those come only from live room data).
const extra = ['availability', 'book'].includes(intent) && ok && !sharedContact &&!/\b(available|availability|vacan\w*|book(ed|ing)?|reserv\w*|sold out|naira|rooms?)\b|₦|\d{2},\d{3}/i.test(p.answer) ? p.answer.trim() : '';
// A guest chasing something already open ("any update?") must not create a second item: nudge staff about the existing one.
const openItems = ctx.open_items || [];
const CHASE = /\b(any (update|news)|updates? (please|pls|abeg)|still waiting|still no(t)?|taking (so |too )?long|nobody (has )?(come|came|called)|no one (has )?(come|came|called)|i dey wait|e don tey|wetin (dey )?happen|following up|chasing)\b/i;
const chase = openItems.length > 0 && CHASE.test(ctx.text || '') && nWords <= 14 && !inProgress && !['book', 'availability', 'service'].includes(intent) && !danger;
let chaseInfo = {};
if (chase) {
  const it = openItems[0], mins = Math.max(1, Math.round((Date.now() - Date.parse(it.created_at)) / 60000));
  const what = it.kind === 'complaint' ? (pidgin ? 'matter' : 'issue') : it.kind === 'request' ? 'request' : (pidgin ? 'question' : 'question');
  const team = it.category && it.category !== 'other' && it.kind !== 'question' ? (CAT_EN[it.category] || it.category) + ' team' : 'team';
  const n = (it.chase_count || 0) + 1;
  const recent = it.last_chased_at && Date.now() - Date.parse(it.last_chased_at) < 5 * 60000;     // do not spam the staff group
  const chaseReply = pidgin
    ? `Sorry for the wait o. I don push your ${what} go our ${team} again, e don dey open for ${mins} min. Dem go update you here.`
    : `I'm sorry for the wait. I have nudged our ${team} about your ${what}, which has been open for ${mins} min. They will update you here.`;
  chaseInfo = { chase: true, chase_id: it.id, chase_next: n, chase_alert: !recent, chase_reply: chaseReply,
    chase_text: `🔔 Guest is chasing (open ${mins} min, chased ${n}x)\nGuest: ${ctx.guest_name || ctx.from_name || 'Unknown'}${ctx.room ? ' (Room ' + ctx.room + ')' : ''}\nItem: ${it.kind === 'question' ? '' : (it.category ? it.category + ' ' : '') + it.kind + ': '}"${it.question}"\nThey wrote: "${ctx.text}"\nOwner: ${it.assigned_to || 'nobody has taken it yet'}` };
  escalate = true;
}
return [{ json: { ...ctx, ...chaseInfo, intent, lang,
  check_in: s(p.check_in), check_out: s(p.check_out), room_type_said: s(p.room_type), name_said: s(p.guest_name), phone_said: s(p.phone),
  service_said: s(p.service), service_date: s(p.service_date), service_end: s(p.service_end), service_qty: Number.isInteger(p.service_qty) ? p.service_qty : 0, wants_to_book: p.wants_to_book === true,
  question: ctx.text || '(shared their phone number)', reply: chase ? chaseInfo.chase_reply : useAnswer ? p.answer.trim() : holding, info_answer: chase ? '' : extra,
  escalate, ai_answered: chase ? false : useAnswer, kind: chase ? 'question' : kind, category: chase ? null : category } }];
