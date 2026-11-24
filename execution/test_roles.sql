-- Tests for sql/024_roles.sql: what staff, manager, owner and the platform admin may and may not do. Run AFTER 024 is applied:
--   python -I -X utf8 execution/supabase_admin.py sql execution/test_roles.sql
-- Everything is rolled back at the end: a PASS looks like  ERROR: P0001: ALL OK  (anything else names the failed check).
do $$
declare
  ha uuid := gen_random_uuid(); hb uuid := gen_random_uuid();
  es text := 'staff.a@test.invalid'; em text := 'manager.a@test.invalid'; eo text := 'owner.a@test.invalid'; eb text := 'manager.b@test.invalid'; ep text := 'admin@test.invalid';
  ga uuid; gb uuid; ba uuid; bb uuid; ba2 uuid; blk uuid; blk_b uuid; esc uuid; n int; r jsonb;
begin
  insert into hotels (id, slug, name) values (ha, 'role-a', 'Role Hotel A'), (hb, 'role-b', 'Role Hotel B');
  insert into staff_users (hotel_id, email, name, role) values (ha, es, 'S', 'staff'), (ha, em, 'M', 'manager'), (ha, eo, 'O', 'owner'), (hb, eb, 'MB', 'manager');
  insert into platform_admins (email) values (ep);
  insert into room_types (hotel_id, name, total_rooms, nightly_rate) values (ha, 'Standard', 5, 10000), (hb, 'Standard', 5, 10000);
  insert into hotel_settings (hotel_id, key, value) values (ha, 'WIFI_NAME', 'wifi-A'), (hb, 'WIFI_NAME', 'wifi-B');
  insert into knowledge_entries (hotel_id, id, category, question, answer) values (ha, 'k1', 'x', 'q', 'a'), (ha, 'k2', 'x', 'q2', 'a2');
  insert into guests (hotel_id, name) values (ha, 'Guest A') returning id into ga;
  insert into guests (hotel_id, name) values (hb, 'Guest B') returning id into gb;
  insert into bookings (hotel_id, guest_id, room_type, check_in, check_out) values (ha, ga, 'Standard', current_date + 5, current_date + 7) returning id into ba;
  insert into bookings (hotel_id, guest_id, room_type, check_in, check_out) values (ha, ga, 'Standard', current_date + 8, current_date + 9) returning id into ba2;
  insert into bookings (hotel_id, guest_id, room_type, check_in, check_out) values (hb, gb, 'Standard', current_date + 5, current_date + 7) returning id into bb;
  insert into room_blocks (hotel_id, room_type, rooms, start_date, end_date) values (ha, 'Standard', 1, current_date + 30, current_date + 31) returning id into blk;
  insert into room_blocks (hotel_id, room_type, rooms, start_date, end_date) values (hb, 'Standard', 1, current_date + 30, current_date + 31) returning id into blk_b;
  insert into escalations (hotel_id, guest_id, guest_chat_id, question) values (ha, ga, 1, 'q') returning id into esc;

  -- ============ the ranks themselves
  assert role_rank('staff') < role_rank('manager') and role_rank('manager') < role_rank('owner') and role_rank('owner') < role_rank('admin') and role_rank('x') = 0, 'ranks';

  -- ============ STAFF
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('email', es, 'role', 'authenticated')::text, true);
  assert my_role(ha) = 'staff' and my_role(hb) is null, 'staff role lookup';
  assert has_role(ha, 'staff') and not has_role(ha, 'manager') and not has_role(hb, 'staff'), 'staff has_role';
  assert (select count(*) from bookings where hotel_id = ha) = 2 and (select count(*) from hotel_settings where hotel_id = ha) = 1
     and (select count(*) from knowledge_entries where hotel_id = ha) = 2, 'staff can READ their hotel';
  update escalations set status = 'answered' where id = esc;                    get diagnostics n = row_count; assert n = 1, 'staff can answer/resolve items';
  assert staff_set_status(ba, 'checkin')->>'ok' = 'true', 'staff can check a guest in';
  assert staff_set_room(ba, '101')->>'ok' = 'true', 'staff can set a room number';
  assert staff_record_payment(ba, 1000)->>'ok' = 'true', 'staff can record a payment';
  assert (select count(*) from staff_availability(ha, current_date + 20, current_date + 21)) = 1, 'staff can check availability';
  assert staff_create_booking(ha, 'Walk In', '08011112222', 'Standard', current_date + 20, current_date + 21)->>'ok' = 'true', 'staff can add a walk-in booking';
  update hotel_settings set value = 'x' where hotel_id = ha;                    get diagnostics n = row_count; assert n = 0, 'staff cannot change settings';
  begin insert into hotel_settings (hotel_id, key, value) values (ha, 'NEW', 'x'); assert false, 'staff added a setting'; exception when insufficient_privilege then null; end;
  begin insert into knowledge_entries (hotel_id, id, category, question, answer) values (ha, 'k3', 'x', 'q', 'a'); assert false, 'staff added knowledge'; exception when insufficient_privilege then null; end;
  update knowledge_entries set answer = 'x' where hotel_id = ha;                get diagnostics n = row_count; assert n = 0, 'staff cannot edit knowledge';
  delete from knowledge_entries where hotel_id = ha;                            get diagnostics n = row_count; assert n = 0, 'staff cannot delete knowledge';
  begin perform staff_cancel_booking(ba2); assert false, 'staff cancelled a booking'; exception when insufficient_privilege then null; end;
  begin perform staff_add_block(ha, 'Standard', 1, current_date + 40, current_date + 41); assert false, 'staff blocked a room'; exception when insufficient_privilege then null; end;
  begin perform staff_remove_block(blk); assert false, 'staff removed a block'; exception when insufficient_privilege then null; end;
  begin perform ratings_report(ha, 7); assert false, 'staff read the ratings report'; exception when insufficient_privilege then null; end;
  begin perform enquiry_report(ha, 7); assert false, 'staff read the enquiries report'; exception when insufficient_privilege then null; end;
  assert (select count(*) from staff_users) = 1, 'staff see only their own staff row (not the team)';

  -- ============ MANAGER
  reset role; set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('email', em, 'role', 'authenticated')::text, true);
  assert my_role(ha) = 'manager' and has_role(ha, 'manager') and not has_role(ha, 'owner'), 'manager role lookup';
  update hotel_settings set value = 'wifi-A2' where hotel_id = ha;              get diagnostics n = row_count; assert n = 1, 'manager can change settings';
  insert into hotel_settings (hotel_id, key, value) values (ha, 'NEW', 'x');
  insert into knowledge_entries (hotel_id, id, category, question, answer) values (ha, 'k3', 'x', 'q', 'a');
  update knowledge_entries set answer = 'edited' where id = 'k3' and hotel_id = ha; get diagnostics n = row_count; assert n = 1, 'manager can edit knowledge';
  delete from knowledge_entries where id = 'k3' and hotel_id = ha;              get diagnostics n = row_count; assert n = 1, 'manager can delete knowledge';
  assert staff_add_block(ha, 'Standard', 1, current_date + 40, current_date + 41)->>'ok' = 'true', 'manager can block a room';
  assert staff_remove_block(blk)->>'ok' = 'true', 'manager can remove a block';
  assert (ratings_report(ha, 7)->>'days')::int = 7 and (enquiry_report(ha, 7)->>'days')::int = 7, 'manager can read both reports';
  assert staff_cancel_booking(ba2)->>'ok' = 'true', 'manager can cancel a booking';
  assert (select count(*) from staff_users) = 1, 'a manager sees only their own staff row';
  -- ...but only in THEIR hotel
  assert staff_cancel_booking(bb)->>'reason' = 'not_found', 'a manager of hotel A cannot cancel hotel B bookings';
  begin perform staff_add_block(hb, 'Standard', 1, current_date + 50, current_date + 51); assert false, 'manager A blocked rooms in B'; exception when insufficient_privilege then null; end;
  begin perform ratings_report(hb, 7); assert false, 'manager A read B ratings'; exception when insufficient_privilege then null; end;

  -- ============ OWNER
  reset role; set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('email', eo, 'role', 'authenticated')::text, true);
  assert my_role(ha) = 'owner' and has_role(ha, 'owner') and not has_role(ha, 'admin') and my_role(hb) is null, 'owner role lookup';
  assert (select count(*) from staff_users where hotel_id = ha) = 3 and (select count(*) from staff_users where hotel_id = hb) = 0, 'the owner sees their own hotel''s team only';
  begin insert into staff_users (hotel_id, email, name, role) values (ha, 'sneaky@test.invalid', 'x', 'owner'); assert false, 'an owner wrote to staff_users from the browser'; exception when insufficient_privilege then null; end;
  update staff_users set role = 'owner' where email = es;                        get diagnostics n = row_count; assert n = 0, 'an owner changed a role from the browser';
  assert (select role from staff_users where email = es) = 'staff', 'the role is unchanged';
  delete from staff_users where email = es;                                      get diagnostics n = row_count; assert n = 0, 'an owner removed a login from the browser';
  begin insert into platform_admins (email) values ('sneaky@test.invalid'); assert false, 'an owner made an admin'; exception when insufficient_privilege then null; end;
  assert staff_cancel_booking(ba2)->>'reason' = 'already', 'owner has manager powers (the booking was already cancelled)';

  -- ============ PLATFORM ADMIN (Alejo)
  reset role; set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('email', ep, 'role', 'authenticated')::text, true);
  assert my_role(ha) = 'admin' and my_role(hb) = 'admin' and has_role(hb, 'owner'), 'admin role lookup';
  assert (select count(*) from staff_users where hotel_id in (ha, hb)) = 4, 'admin sees every hotel''s team';
  assert staff_cancel_booking(bb)->>'ok' = 'true', 'admin can cancel in any hotel';
  assert (ratings_report(hb, 7)->>'days')::int = 7, 'admin can read any hotel''s reports';
  update hotel_settings set value = 'by admin' where hotel_id = hb;             get diagnostics n = row_count; assert n = 1, 'admin can change any hotel''s settings';

  -- ============ a stranger and the public
  reset role; set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('email', 'nobody@test.invalid', 'role', 'authenticated')::text, true);
  assert my_role(ha) is null and not has_role(ha, 'staff'), 'a stranger has no role';
  reset role; set local role anon; perform set_config('request.jwt.claims', '{}', true);
  begin perform has_role(ha, 'staff'); assert false, 'anon called has_role'; exception when insufficient_privilege then null; end;

  raise exception 'ALL OK';
end $$;
