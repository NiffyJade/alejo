-- Tests for sql/017_manage_bookings.sql. Run: python execution/supabase_admin.py sql execution/test_manage_bookings.sql
-- Everything is rolled back at the end: a PASS looks like  ERROR: P0001: ALL OK  (anything else names the failed check).
-- Uses dates 200+ days ahead and the first staff user as the signed-in staff member; assumes Suite has 3 rooms, Deluxe 6, Standard 10.
do $$
declare
  HID uuid := (select id from hotels where slug = 'brightside');
  d     date := (now() at time zone 'Africa/Lagos')::date + 200;     -- far ahead: nothing real is booked there
  today date := (now() at time zone 'Africa/Lagos')::date;
  email text := (select email from staff_users limit 1);
  r jsonb; b1 uuid; b2 uuid; b3 uuid; n int; free_n int; blk uuid; s text;
begin
  -- ---- a non-staff caller is refused (no JWT at all)
  begin
    perform staff_create_booking(HID, 'X', null, 'Standard', d, d + 1);
    assert false, 'non-staff was allowed to create a booking';
  exception when insufficient_privilege then null;
  end;
  begin perform staff_availability(HID, d, d + 1); assert false, 'non-staff availability'; exception when insufficient_privilege then null; end;
  begin perform staff_remove_block(gen_random_uuid()); assert false, 'non-staff remove block'; exception when insufficient_privilege then null; end;

  -- from here on we are a signed-in staff member
  perform set_config('request.jwt.claims', json_build_object('email', email, 'role', 'authenticated')::text, true);

  -- ---- create a walk-in with a local phone number, a room and a part payment
  r := staff_create_booking(HID, 'Walk In', '0803 111 2222', 'standard', d, d + 2, 'walk-in', '101', false, 10000, 'cash');
  assert r->>'ok' = 'true', 'create: ' || r::text;
  b1 := (r->>'booking_id')::uuid;
  assert (select phone from guests g join bookings b on b.guest_id = g.id where b.id = b1) = '+2348031112222', 'phone not normalised';
  assert (select source from bookings where id = b1) = 'walk-in', 'source';
  assert (select created_by from bookings where id = b1) = lower(email), 'created_by';
  assert (select sum(amount) from booking_payments where booking_id = b1) = 10000, 'payment at booking';
  assert (select count(*) from guests where phone = '+2348031112222') = 1, 'guest created once';

  -- same phone again: the same guest is reused
  r := staff_create_booking(HID, 'Someone Else', '+234 803 111 2222', 'Standard', d + 5, d + 6, 'phone');
  assert r->>'ok' = 'true', 'second create';
  assert (select count(*) from guests where phone = '+2348031112222') = 1, 'guest reused by phone';

  -- validations
  assert staff_create_booking(HID, '', null, 'Standard', d, d + 1)->>'reason' = 'name', 'empty name';
  assert staff_create_booking(HID, 'A', null, 'Standard', d, d)->>'reason' = 'dates', 'same-day dates';
  assert staff_create_booking(HID, 'A', null, 'Standard', today - 1, today + 1)->>'reason' = 'dates', 'past dates';
  assert staff_create_booking(HID, 'A', null, 'Standard', d, d + 100)->>'reason' = 'dates', '100 nights';
  assert staff_create_booking(HID, 'A', null, 'Penthouse', d, d + 1)->>'reason' = 'room_type', 'unknown type';
  assert staff_create_booking(HID, 'A', null, 'Standard', d, d + 1, 'walk-in', null, false, -5)->>'reason' = 'amount', 'negative paid';
  assert staff_create_booking(HID, 'A', null, 'Standard', d, d + 1, 'walk-in', null, true)->>'reason' = 'not_today', 'check-in-now for another day';
  r := staff_create_booking(HID, 'A', null, 'Standard', d, d + 1, 'nonsense');
  assert r->>'ok' = 'true' and (select source from bookings where id = (r->>'booking_id')::uuid) = 'other', 'unknown source stored as other';

  -- ---- one room number cannot be used twice on overlapping dates
  assert staff_create_booking(HID, 'B', null, 'Standard', d + 1, d + 3, 'walk-in', '101')->>'reason' = 'room_taken', 'room 101 reused while overlapping';
  assert staff_create_booking(HID, 'B', null, 'Standard', d + 2, d + 4, 'walk-in', '101')->>'ok' = 'true', 'room 101 free again after check-out day';

  -- ---- availability is counted per night (Suite has 3 rooms)
  assert (select count(*) from room_types where name = 'Suite' and total_rooms = 3) = 1, 'test assumes 3 suites';
  for n in 1..3 loop
    assert staff_create_booking(HID, 'S' || n, null, 'Suite', d + 20, d + 21)->>'ok' = 'true', 'suite ' || n;
  end loop;
  assert staff_create_booking(HID, 'S4', null, 'Suite', d + 20, d + 21)->>'reason' = 'sold_out', 'fourth suite is sold out';
  assert staff_create_booking(HID, 'S5', null, 'Suite', d + 21, d + 22)->>'ok' = 'true', 'next night is free (per-night counting)';
  assert staff_create_booking(HID, 'S6', null, 'Suite', d + 19, d + 22)->>'reason' = 'sold_out', 'a stay across the full night is refused';
  assert (select available_rooms from room_availability(HID, d + 20, d + 21, 'Suite')) = 0, 'room_availability agrees';
  assert (select available_rooms from room_availability(HID, d + 22, d + 23, 'Suite')) = 3, 'room_availability, a free night';
  assert (select free from staff_availability(HID, d + 20, d + 21) where room_type = 'Suite') = 0, 'staff_availability agrees';

  -- ---- the bots use the same rule and the same lock
  assert telegram_book_room(HID, 999000901, 'Bot Guest', null, false, 'Suite', d + 20, d + 21)->>'reason' = 'sold_out', 'telegram sees staff bookings';
  assert phone_book_room(HID, 'Phone Guest', '+2348099990001', null, 'Suite', d + 20, d + 21)->>'reason' = 'sold_out', 'phone sees staff bookings';
  r := telegram_book_room(HID, 999000902, 'Bot Guest', null, false, 'Standard', d + 30, d + 31);
  assert r->>'ok' = 'true' and (select source from bookings where id = (r->>'booking_id')::uuid) = 'telegram', 'telegram booking source';
  r := phone_book_room(HID, 'Phone Guest', '+2348099990002', null, 'Standard', d + 30, d + 31);
  assert r->>'ok' = 'true' and (select source from bookings where id = (r->>'booking_id')::uuid) = 'phone', 'phone booking source';

  -- ---- blocked rooms (Deluxe has 6)
  r := staff_add_block(HID, 'Deluxe', 6, d + 40, d + 43, 'repainting');
  assert r->>'ok' = 'true', 'block: ' || r::text;
  blk := (r->>'id')::uuid;
  assert staff_create_booking(HID, 'D', null, 'Deluxe', d + 40, d + 41)->>'reason' = 'sold_out', 'blocked rooms are not sold (staff)';
  assert telegram_book_room(HID, 999000903, 'Bot', null, false, 'Deluxe', d + 41, d + 42)->>'reason' = 'sold_out', 'blocked rooms are not sold (telegram)';
  assert staff_create_booking(HID, 'D', null, 'Deluxe', d + 43, d + 44)->>'ok' = 'true', 'the end date night is not blocked';
  assert staff_add_block(HID, 'Deluxe', 7, d + 50, d + 51)->>'reason' = 'rooms', 'more rooms than the hotel has';
  assert staff_add_block(HID, 'Standard', 9, d, d + 2)->>'reason' = 'conflict', 'cannot block rooms that are already booked';
  assert (staff_add_block(HID, 'Standard', 9, d, d + 2)->>'free')::int < 9, 'conflict reports how many are free';
  assert staff_add_block(HID, 'Deluxe', 1, d - 400, d - 399)->>'reason' = 'dates', 'block in the past';
  assert staff_remove_block(blk)->>'ok' = 'true', 'unblock';
  assert staff_create_booking(HID, 'D2', null, 'Deluxe', d + 40, d + 41)->>'ok' = 'true', 'sold again after unblock';
  assert staff_remove_block(blk)->>'reason' = 'not_found', 'unblock twice';

  -- ---- check in, check out
  r := staff_create_booking(HID, 'Desk', null, 'Standard', today, today + 1, 'walk-in', null, true);
  assert r->>'ok' = 'true' and (select status from bookings where id = (r->>'booking_id')::uuid) = 'checked_in', 'check in now';
  b2 := (r->>'booking_id')::uuid;
  assert (select checked_in_at from bookings where id = b2) is not null, 'checked_in_at set';
  assert staff_set_status(b2, 'checkin')->>'reason' = 'not_booked', 'cannot check in twice';
  assert staff_cancel_booking(b2)->>'reason' = 'in_house', 'cannot cancel an in-house stay';
  assert staff_set_status(b2, 'checkout')->>'ok' = 'true', 'check out';
  assert (select status from bookings where id = b2) = 'checked_out' and (select checked_out_at from bookings where id = b2) is not null, 'checked out';
  assert staff_set_status(b2, 'checkout')->>'reason' = 'not_in_house', 'cannot check out twice';
  assert staff_cancel_booking(b2)->>'reason' = 'done', 'cannot cancel a finished stay';
  assert staff_set_status(b2, 'fly')->>'reason' is not null, 'unknown action';
  assert staff_set_status(gen_random_uuid(), 'checkin')->>'reason' = 'not_found', 'unknown booking';

  -- ---- booked -> checked in from the desk
  assert staff_set_status(b1, 'checkin')->>'ok' = 'true', 'desk check in of an advance booking';

  -- ---- room numbers
  r := staff_create_booking(HID, 'Rm', null, 'Standard', d + 60, d + 62);
  b3 := (r->>'booking_id')::uuid;
  r := staff_set_room(b3, ' 202 ');
  assert r->>'ok' = 'true', 'assign room: ' || r::text;
  assert (select room_number from bookings where id = b3) = '202', 'room stored trimmed';
  assert staff_set_room(b1, '202')->>'ok' = 'true', 'same number on different dates is fine';
  r := staff_create_booking(HID, 'Rm2', null, 'Standard', d + 61, d + 63);
  assert staff_set_room((r->>'booking_id')::uuid, '202')->>'reason' = 'room_taken', 'room number taken by an overlapping stay';
  r := staff_set_room(b3, '');
  assert r->>'ok' = 'true', 'clear room';
  assert (select room_number from bookings where id = b3) is null, 'room cleared';

  -- ---- cancel
  free_n := (select available_rooms from room_availability(HID, d + 60, d + 62, 'Standard'));
  assert staff_cancel_booking(b3, 'guest called')->>'ok' = 'true', 'cancel';
  assert (select status from bookings where id = b3) = 'cancelled' and (select cancel_reason from bookings where id = b3) = 'guest called', 'cancel recorded';
  assert (select cancelled_by from bookings where id = b3) = lower(email), 'cancelled_by';
  assert (select available_rooms from room_availability(HID, d + 60, d + 62, 'Standard')) = free_n + 1, 'room is free again after a cancel';
  assert staff_cancel_booking(b3)->>'reason' = 'already', 'cancel twice';
  assert staff_set_room(b3, '9')->>'reason' = 'closed', 'no room for a cancelled booking';

  -- ---- payments
  r := staff_record_payment(b1, 5000, 'transfer', 'ref 123');
  assert r->>'ok' = 'true' and (r->>'total_paid')::numeric = 15000, 'payment total: ' || r::text;
  r := staff_record_payment(b1, -2000, 'cash', 'refund');
  assert (r->>'total_paid')::numeric = 13000, 'refund lowers the total';
  assert staff_record_payment(b1, 0)->>'reason' = 'amount', 'zero payment';
  assert staff_record_payment(gen_random_uuid(), 100)->>'reason' = 'not_found', 'payment for unknown booking';
  assert staff_record_payment(b1, 1e12)->>'reason' = 'amount', 'absurd payment';

  s := 'ALL OK';
  raise exception '%', s;      -- always roll everything back
end $$;
