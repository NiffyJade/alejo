-- Tests for daily_digest in sql/020_daily_digest.sql. Run: python execution/supabase_admin.py sql execution/test_daily_digest.sql
-- Everything is rolled back at the end: a PASS looks like  ERROR: P0001: ALL OK  (anything else names the failed check).
-- It adds synthetic rows and checks the DIFFERENCE the digest shows, so real data does not matter.
do $$
declare
  HID uuid := (select id from hotels where slug = 'brightside');
  today date := (now() at time zone 'Africa/Lagos')::date;
  g1 uuid; g2 uuid; g3 uuid; b_arr uuid; b_leave uuid; b_new uuid; b_canc uuid;
  d0 jsonb; d1 jsonb; item jsonb;
begin
  d0 := daily_digest(HID);
  assert d0->>'today' = today::text, 'today is the Lagos date';
  assert (d0->>'rooms_total')::int = (select sum(total_rooms) from room_types where active and hotel_id = HID), 'rooms total';
  assert jsonb_array_length(d0->'free_tonight') = (select count(*) from room_types where active and hotel_id = HID), 'free tonight lists every room type';

  insert into guests (hotel_id, name, phone) values (HID, 'Arriving Ada', '+2348070000001') returning id into g1;
  insert into guests (hotel_id, name, phone) values (HID, 'Leaving Lekan', '+2348070000002') returning id into g2;
  insert into guests (hotel_id, name, phone) values (HID, 'Fresh Funmi', '+2348070000003') returning id into g3;

  -- arrives today, Deluxe 2 nights (110,000), part paid 30,000 -> owes 80,000
  insert into bookings (hotel_id, guest_id, room_type, check_in, check_out, status, source, created_at) values (HID, g1, 'Deluxe', today, today + 2, 'booked', 'phone', now() - interval '3 days') returning id into b_arr;
  insert into booking_payments (hotel_id, booking_id, amount, method, created_at) values (HID, b_arr, 30000, 'cash', now() - interval '3 days');
  -- leaves today, Standard 2 nights (70,000), nothing paid -> owes 70,000
  insert into bookings (hotel_id, guest_id, room_type, room_number, check_in, check_out, status, checked_in_at, source, created_at) values (HID, g2, 'Standard', '101', today - 2, today, 'checked_in', now() - interval '2 days', 'telegram', now() - interval '5 days') returning id into b_leave;
  -- booked in the last 24 hours (Telegram, Suite 1 night = 95,000) and one that was booked then cancelled
  insert into bookings (hotel_id, guest_id, room_type, check_in, check_out, status, source, created_at) values (HID, g3, 'Suite', today + 10, today + 11, 'booked', 'telegram', now() - interval '2 hours') returning id into b_new;
  insert into bookings (hotel_id, guest_id, room_type, check_in, check_out, status, source, created_at, cancelled_at) values (HID, g3, 'Suite', today + 20, today + 21, 'cancelled', 'walk-in', now() - interval '5 hours', now() - interval '1 hour') returning id into b_canc;
  insert into booking_payments (hotel_id, booking_id, amount, method, created_at) values (HID, b_new, 50000, 'transfer', now() - interval '1 hour'), (HID, b_new, -5000, 'cash', now() - interval '30 minutes');
  insert into messages (hotel_id, chat_id, direction, text, intent, created_at) values
    (HID, 990003001, 'in', 'rooms?', 'availability', now() - interval '3 hours'), (HID, 990003001, 'in', 'deluxe', 'book', now() - interval '2 hours'),
    (HID, 990003002, 'in', 'wifi?', 'info', now() - interval '4 hours'), (HID, 990003003, 'in', 'old message', 'availability', now() - interval '2 days');
  insert into escalations (hotel_id, guest_chat_id, question, kind, status, created_at) values
    (HID, 990003002, 'can I bring a dog?', 'question', 'open', now() - interval '3 hours'),
    (HID, 990003004, 'AC is broken', 'request', 'open', now() - interval '90 minutes'),
    (HID, 990003005, 'Rated their stay 2 out of 5', 'complaint', 'answered', now() - interval '1 hour');

  d1 := daily_digest(HID);
  assert (d1->>'in_house')::int - (d0->>'in_house')::int = 1, 'one more in house';
  select x into item from jsonb_array_elements(d1->'arriving') x where x->>'name' = 'Arriving Ada';
  assert item is not null and item->>'room_type' = 'Deluxe' and (item->>'balance')::numeric = 80000, 'arriving, owes 80,000: ' || coalesce(item::text, 'missing');
  select x into item from jsonb_array_elements(d1->'leaving') x where x->>'name' = 'Leaving Lekan';
  assert item is not null and item->>'room_number' = '101' and (item->>'balance')::numeric = 70000, 'leaving, owes 70,000: ' || coalesce(item::text, 'missing');
  assert not exists (select 1 from jsonb_array_elements(d1->'arriving') x where x->>'name' in ('Leaving Lekan', 'Fresh Funmi')), 'only today''s arrivals';
  assert (d1->>'unpaid_count')::int - (d0->>'unpaid_count')::int = 2 and (d1->>'unpaid_sum')::numeric - (d0->>'unpaid_sum')::numeric = 150000, 'unpaid: arriving + in house';
  assert (d1->>'new_bookings')::int - (d0->>'new_bookings')::int = 1 and (d1->>'new_value')::numeric - (d0->>'new_value')::numeric = 95000, 'new bookings exclude the cancelled one';
  assert coalesce((d1->'by_source'->>'telegram')::int, 0) - coalesce((d0->'by_source'->>'telegram')::int, 0) = 1, 'by source';
  assert (d1->>'cancelled')::int - (d0->>'cancelled')::int = 1, 'one cancelled in the last 24 hours';
  assert (d1->>'payments')::numeric - (d0->>'payments')::numeric = 45000, 'payments are net of refunds (50,000 - 5,000)';
  assert (d1->>'people_messaged')::int - (d0->>'people_messaged')::int = 2, 'two people messaged in 24 hours (not the 2-day-old one)';
  assert (d1->>'people_asked_rooms')::int - (d0->>'people_asked_rooms')::int = 1, 'one asked about rooms';
  assert (d1->>'needed_person')::int - (d0->>'needed_person')::int = 2, 'two needed a person (a rating item is not counted)';
  assert (d1->>'open_items')::int - (d0->>'open_items')::int = 2 and (d1->>'open_service')::int - (d0->>'open_service')::int = 1, 'open items, one of them a request';
  assert (d1->>'oldest_open_minutes')::numeric >= 179, 'the oldest open item has waited about 3 hours';
  assert (d1->'free_tonight') @> '[{"room_type": "Suite"}]'::jsonb, 'free tonight names room types';
  assert not exists (select 1 from jsonb_array_elements(d1->'free_tonight') x where (x->>'free')::int < 0), 'never a negative number of free rooms';

  raise exception '%', 'ALL OK';
end $$;
