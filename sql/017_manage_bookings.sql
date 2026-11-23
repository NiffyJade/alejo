-- Manage bookings from the staff dashboard (run after 016; safe to re-run).
--
-- Staff can create a booking (walk-in, phone, online), cancel one, check a guest in or out, assign a room number,
-- record payments, and block rooms (maintenance, a hold, bookings made on other platforms).
-- Every change goes through the staff_* functions below, which check is_staff() and use the SAME lock and the SAME
-- availability rule (rooms_free) as the Telegram and phone bookings, so no channel can double-book against another.
--
-- This file REPLACES room_availability, telegram_book_room and phone_book_room from 002/009/010 (same signatures) so that they
--   * count availability per night instead of "any overlap", and
--   * take blocked rooms into account.
-- If you ever re-run 002, 009 or 010, run this file again afterwards.

-- ---------------------------------------------------------------- columns and tables
alter table bookings add column if not exists source        text;          -- telegram | phone | walk-in | online | other (null: older rows)
alter table bookings add column if not exists created_by    text;          -- staff email when made from the dashboard
alter table bookings add column if not exists cancelled_at  timestamptz;
alter table bookings add column if not exists cancelled_by  text;
alter table bookings add column if not exists cancel_reason text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'bookings_source_check') then
    alter table bookings add constraint bookings_source_check
      check (source is null or source in ('telegram', 'phone', 'walk-in', 'online', 'other'));
  end if;
end $$;

-- Money received for a stay. Append-only: a correction or refund is a new row (negative amount), so there is a trail.
create table if not exists booking_payments (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid not null references bookings(id) on delete cascade,
  amount       numeric(12,2) not null check (amount <> 0),
  method       text,                                   -- cash, transfer, pos...
  note         text,
  recorded_by  text,
  created_at   timestamptz not null default now()
);
create index if not exists booking_payments_booking_idx on booking_payments (booking_id);

-- Rooms taken out of sale for a period.
create table if not exists room_blocks (
  id          uuid primary key default gen_random_uuid(),
  room_type   text not null references room_types(name) on update cascade on delete cascade,
  rooms       int  not null check (rooms > 0),
  start_date  date not null,
  end_date    date not null check (end_date > start_date),     -- the night of end_date is NOT blocked (like a check-out)
  reason      text,
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists room_blocks_window_idx on room_blocks (room_type, start_date, end_date);

alter table booking_payments enable row level security;
alter table room_blocks      enable row level security;
drop policy if exists staff_read on booking_payments;
create policy staff_read on booking_payments for select to authenticated using (is_staff());
drop policy if exists staff_read on room_blocks;
create policy staff_read on room_blocks for select to authenticated using (is_staff());

-- the dashboard updates live
do $$
declare t text;
begin
  foreach t in array array['booking_payments', 'room_blocks'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- helpers
-- Phone numbers are stored the way the bots store them: +234...
create or replace function norm_phone(p text) returns text
language sql immutable as $$
  select case
    when d = '' then null
    when length(d) = 11 and left(d, 1) = '0' then '+234' || substr(d, 2)
    else '+' || d
  end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;

-- Rooms still free of one type for [p_in, p_out): the room count minus, on the BUSIEST night of the stay, the booked rooms
-- (booked or checked in) and the blocked rooms. Two bookings that never overlap each other no longer count against each other.
-- p_exclude lets a booking be ignored (used when changing it).
create or replace function rooms_free(p_type text, p_in date, p_out date, p_exclude uuid default null) returns int
language sql stable as $$
  select greatest(0, rt.total_rooms - coalesce(max(occ.n), 0))::int
  from room_types rt
  left join lateral (
    select (select count(*) from bookings b
            where b.room_type = rt.name and b.status in ('booked', 'checked_in')
              and b.check_in <= d::date and b.check_out > d::date
              and (p_exclude is null or b.id <> p_exclude))
         + coalesce((select sum(rb.rooms) from room_blocks rb
                     where rb.room_type = rt.name and rb.start_date <= d::date and rb.end_date > d::date), 0) as n
    from generate_series(p_in::timestamp, (p_out - 1)::timestamp, interval '1 day') d
  ) occ on true
  where rt.name = p_type
  group by rt.total_rooms
$$;

create or replace function room_availability(p_check_in date, p_check_out date, p_room_type text default null)
returns table (room_type text, available_rooms int, nightly_rate numeric)
language sql stable as $$
  select rt.name, rooms_free(rt.name, p_check_in, p_check_out), rt.nightly_rate
  from room_types rt
  where rt.active and (p_room_type is null or lower(rt.name) = lower(p_room_type))
  order by rt.nightly_rate nulls last, rt.name
$$;

revoke execute on function norm_phone(text) from public, anon, authenticated;
revoke execute on function rooms_free(text, date, date, uuid) from public, anon, authenticated;
revoke execute on function room_availability(date, date, text) from public, anon, authenticated;
grant  execute on function norm_phone(text) to service_role;
grant  execute on function rooms_free(text, date, date, uuid) to service_role;
grant  execute on function room_availability(date, date, text) to service_role;

-- ---------------------------------------------------------------- the bots' booking functions, now using rooms_free
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

  perform pg_advisory_xact_lock(hashtext('room:' || v_rt.name));

  if rooms_free(v_rt.name, p_check_in, p_check_out) < 1 then
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

  insert into bookings (guest_id, room_type, check_in, check_out, source)
  values (v_guest.id, v_rt.name, p_check_in, p_check_out, 'telegram')
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

  perform pg_advisory_xact_lock(hashtext('room:' || v_rt.name));   -- same lock as every other way of booking

  if rooms_free(v_rt.name, p_check_in, p_check_out) < 1 then
    return jsonb_build_object('ok', false, 'reason', 'sold_out', 'room_type', v_rt.name);
  end if;

  -- a caller is the guest with that number (last 10 digits), created if new
  select * into v_guest from guests where phone like '%' || v_digits order by created_at limit 1;
  if not found then
    insert into guests (name, phone, email)
    values (left(trim(p_name), 80), p_phone, nullif(p_email, ''))
    returning * into v_guest;
  end if;

  insert into bookings (guest_id, room_type, check_in, check_out, source)
  values (v_guest.id, v_rt.name, p_check_in, p_check_out, 'phone')
  returning * into v_booking;

  return jsonb_build_object('ok', true, 'booking_id', v_booking.id, 'ref', upper(left(v_booking.id::text, 8)),
    'room_type', v_rt.name, 'rate', v_rt.nightly_rate, 'nights', p_check_out - p_check_in);
end
$$;

revoke execute on function telegram_book_room(bigint, text, text, boolean, text, date, date) from public, anon, authenticated;
revoke execute on function phone_book_room(text, text, text, text, date, date) from public, anon, authenticated;
grant  execute on function telegram_book_room(bigint, text, text, boolean, text, date, date) to service_role;
grant  execute on function phone_book_room(text, text, text, text, date, date) to service_role;

-- ---------------------------------------------------------------- staff functions (the dashboard calls these)
-- All return jsonb: {ok: true, ...} or {ok: false, reason: '...'}. Only a non-staff caller gets an error.

-- free rooms per type for a date range (hint under the booking form)
create or replace function staff_availability(p_check_in date, p_check_out date)
returns table (room_type text, free int, nightly_rate numeric, total_rooms int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
    select rt.name, rooms_free(rt.name, p_check_in, p_check_out), rt.nightly_rate, rt.total_rooms
    from room_types rt where rt.active order by rt.nightly_rate nulls last, rt.name;
end
$$;

create or replace function staff_create_booking(
  p_name            text,
  p_phone           text,
  p_room_type       text,
  p_check_in        date,
  p_check_out       date,
  p_source          text    default 'walk-in',
  p_room_number     text    default null,
  p_check_in_now    boolean default false,
  p_paid            numeric default 0,
  p_payment_method  text    default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_rt      room_types%rowtype;
  v_guest   guests%rowtype;
  v_booking bookings%rowtype;
  v_today   date := (now() at time zone 'Africa/Lagos')::date;
  v_digits  text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  v_room    text := left(nullif(trim(coalesce(p_room_number, '')), ''), 20);
  v_who     text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_source  text := case when p_source in ('walk-in', 'phone', 'online', 'other') then p_source else 'other' end;
begin
  if not is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(trim(p_name), '') = '' then return jsonb_build_object('ok', false, 'reason', 'name'); end if;
  if p_check_in is null or p_check_out is null or p_check_out <= p_check_in
     or p_check_in < v_today or p_check_out - p_check_in > 90 then
    return jsonb_build_object('ok', false, 'reason', 'dates');
  end if;
  if coalesce(p_paid, 0) < 0 then return jsonb_build_object('ok', false, 'reason', 'amount'); end if;
  if p_check_in_now and p_check_in <> v_today then return jsonb_build_object('ok', false, 'reason', 'not_today'); end if;

  select * into v_rt from room_types where active and lower(name) = lower(coalesce(p_room_type, ''));
  if not found then return jsonb_build_object('ok', false, 'reason', 'room_type'); end if;

  perform pg_advisory_xact_lock(hashtext('room:' || v_rt.name));
  if rooms_free(v_rt.name, p_check_in, p_check_out) < 1 then
    return jsonb_build_object('ok', false, 'reason', 'sold_out', 'room_type', v_rt.name);
  end if;
  if v_room is not null and exists (
       select 1 from bookings b
       where b.room_number = v_room and b.status in ('booked', 'checked_in') and b.check_in < p_check_out and b.check_out > p_check_in) then
    return jsonb_build_object('ok', false, 'reason', 'room_taken');
  end if;

  -- staff typed this number themselves, so matching an existing guest by phone is safe (it links no Telegram chat)
  if length(v_digits) >= 7 then
    select * into v_guest from guests where phone like '%' || v_digits order by created_at limit 1;
  end if;
  if v_guest.id is null then
    insert into guests (name, phone) values (left(trim(p_name), 80), norm_phone(p_phone)) returning * into v_guest;
  end if;

  insert into bookings (guest_id, room_type, room_number, check_in, check_out, source, created_by, status, checked_in_at)
  values (v_guest.id, v_rt.name, v_room, p_check_in, p_check_out, v_source, v_who,
          case when p_check_in_now then 'checked_in' else 'booked' end, case when p_check_in_now then now() end)
  returning * into v_booking;

  if coalesce(p_paid, 0) > 0 then
    insert into booking_payments (booking_id, amount, method, recorded_by)
    values (v_booking.id, p_paid, coalesce(nullif(trim(p_payment_method), ''), 'recorded at booking'), v_who);
  end if;

  return jsonb_build_object('ok', true, 'booking_id', v_booking.id, 'ref', upper(left(v_booking.id::text, 8)),
    'guest_name', v_guest.name, 'room_type', v_rt.name, 'nights', p_check_out - p_check_in);
end
$$;

create or replace function staff_cancel_booking(p_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_b bookings%rowtype;
begin
  if not is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_b from bookings where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_b.status = 'cancelled'   then return jsonb_build_object('ok', false, 'reason', 'already'); end if;
  if v_b.status = 'checked_in'  then return jsonb_build_object('ok', false, 'reason', 'in_house'); end if;
  if v_b.status = 'checked_out' then return jsonb_build_object('ok', false, 'reason', 'done'); end if;
  update bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = lower(coalesce(auth.jwt() ->> 'email', '')),
         cancel_reason = left(nullif(trim(coalesce(p_reason, '')), ''), 200)
  where id = p_id;
  return jsonb_build_object('ok', true, 'ref', upper(left(p_id::text, 8)));
end
$$;

create or replace function staff_set_status(p_id uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_b bookings%rowtype;
begin
  if not is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_b from bookings where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_action = 'checkin' then
    if v_b.status <> 'booked' then return jsonb_build_object('ok', false, 'reason', 'not_booked'); end if;
    update bookings set status = 'checked_in', checked_in_at = now() where id = p_id;
  elsif p_action = 'checkout' then
    if v_b.status <> 'checked_in' then return jsonb_build_object('ok', false, 'reason', 'not_in_house'); end if;
    update bookings set status = 'checked_out', checked_out_at = now() where id = p_id;
  else
    return jsonb_build_object('ok', false, 'reason', 'action');
  end if;
  return jsonb_build_object('ok', true);
end
$$;

create or replace function staff_set_room(p_id uuid, p_room text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_b    bookings%rowtype;
  v_room text := left(nullif(trim(coalesce(p_room, '')), ''), 20);      -- empty clears the room number
begin
  if not is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_b from bookings where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_b.status in ('cancelled', 'checked_out') then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
  if v_room is not null and exists (
       select 1 from bookings b
       where b.id <> p_id and b.room_number = v_room and b.status in ('booked', 'checked_in')
         and b.check_in < v_b.check_out and b.check_out > v_b.check_in) then
    return jsonb_build_object('ok', false, 'reason', 'room_taken');
  end if;
  update bookings set room_number = v_room where id = p_id;
  return jsonb_build_object('ok', true, 'room', v_room);
end
$$;

create or replace function staff_record_payment(p_id uuid, p_amount numeric, p_method text default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_total numeric;
begin
  if not is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 100000000 then return jsonb_build_object('ok', false, 'reason', 'amount'); end if;
  if not exists (select 1 from bookings where id = p_id) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  insert into booking_payments (booking_id, amount, method, note, recorded_by)
  values (p_id, round(p_amount, 2), left(nullif(trim(coalesce(p_method, '')), ''), 40), left(nullif(trim(coalesce(p_note, '')), ''), 200),
          lower(coalesce(auth.jwt() ->> 'email', '')));
  select coalesce(sum(amount), 0) into v_total from booking_payments where booking_id = p_id;
  return jsonb_build_object('ok', true, 'total_paid', v_total);
end
$$;

create or replace function staff_add_block(p_room_type text, p_rooms int, p_start date, p_end date, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_rt    room_types%rowtype;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_free  int;
  v_id    uuid;
begin
  if not is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_start is null or p_end is null or p_end <= p_start or p_start < v_today or p_end - p_start > 365 then
    return jsonb_build_object('ok', false, 'reason', 'dates');
  end if;
  select * into v_rt from room_types where lower(name) = lower(coalesce(p_room_type, ''));
  if not found then return jsonb_build_object('ok', false, 'reason', 'room_type'); end if;
  if p_rooms is null or p_rooms < 1 or p_rooms > v_rt.total_rooms then return jsonb_build_object('ok', false, 'reason', 'rooms'); end if;

  perform pg_advisory_xact_lock(hashtext('room:' || v_rt.name));
  v_free := rooms_free(v_rt.name, p_start, p_end);
  if v_free < p_rooms then
    return jsonb_build_object('ok', false, 'reason', 'conflict', 'free', v_free, 'room_type', v_rt.name);   -- existing bookings already use those rooms
  end if;
  insert into room_blocks (room_type, rooms, start_date, end_date, reason, created_by)
  values (v_rt.name, p_rooms, p_start, p_end, left(nullif(trim(coalesce(p_reason, '')), ''), 200), lower(coalesce(auth.jwt() ->> 'email', '')))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end
$$;

create or replace function staff_remove_block(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from room_blocks where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end
$$;

-- staff only: signed-in staff may call these (each checks is_staff() again); nobody else can
do $$
declare f text;
begin
  foreach f in array array[
    'staff_availability(date, date)',
    'staff_create_booking(text, text, text, date, date, text, text, boolean, numeric, text)',
    'staff_cancel_booking(uuid, text)',
    'staff_set_status(uuid, text)',
    'staff_set_room(uuid, text)',
    'staff_record_payment(uuid, numeric, text, text)',
    'staff_add_block(text, integer, date, date, text)',
    'staff_remove_block(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
