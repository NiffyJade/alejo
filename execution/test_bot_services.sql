-- Test for sql/027_bot_services.sql: what the bot's one context call returns about services. Run AFTER 027 is applied:
--   python -I -X utf8 execution/supabase_admin.py sql execution/test_bot_services.sql
-- Before 027 is applied, as a DRY RUN with the migration:  python -I -X utf8 execution/dry_run_sql.py sql/027_bot_services.sql execution/test_bot_services.sql
-- Everything is rolled back at the end: a PASS looks like  ERROR: P0001: ALL OK  (anything else names the failed check).
do $$
declare
  ha uuid := gen_random_uuid(); hb uuid := gen_random_uuid();
  hall uuid; pool uuid; spa uuid; hall_b uuid; c jsonb; s jsonb; t0 date := current_date;
begin
  insert into hotels (id, slug, name) values (ha, 'bots-a', 'Bot Services A'), (hb, 'bots-b', 'Bot Services B');
  insert into hotel_services (hotel_id, name, price, unit, exclusive, sort) values (ha, 'Event hall', 250000, 'per_event', true, 1) returning id into hall;
  insert into hotel_services (hotel_id, name, price, unit, exclusive, sort) values (ha, 'Pool', 3000, 'per_head', false, 2) returning id into pool;
  insert into hotel_services (hotel_id, name, price, unit, exclusive, active, sort) values (ha, 'Old spa', 5000, 'per_visit', false, false, 3) returning id into spa;
  insert into hotel_services (hotel_id, name, price, unit, exclusive) values (hb, 'Hall of B', 1, 'per_event', true) returning id into hall_b;
  -- bookings: two future hall bookings, one past, one cancelled; a pool booking; another hotel's hall booking
  insert into service_bookings (hotel_id, service_id, customer_name, starts_on, ends_on, amount) values
    (ha, hall, 'Future One', t0 + 10, t0 + 11, 1), (ha, hall, 'Future Two', t0 + 20, t0 + 20, 1), (ha, hall, 'Past', t0 - 10, t0 - 9, 1), (ha, pool, 'Swimmers', t0 + 10, t0 + 10, 1);
  insert into service_bookings (hotel_id, service_id, customer_name, starts_on, ends_on, amount, status) values (ha, hall, 'Cancelled', t0 + 30, t0 + 30, 1, 'cancelled');
  insert into service_bookings (hotel_id, service_id, customer_name, starts_on, ends_on, amount) values (hb, hall_b, 'Other Hotel', t0 + 10, t0 + 10, 1);
  insert into service_bookings (hotel_id, service_id, customer_name, starts_on, ends_on, amount) values (ha, hall, 'Running now', t0 - 1, t0 + 1, 1);

  c := bot_context(ha, 123456);
  assert c ? 'hotel' and c ? 'guest' and c ? 'draft' and c ? 'knowledge' and c ? 'settings' and c ? 'rooms' and c ? 'history' and c ? 'open_items', 'every key the bot already relied on is still there';
  assert jsonb_array_length(c->'services') = 2, 'only the two active services of this hotel (not the switched-off one, not the other hotel''s)';
  assert (c->'services'->0->>'name') = 'Event hall' and (c->'services'->1->>'name') = 'Pool', 'in the hotel''s own order';
  s := c->'services'->0;
  assert (s->>'price')::numeric = 250000 and s->>'unit' = 'per_event' and (s->>'exclusive')::boolean, 'name, price, unit and exclusivity come through';
  assert jsonb_array_length(s->'booked') = 3, 'the hall lists the days still taken: today''s running booking and the two future ones (not the past or the cancelled one)';
  assert s->'booked'->0 = jsonb_build_array((t0 - 1)::text, (t0 + 1)::text) and s->'booked'->1 = jsonb_build_array((t0 + 10)::text, (t0 + 11)::text)
     and s->'booked'->2 = jsonb_build_array((t0 + 20)::text, (t0 + 20)::text), 'as [from, to] day pairs, earliest first';
  assert jsonb_array_length(c->'services'->1->'booked') = 0, 'a service that is not exclusive lists no taken days (many can use it at once)';
  assert not (c::text like '%Other Hotel%') and not (c::text like '%Hall of B%'), 'nothing of the other hotel';
  assert jsonb_array_length((bot_context(hb, 1))->'services') = 1 and ((bot_context(hb, 1))->'services'->0->>'name') = 'Hall of B', 'the other hotel sees only its own service';
  assert jsonb_array_length((bot_context(gen_random_uuid(), 1))->'services') = 0, 'a hotel with no services gets an empty list, not an error';
  raise exception 'ALL OK';
end $$;
