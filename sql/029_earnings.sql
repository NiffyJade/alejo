-- Earnings: the owner's money page (run after 028; safe to re-run).
--
-- One report function, earnings_report(hotel, from, to), gives everything the Earnings page draws:
--   * money received each day (room and service payments, refunds taken off), counted on the day it was recorded, in the hotel's time zone;
--   * the value of rooms sold each night (a stay is spread over its nights at the price it was BOOKED at: bookings.nightly_rate, set
--     when the booking is made, so changing a room rate later never rewrites past earnings), and the value of services booked on the
--     day they start;
--   * nights sold, rooms on sale, so the page can show occupancy, average rate (ADR) and revenue per available room (RevPAR);
--   * the same totals for the period just before, to compare;
--   * splits by payment method, booking channel, room type and service;
--   * who still owes money (stays that have started, services that have happened).
--
-- Who may see it: the owner (and Alejo's own admin). The owner can switch it on for managers too (hotels.earnings_for_managers,
-- changed only through owner_set_earnings_access). Front-desk staff never see it. The function checks this itself, so the rule
-- holds whatever the page does.
-- Note: each payment is still visible on its own booking, because the front desk records payments; the totals, charts and
-- comparisons are what this page adds, and only this function produces them.

alter table hotels add column if not exists earnings_for_managers boolean not null default false;

-- ---------------------------------------------------------------- the price a stay was sold at
-- Every way of booking (Telegram, phone, the dashboard) inserts into bookings, so one trigger stamps the room type's rate at that moment.
-- A change of room type takes the new type's rate. Bookings made before this file get today's rate (the best record there is).
alter table bookings add column if not exists nightly_rate numeric(12,2);
create or replace function bookings_stamp_rate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.nightly_rate is not null then return new; end if;
  if tg_op = 'UPDATE' and new.room_type is not distinct from old.room_type then return new; end if;
  new.nightly_rate := (select rt.nightly_rate from room_types rt where rt.hotel_id = new.hotel_id and rt.name = new.room_type);
  return new;
end $$;
drop trigger if exists bookings_stamp_rate on bookings;
create trigger bookings_stamp_rate before insert or update of room_type on bookings for each row execute function bookings_stamp_rate();
revoke execute on function bookings_stamp_rate() from public, anon, authenticated;
update bookings b set nightly_rate = rt.nightly_rate
from room_types rt where b.nightly_rate is null and rt.hotel_id = b.hotel_id and rt.name = b.room_type;

-- ---------------------------------------------------------------- who may see it
create or replace function can_see_earnings(p_hotel uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(has_role(p_hotel, 'owner'), false)
      or (coalesce(has_role(p_hotel, 'manager'), false)
          and coalesce((select h.earnings_for_managers from hotels h where h.id = p_hotel), false))
$$;

create or replace function owner_set_earnings_access(p_hotel uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(has_role(p_hotel, 'owner'), false) then
    raise exception 'Only the owner can choose who sees Earnings.' using errcode = '42501';
  end if;
  update hotels set earnings_for_managers = coalesce(p_on, false) where id = p_hotel;
  return jsonb_build_object('ok', true, 'earnings_for_managers', coalesce(p_on, false));
end $$;

-- ---------------------------------------------------------------- the totals for one period (used twice: this period and the one before)
create or replace function earnings_totals(p_hotel uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  with tz as (select hotel_tz(p_hotel) as z),
  nights as (
    select b.id, coalesce(b.nightly_rate, rt.nightly_rate, 0) as rate
    from bookings b
    left join room_types rt on rt.hotel_id = b.hotel_id and rt.name = b.room_type
    cross join lateral generate_series(greatest(b.check_in, p_from), least(b.check_out - 1, p_to), interval '1 day') d
    where b.hotel_id = p_hotel and b.status <> 'cancelled' and b.check_in <= p_to and b.check_out > p_from
  ),
  pays as (
    select p.amount from booking_payments p, tz where p.hotel_id = p_hotel and (p.created_at at time zone tz.z)::date between p_from and p_to
    union all
    select p.amount from service_payments p, tz where p.hotel_id = p_hotel and (p.created_at at time zone tz.z)::date between p_from and p_to
  )
  select jsonb_build_object(
    'received',       (select coalesce(sum(amount), 0) from pays),
    'refunds',        (select coalesce(-sum(amount), 0) from pays where amount < 0),
    'payments',       (select count(*) from pays where amount > 0),
    'rooms_value',    (select coalesce(sum(rate), 0) from nights),
    'nights_sold',    (select count(*) from nights),
    'stays',          (select count(distinct id) from nights),
    'services_value', (select coalesce(sum(s.amount), 0) from service_bookings s
                        where s.hotel_id = p_hotel and s.status = 'booked' and s.starts_on between p_from and p_to),
    'room_nights',    (select coalesce(sum(total_rooms), 0) from room_types where hotel_id = p_hotel and active) * (p_to - p_from + 1))
$$;

-- ---------------------------------------------------------------- the report
create or replace function earnings_report(p_hotel uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz    text := hotel_tz(p_hotel);
  v_today date := (now() at time zone hotel_tz(p_hotel))::date;
  v_len   int;
  v_out   jsonb;
begin
  if not can_see_earnings(p_hotel) then
    raise exception 'Earnings are for the owner. Ask the owner if you need to see them.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Choose a start date on or before the end date.' using errcode = '22023';
  end if;
  v_len := p_to - p_from + 1;
  if v_len > 400 then
    raise exception 'Choose a period of 400 days or less.' using errcode = '22023';
  end if;

  with
  days as (select d::date as day from generate_series(p_from, p_to, interval '1 day') d),
  nights as (
    select b.id, b.room_type, coalesce(nullif(b.source, ''), 'other') as source, d::date as night, coalesce(b.nightly_rate, rt.nightly_rate, 0) as rate
    from bookings b
    left join room_types rt on rt.hotel_id = b.hotel_id and rt.name = b.room_type
    cross join lateral generate_series(greatest(b.check_in, p_from), least(b.check_out - 1, p_to), interval '1 day') d
    where b.hotel_id = p_hotel and b.status <> 'cancelled' and b.check_in <= p_to and b.check_out > p_from
  ),
  pays as (
    select p.amount, (p.created_at at time zone v_tz)::date as day, lower(coalesce(nullif(trim(p.method), ''), 'not recorded')) as method, 'room' as kind
    from booking_payments p where p.hotel_id = p_hotel and (p.created_at at time zone v_tz)::date between p_from and p_to
    union all
    select p.amount, (p.created_at at time zone v_tz)::date, lower(coalesce(nullif(trim(p.method), ''), 'not recorded')), 'service'
    from service_payments p where p.hotel_id = p_hotel and (p.created_at at time zone v_tz)::date between p_from and p_to
  ),
  svc as (
    select s.amount, s.starts_on as day, hs.name
    from service_bookings s join hotel_services hs on hs.id = s.service_id and hs.hotel_id = s.hotel_id
    where s.hotel_id = p_hotel and s.status = 'booked' and s.starts_on between p_from and p_to
  ),
  -- money still owed: stays that have started (whole stay at today's rate, less what was paid) and services that have started
  stay_owed as (
    select b.id, g.name, b.room_type, b.check_in, b.check_out, b.status,
           (b.check_out - b.check_in) * coalesce(b.nightly_rate, rt.nightly_rate, 0)
             - coalesce((select sum(p.amount) from booking_payments p where p.booking_id = b.id), 0) as owed
    from bookings b
    join guests g on g.id = b.guest_id
    left join room_types rt on rt.hotel_id = b.hotel_id and rt.name = b.room_type
    where b.hotel_id = p_hotel and b.status <> 'cancelled' and b.check_in <= v_today
  ),
  svc_owed as (
    select s.id, s.customer_name as name, hs.name as service, s.starts_on, s.amount - s.paid as owed
    from service_bookings s join hotel_services hs on hs.id = s.service_id and hs.hotel_id = s.hotel_id
    where s.hotel_id = p_hotel and s.status = 'booked' and s.starts_on <= v_today
  ),
  owed_all as (
    select 'stay' as kind, name, room_type as what, check_out as until, owed from stay_owed where owed > 0
    union all
    select 'service', name, service, starts_on, owed from svc_owed where owed > 0
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'days', v_len, 'today', v_today, 'timezone', v_tz,
    'rooms_on_sale', (select coalesce(sum(total_rooms), 0) from room_types where hotel_id = p_hotel and active),
    'totals',   earnings_totals(p_hotel, p_from, p_to),
    'previous', earnings_totals(p_hotel, p_from - v_len, p_from - 1) || jsonb_build_object('from', p_from - v_len, 'to', p_from - 1),
    'series', (select coalesce(jsonb_agg(jsonb_build_object(
                 'd', dd.day,
                 'received', coalesce((select sum(amount) from pays where pays.day = dd.day), 0),
                 'rooms',    coalesce((select sum(rate) from nights where nights.night = dd.day), 0),
                 'services', coalesce((select sum(amount) from svc where svc.day = dd.day), 0),
                 'nights',   (select count(*) from nights where nights.night = dd.day)) order by dd.day), '[]'::jsonb)
               from days dd),
    'by_method', (select coalesce(jsonb_agg(jsonb_build_object('name', method, 'amount', amt, 'count', n) order by amt desc), '[]'::jsonb)
                  from (select method, sum(amount) as amt, count(*) filter (where amount > 0) as n from pays group by method) m),
    'by_source', (select coalesce(jsonb_agg(jsonb_build_object('name', source, 'amount', amt, 'nights', n) order by amt desc), '[]'::jsonb)
                  from (select source, sum(rate) as amt, count(*) as n from nights group by source) s),
    'by_room_type', (select coalesce(jsonb_agg(jsonb_build_object('name', room_type, 'amount', amt, 'nights', n) order by amt desc), '[]'::jsonb)
                     from (select coalesce(room_type, 'Not set') as room_type, sum(rate) as amt, count(*) as n from nights group by 1) r),
    'by_service', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'amount', amt, 'count', n) order by amt desc), '[]'::jsonb)
                   from (select name, sum(amount) as amt, count(*) as n from svc group by name) v),
    'by_kind', jsonb_build_object(
                 'rooms',    (select coalesce(sum(amount), 0) from pays where kind = 'room'),
                 'services', (select coalesce(sum(amount), 0) from pays where kind = 'service')),
    'owed', jsonb_build_object(
              'total', (select coalesce(sum(owed), 0) from owed_all),
              'count', (select count(*) from owed_all),
              'top',   (select coalesce(jsonb_agg(to_jsonb(o) order by o.owed desc), '[]'::jsonb)
                        from (select kind, name, what, until, owed from owed_all order by owed desc limit 6) o))
  ) into v_out;
  return v_out;
end $$;

-- ---------------------------------------------------------------- who may call what
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
           and p.proname in ('earnings_totals') loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
  for r in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
           and p.proname in ('earnings_report', 'can_see_earnings', 'owner_set_earnings_access') loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;
