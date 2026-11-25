-- Test for sql/028_checkout_overdue_alert.sql. Run AFTER 028 is applied:
--   python -I -X utf8 execution/supabase_admin.py sql execution/test_overdue.sql
-- Before 028 is applied, as a DRY RUN with the migration:  python -I -X utf8 execution/dry_run_sql.py sql/028_checkout_overdue_alert.sql execution/test_overdue.sql
-- Everything is rolled back at the end: a PASS looks like  ERROR: P0001: ALL OK  (anything else names the failed check).
do $$
declare
  h uuid := gen_random_uuid(); g uuid; b_late uuid; b_ok uuid; b_other_day uuid; n int;
begin
  insert into hotels (id, slug, name) values (h, 'overdue-test', 'Overdue Test Hotel');
  insert into room_types (hotel_id, name, total_rooms, nightly_rate) values (h, 'Standard', 3, 10000);
  insert into guests (hotel_id, name) values (h, 'Guest') returning id into g;
  insert into bookings (hotel_id, guest_id, room_type, check_in, check_out, status, checked_in_at) values (h, g, 'Standard', current_date - 2, current_date, 'checked_in', now()) returning id into b_late;
  insert into bookings (hotel_id, guest_id, room_type, check_in, check_out, status, checked_in_at) values (h, g, 'Standard', current_date - 1, current_date, 'checked_in', now()) returning id into b_ok;
  insert into bookings (hotel_id, guest_id, room_type, check_in, check_out, status, checked_in_at) values (h, g, 'Standard', current_date - 1, current_date + 1, 'checked_in', now()) returning id into b_other_day;

  assert (select checkout_overdue_alert_sent_at from bookings where id = b_late) is null, 'a new booking has not been announced';
  -- the query the scheduler runs: checked in, due out today, not announced yet
  select count(*) into n from bookings where hotel_id = h and status = 'checked_in' and check_out = current_date and checkout_overdue_alert_sent_at is null;
  assert n = 2, 'both stays due out today are found (the one leaving tomorrow is not)';
  -- after the alert, the stamp keeps it from being found again
  update bookings set checkout_overdue_alert_sent_at = now() where id = b_late;
  select count(*) into n from bookings where hotel_id = h and status = 'checked_in' and check_out = current_date and checkout_overdue_alert_sent_at is null;
  assert n = 1 and not exists (select 1 from bookings where id = b_late and checkout_overdue_alert_sent_at is null), 'an announced stay is not announced again';
  -- checking the guest out afterwards leaves the stamp alone and drops the stay from the query
  update bookings set status = 'checked_out', checked_out_at = now() where id = b_ok;
  select count(*) into n from bookings where hotel_id = h and status = 'checked_in' and check_out = current_date and checkout_overdue_alert_sent_at is null;
  assert n = 0, 'a guest who has checked out is never announced';
  -- staff cannot stamp it themselves: the column is not writable by the dashboard (bookings change only through the staff functions)
  insert into staff_users (hotel_id, email, name, role) values (h, 'od.staff@test.invalid', 'S', 'staff');
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('email', 'od.staff@test.invalid', 'role', 'authenticated')::text, true);
  update bookings set checkout_overdue_alert_sent_at = null where id = b_late;  get diagnostics n = row_count;
  assert n = 0, 'a staff login cannot change the stamp directly';
  assert (select count(*) from bookings where hotel_id = h) = 3, 'but can still read the hotel''s bookings';
  reset role;
  raise exception 'ALL OK';
end $$;
