-- Tests for sql/025_services.sql and sql/026_service_payments.sql (event hall, gym, pool ... bookings and their payment history). Run AFTER 026 is applied:
--   python -I -X utf8 execution/supabase_admin.py sql execution/test_services.sql
-- Before 026 is applied, run it as a DRY RUN together with the migration (025 is already live):  python -I -X utf8 execution/dry_run_sql.py sql/026_service_payments.sql execution/test_services.sql
-- Everything is rolled back at the end: a PASS looks like  ERROR: P0001: ALL OK  (anything else names the failed check).
do $$
declare
  ha uuid := gen_random_uuid(); hb uuid := gen_random_uuid();
  es text := 'svc.staff.a@test.invalid'; em text := 'svc.manager.a@test.invalid'; eb text := 'svc.manager.b@test.invalid';
  hall_a uuid; pool_a uuid; gym_a uuid; off_a uuid; hall_b uuid;
  r jsonb; b1 uuid; b2 uuid; b3 uuid; n int; t0 date := current_date + 10;
begin
  insert into hotels (id, slug, name) values (ha, 'svc-a', 'Service Hotel A'), (hb, 'svc-b', 'Service Hotel B');
  insert into staff_users (hotel_id, email, name, role) values (ha, es, 'S', 'staff'), (ha, em, 'M', 'manager'), (hb, eb, 'MB', 'manager');
  insert into hotel_services (hotel_id, name, price, unit, exclusive) values (ha, 'Event hall', 250000, 'per_event', true) returning id into hall_a;
  insert into hotel_services (hotel_id, name, price, unit, exclusive) values (ha, 'Pool', 3000, 'per_head', false) returning id into pool_a;
  insert into hotel_services (hotel_id, name, price, unit, exclusive) values (ha, 'Gym monthly', 18000, 'per_month', false) returning id into gym_a;
  insert into hotel_services (hotel_id, name, price, unit, exclusive, active) values (ha, 'Old spa', 5000, 'per_visit', false, false) returning id into off_a;
  insert into hotel_services (hotel_id, name, price, unit, exclusive) values (hb, 'Event hall', 100000, 'per_event', true) returning id into hall_b;

  -- ============ STAFF of hotel A
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('email', es, 'role', 'authenticated')::text, true);
  assert (select count(*) from hotel_services) = 4, 'staff read their hotel''s services (and no other hotel''s)';

  r := staff_create_service_booking(ha, hall_a, 'Ada Obi', '0803 111 2222', t0, t0, '10:00', '16:00', 1);
  assert r->>'ok' = 'true' and (r->>'amount')::numeric = 250000 and r->>'service' = 'Event hall', 'staff books the hall; the amount defaults to price x quantity';
  b1 := (r->>'id')::uuid;
  assert (select starts_on = t0 and ends_on = t0 and status = 'booked' and paid = 0 and quantity = 1 from service_bookings where id = b1), 'the booking is stored as asked';

  -- the hall holds one booking per day
  r := staff_create_service_booking(ha, hall_a, 'Someone Else', null, t0, t0);
  assert r->>'ok' = 'false' and r->>'reason' = 'taken' and (r->>'from')::date = t0, 'the same day is refused for an exclusive service, with the dates that block it';
  r := staff_create_service_booking(ha, hall_a, 'Overlap', null, t0 - 1, t0 + 1);
  assert r->>'reason' = 'taken', 'a longer booking that overlaps it is refused';
  r := staff_create_service_booking(ha, hall_a, 'Next Day', null, t0 + 1, t0 + 2, null, null, 1, 200000, 50000);
  assert r->>'ok' = 'true' and (r->>'amount')::numeric = 200000, 'the next day is free, and a negotiated amount is kept';
  b2 := (r->>'id')::uuid;
  assert (select count(*) from service_payments where booking_id = b2) = 1 and (select amount from service_payments where booking_id = b2) = 50000
     and (select method from service_payments where booking_id = b2) = 'recorded at booking', 'money paid at booking becomes the first payment row';
  r := staff_create_service_booking(ha, pool_a, 'Pays By Transfer', null, t0 + 3, t0 + 3, null, null, 2, null, 6000, 'phone', null, 'transfer');
  assert (select method from service_payments where booking_id = (r->>'id')::uuid) = 'transfer', 'the payment method given at booking is kept';

  -- a pool and a gym are not exclusive: many on the same day, the amount follows the quantity
  r := staff_create_service_booking(ha, pool_a, 'Group One', null, t0, t0, null, null, 4);
  assert r->>'ok' = 'true' and (r->>'amount')::numeric = 12000, 'pool: 4 heads x 3,000';
  r := staff_create_service_booking(ha, pool_a, 'Group Two', null, t0, t0, null, null, 2);
  assert r->>'ok' = 'true', 'a non-exclusive service can be booked many times on one day';
  r := staff_create_service_booking(ha, gym_a, 'Member', '08099998888', t0, t0 + 29, null, null, 1);
  assert r->>'ok' = 'true' and (r->>'amount')::numeric = 18000, 'a monthly membership covers its whole period';

  -- every refusal names its reason, and nothing is stored
  select count(*) into n from service_bookings;
  assert staff_create_service_booking(ha, hall_a, '  ', null, t0 + 5, t0 + 5)->>'reason' = 'name', 'a name is needed';
  assert staff_create_service_booking(ha, off_a, 'X', null, t0, t0)->>'reason' = 'service', 'a switched-off service cannot be booked';
  assert staff_create_service_booking(ha, hall_b, 'X', null, t0 + 5, t0 + 5)->>'reason' = 'service', 'another hotel''s service cannot be booked';
  assert staff_create_service_booking(ha, hall_a, 'X', null, current_date - 1, current_date - 1)->>'reason' = 'dates', 'a past date is refused';
  assert staff_create_service_booking(ha, hall_a, 'X', null, t0 + 8, t0 + 7)->>'reason' = 'dates', 'the end cannot be before the start';
  assert staff_create_service_booking(ha, hall_a, 'X', null, t0 + 20, t0 + 20 + 400)->>'reason' = 'dates', 'more than a year is refused';
  assert staff_create_service_booking(ha, hall_a, 'X', null, t0 + 5, t0 + 5, '16:00', '10:00')->>'reason' = 'times', 'a same-day end time before the start time is refused';
  assert staff_create_service_booking(ha, pool_a, 'X', null, t0 + 5, t0 + 5, null, null, 0)->>'reason' = 'quantity', 'quantity must be at least 1';
  assert staff_create_service_booking(ha, hall_a, 'X', null, t0 + 5, t0 + 5, null, null, 1, -5)->>'reason' = 'amount', 'a negative amount is refused';
  assert staff_create_service_booking(ha, hall_a, 'X', null, t0 + 5, t0 + 5, null, null, 1, 1000, 2000)->>'reason' = 'amount', 'paying more than the amount at booking is refused';
  assert (select count(*) from service_bookings) = n, 'a refused booking stores nothing';

  -- payments
  r := staff_service_payment(b1, 100000);
  assert r->>'ok' = 'true' and (r->>'paid')::numeric = 100000, 'staff records a payment';
  assert (staff_service_payment(b1, -30000)->>'paid')::numeric = 70000, 'a refund lowers the total paid';
  assert staff_service_payment(b1, -999999)->>'reason' = 'amount', 'the total paid cannot go below zero';
  assert staff_service_payment(b1, 0)->>'reason' = 'amount', 'a zero payment is refused';
  assert (select paid from service_bookings where id = b1) = 70000, 'the refused payments changed nothing';
  assert (select count(*) from service_payments where booking_id = b1) = 2, 'only the two good payments are in the history (the refused ones left no row)';
  assert staff_service_payment(b1, 5000, 'cash', 'deposit for the hall')->>'ok' = 'true', 'a payment can carry a method and a note';
  assert (select method = 'cash' and note = 'deposit for the hall' and recorded_by = es from service_payments where booking_id = b1 and amount = 5000), 'the history keeps how, why and who recorded it';
  assert (select paid from service_bookings where id = b1) = (select sum(amount) from service_payments where booking_id = b1) and (select paid from service_bookings where id = b1) = 75000, 'the total paid is always the sum of the history';
  assert (select count(*) from service_payments) >= 3, 'staff read their hotel''s payment history';

  -- staff cannot cancel or change the services list
  begin perform staff_cancel_service_booking(b1); assert false, 'staff cancelled a service booking'; exception when insufficient_privilege then null; end;
  begin insert into hotel_services (hotel_id, name) values (ha, 'Sneaky'); assert false, 'staff added a service'; exception when insufficient_privilege then null; end;
  update hotel_services set price = 1 where hotel_id = ha;                       get diagnostics n = row_count; assert n = 0, 'staff cannot change a price';
  delete from hotel_services where hotel_id = ha;                                get diagnostics n = row_count; assert n = 0, 'staff cannot delete a service';
  begin insert into service_payments (hotel_id, booking_id, amount) values (ha, b1, 1); assert false, 'staff wrote a payment straight into the table'; exception when insufficient_privilege then null; end;
  begin insert into service_bookings (hotel_id, service_id, customer_name, starts_on, ends_on, amount) values (ha, hall_a, 'Direct', t0 + 9, t0 + 9, 1);
        assert false, 'staff wrote a booking straight into the table'; exception when insufficient_privilege then null; end;

  -- ============ MANAGER of hotel A
  reset role; set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('email', em, 'role', 'authenticated')::text, true);
  r := staff_cancel_service_booking(b2, 'customer called');
  assert r->>'ok' = 'true', 'a manager cancels a service booking';
  assert staff_cancel_service_booking(b2)->>'reason' = 'already', 'cancelling twice is refused';
  assert staff_service_payment(b2, 1000)->>'reason' = 'cancelled', 'a cancelled booking takes no payment';
  assert (select count(*) from service_payments where booking_id = b2) = 1, '...and leaves no payment row';
  r := staff_create_service_booking(ha, hall_a, 'Takes Its Place', null, t0 + 1, t0 + 2);
  assert r->>'ok' = 'true', 'a cancelled booking frees the hall again';
  insert into hotel_services (hotel_id, name, price, unit) values (ha, 'Restaurant table', 0, 'per_head');
  update hotel_services set price = 260000 where id = hall_a;                    get diagnostics n = row_count; assert n = 1, 'a manager changes a price';
  assert (select amount from service_bookings where id = b1) = 250000, '...and old bookings keep the amount they were made with';
  begin delete from hotel_services where id = hall_a; assert false, 'deleted a service that has bookings'; exception when foreign_key_violation then null; end;

  -- ============ MANAGER of hotel B sees nothing of A, and cannot touch it
  reset role; set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('email', eb, 'role', 'authenticated')::text, true);
  assert (select count(*) from service_bookings) = 0 and (select count(*) from hotel_services) = 1 and (select count(*) from service_payments) = 0, 'the other hotel sees none of A''s bookings or payments, and only its own service';
  begin perform staff_create_service_booking(ha, hall_a, 'Intruder', null, t0 + 30, t0 + 30); assert false, 'staff of hotel B booked at hotel A'; exception when insufficient_privilege then null; end;
  assert staff_cancel_service_booking(b1)->>'reason' = 'not_found', 'hotel B cannot cancel hotel A''s booking (it looks like it does not exist)';
  assert staff_service_payment(b1, 1000)->>'reason' = 'not_found', 'hotel B cannot record a payment on hotel A''s booking';
  begin insert into hotel_services (hotel_id, name) values (ha, 'Planted'); assert false, 'a manager of B added a service to A'; exception when insufficient_privilege then null; end;

  -- ============ the database itself refuses a booking that points at another hotel's service (even for the service role)
  reset role;
  begin insert into service_payments (hotel_id, booking_id, amount) values (hb, b1, 1); assert false, 'a payment linked to another hotel''s booking'; exception when foreign_key_violation then null; end;
  begin insert into service_bookings (hotel_id, service_id, customer_name, starts_on, ends_on, amount) values (ha, hall_b, 'Cross', t0 + 40, t0 + 40, 1);
        assert false, 'a booking linked to another hotel''s service'; exception when foreign_key_violation then null; end;

  raise exception 'ALL OK';
end $$;
