// "Compose ratings summary" (Scheduler, Monday mornings): the week's guest ratings for the staff group.
// Sends nothing when nobody rated a stay in the last 7 days (send = false), so a quiet week is not noise.
const r = $input.first().json || {};
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = s => { const t = new Date(Date.parse(s)); return `${t.getUTCDate()} ${MON[t.getUTCMonth()]}`; };
if (!r || !Number(r.rated)) return [{ json: { send: false, text: '' } }];
const d = r.distribution || {};
const asked = Number(r.asked) || 0, rated = Number(r.rated);
const lines = [
  `⭐ Guest ratings, last ${r.days} days`, '',
  `Rated: ${rated}${asked ? ` of ${asked} asked (${Math.min(100, Math.round(100 * rated / asked))}%)` : ''}`,
  `Average: ${Number(r.average).toFixed(1)} out of 5${r.previous_average !== null && r.previous_average !== undefined && Number(r.previous_rated) ? ` (the 7 days before: ${Number(r.previous_average).toFixed(1)})` : ''}`,
  `5★ ${d['5'] || 0} · 4★ ${d['4'] || 0} · 3★ ${d['3'] || 0} · 2★ ${d['2'] || 0} · 1★ ${d['1'] || 0}`,
];
const low = r.low || [];
if (low.length) {
  lines.push('', `Needs attention (3 or lower): ${low.length}`);
  for (const l of low.slice(0, 8)) lines.push(`• ${l.name || 'Guest'}, ${l.room_type || 'room'}${l.room_number ? ' ' + l.room_number : ''}, ${l.rating} out of 5, stayed ${day(l.check_in)} to ${day(l.check_out)}${l.item_open ? ' (still open)' : ''}`);
  if (low.length > 8) lines.push(`…and ${low.length - 8} more`);
} else lines.push('', 'No low scores this week. 🎉');
lines.push('', 'The Ratings page on the dashboard has the full picture.');
return [{ json: { send: true, text: lines.join('\n') } }];
