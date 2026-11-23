// "Compose daily summary" (Scheduler, every morning): the manager's summary from daily_digest(). Sections with nothing to say are short or left out,
// so a quiet day is a short message. It goes to MANAGER_CHAT_ID when that setting holds a chat id, otherwise to the staff group.
const d = $input.first().json || {};
if (!d.today) return [];                       // the figures could not be fetched: send nothing, the scheduler tries again on its next run
const s = ($('Context').first().json || {}).settings || {};
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const t = new Date(Date.parse(d.today));
const label = `${DAY[t.getUTCDay()]} ${t.getUTCDate()} ${MON[t.getUTCMonth()]}`;
const naira = n => '₦' + Number(n).toLocaleString('en-US');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const short = name => { const p = String(name || 'Guest').trim().split(/\s+/).filter(Boolean); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : (p[0] || 'Guest'); };
const age = m => { m = Math.round(Number(m) || 0); return m < 60 ? `${Math.max(1, m)} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`; };
const list = (arr, max, fmt) => arr.slice(0, max).map(fmt).join(' · ') + (arr.length > max ? ` · +${arr.length - max} more` : '');
const stay = l => `${short(l.name)} ${l.room_number ? l.room_number : (l.room_type || '')}`.trim() + (Number(l.balance) > 0 ? ` (owes ${naira(l.balance)})` : '');
const SRC = { telegram: 'Telegram', phone: 'Phone', 'walk-in': 'Walk-in', online: 'Online', other: 'Other' };

const arriving = d.arriving || [], leaving = d.leaving || [];
const total = Number(d.rooms_total) || 0, inHouse = Number(d.in_house) || 0;
const lines = [`☀️ ${s.HOTEL_NAME || 'Your hotel'}, ${label}`, '', 'TODAY',
  arriving.length ? `Arriving (${arriving.length}): ${list(arriving, 6, stay)}` : 'Arriving: nobody',
  leaving.length ? `Leaving (${leaving.length}): ${list(leaving, 6, stay)}` : 'Leaving: nobody',
  `In house: ${inHouse} of ${plural(total, 'room', 'rooms')}${total ? ` (${Math.round(100 * inHouse / total)}%)` : ''}`,
  `Free tonight: ${(d.free_tonight || []).map(f => `${f.room_type} ${Math.max(0, Number(f.free) || 0)}`).join(' · ') || 'no room types set up'}`,
  '', 'LAST 24 HOURS'];
const bySource = Object.entries(d.by_source || {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${SRC[k] || k} ${n}`).join(' · ');
lines.push(Number(d.new_bookings) ? `New bookings: ${d.new_bookings}, worth ${naira(d.new_value)}${bySource ? ` (${bySource})` : ''}` : 'New bookings: none');
if (Number(d.cancelled)) lines.push(`Cancelled: ${d.cancelled}`);
if (Number(d.payments)) lines.push(`Payments recorded: ${naira(d.payments)}`);
const msgd = Number(d.people_messaged) || 0;
lines.push(msgd
  ? `Messages from ${plural(msgd, 'person', 'people')}${Number(d.people_asked_rooms) ? `, ${d.people_asked_rooms} asked about rooms` : ''}${Number(d.needed_person) ? `, ${d.needed_person} needed a person` : ''}`
  : 'No messages from guests');
lines.push('', 'NEEDS YOU');
const need = [];
if (Number(d.open_items)) need.push(`${plural(Number(d.open_items), 'open item', 'open items')}${Number(d.open_service) ? ` (${d.open_service} ${Number(d.open_service) === 1 ? 'is a request or complaint' : 'are requests or complaints'})` : ''}, the oldest waiting ${age(d.oldest_open_minutes)}`);
if (Number(d.unpaid_count)) need.push(`Unpaid: ${plural(Number(d.unpaid_count), 'stay', 'stays')}, ${naira(d.unpaid_sum)} in total`);
lines.push(...(need.length ? need : ['Nothing is waiting on you. ✅']));

const custom = String(s.MANAGER_CHAT_ID || '').trim();
return [{ json: { chat_id: /^-?\d{5,}$/.test(custom) ? Number(custom) : __STAFF__, text: lines.join('\n') } }];
