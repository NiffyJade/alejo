const u = $input.first().json;
const STAFF = __STAFF__;
const clean = (s, re) => String(s || '').replace(re, '');
let out = { type: 'ignore' };
if (u.callback_query) {
  const q = u.callback_query, raw = String(q.data || '');
  const [action, id] = raw.split(':');
  const who = [q.from && q.from.first_name, q.from && q.from.last_name].filter(Boolean).join(' ').slice(0, 60);
  if (/^fu(yes|no):/.test(raw)) {
    // buttons under the follow-up for an unfinished booking (sent by the scheduler)
    if (q.message && q.message.chat.type === 'private')
      out = raw.startsWith('fuyes')
        ? { type: 'booking_cb', query_id: q.id, chat_id: q.message.chat.id, action: 'bkcont', payload: '', text: 'Yes, I would like to continue my booking.', from_name: who }
        : { type: 'booking_cb', query_id: q.id, chat_id: q.message.chat.id, action: 'bkno', payload: '' };
  } else if (/^bk(ok|no):/.test(raw)) {
    // Confirm / Cancel under a booking summary; the payload names the dates and room type that were summarised
    if (q.message && q.message.chat.type === 'private')
      out = { type: 'booking_cb', query_id: q.id, chat_id: q.message.chat.id, action, payload: raw.slice(raw.indexOf(':') + 1).slice(0, 60) };
  } else {
    out = { type: 'callback', query_id: q.id, chat_id: q.message && q.message.chat.id,
            action, booking_id: clean(id, /[^0-9a-f-]/g) };
  }
} else if (u.message) {
  const m = u.message, text = (m.text || '').trim();
  const fromName = [m.from && m.from.first_name, m.from && m.from.last_name].filter(Boolean).join(' ').slice(0, 60);
  if (m.chat.id === STAFF) {
    if (m.reply_to_message && text) {
      const learn = /^#kb\s+/i.test(text);
      out = { type: 'staff_reply', reply_to: m.reply_to_message.message_id,
              text: learn ? text.replace(/^#kb\s+/i, '') : text, learn };
    }
  } else if (m.chat.type === 'private' && m.contact) {
    const phone = String(m.contact.phone_number || '').replace(/\D/g, '');
    out = { type: 'contact', chat_id: m.chat.id, phone, from_name: fromName,
            own: phone.length >= 7 && (!m.contact.user_id || m.contact.user_id === (m.from && m.from.id)) };
  } else if (m.chat.type === 'private' && text) {
    const s = text.match(/^\/start(?:\s+(\S+))?$/);
    const token = s ? clean(s[1], /[^A-Za-z0-9_-]/g) : '';
    // Shortcuts are matched by exact rules, not by the AI: instant, and they cannot be misread.
    // Emoji and punctuation are stripped first, so the menu buttons ("✅ Check in") and plain typing both work.
    const t = text.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/\s+/g, ' ').trim();
    const wantsChange = /\b(cancel|change|modify|extend|move|refund|reschedul\w*|postpone|amend)\b/.test(t);
    if (s && token) out = { type: 'start', chat_id: m.chat.id, token };
    else if (s || /^(menu|help|hello menu|show menu)$/.test(t)) out = { type: 'hello', chat_id: m.chat.id };   // /start without a booking link
    else if (/^(check ?in( now| please)?|check me in( please)?|i want to check in)$/.test(t)) out = { type: 'menu', action: 'checkin', chat_id: m.chat.id };
    else if (/^(check ?out( now| please)?|check me out( please)?|i want to check out)$/.test(t)) out = { type: 'menu', action: 'checkout', chat_id: m.chat.id };
    else if (!wantsChange && (/\b(booking|reservation)s? ?(id|ref|reference|number|no|code|details|status)\b/.test(t)
          || /\b(my|the) (ref|reference|confirmation)( number| code| id)?\b/.test(t)
          || /^(my|show my|see my|view my|check my) (booking|reservation)s?( please)?$/.test(t)))
      out = { type: 'mybooking', chat_id: m.chat.id };
    else out = { type: 'guest_message', chat_id: m.chat.id, text: text.slice(0, 1000), from_name: fromName };
  }
}
return [{ json: out }];
