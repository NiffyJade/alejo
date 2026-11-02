-- Staff access for the Alejo dashboard (run after 001-003; safe to re-run).
-- The dashboard talks to Supabase with the public anon key plus the signed-in user's token.
-- Only emails listed in staff_users get any access; n8n keeps using the service-role key, which bypasses all of this.

create table if not exists staff_users (
  email       text primary key,
  name        text not null default '',
  role        text not null default 'staff' check (role in ('staff','manager','owner')),
  created_at  timestamptz not null default now()
);
alter table staff_users enable row level security;

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff_users where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
$$;
revoke execute on function is_staff() from public, anon;
grant  execute on function is_staff() to authenticated, service_role;

-- a staff member may see their own row (so the dashboard can show who is signed in)
drop policy if exists staff_read_self on staff_users;
create policy staff_read_self on staff_users for select to authenticated using (lower(email) = lower(auth.jwt() ->> 'email'));

-- read access
do $$
declare t text;
begin
  foreach t in array array['guests','bookings','escalations','messages','knowledge_entries','hotel_settings','room_types','demo_requests'] loop
    execute format('drop policy if exists staff_read on %I', t);
    execute format('create policy staff_read on %I for select to authenticated using (is_staff())', t);
  end loop;
end $$;

-- write access: the facts the AI may use, and closing an escalation without a reply
drop policy if exists staff_write_settings on hotel_settings;
create policy staff_write_settings on hotel_settings for insert to authenticated with check (is_staff());
drop policy if exists staff_update_settings on hotel_settings;
create policy staff_update_settings on hotel_settings for update to authenticated using (is_staff()) with check (is_staff());

drop policy if exists staff_write_kb on knowledge_entries;
create policy staff_write_kb on knowledge_entries for insert to authenticated with check (is_staff());
drop policy if exists staff_update_kb on knowledge_entries;
create policy staff_update_kb on knowledge_entries for update to authenticated using (is_staff()) with check (is_staff());

drop policy if exists staff_update_escalations on escalations;
create policy staff_update_escalations on escalations for update to authenticated using (is_staff()) with check (is_staff());

drop policy if exists staff_update_demo on demo_requests;
create policy staff_update_demo on demo_requests for update to authenticated using (is_staff()) with check (is_staff());
