-- 021: many hotels in one Alejo.  Every hotel's data carries a hotel_id; staff only ever see their own hotel(s).
--
-- Run as ONE statement batch (it is atomic: if anything fails, nothing is applied):
--   python -I execution/supabase_admin.py sql sql/021_multi_hotel.sql
-- Then, once the n8n workflows, edge functions and dashboard pass a hotel (phase B and C), run sql/022_multi_hotel_seal.sql.
--
-- TRANSITION (removed by 022): every hotel_id has a temporary default (the existing BrightSide hotel) and the old function
-- signatures still exist as thin wrappers that act on BrightSide, so the live bot and dashboard keep working while they are
-- moved over. Nothing here adds a second hotel; do that only after 022.

-- ============================================================ hotels
create table if not exists hotels (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}$'),   -- used in the bot webhook address and the dashboard
  name           text not null,
  timezone       text not null default 'Africa/Lagos',
  active         boolean not null default true,
  staff_chat_id  bigint,                  -- the hotel's Telegram staff group
  bot_username   text,
  created_at     timestamptz not null default now()
);
alter table hotels enable row level security;

-- one place for every secret a hotel has (bot token ...). RLS on and NO policy and no grants: only the service role can read it.
create table if not exists hotel_secrets (
  hotel_id                uuid primary key references hotels(id) on delete cascade,
  telegram_bot_token      text,
  telegram_webhook_secret text,
  vapi_assistant_id       text,
  updated_at              timestamptz not null default now()
);
alter table hotel_secrets enable row level security;
revoke all on hotel_secrets from anon, authenticated;

create table if not exists platform_admins (email text primary key check (email = lower(email)));
alter table platform_admins enable row level security;
revoke all on platform_admins from anon, authenticated;

-- the one hotel that exists today (test data); a fixed id so the transition defaults can name it
create or replace function legacy_hotel() returns uuid language sql immutable as $$ select '00000000-0000-4000-8000-000000000001'::uuid $$;

insert into hotels (id, slug, name)
values (legacy_hotel(), 'brightside', coalesce((select value from hotel_settings where key = 'HOTEL_NAME' and value <> ''), 'BrightSide Hotel'))
on conflict (id) do nothing;

insert into platform_admins (email)
select lower(email) from staff_users where role = 'owner'
on conflict do nothing;

-- ============================================================ who may do what
create or replace function jwt_email() returns text language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where email = jwt_email())
$$;

-- staff members belong to a hotel; a person working at two hotels has two rows
alter table staff_users add column if not exists hotel_id uuid not null default legacy_hotel() references hotels(id) on delete cascade;
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'staff_users_pkey' and conrelid = 'staff_users'::regclass
             and pg_get_constraintdef(oid) = 'PRIMARY KEY (email)') then
    alter table staff_users drop constraint staff_users_pkey;
    alter table staff_users add primary key (hotel_id, email);
  end if;
end $$;

create or replace function is_hotel_staff(p_hotel uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_hotel is not null and (
    is_platform_admin()
    or exists (select 1 from staff_users s where s.hotel_id = p_hotel and lower(s.email) = jwt_email()))
$$;

-- staff of ANY hotel (kept for the transition; 022 drops it)
create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select is_platform_admin() or exists (select 1 from staff_users where lower(email) = jwt_email())
$$;

create or replace function hotel_tz(p_hotel uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select timezone from hotels where id = p_hotel), 'Africa/Lagos')
$$;

-- ============================================================ hotel_id on every hotel table
do $$
declare t text;
begin
  foreach t in array array['hotel_settings','knowledge_entries','guests','bookings','escalations','messages',
                           'room_types','room_blocks','booking_payments','booking_drafts','bot_typing'] loop
    execute format('alter table %I add column if not exists hotel_id uuid not null default legacy_hotel() references hotels(id) on delete cascade', t);
  end loop;
end $$;

-- composite keys: an id/name/chat is unique PER HOTEL (the old single-column keys stay until 022 so the old workflows still upsert)
create unique index if not exists hotel_settings_hk     on hotel_settings (hotel_id, key);
create unique index if not exists knowledge_entries_hk  on knowledge_entries (hotel_id, id);
create unique index if not exists room_types_hk         on room_types (hotel_id, name);
create unique index if not exists booking_drafts_hk     on booking_drafts (hotel_id, chat_id);
create unique index if not exists bot_typing_hk         on bot_typing (hotel_id, chat_id);
create unique index if not exists guests_hotel_chat_hk  on guests (hotel_id, telegram_chat_id);
create unique index if not exists guests_id_hotel_hk    on guests (id, hotel_id);
create unique index if not exists bookings_id_hotel_hk  on bookings (id, hotel_id);

-- Links between rows must stay inside one hotel: the database refuses a booking for another hotel's guest, a payment on another
-- hotel's booking, a room block for another hotel's room type, and so on.
alter table bookings         drop constraint if exists bookings_guest_id_fkey;
alter table bookings         drop constraint if exists bookings_guest_hotel_fk;
alter table bookings         add  constraint bookings_guest_hotel_fk foreign key (guest_id, hotel_id) references guests (id, hotel_id) on delete cascade;
alter table booking_payments drop constraint if exists booking_payments_booking_id_fkey;
alter table booking_payments drop constraint if exists booking_payments_booking_hotel_fk;
alter table booking_payments add  constraint booking_payments_booking_hotel_fk foreign key (booking_id, hotel_id) references bookings (id, hotel_id) on delete cascade;
alter table room_blocks      drop constraint if exists room_blocks_room_type_fkey;
alter table room_blocks      drop constraint if exists room_blocks_room_hotel_fk;
alter table room_blocks      add  constraint room_blocks_room_hotel_fk foreign key (hotel_id, room_type) references room_types (hotel_id, name) on update cascade on delete cascade;
alter table escalations      drop constraint if exists escalations_booking_id_fkey;
alter table escalations      drop constraint if exists escalations_guest_id_fkey;
alter table escalations      drop constraint if exists escalations_booking_hotel_fk;
alter table escalations      drop constraint if exists escalations_guest_hotel_fk;
alter table escalations      add  constraint escalations_booking_hotel_fk foreign key (booking_id, hotel_id) references bookings (id, hotel_id) on delete set null (booking_id);
alter table escalations      add  constraint escalations_guest_hotel_fk   foreign key (guest_id, hotel_id)   references guests (id, hotel_id)   on delete set null (guest_id);
alter table messages         drop constraint if exists messages_guest_id_fkey;
alter table messages         drop constraint if exists messages_guest_hotel_fk;
alter table messages         add  constraint messages_guest_hotel_fk foreign key (guest_id, hotel_id) references guests (id, hotel_id) on delete set null (guest_id);

-- indexes that lead with the hotel (the dashboard and scheduler always ask "for this hotel")
create index if not exists guests_hotel_phone_idx      on guests (hotel_id, phone);
create index if not exists bookings_hotel_status_idx   on bookings (hotel_id, status, check_in);
create index if not exists escalations_hotel_idx       on escalations (hotel_id, status, created_at);
create index if not exists messages_hotel_chat_idx     on messages (hotel_id, chat_id, created_at);
create index if not exists room_blocks_hotel_idx       on room_blocks (hotel_id, room_type, start_date, end_date);

-- ============================================================ row-level security: staff see only their hotel(s)
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public'
           and tablename in ('hotel_settings','knowledge_entries','guests','bookings','escalations','messages','room_types',
                             'room_blocks','booking_payments','demo_requests','staff_users','hotels') loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['guests','bookings','escalations','messages','room_types','room_blocks','booking_payments','hotel_settings','knowledge_entries'] loop
    execute format('create policy staff_read on %I for select to authenticated using (is_hotel_staff(hotel_id))', t);
  end loop;
end $$;

create policy staff_update_escalations on escalations     for update to authenticated using (is_hotel_staff(hotel_id)) with check (is_hotel_staff(hotel_id));
create policy staff_update_settings    on hotel_settings  for update to authenticated using (is_hotel_staff(hotel_id)) with check (is_hotel_staff(hotel_id));
create policy staff_write_settings     on hotel_settings  for insert to authenticated with check (is_hotel_staff(hotel_id));
create policy staff_update_kb          on knowledge_entries for update to authenticated using (is_hotel_staff(hotel_id)) with check (is_hotel_staff(hotel_id));
create policy staff_write_kb           on knowledge_entries for insert to authenticated with check (is_hotel_staff(hotel_id));
create policy staff_delete_kb          on knowledge_entries for delete to authenticated using (is_hotel_staff(hotel_id));

-- demo requests are Alejo's own sales leads: platform admins only, never a hotel's staff
create policy admin_read_demo   on demo_requests for select to authenticated using (is_platform_admin());
create policy admin_update_demo on demo_requests for update to authenticated using (is_platform_admin()) with check (is_platform_admin());

create policy staff_read_hotel  on hotels      for select to authenticated using (is_hotel_staff(id));
create policy admin_update_hotel on hotels     for update to authenticated using (is_platform_admin()) with check (is_platform_admin());
create policy staff_read_self   on staff_users for select to authenticated using (lower(email) = jwt_email() or is_platform_admin());

-- ============================================================ functions (the hotel is always the first argument)
-- Free rooms of one type in one hotel over [p_in, p_out)
create or replace function rooms_free(p_hotel uuid, p_type text, p_in date, p_out date, p_exclude uuid default null)
returns integer language sql stable as $$
  select greatest(0, rt.total_rooms - coalesce(max(occ.n), 0))::int
  from room_types rt
  left join lateral (
    select (select count(*) from bookings b
            where b.hotel_id = rt.hotel_id and b.room_type = rt.name and b.status in ('booked', 'checked_in')
              and b.check_in <= d::date and b.check_out > d::date
              and (p_exclude is null or b.id <> p_exclude))
         + coalesce((select sum(rb.rooms) from room_blocks rb
                     where rb.hotel_id = rt.hotel_id and rb.room_type = rt.name and rb.start_date <= d::date and rb.end_date > d::date), 0) as n
    from generate_series(p_in::timestamp, (p_out - 1)::timestamp, interval '1 day') d
  ) occ on true
  where rt.hotel_id = p_hotel and rt.name = p_type
  group by rt.total_rooms
$$;

create or replace function room_availability(p_hotel uuid, p_check_in date, p_check_out date, p_room_type text default null)
returns table (room_type text, available_rooms integer, nightly_rate numeric) language sql stable as $$
  select rt.name, rooms_free(p_hotel, rt.name, p_check_in, p_check_out), rt.nightly_rate
  from room_types rt
  where rt.hotel_id = p_hotel and rt.active and (p_room_type is null or lower(rt.name) = lower(p_room_type))
  order by rt.nightly_rate nulls last, rt.name
$$;

create or replace function bot_availability(p_hotel uuid, p_check_in date, p_check_out date, p_room_type text default null, p_chat_id bigint default null)
returns table (room_type text, available_rooms integer, nightly_rate numeric) language plpgsql as $$
begin
  if p_chat_id is not null then
    update bot_typing set finished_at = now() where hotel_id = p_hotel and chat_id = p_chat_id;
  end if;
  return query select * from room_availability(p_hotel, p_check_in, p_check_out, p_room_type);
end
$$;

create or replace function bot_context(p_hotel uuid, p_chat_id bigint) returns jsonb language sql stable as $$
  with g as (select id, name, phone from guests where hotel_id = p_hotel and telegram_chat_id = p_chat_id)
  select jsonb_build_object(
    'hotel', (select jsonb_build_object('id', h.id, 'slug', h.slug, 'name', h.name, 'timezone', h.timezone) from hotels h where h.id = p_hotel),
    'guest', (select to_jsonb(g) || jsonb_build_object('bookings', coalesce((
                select jsonb_agg(jsonb_build_object('id', b.id, 'room_number', b.room_number, 'room_type', b.room_type,
                                                    'check_in', b.check_in, 'check_out', b.check_out, 'status', b.status))
                from bookings b where b.hotel_id = p_hotel and b.guest_id = g.id), '[]'::jsonb)) from g),
    'draft', (select to_jsonb(d) - 'hotel_id' from booking_drafts d where d.hotel_id = p_hotel and d.chat_id = p_chat_id),
    'knowledge', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'category', category, 'question', question, 'answer', answer))
                           from knowledge_entries where hotel_id = p_hotel), '[]'::jsonb),
    'settings', coalesce((select jsonb_object_agg(key, value) from hotel_settings where hotel_id = p_hotel), '{}'::jsonb),
    'rooms', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'nightly_rate', nightly_rate) order by nightly_rate nulls last)
                       from room_types where hotel_id = p_hotel and active), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('direction', direction, 'text', text) order by created_at desc)
                         from (select direction, text, created_at from messages
                               where hotel_id = p_hotel and guest_id = (select id from g) order by created_at desc limit 6) m), '[]'::jsonb),
    'open_items', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'category', category, 'question', left(question, 120),
                                                                'created_at', created_at, 'chase_count', chase_count,
                                                                'last_chased_at', last_chased_at, 'assigned_to', assigned_to) order by created_at)
                            from escalations where hotel_id = p_hotel and guest_chat_id = p_chat_id and status = 'open'), '[]'::jsonb)
  )
$$;

create or replace function telegram_book_room(p_hotel uuid, p_chat_id bigint, p_name text, p_phone text, p_verified boolean, p_room_type text, p_check_in date, p_check_out date)
returns jsonb language plpgsql as $$
declare
  v_rt      room_types%rowtype;
  v_guest   guests%rowtype;
  v_booking bookings%rowtype;
  v_digits  text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  v_today   date := (now() at time zone hotel_tz(p_hotel))::date;
  v_open    int;
begin
  if not exists (select 1 from hotels where id = p_hotel and active) then
    return jsonb_build_object('ok', false, 'reason', 'hotel');
  end if;
  if p_check_in is null or p_check_out is null or p_check_out <= p_check_in
     or p_check_in < v_today or p_check_out - p_check_in > 30 then
    return jsonb_build_object('ok', false, 'reason', 'dates');
  end if;

  select * into v_rt from room_types where hotel_id = p_hotel and active and lower(name) = lower(coalesce(p_room_type, ''));
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'room_type');
  end if;

  perform pg_advisory_xact_lock(hashtext('room:' || p_hotel::text || ':' || v_rt.name));   -- same lock as every other way of booking

  if rooms_free(p_hotel, v_rt.name, p_check_in, p_check_out) < 1 then
    return jsonb_build_object('ok', false, 'reason', 'sold_out', 'room_type', v_rt.name);
  end if;

  -- Who is booking: the guest already linked to this chat. A guest found only by a typed phone number is NOT linked
  -- (anyone could type someone else's number and start receiving their stay code); only a number shared with
  -- Telegram's own button (p_verified) may link a guest who booked earlier by phone.
  select * into v_guest from guests where hotel_id = p_hotel and telegram_chat_id = p_chat_id;
  if not found and p_verified and length(v_digits) >= 7 then
    select * into v_guest from guests
    where hotel_id = p_hotel and telegram_chat_id is null and phone like '%' || v_digits
    order by created_at limit 1;
    if found then
      update guests set telegram_chat_id = p_chat_id where id = v_guest.id;
    end if;
  end if;
  if v_guest.id is null then
    if coalesce(trim(p_name), '') = '' then
      return jsonb_build_object('ok', false, 'reason', 'name');
    end if;
    insert into guests (hotel_id, name, phone, telegram_chat_id)
    values (p_hotel, left(trim(p_name), 80), nullif(p_phone, ''), p_chat_id)
    returning * into v_guest;
  end if;

  -- a person cannot hold more than 3 upcoming reservations through the bot
  select count(*) into v_open from bookings
  where hotel_id = p_hotel and guest_id = v_guest.id and status = 'booked' and check_out >= v_today;
  if v_open >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'limit');
  end if;

  insert into bookings (hotel_id, guest_id, room_type, check_in, check_out, source)
  values (p_hotel, v_guest.id, v_rt.name, p_check_in, p_check_out, 'telegram')
  returning * into v_booking;

  delete from booking_drafts where hotel_id = p_hotel and chat_id = p_chat_id;

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

create or replace function phone_book_room(p_hotel uuid, p_name text, p_phone text, p_email text, p_room_type text, p_check_in date, p_check_out date)
returns jsonb language plpgsql as $$
declare
  v_rt      room_types%rowtype;
  v_guest   guests%rowtype;
  v_booking bookings%rowtype;
  v_digits  text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  v_today   date := (now() at time zone hotel_tz(p_hotel))::date;
begin
  if not exists (select 1 from hotels where id = p_hotel and active) then
    return jsonb_build_object('ok', false, 'reason', 'hotel');
  end if;
  if p_check_in is null or p_check_out is null or p_check_out <= p_check_in
     or p_check_in < v_today or p_check_out - p_check_in > 30 then
    return jsonb_build_object('ok', false, 'reason', 'dates');
  end if;
  if coalesce(trim(p_name), '') = '' or length(v_digits) < 7 then
    return jsonb_build_object('ok', false, 'reason', 'details');
  end if;

  select * into v_rt from room_types where hotel_id = p_hotel and active and lower(name) = lower(coalesce(p_room_type, ''));
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'room_type');
  end if;

  perform pg_advisory_xact_lock(hashtext('room:' || p_hotel::text || ':' || v_rt.name));   -- same lock as every other way of booking

  if rooms_free(p_hotel, v_rt.name, p_check_in, p_check_out) < 1 then
    return jsonb_build_object('ok', false, 'reason', 'sold_out', 'room_type', v_rt.name);
  end if;

  -- a caller is the guest with that number (last 10 digits), created if new
  select * into v_guest from guests where hotel_id = p_hotel and phone like '%' || v_digits order by created_at limit 1;
  if not found then
    insert into guests (hotel_id, name, phone, email)
    values (p_hotel, left(trim(p_name), 80), p_phone, nullif(p_email, ''))
    returning * into v_guest;
  end if;

  insert into bookings (hotel_id, guest_id, room_type, check_in, check_out, source)
  values (p_hotel, v_guest.id, v_rt.name, p_check_in, p_check_out, 'phone')
  returning * into v_booking;

  return jsonb_build_object('ok', true, 'booking_id', v_booking.id, 'ref', upper(left(v_booking.id::text, 8)),
    'room_type', v_rt.name, 'rate', v_rt.nightly_rate, 'nights', p_check_out - p_check_in);
end
$$;

create or replace function record_rating(p_hotel uuid, p_booking_id uuid, p_chat_id bigint, p_rating integer)
returns jsonb language plpgsql as $$
declare
  v_b    bookings%rowtype;
  v_g    guests%rowtype;
  v_prev int;
  v_esc  uuid;
begin
  if p_rating is null or p_rating not between 1 and 5 then return jsonb_build_object('ok', false, 'reason', 'rating'); end if;
  select * into v_b from bookings where id = p_booking_id and hotel_id = p_hotel for update;     -- another hotel's booking is simply "not found"
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into v_g from guests where id = v_b.guest_id;
  -- only the guest whose Telegram chat is linked to the booking can rate it
  if v_g.telegram_chat_id is distinct from p_chat_id then return jsonb_build_object('ok', false, 'reason', 'not_yours'); end if;
  if v_b.status <> 'checked_out' then return jsonb_build_object('ok', false, 'reason', 'not_finished'); end if;
  if v_b.checked_out_at is not null and v_b.checked_out_at < now() - interval '14 days' then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  v_prev := v_b.rating;
  update bookings set rating = p_rating, rated_at = now() where id = p_booking_id;

  if p_rating <= 3 and not exists (select 1 from escalations where hotel_id = p_hotel and booking_id = p_booking_id and question like 'Rated their stay%') then
    insert into escalations (hotel_id, booking_id, guest_id, guest_chat_id, question, kind, category)
    values (p_hotel, p_booking_id, v_g.id, p_chat_id, 'Rated their stay ' || p_rating || ' out of 5', 'complaint', 'other')
    returning id into v_esc;
  end if;

  return jsonb_build_object('ok', true, 'rating', p_rating, 'previous', v_prev, 'new_item', v_esc is not null, 'escalation_id', v_esc,
    'guest_name', v_g.name, 'room_type', v_b.room_type, 'room_number', v_b.room_number, 'check_in', v_b.check_in, 'check_out', v_b.check_out);
end
$$;

create or replace function ratings_summary(p_hotel uuid, p_days integer default 7) returns jsonb language plpgsql stable as $$
declare
  v_days       int := least(greatest(coalesce(p_days, 7), 1), 365);
  v_since      timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 365));
  v_prev_since timestamptz := now() - make_interval(days => 2 * least(greatest(coalesce(p_days, 7), 1), 365));
  v_out        jsonb;
begin
  select jsonb_build_object(
    'days', v_days,
    'rated', count(*),
    'asked', (select count(*) from bookings where hotel_id = p_hotel and rating_prompted_at >= v_since),
    'average', round(avg(b.rating)::numeric, 1),
    'previous_average', (select round(avg(rating)::numeric, 1) from bookings where hotel_id = p_hotel and rated_at >= v_prev_since and rated_at < v_since),
    'previous_rated', (select count(*) from bookings where hotel_id = p_hotel and rated_at >= v_prev_since and rated_at < v_since),
    'distribution', jsonb_build_object('1', count(*) filter (where b.rating = 1), '2', count(*) filter (where b.rating = 2), '3', count(*) filter (where b.rating = 3),
                                       '4', count(*) filter (where b.rating = 4), '5', count(*) filter (where b.rating = 5)),
    'low_count', count(*) filter (where b.rating <= 3),
    'tracking_since', (select min(rating_prompted_at) from bookings where hotel_id = p_hotel and rating_prompted_at is not null),
    'by_room', coalesce((select jsonb_agg(jsonb_build_object('room_type', x.t, 'average', x.a, 'count', x.c) order by x.t)
                         from (select room_type as t, round(avg(rating)::numeric, 1) as a, count(*) as c
                               from bookings where hotel_id = p_hotel and rated_at >= v_since group by room_type) x), '[]'::jsonb),
    'low', coalesce(jsonb_agg(jsonb_build_object('booking_id', b.id, 'guest_id', g.id, 'name', g.name, 'room_type', b.room_type, 'room_number', b.room_number,
                              'check_in', b.check_in, 'check_out', b.check_out, 'rating', b.rating, 'rated_at', b.rated_at,
                              'item_open', exists (select 1 from escalations e where e.hotel_id = p_hotel and e.booking_id = b.id and e.status = 'open' and e.question like 'Rated their stay%'))
                              order by b.rated_at desc) filter (where b.rating <= 3), '[]'::jsonb)
  ) into v_out
  from bookings b join guests g on g.id = b.guest_id
  where b.hotel_id = p_hotel and b.rated_at >= v_since;
  return v_out;
end
$$;

create or replace function ratings_report(p_hotel uuid, p_days integer default 7) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_hotel_staff(p_hotel) then raise exception 'not allowed' using errcode = '42501'; end if;
  return ratings_summary(p_hotel, p_days);
end
$$;

create or replace function daily_digest(p_hotel uuid) returns jsonb language plpgsql stable as $$
declare
  v_tz    text := hotel_tz(p_hotel);
  v_today date := (now() at time zone hotel_tz(p_hotel))::date;
  v_since timestamptz := now() - interval '24 hours';
  v_out   jsonb;
begin
  with stays as (
    -- every stay still to come or in progress, with what the guest still owes (nights x rate minus payments recorded)
    select b.id, b.status, b.check_in, b.check_out, b.room_type, b.room_number, g.name,
           greatest(0, (b.check_out - b.check_in) * coalesce(rt.nightly_rate, 0)
                       - coalesce((select sum(p.amount) from booking_payments p where p.booking_id = b.id), 0)) as balance
    from bookings b join guests g on g.id = b.guest_id left join room_types rt on rt.hotel_id = b.hotel_id and rt.name = b.room_type
    where b.hotel_id = p_hotel and b.status in ('booked', 'checked_in')
  ), fresh as (
    select b.source, (b.check_out - b.check_in) * coalesce(rt.nightly_rate, 0) as value
    from bookings b left join room_types rt on rt.hotel_id = b.hotel_id and rt.name = b.room_type
    where b.hotel_id = p_hotel and b.created_at >= v_since and b.status <> 'cancelled'
  )
  select jsonb_build_object(
    'today', v_today,
    'rooms_total', (select coalesce(sum(total_rooms), 0) from room_types where hotel_id = p_hotel and active),
    'in_house', (select count(*) from bookings where hotel_id = p_hotel and status = 'checked_in'),
    'free_tonight', coalesce((select jsonb_agg(jsonb_build_object('room_type', rt.name, 'free', rooms_free(p_hotel, rt.name, v_today, v_today + 1))
                                               order by rt.nightly_rate nulls last, rt.name) from room_types rt where rt.hotel_id = p_hotel and rt.active), '[]'::jsonb),
    'arriving', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'room_type', room_type, 'room_number', room_number, 'balance', balance) order by name)
                          from stays where status = 'booked' and check_in = v_today), '[]'::jsonb),
    'leaving', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'room_type', room_type, 'room_number', room_number, 'balance', balance) order by name)
                         from stays where status = 'checked_in' and check_out = v_today), '[]'::jsonb),
    'unpaid_count', (select count(*) from stays where balance > 0 and (status = 'checked_in' or (status = 'booked' and check_in = v_today))),
    'unpaid_sum', (select coalesce(sum(balance), 0) from stays where balance > 0 and (status = 'checked_in' or (status = 'booked' and check_in = v_today))),
    'new_bookings', (select count(*) from fresh),
    'new_value', (select coalesce(sum(value), 0) from fresh),
    'by_source', coalesce((select jsonb_object_agg(s, n) from (select coalesce(source, 'other') as s, count(*) as n from fresh group by 1) x), '{}'::jsonb),
    'cancelled', (select count(*) from bookings where hotel_id = p_hotel and cancelled_at >= v_since),
    'payments', (select coalesce(sum(amount), 0) from booking_payments where hotel_id = p_hotel and created_at >= v_since),
    'people_messaged', (select count(distinct chat_id) from messages where hotel_id = p_hotel and direction = 'in' and chat_id is not null and created_at >= v_since),
    'people_asked_rooms', (select count(distinct chat_id) from messages where hotel_id = p_hotel and direction = 'in' and chat_id is not null and intent in ('availability', 'book') and created_at >= v_since),
    'needed_person', (select count(*) from escalations where hotel_id = p_hotel and created_at >= v_since and guest_chat_id is not null and question not like 'Rated their stay%'),
    'open_items', (select count(*) from escalations where hotel_id = p_hotel and status = 'open'),
    'open_service', (select count(*) from escalations where hotel_id = p_hotel and status = 'open' and kind <> 'question'),
    'oldest_open_minutes', (select round(extract(epoch from (now() - min(created_at))) / 60) from escalations where hotel_id = p_hotel and status = 'open')
  ) into v_out;
  return v_out;
end
$$;

create or replace function enquiry_report(p_hotel uuid, p_days integer default 7) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz    text := hotel_tz(p_hotel);
  v_days  int := least(greatest(coalesce(p_days, 7), 1), 90);
  v_since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 90));
  v_out   jsonb;
begin
  if not is_hotel_staff(p_hotel) then raise exception 'not allowed' using errcode = '42501'; end if;

  with inbound as (
    select chat_id, created_at, intent,
           lag(created_at) over (partition by chat_id order by created_at) as prev
    from messages
    where hotel_id = p_hotel and direction = 'in' and chat_id is not null and created_at >= v_since - interval '2 days'
  ), numbered as (
    select *, sum((prev is null or created_at - prev > interval '12 hours')::int) over (partition by chat_id order by created_at) as sess
    from inbound
  ), sessions0 as (
    select chat_id, sess, min(created_at) as started_at, max(created_at) as last_at, count(*) as msgs,
           coalesce(bool_or(intent in ('availability', 'book')), false) as asked_rooms,
           coalesce(bool_or(intent = 'book'), false) as wanted_booking
    from numbered group by chat_id, sess
  ), sessions as (
    select * from sessions0 where started_at >= v_since
  ), enriched as (
    select s.*,
      exists (select 1 from bookings b join guests g on g.id = b.guest_id
              where b.hotel_id = p_hotel and g.telegram_chat_id = s.chat_id and b.source = 'telegram'
                and b.created_at >= s.started_at and b.created_at <= s.last_at + interval '2 days'
                and not exists (select 1 from sessions0 s2 where s2.chat_id = s.chat_id and s2.started_at > s.started_at and s2.started_at <= b.created_at)) as booked,
      exists (select 1 from escalations e
              where e.hotel_id = p_hotel and e.guest_chat_id = s.chat_id and e.created_at >= s.started_at - interval '1 minute' and e.created_at <= s.last_at + interval '1 minute') as escalated,
      exists (select 1 from messages m
              where m.hotel_id = p_hotel and m.chat_id = s.chat_id and m.direction = 'out' and m.intent = 'followup'
                and m.created_at >= s.started_at and m.created_at <= s.last_at + interval '12 hours') as followed_up,
      not (extract(hour from s.started_at at time zone v_tz) between 8 and 20) as after_hours,
      coalesce((select g.name from guests g where g.hotel_id = p_hotel and g.telegram_chat_id = s.chat_id), d.guest_name, d.tg_name) as who,
      d.check_in as want_in, d.check_out as want_out, d.room_type as want_type, d.phone as want_phone
    from sessions s left join booking_drafts d on d.hotel_id = p_hotel and d.chat_id = s.chat_id
  )
  select jsonb_build_object(
    'days', v_days,
    'tracking_since', (select min(created_at) from messages where hotel_id = p_hotel and chat_id is not null and direction = 'in'),
    'enquiries', count(*),
    'asked_rooms', count(*) filter (where asked_rooms),
    'wanted_booking', count(*) filter (where wanted_booking),
    'booked', count(*) filter (where booked),
    'booked_of_room_enquiries', count(*) filter (where asked_rooms and booked),
    'needed_person', count(*) filter (where escalated),
    'answered_alone', count(*) filter (where not escalated),
    'after_hours', count(*) filter (where after_hours),
    'median_staff_reply_minutes', (select round((percentile_cont(0.5) within group (order by extract(epoch from (e.answered_at - e.created_at)) / 60))::numeric, 0)
                                   from escalations e where e.hotel_id = p_hotel and e.created_at >= v_since and e.status = 'answered' and e.answered_at is not null and e.guest_chat_id is not null),
    'followups_sent', (select count(*) from messages m where m.hotel_id = p_hotel and m.direction = 'out' and m.intent = 'followup' and m.created_at >= v_since),
    'booked_after_followup', count(*) filter (where booked and followed_up),
    'lost', count(*) filter (where asked_rooms and not booked and last_at < now() - interval '3 days'),
    'open', coalesce(jsonb_agg(jsonb_build_object('chat_id', chat_id, 'name', who, 'last_at', last_at, 'followed_up', followed_up,
              'check_in', want_in, 'check_out', want_out, 'room_type', want_type, 'phone', want_phone) order by last_at desc)
              filter (where asked_rooms and not booked and last_at >= now() - interval '3 days'), '[]'::jsonb)
  ) into v_out from enriched;

  return v_out;
end
$$;

-- ---------------------------------------------------------------- dashboard actions
-- Actions on one booking / block take no hotel: the row says which hotel it belongs to, and a caller who is not that hotel's staff
-- gets exactly the answer they would get for a row that does not exist.
create or replace function staff_availability(p_hotel uuid, p_check_in date, p_check_out date)
returns table (room_type text, free integer, nightly_rate numeric, total_rooms integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_hotel_staff(p_hotel) then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
    select rt.name, rooms_free(p_hotel, rt.name, p_check_in, p_check_out), rt.nightly_rate, rt.total_rooms
    from room_types rt where rt.hotel_id = p_hotel and rt.active order by rt.nightly_rate nulls last, rt.name;
end
$$;

create or replace function staff_add_block(p_hotel uuid, p_room_type text, p_rooms integer, p_start date, p_end date, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_rt    room_types%rowtype;
  v_today date := (now() at time zone hotel_tz(p_hotel))::date;
  v_free  int;
  v_id    uuid;
begin
  if not is_hotel_staff(p_hotel) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_start is null or p_end is null or p_end <= p_start or p_start < v_today or p_end - p_start > 365 then
    return jsonb_build_object('ok', false, 'reason', 'dates');
  end if;
  select * into v_rt from room_types where hotel_id = p_hotel and lower(name) = lower(coalesce(p_room_type, ''));
  if not found then return jsonb_build_object('ok', false, 'reason', 'room_type'); end if;
  if p_rooms is null or p_rooms < 1 or p_rooms > v_rt.total_rooms then return jsonb_build_object('ok', false, 'reason', 'rooms'); end if;

  perform pg_advisory_xact_lock(hashtext('room:' || p_hotel::text || ':' || v_rt.name));
  v_free := rooms_free(p_hotel, v_rt.name, p_start, p_end);
  if v_free < p_rooms then
    return jsonb_build_object('ok', false, 'reason', 'conflict', 'free', v_free, 'room_type', v_rt.name);   -- existing bookings already use those rooms
  end if;
  insert into room_blocks (hotel_id, room_type, rooms, start_date, end_date, reason, created_by)
  values (p_hotel, v_rt.name, p_rooms, p_start, p_end, left(nullif(trim(coalesce(p_reason, '')), ''), 200), jwt_email())
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end
$$;

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
  v_source  text := case when p_source in ('walk-in', 'phone', 'online', 'other') then p_source else 'other' end;
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

create or replace function staff_cancel_booking(p_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_b bookings%rowtype;
begin
  if not is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_b from bookings where id = p_id and is_hotel_staff(hotel_id) for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_b.status = 'cancelled'   then return jsonb_build_object('ok', false, 'reason', 'already'); end if;
  if v_b.status = 'checked_in'  then return jsonb_build_object('ok', false, 'reason', 'in_house'); end if;
  if v_b.status = 'checked_out' then return jsonb_build_object('ok', false, 'reason', 'done'); end if;
  update bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = jwt_email(),
         cancel_reason = left(nullif(trim(coalesce(p_reason, '')), ''), 200)
  where id = p_id;
  return jsonb_build_object('ok', true, 'ref', upper(left(p_id::text, 8)));
end
$$;

create or replace function staff_record_payment(p_id uuid, p_amount numeric, p_method text default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_b bookings%rowtype; v_total numeric;
begin
  if not is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 100000000 then return jsonb_build_object('ok', false, 'reason', 'amount'); end if;
  select * into v_b from bookings where id = p_id and is_hotel_staff(hotel_id);
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  insert into booking_payments (hotel_id, booking_id, amount, method, note, recorded_by)
  values (v_b.hotel_id, p_id, round(p_amount, 2), left(nullif(trim(coalesce(p_method, '')), ''), 40), left(nullif(trim(coalesce(p_note, '')), ''), 200), jwt_email());
  select coalesce(sum(amount), 0) into v_total from booking_payments where booking_id = p_id;
  return jsonb_build_object('ok', true, 'total_paid', v_total);
end
$$;

create or replace function staff_remove_block(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from room_blocks where id = p_id and is_hotel_staff(hotel_id);
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
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
  select * into v_b from bookings where id = p_id and is_hotel_staff(hotel_id) for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_b.status in ('cancelled', 'checked_out') then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
  if v_room is not null and exists (
       select 1 from bookings b
       where b.hotel_id = v_b.hotel_id and b.id <> p_id and b.room_number = v_room and b.status in ('booked', 'checked_in')
         and b.check_in < v_b.check_out and b.check_out > v_b.check_in) then
    return jsonb_build_object('ok', false, 'reason', 'room_taken');
  end if;
  update bookings set room_number = v_room where id = p_id;
  return jsonb_build_object('ok', true, 'room', v_room);
end
$$;

create or replace function staff_set_status(p_id uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_b bookings%rowtype;
begin
  if not is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_b from bookings where id = p_id and is_hotel_staff(hotel_id) for update;
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

-- ============================================================ TRANSITION wrappers: the old signatures act on the existing hotel (dropped by 022)
create or replace function room_availability(p_check_in date, p_check_out date, p_room_type text default null)
returns table (room_type text, available_rooms integer, nightly_rate numeric) language sql stable as $$
  select * from room_availability(legacy_hotel(), p_check_in, p_check_out, p_room_type)
$$;
create or replace function bot_availability(p_check_in date, p_check_out date, p_room_type text default null, p_chat_id bigint default null)
returns table (room_type text, available_rooms integer, nightly_rate numeric) language sql as $$
  select * from bot_availability(legacy_hotel(), p_check_in, p_check_out, p_room_type, p_chat_id)
$$;
create or replace function bot_context(p_chat_id bigint) returns jsonb language sql stable as $$ select bot_context(legacy_hotel(), p_chat_id) $$;
create or replace function telegram_book_room(p_chat_id bigint, p_name text, p_phone text, p_verified boolean, p_room_type text, p_check_in date, p_check_out date)
returns jsonb language sql as $$ select telegram_book_room(legacy_hotel(), p_chat_id, p_name, p_phone, p_verified, p_room_type, p_check_in, p_check_out) $$;
create or replace function phone_book_room(p_name text, p_phone text, p_email text, p_room_type text, p_check_in date, p_check_out date)
returns jsonb language sql as $$ select phone_book_room(legacy_hotel(), p_name, p_phone, p_email, p_room_type, p_check_in, p_check_out) $$;
create or replace function record_rating(p_booking_id uuid, p_chat_id bigint, p_rating integer)
returns jsonb language sql as $$ select record_rating(legacy_hotel(), p_booking_id, p_chat_id, p_rating) $$;
create or replace function ratings_summary(p_days integer default 7) returns jsonb language sql stable as $$ select ratings_summary(legacy_hotel(), p_days) $$;
create or replace function daily_digest() returns jsonb language sql stable as $$ select daily_digest(legacy_hotel()) $$;
create or replace function ratings_report(p_days integer default 7) returns jsonb language sql stable security definer set search_path = public as $$ select ratings_report(legacy_hotel(), p_days) $$;
create or replace function enquiry_report(p_days integer default 7) returns jsonb language sql stable security definer set search_path = public as $$ select enquiry_report(legacy_hotel(), p_days) $$;
create or replace function staff_availability(p_check_in date, p_check_out date)
returns table (room_type text, free integer, nightly_rate numeric, total_rooms integer) language sql stable security definer set search_path = public as $$
  select * from staff_availability(legacy_hotel(), p_check_in, p_check_out)
$$;
create or replace function staff_add_block(p_room_type text, p_rooms integer, p_start date, p_end date, p_reason text default null)
returns jsonb language sql security definer set search_path = public as $$ select staff_add_block(legacy_hotel(), p_room_type, p_rooms, p_start, p_end, p_reason) $$;
create or replace function staff_create_booking(p_name text, p_phone text, p_room_type text, p_check_in date, p_check_out date, p_source text default 'walk-in',
                                                p_room_number text default null, p_check_in_now boolean default false, p_paid numeric default 0, p_payment_method text default null)
returns jsonb language sql security definer set search_path = public as $$
  select staff_create_booking(legacy_hotel(), p_name, p_phone, p_room_type, p_check_in, p_check_out, p_source, p_room_number, p_check_in_now, p_paid, p_payment_method)
$$;

-- the old single-hotel availability helper has no remaining callers
drop function if exists rooms_free(text, date, date, uuid);

-- ============================================================ who may call what
do $$
declare r record;
begin
  -- the bot, scheduler and phone assistant (service role only)
  for r in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
           and p.proname in ('rooms_free','room_availability','bot_availability','bot_context','telegram_book_room','phone_book_room',
                             'record_rating','ratings_summary','daily_digest','legacy_hotel','norm_phone') loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
  -- the dashboard (signed-in staff; each one checks the hotel itself)
  for r in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
           and p.proname in ('enquiry_report','ratings_report','staff_availability','staff_add_block','staff_create_booking','staff_cancel_booking',
                             'staff_record_payment','staff_remove_block','staff_set_room','staff_set_status',
                             'is_staff','is_hotel_staff','is_platform_admin','jwt_email','hotel_tz') loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;
