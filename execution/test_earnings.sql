-- Test for sql/029_earnings.sql. Before 029 is applied, as a DRY RUN with the migration:
--   python -I -X utf8 execution/dry_run_sql.py sql/029_earnings.sql execution/test_earnings.sql
-- After it is applied:  python -I -X utf8 execution/supabase_admin.py sql execution/test_earnings.sql
-- Everything is rolled back at the end: a PASS looks like  ERROR: P0001: ALL OK  (anything else names the failed check).
do $$
declare
  h uuid := gen_random_uuid(); h2 uuid := gen_random_uuid();
  t date; f date; g uuid; b1 uuid; b2 uuid; b3 uuid; sv uuid; sb uuid;
  r jsonb; tot jsonb; ok boolean;
begin
  insert into hotels (id, slug, name) values (h, 'earn-test', 'Earnings Test Hotel'), (h2, 'earn-other', 'Other Hotel');
  t := (now() at time zone hotel_tz(h))::date;  f := t - 3;                    -- the period: four days ending today
  insert into room_types (hotel_id, name, total_rooms, nightly_rate) values (h, 'Standard', 2, 10000), (h, 'Suite', 1, 30000), (h2, 'Standard', 5, 99999);
  insert into guests (hotel_id, name) values (h, 'Ada Owing') returning id into g;

  -- 3 nights in Standard (walk-in), paid 20,000 of 30,000 in cash
  insert into bookings (hotel_id, guest_id, room_type, check_in, check_out, status, source) values (h, g, 'Standard', f, f + 3, 'checked_in', 'walk-in') returning id into b1;
  insert into booking_payments (hotel_id, booking_id, amount, method) values (h, b1, 20000, 'Cash');
  -- 1 night in the Suite (telegram), paid in full by transfer
  insert into bookings (hotel_id, guest_id, room_type, check_in, check_out, status, source) values (h, g, 'Suite', f + 1, f + 2, 'checked_out', 'telegram') returning id into b2;
  insert into booking_payments (hotel_id, booking_id, amount, method) values (h, b2, 30000, 'transfer');
  -- a cancelled stay counts for nothing
  insert into bookings (hotel_id, guest_id, room_type, check_in, check_out, status, source) values (h, g, 'Standard', f, f + 2, 'cancelled', 'phone') returning id into b3;
  -- a stay that runs past the end of the period only counts its nights inside it (today is in, tomorrow is not)
  insert into bookings (hotel_id, guest_id, room_type, check_in, check_out, status, source) values (h, g, 'Standard', t, t + 3, 'booked', 'phone');
  -- an event hall booked for the day after the start, 50,000, paid by POS
  insert into hotel_services (hotel_id, name, price, unit, exclusive) values (h, 'Event hall', 50000, 'per_event', true) returning id into sv;
  insert into service_bookings (hotel_id, service_id, customer_name, starts_on, ends_on, amount, paid) values (h, sv, 'Wedding party', f + 1, f + 1, 50000, 50000) returning id into sb;
  insert into service_payments (hotel_id, booking_id, amount, method) values (h, sb, 50000, 'POS');
  -- a payment from before the period lands in "previous", and another hotel's money never shows
  insert into booking_payments (hotel_id, booking_id, amount, method, created_at) values (h, b1, 7000, 'cash', now() - interval '6 days');
  insert into guests (hotel_id, name) values (h2, 'Elsewhere') returning id into g;
  insert into bookings (hotel_id, guest_id, room_type, check_in, check_out, status) values (h2, g, 'Standard', f, t, 'checked_in') returning id into b3;
  insert into booking_payments (hotel_id, booking_id, amount, method) values (h2, b3, 123456, 'cash');

  insert into staff_users (hotel_id, email, name, role) values
    (h, 'earn.owner@test.invalid', 'O', 'owner'), (h, 'earn.manager@test.invalid', 'M', 'manager'), (h, 'earn.staff@test.invalid', 'S', 'staff');

  set local role authenticated;
  -- ---------------- the owner sees the report
  perform set_config('request.jwt.claims', json_build_object('email', 'earn.owner@test.invalid', 'role', 'authenticated')::text, true);
  assert can_see_earnings(h), 'the owner can see Earnings';
  assert not can_see_earnings(h2), 'but not another hotel''s';
  r := earnings_report(h, f, t);  tot := r->'totals';
  assert (tot->>'rooms_value')::numeric = 3 * 10000 + 30000 + 10000, 'rooms: 3 Standard nights + 1 Suite night + tonight of the long stay; cancelled ignored: ' || (tot->>'rooms_value');
  assert (tot->>'nights_sold')::int = 5, 'five nights sold';
  assert (tot->>'stays')::int = 3, 'three stays touch the period';
  assert (tot->>'services_value')::numeric = 50000, 'the hall';
  assert (tot->>'received')::numeric = 100000, 'received today: 20,000 + 30,000 + 50,000 (not the old 7,000, not the other hotel): ' || (tot->>'received');
  assert (tot->>'room_nights')::int = 3 * 4, 'three rooms on sale for four days';
  assert (r->'previous'->>'received')::numeric = 7000, 'the older payment is in the period before';
  assert jsonb_array_length(r->'series') = 4, 'one row a day';
  assert (select sum((x->>'rooms')::numeric) from jsonb_array_elements(r->'series') x) = (tot->>'rooms_value')::numeric, 'the days add up to the total (rooms)';
  assert (select sum((x->>'received')::numeric) from jsonb_array_elements(r->'series') x) = (tot->>'received')::numeric, 'the days add up to the total (received)';
  assert (select (x->>'services')::numeric from jsonb_array_elements(r->'series') x where x->>'d' = (f + 1)::text) = 50000, 'the hall sits on its own day';
  assert (select (x->>'nights')::int from jsonb_array_elements(r->'series') x where x->>'d' = (f + 1)::text) = 2, 'two rooms were occupied that night';
  assert (select (x->>'amount')::numeric from jsonb_array_elements(r->'by_method') x where x->>'name' = 'cash') = 20000, 'methods are grouped case-blind';
  assert (select (x->>'amount')::numeric from jsonb_array_elements(r->'by_room_type') x where x->>'name' = 'Suite') = 30000, 'by room type';
  assert (select (x->>'amount')::numeric from jsonb_array_elements(r->'by_source') x where x->>'name' = 'walk-in') = 30000, 'by channel';
  assert (r->'by_kind'->>'services')::numeric = 50000 and (r->'by_kind'->>'rooms')::numeric = 50000, 'rooms and services received';
  -- owed: Ada's walk-in stay is 30,000, paid 20,000 + the older 7,000 = 3,000 left; the long stay that starts today owes 30,000
  assert (r->'owed'->>'total')::numeric = 33000, 'owed: 3,000 + 30,000: ' || (r->'owed'->>'total');
  assert (r->'owed'->'top'->0->>'owed')::numeric = 30000, 'largest first';

  -- a refund is taken off what was received and reported as a refund
  reset role;
  insert into booking_payments (hotel_id, booking_id, amount, method) values (h, b2, -5000, 'transfer');
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('email', 'earn.owner@test.invalid', 'role', 'authenticated')::text, true);
  tot := earnings_report(h, f, t)->'totals';
  assert (tot->>'received')::numeric = 95000 and (tot->>'refunds')::numeric = 5000, 'refunds come off';

  -- the price a stay was booked at: changing the room rate later does not rewrite what was earned
  reset role;
  assert (select nightly_rate from bookings where id = b1) = 10000, 'a new booking is stamped with the rate of the moment';
  update room_types set nightly_rate = 99999 where hotel_id = h and name = 'Standard';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('email', 'earn.owner@test.invalid', 'role', 'authenticated')::text, true);
  assert (earnings_report(h, f, t)->'totals'->>'rooms_value')::numeric = 70000, 'past room sales keep their booked price';
  reset role;
  insert into bookings (hotel_id, guest_id, room_type, check_in, check_out, status) values (h, (select guest_id from bookings where id = b1), 'Standard', t, t + 1, 'booked') returning id into b3;
  assert (select nightly_rate from bookings where id = b3) = 99999, 'a booking made after the change takes the new rate';
  update bookings set room_type = 'Suite' where id = b3;
  assert (select nightly_rate from bookings where id = b3) = 30000, 'moving a stay to another room type takes that type''s rate';
  update bookings set status = 'cancelled' where id = b3;
  assert (select nightly_rate from bookings where id = b3) = 30000, 'other changes leave the price alone';
  update room_types set nightly_rate = 10000 where hotel_id = h and name = 'Standard';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('email', 'earn.owner@test.invalid', 'role', 'authenticated')::text, true);

  -- bad periods are refused
  ok := false; begin perform earnings_report(h, t, f); exception when others then ok := sqlerrm like '%start date%'; end;
  assert ok, 'end before start is refused';
  ok := false; begin perform earnings_report(h, t - 500, t); exception when others then ok := sqlerrm like '%400 days%'; end;
  assert ok, 'more than 400 days is refused';

  -- ---------------- a manager: not until the owner says so
  perform set_config('request.jwt.claims', json_build_object('email', 'earn.manager@test.invalid', 'role', 'authenticated')::text, true);
  assert not can_see_earnings(h), 'a manager cannot see Earnings by default';
  ok := false; begin perform earnings_report(h, f, t); exception when others then ok := sqlerrm like '%for the owner%'; end;
  assert ok, 'the manager is refused the report';
  ok := false; begin perform owner_set_earnings_access(h, true); exception when others then ok := sqlerrm like '%Only the owner%'; end;
  assert ok, 'a manager cannot switch it on';
  begin update hotels set earnings_for_managers = true where id = h; exception when insufficient_privilege then null; end;
  assert not (select earnings_for_managers from hotels where id = h), 'nor change the hotel row directly';

  -- the owner switches it on
  perform set_config('request.jwt.claims', json_build_object('email', 'earn.owner@test.invalid', 'role', 'authenticated')::text, true);
  assert (owner_set_earnings_access(h, true)->>'earnings_for_managers')::boolean, 'the owner switches it on';
  perform set_config('request.jwt.claims', json_build_object('email', 'earn.manager@test.invalid', 'role', 'authenticated')::text, true);
  assert can_see_earnings(h) and (earnings_report(h, f, t)->'totals'->>'received')::numeric = 95000, 'now the manager sees the same figures';

  -- front-desk staff: never, even with the switch on
  perform set_config('request.jwt.claims', json_build_object('email', 'earn.staff@test.invalid', 'role', 'authenticated')::text, true);
  assert not can_see_earnings(h), 'staff cannot see Earnings';
  ok := false; begin perform earnings_report(h, f, t); exception when others then ok := sqlerrm like '%for the owner%'; end;
  assert ok, 'staff are refused the report';
  ok := false; begin perform earnings_totals(h, f, t); exception when others then ok := sqlerrm like '%permission denied%'; end;
  assert ok, 'the inner totals function cannot be called from the dashboard';

  -- the owner switches it off again
  perform set_config('request.jwt.claims', json_build_object('email', 'earn.owner@test.invalid', 'role', 'authenticated')::text, true);
  perform owner_set_earnings_access(h, false);
  perform set_config('request.jwt.claims', json_build_object('email', 'earn.manager@test.invalid', 'role', 'authenticated')::text, true);
  assert not can_see_earnings(h), 'switched off, the manager loses it again';
  reset role;
  raise exception 'ALL OK';
end $$;
