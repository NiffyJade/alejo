-- Phone bookings made atomic + language memory for Telegram booking drafts (run after 009; safe to re-run).
--
-- phone_book_room : the Vapi book_room tool used to check availability, then create the guest and booking in separate
--                   steps, so two callers could both be given the last room. This does the re-check and the insert in one
--                   transaction under the same per-room-type lock as telegram_book_room (they now exclude each other).
-- booking_drafts.lang : 'en' or 'pcm' (Nigerian Pidgin), so button taps and shared contacts keep the guest's language.

alter table booking_drafts add column if not exists lang text not null default 'en';

create or replace function phone_book_room(
  p_name       text,
  p_phone      text,
  p_email      text,
  p_room_type  text,
  p_check_in   date,
  p_check_out  date
) returns jsonb
language plpgsql as $$
declare
  v_rt      room_types%rowtype;
  v_used    int;
  v_guest   guests%rowtype;
  v_booking bookings%rowtype;
  v_digits  text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  v_today   date := (now() at time zone 'Africa/Lagos')::date;
begin
  if p_check_in is null or p_check_out is null or p_check_out <= p_check_in
     or p_check_in < v_today or p_check_out - p_check_in > 30 then
    return jsonb_build_object('ok', false, 'reason', 'dates');
  end if;
  if coalesce(trim(p_name), '') = '' or length(v_digits) < 7 then
    return jsonb_build_object('ok', false, 'reason', 'details');
  end if;

  select * into v_rt from room_types where active and lower(name) = lower(coalesce(p_room_type, ''));
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'room_type');
  end if;

  perform pg_advisory_xact_lock(hashtext('room:' || v_rt.name));   -- same lock as telegram_book_room

  select count(*) into v_used
  from bookings b
  where b.room_type = v_rt.name
    and b.status in ('booked', 'checked_in')
    and b.check_in < p_check_out
    and b.check_out > p_check_in;
  if v_used >= v_rt.total_rooms then
    return jsonb_build_object('ok', false, 'reason', 'sold_out', 'room_type', v_rt.name);
  end if;

  -- same rule as before: a caller is the guest with that number (last 10 digits), created if new
  select * into v_guest from guests where phone like '%' || v_digits order by created_at limit 1;
  if not found then
    insert into guests (name, phone, email)
    values (left(trim(p_name), 80), p_phone, nullif(p_email, ''))
    returning * into v_guest;
  end if;

  insert into bookings (guest_id, room_type, check_in, check_out)
  values (v_guest.id, v_rt.name, p_check_in, p_check_out)
  returning * into v_booking;

  return jsonb_build_object('ok', true, 'booking_id', v_booking.id, 'ref', upper(left(v_booking.id::text, 8)),
    'room_type', v_rt.name, 'rate', v_rt.nightly_rate, 'nights', p_check_out - p_check_in);
end
$$;

revoke execute on function phone_book_room(text, text, text, text, date, date) from public, anon, authenticated;
grant  execute on function phone_book_room(text, text, text, text, date, date) to service_role;
