-- 026: a payment HISTORY for service bookings (event hall, gym, pool ...), like room stays have. Needs 025.
--   python -I execution/supabase_admin.py sql sql/026_service_payments.sql        (atomic: all or nothing)
--
-- Until now a service booking only kept a running total ("paid"). Now every payment (and refund) is its own row: when, how much, how
-- (cash, transfer, POS), a note, and who recorded it. service_bookings.paid stays as the total, kept equal to the sum of the rows by the
-- functions below (the only things that write to either table). Two function signatures change (they gain a payment method and note),
-- so the dashboard that calls them is deployed together with this file.

create unique index if not exists service_bookings_id_hotel_hk on service_bookings (id, hotel_id);

create table if not exists service_payments (
  id          uuid        not null default gen_random_uuid() primary key,
  hotel_id    uuid        not null references hotels(id) on delete cascade,
  booking_id  uuid        not null,
  amount      numeric     not null check (amount <> 0),            -- a refund is negative
  method      text,
  note        text,
  recorded_by text,
  created_at  timestamptz not null default now(),
  foreign key (booking_id, hotel_id) references service_bookings (id, hotel_id) on delete cascade
);
create index if not exists service_payments_booking_idx on service_payments (booking_id, created_at);

alter table service_payments enable row level security;
drop policy if exists staff_read on service_payments;
create policy staff_read on service_payments for select to authenticated using (is_hotel_staff(hotel_id));
revoke all on service_payments from anon;
grant select on service_payments to authenticated;
grant all on service_payments to service_role;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'service_payments') then
    alter publication supabase_realtime add table public.service_payments;
  end if;
end $$;

-- a booking that already had money recorded keeps it, as one opening payment
insert into service_payments (hotel_id, booking_id, amount, method, recorded_by, created_at)
select sb.hotel_id, sb.id, sb.paid, 'recorded at booking', sb.created_by, sb.created_at
from service_bookings sb
where sb.paid > 0 and not exists (select 1 from service_payments p where p.booking_id = sb.id);

-- ---------------------------------------------------------------- functions (the old signatures go; the new ones add method and note)
drop function if exists staff_create_service_booking(uuid, uuid, text, text, date, date, time, time, int, numeric, numeric, text, text);
drop function if exists staff_service_payment(uuid, numeric);

create or replace function staff_create_service_booking(p_hotel uuid, p_service uuid, p_name text, p_phone text, p_start date, p_end date,
                                                        p_start_time time default null, p_end_time time default null, p_quantity int default 1,
                                                        p_amount numeric default null, p_paid numeric default 0, p_source text default 'walk-in',
                                                        p_notes text default null, p_payment_method text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_svc    hotel_services%rowtype;
  v_today  date := (now() at time zone hotel_tz(p_hotel))::date;
  v_end    date := coalesce(p_end, p_start);
  v_amount numeric;
  v_clash  service_bookings%rowtype;
  v_row    service_bookings%rowtype;
  v_who    text := jwt_email();
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
          left(nullif(trim(coalesce(p_notes, '')), ''), 300), v_who)
  returning * into v_row;
  if coalesce(p_paid, 0) > 0 then
    insert into service_payments (hotel_id, booking_id, amount, method, recorded_by)
    values (p_hotel, v_row.id, p_paid, coalesce(left(nullif(trim(coalesce(p_payment_method, '')), ''), 40), 'recorded at booking'), v_who);
  end if;
  return jsonb_build_object('ok', true, 'id', v_row.id, 'ref', upper(left(v_row.id::text, 8)), 'service', v_svc.name, 'customer', v_row.customer_name, 'amount', v_row.amount);
end
$$;

-- Record money received (or a refund, as a negative amount) with how it was paid. The total paid never goes below zero.
create or replace function staff_service_payment(p_id uuid, p_amount numeric, p_method text default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_b service_bookings%rowtype; v_paid numeric;
begin
  if not is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 1000000000 then return jsonb_build_object('ok', false, 'reason', 'amount'); end if;
  select * into v_b from service_bookings where id = p_id and is_hotel_staff(hotel_id) for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_b.status = 'cancelled' then return jsonb_build_object('ok', false, 'reason', 'cancelled'); end if;
  v_paid := round(coalesce((select sum(amount) from service_payments where booking_id = p_id), 0) + p_amount, 2);
  if v_paid < 0 then return jsonb_build_object('ok', false, 'reason', 'amount'); end if;
  insert into service_payments (hotel_id, booking_id, amount, method, note, recorded_by)
  values (v_b.hotel_id, p_id, round(p_amount, 2), left(nullif(trim(coalesce(p_method, '')), ''), 40), left(nullif(trim(coalesce(p_note, '')), ''), 200), jwt_email());
  update service_bookings set paid = v_paid where id = p_id;
  return jsonb_build_object('ok', true, 'paid', v_paid, 'amount', v_b.amount);
end
$$;

-- ---------------------------------------------------------------- who may call what
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
           and p.proname in ('staff_create_service_booking', 'staff_service_payment') loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;
