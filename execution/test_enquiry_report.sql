-- Tests for enquiry_report in sql/018_enquiries.sql. Run: python execution/supabase_admin.py sql execution/test_enquiry_report.sql
-- Everything is rolled back at the end: a PASS looks like  ERROR: P0001: ALL OK  (anything else names the failed check).
-- It adds synthetic conversations (chat ids 99000100x) and checks the DIFFERENCE the report shows, so real data does not matter.
do $$
declare
  HID uuid := (select id from hotels where slug = 'brightside');
  email text := (select email from staff_users limit 1);
  lagos_midnight timestamptz := date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos';
  t_day  timestamptz := lagos_midnight - interval '2 days' + interval '10 hours';      -- 10:00 Lagos, two days ago: open hours
  t_late timestamptz := lagos_midnight - interval '1 day' + interval '23 hours 30 minutes';  -- 23:30 Lagos yesterday: after hours
  b0 jsonb; b1 jsonb; g1 uuid; g3 uuid; esc uuid; r jsonb; item jsonb;
begin
  begin perform enquiry_report(HID, 7); assert false, 'non-staff got the report'; exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims', json_build_object('email', email, 'role', 'authenticated')::text, true);
  b0 := enquiry_report(HID, 30);

  -- A: asks about rooms, starts a booking, books (a guest linked to the chat, source telegram) 20 minutes later
  insert into messages (hotel_id, chat_id, direction, text, intent, created_at) values
    (HID, 990001001, 'in', 'rooms friday?', 'availability', t_day), (HID, 990001001, 'out', 'We have...', null, t_day + interval '5 seconds'),
    (HID, 990001001, 'in', 'deluxe please', 'book', t_day + interval '5 minutes');
  insert into guests (hotel_id, name, telegram_chat_id) values (HID, 'Booker', 990001001) returning id into g1;
  insert into bookings (hotel_id, guest_id, room_type, check_in, check_out, source, created_at)
    values (HID, g1, 'Deluxe', current_date + 300, current_date + 301, 'telegram', t_day + interval '20 minutes');

  -- B: only a general question, handled by the bot
  insert into messages (hotel_id, chat_id, direction, text, intent, created_at) values (HID, 990001002, 'in', 'what time is checkout?', 'info', t_day + interval '1 hour');

  -- C: asks late at night, does not book, gets one follow-up, replies the next morning; also needed a person (answered after 30 min)
  insert into messages (hotel_id, chat_id, direction, text, intent, created_at) values
    (HID, 990001003, 'in', 'any suite next week?', 'availability', t_late), (HID, 990001003, 'out', 'We have...', null, t_late + interval '5 seconds'),
    (HID, 990001003, 'out', 'Still interested?', 'followup', t_late + interval '4 hours'),
    (HID, 990001003, 'in', 'yes', 'book', t_late + interval '5 hours');
  insert into booking_drafts (hotel_id, chat_id, check_in, check_out, room_type, tg_name, updated_at, followup_sent_at)
    values (HID, 990001003, current_date + 20, current_date + 22, 'Suite', 'Late Lola', now() - interval '1 hour', now() - interval '30 minutes');
  insert into escalations (hotel_id, guest_chat_id, question, status, created_at, answered_at, staff_answer)
    values (HID, 990001003, 'can I bring a dog?', 'answered', t_late + interval '1 minute', t_late + interval '31 minutes', 'yes');

  -- D: two inbound messages an hour apart are ONE enquiry; one 13 hours later is a second enquiry
  insert into messages (hotel_id, chat_id, direction, text, intent, created_at) values
    (HID, 990001004, 'in', 'hi', 'other', t_day), (HID, 990001004, 'in', 'anyone there?', 'other', t_day + interval '1 hour'),
    (HID, 990001004, 'in', 'hello again', 'info', t_day + interval '14 hours');

  -- E: asked about rooms 5 days ago and never came back: lost, not open
  insert into messages (hotel_id, chat_id, direction, text, intent, created_at) values (HID, 990001005, 'in', 'rooms?', 'availability', lagos_midnight - interval '5 days' + interval '12 hours');

  r := enquiry_report(HID, 30);
  assert (r->>'enquiries')::int - (b0->>'enquiries')::int = 6, 'enquiries: A, B, C, D x2, E = 6, got ' || ((r->>'enquiries')::int - (b0->>'enquiries')::int);
  assert (r->>'asked_rooms')::int - (b0->>'asked_rooms')::int = 3, 'asked about rooms: A, C, E';
  assert (r->>'wanted_booking')::int - (b0->>'wanted_booking')::int = 2, 'wanted to book: A, C';
  assert (r->>'booked')::int - (b0->>'booked')::int = 1, 'booked: A only';
  assert (r->>'booked_of_room_enquiries')::int - (b0->>'booked_of_room_enquiries')::int = 1, 'booked among room enquiries';
  assert (r->>'needed_person')::int - (b0->>'needed_person')::int = 1, 'needed a person: C';
  assert (r->>'answered_alone')::int - (b0->>'answered_alone')::int = 5, 'answered alone';
  assert (r->>'after_hours')::int - (b0->>'after_hours')::int = 2, 'after hours: C (23:30) and the second D conversation (00:00)';
  assert (r->>'followups_sent')::int - (b0->>'followups_sent')::int = 1, 'one follow-up sent';
  assert (r->>'booked_after_followup')::int - (b0->>'booked_after_followup')::int = 0, 'nobody booked after a follow-up yet';
  assert (r->>'lost')::int - (b0->>'lost')::int = 1, 'lost: E';
  assert r->>'tracking_since' is not null, 'tracking_since';

  -- the open list: C (unfinished, followed up, name from the draft), not A (booked) and not E (too old)
  select x into item from jsonb_array_elements(r->'open') x where (x->>'chat_id')::bigint = 990001003;
  assert item is not null and item->>'name' = 'Late Lola' and (item->>'followed_up')::boolean and item->>'room_type' = 'Suite', 'open item C: ' || coalesce(item::text, 'missing');
  assert not exists (select 1 from jsonb_array_elements(r->'open') x where (x->>'chat_id')::bigint in (990001001, 990001005)), 'booked or old enquiries must not be open';

  -- the median staff reply time moves to 30 minutes when ours is the only answered escalation of the period
  delete from escalations where guest_chat_id <> 990001003 and created_at >= now() - interval '30 days';
  assert (enquiry_report(HID, 30)->>'median_staff_reply_minutes')::numeric = 30, 'median staff reply minutes';

  -- if C now books, the report credits the follow-up
  insert into guests (hotel_id, name, telegram_chat_id) values (HID, 'Late Lola', 990001003) returning id into g3;
  insert into bookings (hotel_id, guest_id, room_type, check_in, check_out, source, created_at)
    values (HID, g3, 'Suite', current_date + 400, current_date + 401, 'telegram', t_late + interval '6 hours');
  r := enquiry_report(HID, 30);
  assert (r->>'booked_after_followup')::int - (b0->>'booked_after_followup')::int = 1, 'booked after a follow-up';
  assert not exists (select 1 from jsonb_array_elements(r->'open') x where (x->>'chat_id')::bigint = 990001003), 'C is no longer open once booked';

  -- a short window excludes older conversations
  assert (enquiry_report(HID, 1)->>'enquiries')::int <= (r->>'enquiries')::int, 'a 1-day window is not larger than 30 days';

  raise exception '%', 'ALL OK';
end $$;
