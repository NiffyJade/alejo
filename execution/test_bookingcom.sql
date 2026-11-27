-- Test for sql/031_bookingcom_counts.sql. Before 031 is applied, as a DRY RUN with the migration:
--   python -I -X utf8 execution/dry_run_sql.py sql/031_bookingcom_counts.sql execution/test_bookingcom.sql
-- After it is applied:  python -I -X utf8 execution/supabase_admin.py sql execution/test_bookingcom.sql
-- Everything is rolled back at the end: a PASS looks like  ERROR: P0001: ALL OK  (anything else names the failed check).
do $$
declare
  h uuid := gen_random_uuid(); t date; g uuid; b1 uuid; r jsonb; ok boolean; n int;
begin
  insert into hotels (id, slug, name) values (h, 'bdc-test', 'Booking.com Test Hotel');
  t := (now() at time zone hotel_tz(h))::date;
  insert into room_types (hotel_id, name, total_rooms, nightly_rate) values (h, 'Standard', 3, 10000), (h, 'Suite', 1, 50000);
  insert into staff_users (hotel_id, email, name, role) values (h, 'bdc.staff@test.invalid', 'S', 'staff');

  -- off by default: nothing kept, nothing to say
  r := ota_check(h);
  assert (r->>'enabled')::boolean = false and not exists (select 1 from ota_counts where hotel_id = h), 'off by default';

  -- switched on: the first check only notes the counts and says what is free tonight
  insert into hotel_settings (hotel_id, key, value) values (h, 'BOOKINGCOM_SYNC', 'yes');
  r := ota_check(h);
  assert (r->>'first')::boolean and jsonb_array_length(r->'changes') = 0, 'first check: no changes, just the start';
  assert (select count(*) from ota_counts where hotel_id = h) = 2 * 365, 'a year of nights noted for both room types';
  assert exists (select 1 from jsonb_array_elements(r->'tonight') x where x->>'room_type' = 'Standard' and (x->>'rooms')::int = 3), 'tonight: 3 Standard free';
  r := ota_check(h);
  assert not (r->>'first')::boolean and jsonb_array_length(r->'changes') = 0, 'nothing changed, nothing to say';

  -- a walk-in takes a Standard for two nights: Booking.com must come down to 2 on those nights
  insert into guests (hotel_id, name) values (h, 'Walk In') returning id into g;
  insert into bookings (hotel_id, guest_id, room_type, check_in, check_out, source) values (h, g, 'Standard', t, t + 2, 'walk-in');
  r := ota_check(h);
  assert jsonb_array_length(r->'changes') = 2, 'two nights changed: ' || (r->'changes')::text;
  assert (select bool_and(x->>'room_type' = 'Standard' and (x->>'rooms')::int = 2 and (x->>'was')::int = 3) from jsonb_array_elements(r->'changes') x), 'Standard 3 -> 2';
  n := ota_mark(h, r->'changes');
  assert n = 2 and jsonb_array_length(ota_check(h)->'changes') = 0, 'once told, not told again';

  -- a Booking.com booking recorded in Alejo by staff: Booking.com already lowered its own count, so staff are told nothing
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('email', 'bdc.staff@test.invalid', 'role', 'authenticated')::text, true);
  r := staff_create_booking(h, 'From Booking', null, 'Standard', t + 5, t + 7, 'booking.com');
  reset role;
  b1 := (r->>'id')::uuid;
  if b1 is null then select id into b1 from bookings where hotel_id = h and source = 'booking.com'; end if;
  assert (select source from bookings where id = b1) = 'booking.com', 'the source is kept as Booking.com (not "other"): ' || coalesce(r::text, 'null');
  assert jsonb_array_length(ota_check(h)->'changes') = 0, 'no instruction for a change Booking.com made itself';
  assert (select rooms from ota_counts where hotel_id = h and room_type = 'Standard' and night = t + 5) = 2, 'the told count followed Booking.com';

  -- the guest cancels on Booking.com and staff cancel it in Alejo: Booking.com already put the room back, so again nothing
  update bookings set status = 'cancelled', cancelled_at = now() where id = b1;
  assert jsonb_array_length(ota_check(h)->'changes') = 0, 'a Booking.com cancellation needs no instruction either';
  assert (select rooms from ota_counts where hotel_id = h and room_type = 'Standard' and night = t + 5) = 3, 'back to 3';

  -- the only Suite is blocked for a night: Booking.com must close it (0)
  insert into room_blocks (hotel_id, room_type, rooms, start_date, end_date, reason) values (h, 'Suite', 1, t + 10, t + 11, 'repairs');
  r := ota_check(h);
  assert jsonb_array_length(r->'changes') = 1 and (r->'changes'->0->>'rooms')::int = 0 and r->'changes'->0->>'room_type' = 'Suite', 'Suite closes for that night';

  -- the walk-in leaves early: the room is free again tonight and tomorrow, Booking.com can sell it
  perform ota_mark(h, r->'changes');
  update bookings set status = 'checked_out' where hotel_id = h and source = 'walk-in';
  r := ota_check(h);
  assert jsonb_array_length(r->'changes') = 2 and (select bool_and((x->>'rooms')::int = 3) from jsonb_array_elements(r->'changes') x), 'freed rooms go back up';

  -- nights in the past are dropped
  insert into ota_counts (hotel_id, room_type, night, rooms) values (h, 'Standard', t - 3, 1);
  perform ota_check(h);
  assert not exists (select 1 from ota_counts where hotel_id = h and night < t), 'the past is forgotten';

  -- switched off: forgotten; on again: a fresh start, no flood
  update hotel_settings set value = 'no' where hotel_id = h and key = 'BOOKINGCOM_SYNC';
  perform ota_check(h);
  assert not exists (select 1 from ota_counts where hotel_id = h), 'off clears what was told';
  update hotel_settings set value = 'yes' where hotel_id = h and key = 'BOOKINGCOM_SYNC';
  assert (ota_check(h)->>'first')::boolean, 'on again starts afresh';

  -- the dashboard cannot run the check or change what was told (the scheduler does that)
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('email', 'bdc.staff@test.invalid', 'role', 'authenticated')::text, true);
  ok := false; begin perform ota_check(h); exception when insufficient_privilege then ok := true; end;
  assert ok, 'staff cannot run the check';
  ok := false; begin perform ota_mark(h, '[]'::jsonb); exception when insufficient_privilege then ok := true; end;
  assert ok, 'staff cannot mark counts as told';
  assert (select count(*) from ota_counts where hotel_id = h) > 0, 'but can read them';
  reset role;
  raise exception 'ALL OK';
end $$;
