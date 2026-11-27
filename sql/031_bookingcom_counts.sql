-- Booking.com room counts, the free way (run after 030; safe to re-run).
--
-- Without a paid channel manager Alejo cannot change Booking.com by itself. Instead, every 15 minutes the scheduler asks ota_check()
-- which room counts no longer match what Booking.com was last told, and tells the staff group exactly what to set
-- ("Standard, Fri 28 Nov - Mon 1 Dec: 3 rooms"). Once Telegram has the message, ota_mark() records those counts as told.
--   * Switched on per hotel by the setting BOOKINGCOM_SYNC = yes (Settings > Booking.com). Off, nothing is kept and nothing is sent.
--   * The first check after switching on only notes the current counts (no flood of messages); so does every newly reachable night.
--   * A booking recorded with the source "booking.com" lowers the told count by itself (and its cancellation raises it), because
--     Booking.com already changed its own count: staff are never told to make a change Booking.com has already made.
--   * The count Booking.com should show is the rooms Alejo has free (rooms_free's rule: bookings booked or checked in, and blocks).

-- ---------------------------------------------------------------- bookings can come from Booking.com
alter table bookings drop constraint if exists bookings_source_check;
alter table bookings add constraint bookings_source_check
  check (source is null or source in ('telegram', 'phone', 'walk-in', 'online', 'booking.com', 'other'));

-- the dashboard's New booking accepts it (the function from 021, with one word added)
create or replace function staff_create_booking(p_hotel uuid, p_name text, p_phone text, p_room_type text, p_check_in date, p_check_out date,
                                                p_source text default 'walk-in', p_room_number text default null, p_check_in_now boolean default false,
                                                p_paid numeric default 0, p_payment_method text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_rt      room_types%rowtype;
  v_guest   guests%rowtype;
  v_booking bookings%rowtype;
  v_today   date := (now() at time zone hotel_tz(p_hotel))::date;
  v_digits  text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  v_room    text := left(nullif(trim(coalesce(p_room_number, '')), ''), 20);
  v_who     text := jwt_email();
  v_source  text := case when p_source in ('walk-in', 'phone', 'online', 'booking.com', 'other') then p_source else 'other' end;
begin
  if not is_hotel_staff(p_hotel) then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(trim(p_name), '') = '' then return jsonb_build_object('ok', false, 'reason', 'name'); end if;
  if p_check_in is null or p_check_out is null or p_check_out <= p_check_in
     or p_check_in < v_today or p_check_out - p_check_in > 90 then
    return jsonb_build_object('ok', false, 'reason', 'dates');
  end if;
  if coalesce(p_paid, 0) < 0 then return jsonb_build_object('ok', false, 'reason', 'amount'); end if;
  if p_check_in_now and p_check_in <> v_today then return jsonb_build_object('ok', false, 'reason', 'not_today'); end if;

  select * into v_rt from room_types where hotel_id = p_hotel and active and lower(name) = lower(coalesce(p_room_type, ''));
  if not found then return jsonb_build_object('ok', false, 'reason', 'room_type'); end if;

  perform pg_advisory_xact_lock(hashtext('room:' || p_hotel::text || ':' || v_rt.name));
  if rooms_free(p_hotel, v_rt.name, p_check_in, p_check_out) < 1 then
    return jsonb_build_object('ok', false, 'reason', 'sold_out', 'room_type', v_rt.name);
  end if;
  if v_room is not null and exists (
       select 1 from bookings b
       where b.hotel_id = p_hotel and b.room_number = v_room and b.status in ('booked', 'checked_in') and b.check_in < p_check_out and b.check_out > p_check_in) then
    return jsonb_build_object('ok', false, 'reason', 'room_taken');
  end if;

  -- staff typed this number themselves, so matching an existing guest by phone is safe (it links no Telegram chat)
  if length(v_digits) >= 7 then
    select * into v_guest from guests where hotel_id = p_hotel and phone like '%' || v_digits order by created_at limit 1;
  end if;
  if v_guest.id is null then
    insert into guests (hotel_id, name, phone) values (p_hotel, left(trim(p_name), 80), norm_phone(p_phone)) returning * into v_guest;
  end if;

  insert into bookings (hotel_id, guest_id, room_type, room_number, check_in, check_out, source, created_by, status, checked_in_at)
  values (p_hotel, v_guest.id, v_rt.name, v_room, p_check_in, p_check_out, v_source, v_who,
          case when p_check_in_now then 'checked_in' else 'booked' end, case when p_check_in_now then now() end)
  returning * into v_booking;

  if coalesce(p_paid, 0) > 0 then
    insert into booking_payments (hotel_id, booking_id, amount, method, recorded_by)
    values (p_hotel, v_booking.id, p_paid, coalesce(nullif(trim(p_payment_method), ''), 'recorded at booking'), v_who);
  end if;

  return jsonb_build_object('ok', true, 'booking_id', v_booking.id, 'ref', upper(left(v_booking.id::text, 8)),
    'guest_name', v_guest.name, 'room_type', v_rt.name, 'nights', p_check_out - p_check_in);
end
$$;

-- ---------------------------------------------------------------- what Booking.com was last told, per room type and night
create table if not exists ota_counts (
  hotel_id  uuid        not null references hotels(id) on delete cascade,
  channel   text        not null default 'booking.com',
  room_type text        not null,
  night     date        not null,
  rooms     int         not null check (rooms >= 0),
  told_at   timestamptz not null default now(),
  primary key (hotel_id, channel, room_type, night)
);
alter table ota_counts enable row level security;
drop policy if exists staff_read on ota_counts;
create policy staff_read on ota_counts for select to authenticated using (is_hotel_staff(hotel_id));
revoke all on ota_counts from anon, authenticated;
grant select on ota_counts to authenticated;
grant all on ota_counts to service_role;

-- free rooms of every active room type for every night in [p_from, p_to): the same rule as rooms_free, for many nights at once
create or replace function rooms_free_by_night(p_hotel uuid, p_from date, p_to date)
returns table (room_type text, night date, rooms int) language sql stable as $$
  select rt.name, d::date,
         greatest(0, rt.total_rooms
           - (select count(*) from bookings b
              where b.hotel_id = p_hotel and b.room_type = rt.name and b.status in ('booked', 'checked_in')
                and b.check_in <= d::date and b.check_out > d::date)
           - coalesce((select sum(rb.rooms) from room_blocks rb
                       where rb.hotel_id = p_hotel and rb.room_type = rt.name and rb.start_date <= d::date and rb.end_date > d::date), 0))::int
  from room_types rt
  cross join generate_series(p_from::timestamp, (p_to - 1)::timestamp, interval '1 day') d
  where rt.hotel_id = p_hotel and rt.active
$$;

-- ---------------------------------------------------------------- the check the scheduler runs
create or replace function ota_check(p_hotel uuid, p_days int default 365) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone hotel_tz(p_hotel))::date;
  v_to    date;
  v_first boolean;
  v       jsonb;
begin
  if lower(coalesce((select value from hotel_settings where hotel_id = p_hotel and key = 'BOOKINGCOM_SYNC'), 'no')) not in ('yes', 'on', 'true') then
    delete from ota_counts where hotel_id = p_hotel and channel = 'booking.com';          -- switched off: start afresh next time
    return jsonb_build_object('enabled', false, 'changes', '[]'::jsonb);
  end if;
  v_to := v_today + greatest(1, least(coalesce(p_days, 365), 500));
  delete from ota_counts where hotel_id = p_hotel and channel = 'booking.com' and night < v_today;   -- the past needs no telling
  v_first := not exists (select 1 from ota_counts where hotel_id = p_hotel and channel = 'booking.com');

  -- nights (or room types) Booking.com has not been told about yet are noted as they are: no message for them
  insert into ota_counts (hotel_id, channel, room_type, night, rooms)
  select p_hotel, 'booking.com', f.room_type, f.night, f.rooms from rooms_free_by_night(p_hotel, v_today, v_to) f
  on conflict (hotel_id, channel, room_type, night) do nothing;

  if v_first then
    return jsonb_build_object('enabled', true, 'first', true, 'today', v_today, 'changes', '[]'::jsonb,
      'tonight', (select coalesce(jsonb_agg(jsonb_build_object('room_type', f.room_type, 'rooms', f.rooms) order by f.room_type), '[]'::jsonb)
                  from rooms_free_by_night(p_hotel, v_today, v_today + 1) f));
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('room_type', f.room_type, 'night', f.night, 'rooms', f.rooms, 'was', o.rooms)
                            order by f.room_type, f.night), '[]'::jsonb) into v
  from rooms_free_by_night(p_hotel, v_today, v_to) f
  join ota_counts o on o.hotel_id = p_hotel and o.channel = 'booking.com' and o.room_type = f.room_type and o.night = f.night
  where o.rooms <> f.rooms;
  return jsonb_build_object('enabled', true, 'first', false, 'today', v_today, 'changes', v);
end $$;

-- after Telegram took the message: these counts are what Booking.com was told
create or replace function ota_mark(p_hotel uuid, p_items jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into ota_counts (hotel_id, channel, room_type, night, rooms, told_at)
  select p_hotel, 'booking.com', x->>'room_type', (x->>'night')::date, greatest(0, (x->>'rooms')::int), now()
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
  where x->>'room_type' is not null and x->>'night' is not null and x->>'rooms' is not null
  on conflict (hotel_id, channel, room_type, night) do update set rooms = excluded.rooms, told_at = excluded.told_at;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- a Booking.com booking changes Booking.com's own count
create or replace function ota_follow_booking() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_delta int;
begin
  if new.source is distinct from 'booking.com' then return null; end if;
  if tg_op = 'INSERT' and new.status in ('booked', 'checked_in') then v_delta := -1;            -- sold on Booking.com: its count already went down
  elsif tg_op = 'UPDATE' and old.status in ('booked', 'checked_in') and new.status = 'cancelled' then v_delta := 1;   -- cancelled there: back up
  end if;
  if v_delta is not null then
    update ota_counts set rooms = greatest(0, rooms + v_delta), told_at = now()
    where hotel_id = new.hotel_id and channel = 'booking.com' and room_type = new.room_type and night >= new.check_in and night < new.check_out;
  end if;
  return null;
end $$;
drop trigger if exists ota_follow_booking on bookings;
create trigger ota_follow_booking after insert or update of status on bookings for each row execute function ota_follow_booking();

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
           and p.proname in ('rooms_free_by_night', 'ota_check', 'ota_mark', 'ota_follow_booking') loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);   -- the scheduler only (service role)
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;
