-- Tests for sql/019_ratings.sql. Run: python execution/supabase_admin.py sql execution/test_ratings.sql
-- Everything is rolled back at the end: a PASS looks like  ERROR: P0001: ALL OK  (anything else names the failed check).
do $$
declare
  HID uuid := (select id from hotels where slug = 'brightside');
  email text := (select email from staff_users limit 1);
  g1 uuid; g2 uuid; b_ok uuid; b_low uuid; b_booked uuid; b_old uuid; b_other uuid;
  r jsonb; s0 jsonb; s1 jsonb; n_esc int; item jsonb;
begin
  s0 := ratings_summary(HID, 7);        -- the baseline, before anything is added
  insert into guests (hotel_id, name, telegram_chat_id) values (HID, 'Rater Ok', 990002001) returning id into g1;
  insert into guests (hotel_id, name, telegram_chat_id) values (HID, 'Rater Low', 990002002) returning id into g2;
  insert into bookings (hotel_id, guest_id, room_type, check_in, check_out, status, checked_out_at, rating_prompted_at)
    values (HID, g1, 'Deluxe', current_date - 3, current_date - 1, 'checked_out', now() - interval '1 hour', now() - interval '30 minutes') returning id into b_ok;
  insert into bookings (hotel_id, guest_id, room_type, room_number, check_in, check_out, status, checked_out_at, rating_prompted_at)
    values (HID, g2, 'Standard', '204', current_date - 3, current_date - 1, 'checked_out', now() - interval '1 hour', now() - interval '30 minutes') returning id into b_low;
  insert into bookings (hotel_id, guest_id, room_type, check_in, check_out, status) values (HID, g1, 'Suite', current_date + 5, current_date + 6, 'booked') returning id into b_booked;
  insert into bookings (hotel_id, guest_id, room_type, check_in, check_out, status, checked_out_at) values (HID, g1, 'Suite', current_date - 40, current_date - 38, 'checked_out', now() - interval '20 days') returning id into b_old;


  -- ---- who may rate what
  assert record_rating(HID, b_ok, 990002001, 0)->>'reason' = 'rating', 'rating 0';
  assert record_rating(HID, b_ok, 990002001, 6)->>'reason' = 'rating', 'rating 6';
  assert record_rating(HID, gen_random_uuid(), 990002001, 5)->>'reason' = 'not_found', 'unknown booking';
  assert record_rating(HID, b_ok, 990002002, 5)->>'reason' = 'not_yours', 'another guest cannot rate this stay';
  assert record_rating(HID, b_ok, 111, 5)->>'reason' = 'not_yours', 'a stranger cannot rate this stay';
  assert record_rating(HID, b_booked, 990002001, 5)->>'reason' = 'not_finished', 'a stay that has not finished cannot be rated';
  assert record_rating(HID, b_old, 990002001, 5)->>'reason' = 'expired', 'ratings close 14 days after checkout';
  assert (select rating from bookings where id in (b_ok, b_booked, b_old) and rating is not null limit 1) is null, 'no refused tap may store a rating';

  -- ---- a good rating: stored, no complaint, can be changed
  r := record_rating(HID, b_ok, 990002001, 5);
  assert r->>'ok' = 'true' and (r->>'rating')::int = 5 and (r->>'new_item')::boolean = false and r->>'previous' is null and r->>'guest_name' = 'Rater Ok', 'good rating: ' || r::text;
  assert (select rating from bookings where id = b_ok) = 5 and (select rated_at from bookings where id = b_ok) is not null, 'stored';
  r := record_rating(HID, b_ok, 990002001, 4);
  assert (r->>'previous')::int = 5 and (select rating from bookings where id = b_ok) = 4, 'a guest can change their rating';
  assert (select count(*) from escalations where booking_id = b_ok) = 0, 'no complaint for a good rating';

  -- ---- a low rating opens ONE complaint item, however many times they tap
  r := record_rating(HID, b_low, 990002002, 2);
  assert r->>'ok' = 'true' and (r->>'new_item')::boolean and r->>'escalation_id' is not null and r->>'room_number' = '204', 'low rating: ' || r::text;
  select count(*) into n_esc from escalations where booking_id = b_low;
  assert n_esc = 1, 'one item';
  assert (select kind from escalations where booking_id = b_low) = 'complaint' and (select category from escalations where booking_id = b_low) = 'other'
     and (select status from escalations where booking_id = b_low) = 'open' and (select guest_chat_id from escalations where booking_id = b_low) = 990002002
     and (select question from escalations where booking_id = b_low) = 'Rated their stay 2 out of 5', 'the item is a complaint, open, for this chat';
  r := record_rating(HID, b_low, 990002002, 1);
  assert (r->>'new_item')::boolean = false and (select count(*) from escalations where booking_id = b_low) = 1, 'tapping again does not open a second item';
  r := record_rating(HID, b_low, 990002002, 3);
  assert (select rating from bookings where id = b_low) = 3 and (select count(*) from escalations where booking_id = b_low) = 1, 'still one item after changing to 3';

  -- ---- figures (differences, so real ratings do not matter)
  s1 := ratings_summary(HID, 7);
  assert (s1->>'rated')::int - (s0->>'rated')::int = 2, 'two rated';
  assert (s1->>'asked')::int - (s0->>'asked')::int = 2, 'two were asked';
  assert (s1->>'low_count')::int - (s0->>'low_count')::int = 1, 'one low score';
  assert (s1->'distribution'->>'4')::int - (s0->'distribution'->>'4')::int = 1 and (s1->'distribution'->>'3')::int - (s0->'distribution'->>'3')::int = 1, 'distribution';
  if (s0->>'rated')::int = 0 then assert (s1->>'average')::numeric = 3.5, 'average of 4 and 3 is 3.5'; end if;
  select x into item from jsonb_array_elements(s1->'low') x where x->>'booking_id' = b_low::text;
  assert item is not null and item->>'name' = 'Rater Low' and (item->>'rating')::int = 3 and (item->>'item_open')::boolean and item->>'room_number' = '204', 'low list: ' || coalesce(item::text, 'missing');
  assert exists (select 1 from jsonb_array_elements(s1->'by_room') x where x->>'room_type' = 'Standard'), 'by room type';
  update escalations set status = 'answered', answered_at = now() where booking_id = b_low;
  select x into item from jsonb_array_elements(ratings_summary(HID, 7)->'low') x where x->>'booking_id' = b_low::text;
  assert not (item->>'item_open')::boolean, 'item_open turns false once the item is settled';
  assert (ratings_summary(HID, 1)->>'days')::int = 1 and (ratings_summary(HID, 9999)->>'days')::int = 365, 'days are bounded';

  -- ---- the dashboard's version is for staff only
  begin perform ratings_report(HID, 7); assert false, 'non-staff got the ratings report'; exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims', json_build_object('email', email, 'role', 'authenticated')::text, true);
  assert (ratings_report(HID, 7)->>'rated')::int = (s1->>'rated')::int, 'staff get the same figures';

  raise exception '%', 'ALL OK';
end $$;
