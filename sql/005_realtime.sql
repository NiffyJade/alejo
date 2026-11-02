-- Live dashboard: let Supabase Realtime announce changes on the tables the dashboard reads (safe to re-run).
-- Realtime respects the same row-level security as normal reads, so only signed-in staff receive these events.
do $$
declare t text;
begin
  foreach t in array array['messages','escalations','bookings','guests','knowledge_entries','hotel_settings'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
