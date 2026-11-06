-- Booking and availability over Telegram (run after 002_rooms.sql; safe to re-run).
--
-- booking_drafts : what a person has told the bot so far (dates, room type, name, phone), one row per Telegram chat,
--                  so a booking can be spread over several messages. Rows older than 6 hours are ignored by the bot.
-- telegram_book_room : the one place a Telegram booking is written. It re-checks availability under a lock
--                  (two people confirming the last room at once cannot both get it), finds or creates the guest,
--                  links the guest to the chat, saves the booking and clears the draft, in a single transaction.

create table if not exists booking_drafts (
  chat_id         bigint primary key,
  check_in        date,
  check_out       date,
  room_type       text,
  guest_name      text,
  phone           text,
  phone_verified  boolean not null default false,   -- true only when the number came from Telegram's "Share my phone number" button
  updated_at      timestamptz not null default now()
);
alter table booking_drafts enable row level security;

create or replace function telegram_book_room(
  p_chat_id    bigint,
  p_name       text,
  p_phone      text,
  p_verified   boolean,
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
  v_open    int;
begin
  if p_check_in is null or p_check_out is null or p_check_out <= p_check_in
     or p_check_in < v_today or p_check_out - p_check_in > 30 then
    return jsonb_build_object('ok', false, 'reason', 'dates');
  end if;

  select * into v_rt from room_types where active and lower(name) = lower(coalesce(p_room_type, ''));
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'room_type');
  end if;

  -- one booking per room type at a time, so the count below cannot go stale before the insert
  perform pg_advisory_xact_lock(hashtext('room:' || v_rt.name));

  select count(*) into v_used
  from bookings b
  where b.room_type = v_rt.name
    and b.status in ('booked', 'checked_in')
    and b.check_in < p_check_out
    and b.check_out > p_check_in;
  if v_used >= v_rt.total_rooms then
    return jsonb_build_object('ok', false, 'reason', 'sold_out', 'room_type', v_rt.name);
  end if;

  -- Who is booking: the guest already linked to this chat. A guest found only by a typed phone number is NOT linked
  -- (anyone could type someone else's number and start receiving their stay code); only a number shared with
  -- Telegram's own button (p_verified) may link a guest who booked earlier by phone.
  select * into v_guest from guests where telegram_chat_id = p_chat_id;
  if not found and p_verified and length(v_digits) >= 7 then
    select * into v_guest from guests
    where telegram_chat_id is null and phone like '%' || v_digits
    order by created_at limit 1;
    if found then
      update guests set telegram_chat_id = p_chat_id where id = v_guest.id;
    end if;
  end if;
  if v_guest.id is null then
    if coalesce(trim(p_name), '') = '' then
      return jsonb_build_object('ok', false, 'reason', 'name');
    end if;
    insert into guests (name, phone, telegram_chat_id)
    values (left(trim(p_name), 80), nullif(p_phone, ''), p_chat_id)
    returning * into v_guest;
  end if;

  -- a person cannot hold more than 3 upcoming reservations through the bot
  select count(*) into v_open from bookings
  where guest_id = v_guest.id and status = 'booked' and check_out >= v_today;
  if v_open >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'limit');
  end if;

  insert into bookings (guest_id, room_type, check_in, check_out)
  values (v_guest.id, v_rt.name, p_check_in, p_check_out)
  returning * into v_booking;

  delete from booking_drafts where chat_id = p_chat_id;

  return jsonb_build_object(
    'ok', true,
    'booking_id', v_booking.id,
    'ref', upper(left(v_booking.id::text, 8)),
    'room_type', v_rt.name,
    'rate', v_rt.nightly_rate,
    'nights', p_check_out - p_check_in,
    'guest_name', v_guest.name,
    'guest_phone', v_guest.phone,
    'check_in', p_check_in,
    'check_out', p_check_out
  );
end
$$;

-- Only the service-role key (n8n) may call it.
revoke execute on function telegram_book_room(bigint, text, text, boolean, text, date, date) from public, anon, authenticated;
grant  execute on function telegram_book_room(bigint, text, text, boolean, text, date, date) to service_role;
