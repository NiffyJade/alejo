// "Check confirm": a guest tapped Confirm or Cancel under a booking summary. Only a tap on the button for the CURRENT summary books.
// __LANG__
const c = $('Classify').first().json;
const dr = $input.first().json || {};
const lang = dr.lang || 'en';
const msg = key => [{ json: { mode: 'msg', lang, text: tr(lang, key) } }];
if (c.action === 'bkcont') return [{ json: { mode: 'cont', lang } }];       // "Yes, continue" under a follow-up: back into the normal conversation
if (c.action === 'bkno') return [{ json: { mode: 'cancel', lang, text: tr(lang, 'cancelled') } }];
const fresh = !!dr.chat_id && Date.now() - Date.parse(dr.updated_at) < 6 * 3600 * 1000;
if (!fresh || !dr.check_in || !dr.check_out || !dr.room_type) return msg('expired');
if (c.payload !== `${dr.check_in}|${dr.check_out}|${dr.room_type.slice(0, 20)}`) return msg('changed');
return [{ json: { mode: 'book', lang, body: { p_chat_id: c.chat_id, p_name: dr.guest_name || '', p_phone: dr.phone || '',
  p_verified: !!dr.phone_verified, p_room_type: dr.room_type, p_check_in: dr.check_in, p_check_out: dr.check_out } } }];
