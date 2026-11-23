-- Daily summary for the manager (run after 019; safe to re-run).
--
-- Every morning the scheduler sends the staff group (or one person's chat) a short summary built by daily_digest():
--   today          who arrives and leaves (with unpaid balances), rooms in house, rooms free tonight
--   last 24 hours  new bookings and their value by channel, cancellations, payments recorded, how many people messaged / asked about rooms
--   needs you      open guest items and how long the oldest has waited, unpaid balances
-- Settings (hotel_settings, all optional):
--   DAILY_DIGEST        'yes' (default) or 'no'
--   DAILY_DIGEST_HOUR   hour of the day in Lagos time, default 8 (it is sent in the three hours from then)
--   MANAGER_CHAT_ID     a Telegram chat id to send it to instead of the staff group
--   DAILY_DIGEST_LAST   written by the scheduler: the date it last ran

insert into hotel_settings (key, value) values ('DAILY_DIGEST', 'yes') on conflict (key) do nothing;

create or replace function daily_digest() returns jsonb
language plpgsql stable as $$
declare
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_since timestamptz := now() - interval '24 hours';
  v_out   jsonb;
begin
  with stays as (
    -- every stay still to come or in progress, with what the guest still owes (nights x rate minus payments recorded)
    select b.id, b.status, b.check_in, b.check_out, b.room_type, b.room_number, g.name,
           greatest(0, (b.check_out - b.check_in) * coalesce(rt.nightly_rate, 0)
                       - coalesce((select sum(p.amount) from booking_payments p where p.booking_id = b.id), 0)) as balance
    from bookings b join guests g on g.id = b.guest_id left join room_types rt on rt.name = b.room_type
    where b.status in ('booked', 'checked_in')
  ), fresh as (
    select b.source, (b.check_out - b.check_in) * coalesce(rt.nightly_rate, 0) as value
    from bookings b left join room_types rt on rt.name = b.room_type
    where b.created_at >= v_since and b.status <> 'cancelled'
  )
  select jsonb_build_object(
    'today', v_today,
    'rooms_total', (select coalesce(sum(total_rooms), 0) from room_types where active),
    'in_house', (select count(*) from bookings where status = 'checked_in'),
    'free_tonight', coalesce((select jsonb_agg(jsonb_build_object('room_type', rt.name, 'free', rooms_free(rt.name, v_today, v_today + 1))
                                               order by rt.nightly_rate nulls last, rt.name) from room_types rt where rt.active), '[]'::jsonb),
    'arriving', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'room_type', room_type, 'room_number', room_number, 'balance', balance) order by name)
                          from stays where status = 'booked' and check_in = v_today), '[]'::jsonb),
    'leaving', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'room_type', room_type, 'room_number', room_number, 'balance', balance) order by name)
                         from stays where status = 'checked_in' and check_out = v_today), '[]'::jsonb),
    'unpaid_count', (select count(*) from stays where balance > 0 and (status = 'checked_in' or (status = 'booked' and check_in = v_today))),
    'unpaid_sum', (select coalesce(sum(balance), 0) from stays where balance > 0 and (status = 'checked_in' or (status = 'booked' and check_in = v_today))),
    'new_bookings', (select count(*) from fresh),
    'new_value', (select coalesce(sum(value), 0) from fresh),
    'by_source', coalesce((select jsonb_object_agg(s, n) from (select coalesce(source, 'other') as s, count(*) as n from fresh group by 1) x), '{}'::jsonb),
    'cancelled', (select count(*) from bookings where cancelled_at >= v_since),
    'payments', (select coalesce(sum(amount), 0) from booking_payments where created_at >= v_since),
    'people_messaged', (select count(distinct chat_id) from messages where direction = 'in' and chat_id is not null and created_at >= v_since),
    'people_asked_rooms', (select count(distinct chat_id) from messages where direction = 'in' and chat_id is not null and intent in ('availability', 'book') and created_at >= v_since),
    'needed_person', (select count(*) from escalations where created_at >= v_since and guest_chat_id is not null and question not like 'Rated their stay%'),
    'open_items', (select count(*) from escalations where status = 'open'),
    'open_service', (select count(*) from escalations where status = 'open' and kind <> 'question'),
    'oldest_open_minutes', (select round(extract(epoch from (now() - min(created_at))) / 60) from escalations where status = 'open')
  ) into v_out;
  return v_out;
end
$$;

revoke execute on function daily_digest() from public, anon, authenticated;
grant  execute on function daily_digest() to service_role;
