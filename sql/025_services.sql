-- 025: bookable SERVICES besides rooms (event hall, gym, pool, ...). Rooms keep their own tables and rules; nothing about room stays changes.
--   python -I execution/supabase_admin.py sql sql/025_services.sql        (atomic: all or nothing)
--
--   hotel_services   what a hotel sells: a name, a price and what the price is "per" (event, day, head, month, visit).
--                    "exclusive" means only one booking can hold it on a given day (an event hall); a pool or gym is not exclusive.
--   service_bookings who booked it, which days, how many (heads, days, months), the amount and what has been paid.
--   Who may do what: every role of the hotel reads both tables and records a booking or a payment; cancelling a booking and changing the
--   services list are manager decisions (the same split as cancelling a room stay and blocking rooms).
--   A booking holds whole days (starts_on to ends_on, both included). The times are for the people, not for the clash check.

create table if not exists hotel_services (
  id         uuid        not null default gen_random_uuid() primary key,
  hotel_id   uuid        not null references hotels(id) on delete cascade,
  name       text        not null check (length(trim(name)) between 1 and 80),
  price      numeric     not null default 0 check (price >= 0),
  unit       text        not null default 'per_event' check (unit in ('per_event', 'per_day', 'per_head', 'per_month', 'per_visit')),
  exclusive  boolean     not null default false,
  active     boolean     not null default true,
  sort       int         not null default 0,
  notes      text,
  created_at timestamptz not null default now(),
  unique (hotel_id, name),
  unique (id, hotel_id)
);

create table if not exists service_bookings (
  id             uuid        not null default gen_random_uuid() primary key,
  hotel_id       uuid        not null references hotels(id) on delete cascade,
  service_id     uuid        not null,
  customer_name  text        not null check (length(trim(customer_name)) between 1 and 80),
  phone          text,
  starts_on      date        not null,
  ends_on        date        not null,
  start_time     time,
  end_time       time,
  quantity       int         not null default 1 check (quantity between 1 and 10000),
  amount         numeric     not null check (amount >= 0),
  paid           numeric     not null default 0 check (paid >= 0),
  status         text        not null default 'booked' check (status in ('booked', 'cancelled')),
  source         text,
  notes          text,
  created_by     text,
  created_at     timestamptz not null default now(),
  cancelled_at   timestamptz,
  cancelled_by   text,
  cancel_reason  text,
  check (ends_on >= starts_on),
  -- a booking can only point at a service of its own hotel; a service with bookings cannot be deleted (switch it off instead)
  foreign key (service_id, hotel_id) references hotel_services (id, hotel_id)
);
create index if not exists service_bookings_hotel_idx   on service_bookings (hotel_id, starts_on);
create index if not exists service_bookings_service_idx on service_bookings (service_id, starts_on, ends_on) where status = 'booked';

-- ---------------------------------------------------------------- row-level security
alter table hotel_services   enable row level security;
alter table service_bookings enable row level security;
drop policy if exists staff_read on hotel_services;
drop policy if exists staff_read on service_bookings;
drop policy if exists manager_write_services  on hotel_services;
drop policy if exists manager_update_services on hotel_services;
drop policy if exists manager_delete_services on hotel_services;
create policy staff_read on hotel_services   for select to authenticated using (is_hotel_staff(hotel_id));
create policy staff_read on service_bookings for select to authenticated using (is_hotel_staff(hotel_id));
create policy manager_write_services  on hotel_services for insert to authenticated with check (has_role(hotel_id, 'manager'));
create policy manager_update_services on hotel_services for update to authenticated using (has_role(hotel_id, 'manager')) with check (has_role(hotel_id, 'manager'));
create policy manager_delete_services on hotel_services for delete to authenticated using (has_role(hotel_id, 'manager'));
-- bookings are written only by the functions below (they check the hotel, the role and the clash rule)
revoke all on hotel_services, service_bookings from anon;
grant select on hotel_services, service_bookings to authenticated;
grant insert, update, delete on hotel_services to authenticated;
grant all on hotel_services, service_bookings to service_role;

-- the dashboard updates live
do $$
declare t text;
begin
  foreach t in array array['hotel_services', 'service_bookings'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- functions
-- Book a service. Returns {ok:true,...} or {ok:false, reason: name | service | dates | times | quantity | amount | taken}.
create or replace function staff_create_service_booking(p_hotel uuid, p_service uuid, p_name text, p_phone text, p_start date, p_end date,
                                                        p_start_time time default null, p_end_time time default null, p_quantity int default 1,
                                                        p_amount numeric default null, p_paid numeric default 0, p_source text default 'walk-in',
                                                        p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_svc    hotel_services%rowtype;
  v_today  date := (now() at time zone hotel_tz(p_hotel))::date;
  v_end    date := coalesce(p_end, p_start);
  v_amount numeric;
  v_clash  service_bookings%rowtype;
  v_row    service_bookings%rowtype;
  v_source text := case when p_source in ('walk-in', 'phone', 'online', 'other') then p_source else 'other' end;
begin
  if not is_hotel_staff(p_hotel) then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(trim(p_name), '') = '' then return jsonb_build_object('ok', false, 'reason', 'name'); end if;
  select * into v_svc from hotel_services where id = p_service and hotel_id = p_hotel and active;
  if not found then return jsonb_build_object('ok', false, 'reason', 'service'); end if;
  if p_start is null or p_start < v_today or v_end < p_start or v_end - p_start > 366 then return jsonb_build_object('ok', false, 'reason', 'dates'); end if;
  if p_start_time is not null and p_end_time is not null and v_end = p_start and p_end_time <= p_start_time then return jsonb_build_object('ok', false, 'reason', 'times'); end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 10000 then return jsonb_build_object('ok', false, 'reason', 'quantity'); end if;
  v_amount := round(coalesce(p_amount, v_svc.price * p_quantity), 2);
  if v_amount < 0 or v_amount > 1000000000 or coalesce(p_paid, 0) < 0 or coalesce(p_paid, 0) > v_amount then return jsonb_build_object('ok', false, 'reason', 'amount'); end if;

  perform pg_advisory_xact_lock(hashtext('svc:' || p_service::text));
  if v_svc.exclusive then
    select * into v_clash from service_bookings
    where service_id = p_service and status = 'booked' and starts_on <= v_end and ends_on >= p_start
    order by starts_on limit 1;
    if found then
      return jsonb_build_object('ok', false, 'reason', 'taken', 'service', v_svc.name, 'from', v_clash.starts_on, 'to', v_clash.ends_on);
    end if;
  end if;

  insert into service_bookings (hotel_id, service_id, customer_name, phone, starts_on, ends_on, start_time, end_time, quantity, amount, paid, source, notes, created_by)
  values (p_hotel, p_service, left(trim(p_name), 80), norm_phone(p_phone), p_start, v_end, p_start_time, p_end_time, p_quantity, v_amount, coalesce(p_paid, 0), v_source,
          left(nullif(trim(coalesce(p_notes, '')), ''), 300), jwt_email())
  returning * into v_row;
  return jsonb_build_object('ok', true, 'id', v_row.id, 'ref', upper(left(v_row.id::text, 8)), 'service', v_svc.name, 'customer', v_row.customer_name, 'amount', v_row.amount);
end
$$;

-- Cancel a booking (a manager's call, like cancelling a room stay).
create or replace function staff_cancel_service_booking(p_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_b service_bookings%rowtype;
begin
  if not is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_b from service_bookings where id = p_id and is_hotel_staff(hotel_id) for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not has_role(v_b.hotel_id, 'manager') then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_b.status = 'cancelled' then return jsonb_build_object('ok', false, 'reason', 'already'); end if;
  update service_bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = jwt_email(), cancel_reason = left(nullif(trim(coalesce(p_reason, '')), ''), 200)
  where id = p_id;
  return jsonb_build_object('ok', true, 'ref', upper(left(p_id::text, 8)));
end
$$;

-- Record money received (or a refund, as a negative amount). The total paid never goes below zero.
create or replace function staff_service_payment(p_id uuid, p_amount numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_b service_bookings%rowtype; v_paid numeric;
begin
  if not is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 1000000000 then return jsonb_build_object('ok', false, 'reason', 'amount'); end if;
  select * into v_b from service_bookings where id = p_id and is_hotel_staff(hotel_id) for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_b.status = 'cancelled' then return jsonb_build_object('ok', false, 'reason', 'cancelled'); end if;
  v_paid := round(v_b.paid + p_amount, 2);
  if v_paid < 0 then return jsonb_build_object('ok', false, 'reason', 'amount'); end if;
  update service_bookings set paid = v_paid where id = p_id;
  return jsonb_build_object('ok', true, 'paid', v_paid, 'amount', v_b.amount);
end
$$;

-- ---------------------------------------------------------------- who may call what
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
           and p.proname in ('staff_create_service_booking', 'staff_cancel_service_booking', 'staff_service_payment') loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;
