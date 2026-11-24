-- 024: what each ROLE may do inside a hotel (staff < manager < owner), plus Alejo's own super admin above all of them.
--   python -I execution/supabase_admin.py sql sql/024_roles.sql        (atomic: all or nothing)
--
--   staff    answer guests (take, resolve, reply), see bookings, add a walk-in booking, check in/out, set a room number, record payments.
--   manager  everything staff can do, plus: change settings and the knowledge base, cancel bookings, block rooms, ratings and enquiry reports.
--   owner    everything a manager can do, plus: see the hotel's team list (adding/removing logins goes through the staff-team function).
--   admin    (a platform admin) everything, in every hotel.
-- Reading hotel data stays open to every role of that hotel (the screens need it); what changes is who may CHANGE things and see the reports.

create or replace function role_rank(p_role text) returns int language sql immutable as $$
  select case p_role when 'staff' then 1 when 'manager' then 2 when 'owner' then 3 when 'admin' then 4 else 0 end
$$;

-- the caller's role in one hotel: 'admin' for a platform admin, else their staff row's role, else null
create or replace function my_role(p_hotel uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when is_platform_admin() then 'admin'
              else (select s.role from staff_users s where s.hotel_id = p_hotel and lower(s.email) = jwt_email()) end
$$;

create or replace function has_role(p_hotel uuid, p_min text) returns boolean
language sql stable security definer set search_path = public as $$
  select role_rank(my_role(p_hotel)) >= role_rank(p_min) and role_rank(my_role(p_hotel)) > 0
$$;

-- ---------------------------------------------------------------- row-level security: only managers and up change settings and knowledge
drop policy if exists staff_update_settings on hotel_settings;
drop policy if exists staff_write_settings  on hotel_settings;
drop policy if exists staff_update_kb       on knowledge_entries;
drop policy if exists staff_write_kb        on knowledge_entries;
drop policy if exists staff_delete_kb       on knowledge_entries;
create policy manager_update_settings on hotel_settings    for update to authenticated using (has_role(hotel_id, 'manager')) with check (has_role(hotel_id, 'manager'));
create policy manager_write_settings  on hotel_settings    for insert to authenticated with check (has_role(hotel_id, 'manager'));
create policy manager_update_kb       on knowledge_entries for update to authenticated using (has_role(hotel_id, 'manager')) with check (has_role(hotel_id, 'manager'));
create policy manager_write_kb        on knowledge_entries for insert to authenticated with check (has_role(hotel_id, 'manager'));
create policy manager_delete_kb       on knowledge_entries for delete to authenticated using (has_role(hotel_id, 'manager'));

-- an owner sees their hotel's whole team (everyone else sees only their own row, as before)
drop policy if exists owner_read_team on staff_users;
create policy owner_read_team on staff_users for select to authenticated using (has_role(hotel_id, 'owner'));

-- ---------------------------------------------------------------- functions: the same check line, now "manager or above"
do $$
declare
  r record; def text; patched text;
begin
  for r in select p.oid from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
           and p.proname in ('enquiry_report', 'ratings_report', 'staff_add_block') and p.pronargs >= 2 loop
    def := pg_get_functiondef(r.oid);
    patched := replace(def, 'if not is_hotel_staff(p_hotel) then', 'if not has_role(p_hotel, ''manager'') then');
    if patched = def then
      raise exception 'could not patch %', r.oid::regprocedure;
    end if;
    execute patched;
  end loop;
end $$;

create or replace function staff_cancel_booking(p_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_b bookings%rowtype;
begin
  if not is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_b from bookings where id = p_id and is_hotel_staff(hotel_id) for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not has_role(v_b.hotel_id, 'manager') then raise exception 'not allowed' using errcode = '42501'; end if;     -- cancelling is a manager's call
  if v_b.status = 'cancelled'   then return jsonb_build_object('ok', false, 'reason', 'already'); end if;
  if v_b.status = 'checked_in'  then return jsonb_build_object('ok', false, 'reason', 'in_house'); end if;
  if v_b.status = 'checked_out' then return jsonb_build_object('ok', false, 'reason', 'done'); end if;
  update bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = jwt_email(),
         cancel_reason = left(nullif(trim(coalesce(p_reason, '')), ''), 200)
  where id = p_id;
  return jsonb_build_object('ok', true, 'ref', upper(left(p_id::text, 8)));
end
$$;

create or replace function staff_remove_block(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_h uuid;
begin
  if not is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  select hotel_id into v_h from room_blocks where id = p_id and is_hotel_staff(hotel_id);
  if v_h is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not has_role(v_h, 'manager') then raise exception 'not allowed' using errcode = '42501'; end if;               -- blocking rooms is a manager's call
  delete from room_blocks where id = p_id;
  return jsonb_build_object('ok', true);
end
$$;

-- ---------------------------------------------------------------- who may call what
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
           and p.proname in ('role_rank', 'my_role', 'has_role') loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;
