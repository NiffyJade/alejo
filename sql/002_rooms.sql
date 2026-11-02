-- Room inventory + availability for phone bookings (run after 001_schema.sql; safe to re-run).
-- Seed rows below are TEST values: replace the room types, counts and rates with the hotel's real ones.

create table if not exists room_types (
  name          text primary key,                 -- must match bookings.room_type exactly
  total_rooms   int  not null check (total_rooms >= 0),
  nightly_rate  numeric(12,2),                    -- Naira per night
  description   text,
  active        boolean not null default true
);
alter table room_types enable row level security;

insert into room_types (name, total_rooms, nightly_rate, description) values
  ('Standard', 10, 35000, 'Test value: comfortable room with air conditioning'),
  ('Deluxe',    6, 55000, 'Test value: larger room with a work desk'),
  ('Suite',     3, 95000, 'Test value: separate living area')
on conflict (name) do nothing;

create index if not exists guests_phone_idx on guests (phone);

-- Rooms still free for every active room type over [p_check_in, p_check_out).
-- A booking blocks a room when its stay overlaps and it is booked or checked in.
create or replace function room_availability(p_check_in date, p_check_out date, p_room_type text default null)
returns table (room_type text, available_rooms int, nightly_rate numeric)
language sql stable as $$
  select rt.name,
         (rt.total_rooms - coalesce(u.used, 0))::int,
         rt.nightly_rate
  from room_types rt
  left join lateral (
    select count(*) as used
    from bookings b
    where b.room_type = rt.name
      and b.status in ('booked', 'checked_in')
      and b.check_in  < p_check_out
      and b.check_out > p_check_in
  ) u on true
  where rt.active
    and (p_room_type is null or lower(rt.name) = lower(p_room_type))
  order by rt.nightly_rate nulls last, rt.name
$$;

-- Only the service-role key (n8n) may call it.
revoke execute on function room_availability(date, date, text) from public, anon, authenticated;
grant  execute on function room_availability(date, date, text) to service_role;
