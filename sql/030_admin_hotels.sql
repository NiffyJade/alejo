-- Alejo admin: every hotel on one page, each with an on/off switch (run after 029; safe to re-run).
--
-- A hotel that is switched off (hotels.active = false) is ignored by its Telegram bot (hotel_by_secret finds only hotels that are on)
-- and skipped by the 15-minute scheduler: no replies, no reminders, no alerts. Its dashboard still opens and its data is kept.
-- Only Alejo's own admins (platform_admins) can list every hotel or flip the switch; a hotel's owner cannot switch their own hotel.
-- Each change records who made it and when.

alter table hotels add column if not exists active_changed_at timestamptz;
alter table hotels add column if not exists active_changed_by text;

-- ---------------------------------------------------------------- every hotel, with what an admin needs before switching it on
create or replace function admin_hotels() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not coalesce(is_platform_admin(), false) then
    raise exception 'Only Alejo admins can see every hotel.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb) into v
  from (
    select jsonb_build_object(
      'id', h.id, 'slug', h.slug, 'name', h.name, 'timezone', h.timezone, 'active', h.active,
      'active_changed_at', h.active_changed_at, 'active_changed_by', h.active_changed_by, 'created_at', h.created_at,
      'bot_username', h.bot_username,
      'bot_token', exists (select 1 from hotel_secrets s where s.hotel_id = h.id and s.telegram_bot_token is not null),
      'staff_group', h.staff_chat_id is not null,
      'staff', (select jsonb_build_object(
                  'owner',   count(*) filter (where u.role = 'owner'),
                  'manager', count(*) filter (where u.role = 'manager'),
                  'staff',   count(*) filter (where u.role = 'staff'))
                from staff_users u where u.hotel_id = h.id),
      'room_types', (select count(*) from room_types r where r.hotel_id = h.id and r.active),
      'rooms', (select coalesce(sum(r.total_rooms), 0) from room_types r where r.hotel_id = h.id and r.active),
      'facts_missing', (select count(*) from (values ('HOTEL_NAME'), ('HOTEL_ADDRESS'), ('HOTEL_PHONE'), ('CHECKIN_TIME'), ('CHECKOUT_TIME')) k(key)
                        where not exists (select 1 from hotel_settings s where s.hotel_id = h.id and s.key = k.key and trim(coalesce(s.value, '')) <> '')),
      'bookings_30d', (select count(*) from bookings b where b.hotel_id = h.id and b.created_at > now() - interval '30 days'),
      'last_guest_message', (select max(m.created_at) from messages m where m.hotel_id = h.id and m.direction = 'in')
    ) as x
    from hotels h
  ) t;
  return v;
end $$;

-- ---------------------------------------------------------------- the switch
create or replace function admin_set_hotel_active(p_hotel uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v hotels%rowtype;
begin
  if not coalesce(is_platform_admin(), false) then
    raise exception 'Only Alejo admins can switch a hotel on or off.' using errcode = '42501';
  end if;
  update hotels set active = coalesce(p_on, false), active_changed_at = now(), active_changed_by = jwt_email()
  where id = p_hotel returning * into v;
  if not found then raise exception 'There is no such hotel.' using errcode = 'P0002'; end if;
  return jsonb_build_object('ok', true, 'id', v.id, 'slug', v.slug, 'active', v.active, 'active_changed_at', v.active_changed_at, 'active_changed_by', v.active_changed_by);
end $$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
           and p.proname in ('admin_hotels', 'admin_set_hotel_active') loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;
