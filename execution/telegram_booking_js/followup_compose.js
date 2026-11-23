// "Compose follow-ups" (Scheduler): one message for each unfinished booking the scheduler found. The message promises nothing about the
// room (it may be gone): it only offers to carry on, and the bot checks availability again when the guest says yes.
// __LANG__
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmt = s => { const t = new Date(Date.parse(s)); return `${DAY[t.getUTCDay()]} ${t.getUTCDate()} ${MON[t.getUTCMonth()]}`; };
return $input.all().map(i => i.json).filter(d => d.chat_id && d.room_type && d.check_in && d.check_out).map(d => {
  const lang = d.lang === 'pcm' ? 'pcm' : 'en';
  const first = String(d.guest_name || d.tg_name || '').trim().split(/\s+/)[0].slice(0, 30);
  return { json: { chat_id: d.chat_id, lang,
    text: tr(lang, 'followup', first, d.room_type, `${fmt(d.check_in)} to ${fmt(d.check_out)}`),
    yes_label: tr(lang, 'followup_yes'), no_label: tr(lang, 'followup_no') } };
});
