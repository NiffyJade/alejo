-- Tests for sql/021 + 022: hotels must never see each other's data. Run AFTER 022 is applied:
--   python -I execution/supabase_admin.py sql execution/test_multi_hotel.sql
-- Everything is rolled back at the end: a PASS looks like  ERROR: P0001: ALL OK  (anything else names the failed check).
do $$
declare
  ha uuid := gen_random_uuid(); hb uuid := gen_random_uuid();
  ea text := 'a.staff@test.invalid'; eb text := 'b.staff@test.invalid'; ep text := 'admin@test.invalid'; en text := 'nobody@test.invalid';
  chat bigint := 880000001;
  ga uuid; gb uuid; ba uuid; bb uuid; blk_a uuid; blk_b uuid; esc_a uuid; esc_b uuid;
  n int; r jsonb; t text; ctx jsonb; sa int;
begin
  -- ============ two hotels, deliberately sharing room-type names, a Telegram chat id, setting keys and knowledge ids
  insert into hotels (id, slug, name) values (ha, 'test-a', 'Hotel A'), (hb, 'test-b', 'Hotel B');
  insert into staff_users (hotel_id, email, name, role) values (ha, ea, 'Staff A', 'manager'), (hb, eb, 'Staff B', 'manager');
  insert into platform_admins (email) values (ep);
  insert into hotel_secrets (hotel_id, telegram_bot_token) values (ha, 'secret-a'), (hb, 'secret-b');
  insert into room_types (hotel_id, name, total_rooms, nightly_rate) values (ha, 'Standard', 2, 10000), (hb, 'Standard', 1, 20000), (hb, 'OnlyB', 1, 5000);
  insert into hotel_settings (hotel_id, key, value) values (ha, 'WIFI_NAME', 'wifi-A'), (hb, 'WIFI_NAME', 'wifi-B');
  insert into knowledge_entries (hotel_id, id, category, question, answer) values (ha, 'k1', 'x', 'qA', 'aA'), (hb, 'k1', 'x', 'qB', 'aB');
  insert into guests (hotel_id, name, telegram_chat_id) values (ha, 'Guest A', chat) returning id into ga;
  insert into guests (hotel_id, name, telegram_chat_id) values (hb, 'Guest B', chat) returning id into gb;      -- same person, two hotels: allowed
  insert into bookings (hotel_id, guest_id, room_type, check_in, check_out) values (ha, ga, 'Standard', current_date + 5, current_date + 7) returning id into ba;
  insert into bookings (hotel_id, guest_id, room_type, check_in, check_out) values (hb, gb, 'Standard', current_date + 5, current_date + 7) returning id into bb;
  insert into booking_payments (hotel_id, booking_id, amount, method) values (ha, ba, 1000, 'cash'), (hb, bb, 2000, 'cash');
  insert into room_blocks (hotel_id, room_type, rooms, start_date, end_date) values (ha, 'Standard', 1, current_date + 30, current_date + 31) returning id into blk_a;
  insert into room_blocks (hotel_id, room_type, rooms, start_date, end_date) values (hb, 'OnlyB', 1, current_date + 30, current_date + 31) returning id into blk_b;
  insert into escalations (hotel_id, guest_id, guest_chat_id, question) values (ha, ga, chat, 'question A') returning id into esc_a;
  insert into escalations (hotel_id, guest_id, guest_chat_id, question) values (hb, gb, chat, 'question B1') returning id into esc_b;
  insert into escalations (hotel_id, guest_id, guest_chat_id, question) values (hb, gb, chat, 'question B2');
  insert into messages (hotel_id, guest_id, chat_id, direction, text) values (ha, ga, chat, 'in', 'hello A'), (hb, gb, chat, 'in', 'hello B');
  insert into demo_requests (hotel, email, source) values ('Some Other Hotel', 'lead@test.invalid', 'website');

  -- ============ the database itself refuses links across hotels
  begin insert into bookings (hotel_id, guest_id, room_type, check_in, check_out) values (ha, gb, 'Standard', current_date + 40, current_date + 41);
        assert false, 'a booking for another hotel''s guest was accepted'; exception when foreign_key_violation then null; end;
  begin insert into booking_payments (hotel_id, booking_id, amount) values (ha, bb, 5);
        assert false, 'a payment on another hotel''s booking was accepted'; exception when foreign_key_violation then null; end;
  begin insert into room_blocks (hotel_id, room_type, rooms, start_date, end_date) values (ha, 'OnlyB', 1, current_date + 50, current_date + 51);
        assert false, 'a block for another hotel''s room type was accepted'; exception when foreign_key_violation then null; end;
  begin insert into escalations (hotel_id, booking_id, question) values (ha, bb, 'x');
        assert false, 'an item about another hotel''s booking was accepted'; exception when foreign_key_violation then null; end;
  begin insert into messages (hotel_id, guest_id, chat_id, direction, text) values (ha, gb, chat, 'in', 'x');
        assert false, 'a message for another hotel''s guest was accepted'; exception when foreign_key_violation then null; end;
  begin insert into hotel_settings (hotel_id, key, value) values (ha, 'WIFI_NAME', 'dup');
        assert false, 'a duplicate setting in one hotel was accepted'; exception when unique_violation then null; end;
  begin insert into bookings (guest_id, room_type, check_in, check_out) values (ga, 'Standard', current_date + 40, current_date + 41);
        assert false, 'a row without a hotel was accepted'; exception when not_null_violation then null; end;

  -- ============ the bot side (service role): every answer comes from ONE hotel
  ctx := bot_context(ha, chat);
  assert ctx->'guest'->>'name' = 'Guest A' and bot_context(hb, chat)->'guest'->>'name' = 'Guest B', 'same chat id resolves to the right guest per hotel';
  assert jsonb_array_length(ctx->'knowledge') = 1 and ctx->'knowledge'->0->>'answer' = 'aA', 'knowledge is A''s only';
  assert bot_context(hb, chat)->'knowledge'->0->>'answer' = 'aB', 'knowledge is B''s only';
  assert ctx->'settings'->>'WIFI_NAME' = 'wifi-A' and bot_context(hb, chat)->'settings'->>'WIFI_NAME' = 'wifi-B', 'settings per hotel';
  assert jsonb_array_length(ctx->'rooms') = 1 and jsonb_array_length(bot_context(hb, chat)->'rooms') = 2, 'rooms per hotel';
  assert jsonb_array_length(ctx->'history') = 1 and ctx->'history'->0->>'text' = 'hello A', 'history per hotel';
  assert jsonb_array_length(ctx->'open_items') = 1 and jsonb_array_length(bot_context(hb, chat)->'open_items') = 2, 'open items per hotel';
  assert jsonb_array_length(ctx->'guest'->'bookings') = 1 and (ctx->'guest'->'bookings'->0->>'id')::uuid = ba, 'bookings per hotel';
  assert ctx->'hotel'->>'slug' = 'test-a', 'the context says which hotel it is';

  -- availability is independent even though both hotels call their room "Standard"
  assert (select available_rooms from room_availability(ha, current_date + 5, current_date + 7, 'Standard')) = 1, 'A: 2 rooms - 1 booked';
  assert (select available_rooms from room_availability(hb, current_date + 5, current_date + 7, 'Standard')) = 0, 'B: 1 room - 1 booked';
  assert not exists (select 1 from room_availability(ha, current_date + 5, current_date + 7, 'OnlyB')), 'A has no OnlyB';
  assert (select available_rooms from room_availability(hb, current_date + 5, current_date + 7, 'OnlyB')) = 1, 'B has OnlyB';

  r := telegram_book_room(ha, 880000002, 'New Guest', '08011112222', false, 'OnlyB', current_date + 20, current_date + 22);
  assert r->>'reason' = 'room_type', 'A cannot book B''s room type: ' || r::text;
  r := telegram_book_room(hb, 880000003, 'Other Guest', '08011113333', false, 'Standard', current_date + 5, current_date + 7);
  assert r->>'reason' = 'sold_out', 'B is full on those dates (A''s free room does not help): ' || r::text;
  r := telegram_book_room(ha, 880000002, 'New Guest', '08011112222', false, 'Standard', current_date + 20, current_date + 22);
  assert r->>'ok' = 'true', 'A books its own room: ' || r::text;
  assert (select hotel_id from bookings where id = (r->>'booking_id')::uuid) = ha and (select hotel_id from guests where telegram_chat_id = 880000002) = ha, 'the booking and guest are A''s';
  assert (select available_rooms from room_availability(ha, current_date + 20, current_date + 22, 'Standard')) = 1
     and (select available_rooms from room_availability(hb, current_date + 20, current_date + 22, 'Standard')) = 1, 'a booking in A does not use B''s room';
  r := phone_book_room(hb, 'Caller B', '08099998888', null, 'OnlyB', current_date + 20, current_date + 21);
  assert r->>'ok' = 'true' and (select hotel_id from bookings where id = (r->>'booking_id')::uuid) = hb, 'phone booking lands in B';
  r := phone_book_room(ha, 'Caller B', '08099998888', null, 'OnlyB', current_date + 20, current_date + 21);
  assert r->>'reason' = 'room_type', 'and A cannot sell it';

  r := record_rating(ha, bb, chat, 5);
  assert r->>'reason' = 'not_found', 'A cannot rate B''s booking: ' || r::text;
  r := record_rating(hb, bb, chat, 5);
  assert r->>'reason' = 'not_finished', 'B reaches its own booking: ' || r::text;

  assert (daily_digest(ha)->>'open_items')::int = 1 and (daily_digest(hb)->>'open_items')::int = 2, 'digest counts only its own hotel';
  assert (daily_digest(ha)->>'rooms_total')::int = 2 and (daily_digest(hb)->>'rooms_total')::int = 2, 'digest rooms_total is per hotel (A: 2, B: 1+1)';

  update hotels set active = false where id = hb;
  assert telegram_book_room(hb, 880000004, 'X', '08011114444', false, 'Standard', current_date + 60, current_date + 61)->>'reason' = 'hotel', 'a switched-off hotel takes no bookings';
  update hotels set active = true where id = hb;

  -- ============ signed-in staff of hotel A
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('email', ea, 'role', 'authenticated')::text, true);

  foreach t in array array['guests','bookings','escalations','messages','room_types','room_blocks','booking_payments','hotel_settings','knowledge_entries'] loop
    execute format('select count(*) from %I where hotel_id <> %L', t, ha) into n;
    assert n = 0, 'staff A can see rows of another hotel in ' || t;
    execute format('select count(*) from %I where hotel_id = %L', t, ha) into n;
    assert n > 0, 'staff A cannot see their own rows in ' || t;
  end loop;
  assert (select count(*) from hotels) = 1 and (select id from hotels) = ha, 'staff A sees only hotel A';
  assert (select count(*) from staff_users) = 1, 'staff A sees only their own staff row';
  assert (select count(*) from demo_requests) = 0, 'hotel staff cannot read Alejo''s sales leads';
  begin perform 1 from hotel_secrets; assert false, 'staff A can read hotel secrets'; exception when insufficient_privilege then null; end;
  begin perform 1 from platform_admins; assert false, 'staff A can read the admin list'; exception when insufficient_privilege then null; end;

  -- writes into hotel B are refused or touch nothing
  begin insert into hotel_settings (hotel_id, key, value) values (hb, 'NEW', 'x'); assert false, 'wrote a setting into B'; exception when insufficient_privilege then null; end;
  begin insert into knowledge_entries (hotel_id, id, category, question, answer) values (hb, 'k2', 'x', 'q', 'a'); assert false, 'wrote knowledge into B'; exception when insufficient_privilege then null; end;
  begin update hotel_settings set hotel_id = hb where hotel_id = ha and key = 'WIFI_NAME'; assert false, 'moved a setting into B'; exception when insufficient_privilege then null; end;
  begin update escalations set hotel_id = hb where id = esc_a; assert false, 'moved an item into B'; exception when foreign_key_violation or insufficient_privilege then null; end;
  update hotel_settings set value = 'hacked' where hotel_id = hb;               get diagnostics n = row_count; assert n = 0, 'updated B settings';
  update knowledge_entries set answer = 'hacked' where hotel_id = hb;           get diagnostics n = row_count; assert n = 0, 'updated B knowledge';
  delete from knowledge_entries where hotel_id = hb;                            get diagnostics n = row_count; assert n = 0, 'deleted B knowledge';
  update escalations set status = 'answered' where hotel_id = hb;               get diagnostics n = row_count; assert n = 0, 'answered B items';
  update hotel_settings set value = 'wifi-A2' where hotel_id = ha and key = 'WIFI_NAME'; get diagnostics n = row_count; assert n = 1, 'staff A can edit their own settings';
  update escalations set status = 'answered' where id = esc_a;                  get diagnostics n = row_count; assert n = 1, 'staff A can answer their own items';

  -- dashboard actions on hotel B are refused, or look like "not found" and change nothing
  begin perform staff_availability(hb, current_date, current_date + 1); assert false, 'availability of B'; exception when insufficient_privilege then null; end;
  begin perform staff_add_block(hb, 'Standard', 1, current_date + 70, current_date + 71); assert false, 'block in B'; exception when insufficient_privilege then null; end;
  begin perform staff_create_booking(hb, 'X', '08012345678', 'Standard', current_date + 70, current_date + 71); assert false, 'booking in B'; exception when insufficient_privilege then null; end;
  begin perform enquiry_report(hb); assert false, 'enquiries of B'; exception when insufficient_privilege then null; end;
  begin perform ratings_report(hb); assert false, 'ratings of B'; exception when insufficient_privilege then null; end;
  assert staff_cancel_booking(bb)->>'reason' = 'not_found', 'cancel B booking';
  assert staff_set_status(bb, 'checkin')->>'reason' = 'not_found', 'check in B booking';
  assert staff_set_room(bb, '101')->>'reason' = 'not_found', 'room for B booking';
  assert staff_record_payment(bb, 5000)->>'reason' = 'not_found', 'payment on B booking';
  assert staff_remove_block(blk_b)->>'reason' = 'not_found', 'remove B block';
  -- the bot's own functions are not for the dashboard
  begin perform bot_context(ha, chat); assert false, 'staff can call the bot function'; exception when insufficient_privilege then null; end;
  begin perform telegram_book_room(ha, 1, 'x', '1', false, 'Standard', current_date + 80, current_date + 81); assert false, 'staff can call telegram_book_room'; exception when insufficient_privilege then null; end;
  -- ...and their own hotel works
  assert (select count(*) from staff_availability(ha, current_date + 5, current_date + 7)) = 1, 'staff A availability';
  assert staff_set_room(ba, '101')->>'ok' = 'true', 'staff A sets a room in A';
  assert staff_record_payment(ba, 500)->>'ok' = 'true', 'staff A records a payment in A';
  assert staff_add_block(ha, 'Standard', 1, current_date + 90, current_date + 91)->>'ok' = 'true', 'staff A blocks a room in A';
  assert (enquiry_report(ha)->>'days')::int = 7 and (ratings_report(ha)->>'days')::int = 7, 'staff A reports for A';
  assert staff_cancel_booking(ba)->>'ok' = 'true', 'staff A cancels their own booking';

  -- ============ hotel B's staff see B, and not A
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('email', eb, 'role', 'authenticated')::text, true);
  assert (select count(*) from bookings where hotel_id = ha) = 0 and (select count(*) from bookings where hotel_id = hb) >= 1, 'staff B sees B only';
  assert (select count(*) from escalations where hotel_id = hb) = 2 and (select count(*) from escalations where hotel_id = ha) = 0, 'staff B items';

  -- ============ a signed-in person who is staff nowhere
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('email', en, 'role', 'authenticated')::text, true);
  assert (select count(*) from bookings) = 0 and (select count(*) from hotels) = 0 and (select count(*) from hotel_settings) = 0, 'a stranger sees nothing';
  begin perform staff_cancel_booking(bb); assert false, 'a stranger cancelled'; exception when insufficient_privilege then null; end;
  begin perform staff_availability(ha, current_date, current_date + 1); assert false, 'a stranger checked availability'; exception when insufficient_privilege then null; end;

  -- ============ not signed in at all
  reset role;
  set local role anon;
  perform set_config('request.jwt.claims', '{}', true);
  assert (select count(*) from bookings) = 0 and (select count(*) from guests) = 0 and (select count(*) from hotel_settings) = 0, 'anon sees nothing';
  begin perform staff_availability(ha, current_date, current_date + 1); assert false, 'anon staff function'; exception when insufficient_privilege then null; end;
  begin perform bot_context(ha, chat); assert false, 'anon bot function'; exception when insufficient_privilege then null; end;
  begin perform 1 from hotel_secrets; assert false, 'anon read secrets'; exception when insufficient_privilege then null; end;

  -- ============ the platform admin (you) sees every hotel
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('email', ep, 'role', 'authenticated')::text, true);
  assert (select count(*) from hotels where id in (ha, hb)) = 2, 'admin sees both hotels';
  assert (select count(*) from bookings where hotel_id in (ha, hb)) >= 2, 'admin sees both hotels'' bookings';
  assert (select count(*) from demo_requests) >= 1, 'admin reads the sales leads';
  assert (select count(*) from staff_availability(hb, current_date + 5, current_date + 7)) = 2, 'admin works inside hotel B';
  begin perform 1 from hotel_secrets; assert false, 'even the admin''s browser session cannot read bot tokens'; exception when insufficient_privilege then null; end;

  -- ============ nothing leaked into the other hotel while all that happened
  reset role;
  assert (select status from bookings where id = bb) = 'booked', 'B booking untouched';
  assert (select count(*) from booking_payments where booking_id = bb) = 1, 'no payment was added to B''s booking';
  assert (select value from hotel_settings where hotel_id = hb and key = 'WIFI_NAME') = 'wifi-B', 'B settings untouched';
  assert (select answer from knowledge_entries where hotel_id = hb and id = 'k1') = 'aB', 'B knowledge untouched';
  assert (select count(*) from room_blocks where id = blk_b) = 1, 'B block still there';
  assert (select count(*) from escalations where hotel_id = hb and status = 'open') = 2, 'B items still open';
  assert (select room_number from bookings where id = bb) is null, 'B room number untouched';

  raise exception 'ALL OK';
end $$;
