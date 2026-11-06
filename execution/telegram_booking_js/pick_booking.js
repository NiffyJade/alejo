// "Pick my booking": which of this guest's active bookings does a Check in / Check out tap mean?
// Check in: a booked stay that is already open (earliest first), otherwise the next upcoming one. Check out: the stay they are in.
const c = $('Classify').first().json;
const rows = $input.all().map(i => i.json).filter(r => r && r.id);
const today = new Date(Date.now() + 3600 * 1000).toISOString().slice(0, 10);   // Africa/Lagos (UTC+1)
let pick = null;
if (c.action === 'checkout') {
  pick = rows.find(r => r.status === 'checked_in') || null;
} else {
  const booked = rows.filter(r => r.status === 'booked').sort((a, b) => a.check_in.localeCompare(b.check_in));
  pick = booked.find(r => r.check_in <= today) || booked[0] || rows.find(r => r.status === 'checked_in') || null;
}
return [{ json: pick || {} }];
