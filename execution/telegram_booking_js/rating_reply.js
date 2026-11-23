// "Rating reply" (Telegram bot): the guest tapped 1-5 under the thank-you after checkout, and record_rating answered.
// A score of 3 or less has already opened a complaint item (the database does that once per stay); here we word the reply and the staff alert.
// English only for now.
const r = $input.first().json || {};
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = s => { const t = new Date(Date.parse(s)); return `${t.getUTCDate()} ${MON[t.getUTCMonth()]}`; };
if (r.ok !== true) {
  const why = {
    not_yours: "Sorry, I couldn't match that stay to this chat.",
    not_found: "Sorry, I couldn't find that stay.",
    not_finished: 'You can rate your stay once you have checked out.',
    expired: 'Sorry, ratings for that stay have closed. You are always welcome to message me here with your feedback.',
  }[r.reason] || 'Sorry, I could not save that rating. Please try again, or message me here.';
  return [{ json: { text: why, alert: '', escalation_id: null } }];
}
const n = Number(r.rating), first = String(r.guest_name || '').trim().split(/\s+/)[0].slice(0, 30);
let text;
if (r.previous !== null && r.previous !== undefined && Number(r.previous) === n) text = `Thanks${first ? ', ' + first : ''}! Your rating of ${n} out of 5 is saved.`;
else if (n >= 4) text = `Thank you${first ? ', ' + first : ''}! 🙏 I'm glad you enjoyed your stay. We hope to welcome you again soon.`;
else if (n === 3) text = `Thank you for telling us${first ? ', ' + first : ''}. I'm sorry we didn't get everything right. I have let our manager know. If you tell me what could have been better, I will pass it on.`;
else text = `I'm really sorry${first ? ', ' + first : ''}, your stay wasn't what it should have been. I have told our manager now and someone will reach out to you here. If you'd like, tell me what went wrong and I will pass it on.`;
const stay = `${r.room_type || 'Room'}${r.room_number ? ' room ' + r.room_number : ''}, ${day(r.check_in)} to ${day(r.check_out)}`;
const alert = r.new_item
  ? `⭐ Low stay rating: ${n} out of 5\nGuest: ${r.guest_name || 'unknown'}\nStay: ${stay}\n\nThis is now an open complaint. Reply to THIS message to answer the guest, or use the dashboard Inbox.`
  : '';
return [{ json: { text, alert, escalation_id: r.escalation_id || null } }];
