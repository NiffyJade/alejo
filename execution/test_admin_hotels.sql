-- Test for sql/030_admin_hotels.sql. Before 030 is applied, as a DRY RUN with the migration:
--   python -I -X utf8 execution/dry_run_sql.py sql/030_admin_hotels.sql execution/test_admin_hotels.sql
-- After it is applied:  python -I -X utf8 execution/supabase_admin.py sql execution/test_admin_hotels.sql
-- Everything is rolled back at the end: a PASS looks like  ERROR: P0001: ALL OK  (anything else names the failed check).
do $$
declare
  h uuid := gen_random_uuid(); r jsonb; me jsonb; ok boolean; g uuid;
begin
  insert into hotels (id, slug, name, active) values (h, 'admin-test', 'Admin Test Hotel', false);
  insert into room_types (hotel_id, name, total_rooms, nightly_rate) values (h, 'Standard', 4, 10000), (h, 'Suite', 1, 50000);
  insert into hotel_settings (hotel_id, key, value) values (h, 'HOTEL_NAME', 'Admin Test Hotel'), (h, 'CHECKOUT_TIME', '');
  insert into guests (hotel_id, name) values (h, 'G') returning id into g;
  insert into bookings (hotel_id, guest_id, room_type, check_in, check_out) values (h, g, 'Standard', current_date, current_date + 1);
  insert into messages (hotel_id, guest_id, direction, text) values (h, g, 'in', 'hello');
  insert into platform_admins (email) values ('alejo.admin@test.invalid') on conflict do nothing;
  insert into staff_users (hotel_id, email, name, role) values (h, 'admin-test.owner@test.invalid', 'O', 'owner'), (h, 'admin-test.staff@test.invalid', 'S', 'staff');

  set local role authenticated;
  -- ---------------- Alejo's admin sees every hotel and what it still needs
  perform set_config('request.jwt.claims', json_build_object('email', 'alejo.admin@test.invalid', 'role', 'authenticated')::text, true);
  r := admin_hotels();
  assert jsonb_array_length(r) >= 2, 'every hotel is listed';
  select x into me from jsonb_array_elements(r) x where x->>'slug' = 'admin-test';
  assert (me->>'active')::boolean = false, 'switched off as created';
  assert (me->>'rooms')::int = 5 and (me->>'room_types')::int = 2, 'rooms on sale';
  assert (me->'staff'->>'owner')::int = 1 and (me->'staff'->>'staff')::int = 1 and (me->'staff'->>'manager')::int = 0, 'staff accounts by role';
  assert (me->>'facts_missing')::int = 4, 'four of the five key facts missing (an empty value counts as missing): ' || (me->>'facts_missing');
  assert (me->>'bookings_30d')::int = 1 and me->>'last_guest_message' is not null, 'activity';
  assert (me->>'staff_group')::boolean = false and (me->>'bot_token')::boolean = false, 'no staff group, no bot yet';

  -- the switch, with who and when
  r := admin_set_hotel_active(h, true);
  assert (r->>'active')::boolean and r->>'active_changed_by' = 'alejo.admin@test.invalid', 'switched on, by whom';
  reset role;
  assert (select active from hotels where id = h), 'the hotel row is on';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('email', 'alejo.admin@test.invalid', 'role', 'authenticated')::text, true);
  perform admin_set_hotel_active(h, false);
  reset role;
  assert not (select active from hotels where id = h) and (select active_changed_at from hotels where id = h) is not null, 'switched off again, and stamped';
  set local role authenticated;

  -- ---------------- a hotel's own owner cannot list every hotel or switch theirs
  perform set_config('request.jwt.claims', json_build_object('email', 'admin-test.owner@test.invalid', 'role', 'authenticated')::text, true);
  ok := false; begin perform admin_hotels(); exception when others then ok := sqlerrm like '%Only Alejo admins%'; end;
  assert ok, 'an owner cannot list every hotel';
  ok := false; begin perform admin_set_hotel_active(h, true); exception when others then ok := sqlerrm like '%Only Alejo admins%'; end;
  assert ok, 'an owner cannot switch their own hotel on';
  begin update hotels set active = true where id = h; exception when insufficient_privilege then null; end;
  -- ---------------- nor can front-desk staff
  perform set_config('request.jwt.claims', json_build_object('email', 'admin-test.staff@test.invalid', 'role', 'authenticated')::text, true);
  ok := false; begin perform admin_set_hotel_active(h, true); exception when others then ok := sqlerrm like '%Only Alejo admins%'; end;
  assert ok, 'staff cannot switch a hotel';
  reset role;
  assert not (select active from hotels where id = h), 'after all that, the hotel is still off';

  -- a hotel that does not exist
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('email', 'alejo.admin@test.invalid', 'role', 'authenticated')::text, true);
  ok := false; begin perform admin_set_hotel_active(gen_random_uuid(), true); exception when others then ok := sqlerrm like '%no such hotel%'; end;
  assert ok, 'an unknown hotel is reported';
  reset role;
  raise exception 'ALL OK';
end $$;
