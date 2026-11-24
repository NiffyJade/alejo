-- 027: the Telegram bot learns about the hotel's SERVICES (event hall, gym, pool ...). Needs 025.
--   python -I execution/supabase_admin.py sql sql/027_bot_services.sql        (atomic: all or nothing)
--
-- bot_context is the ONE database call the bot makes per guest message. It now also returns "services": every active service with its
-- price and what it is per, and, for a service that holds one booking per day (the event hall), the days already taken from today
-- onward as [from, to] pairs. The bot uses that to say whether the hall is free on a date, and to quote prices, without any extra
-- round trip. It only READS; a service request from a guest still goes to staff (who book it in the dashboard), the bot never books it.
-- Only the one key is added: everything else in the result is exactly as it was.

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
                            from escalations where hotel_id = p_hotel and guest_chat_id = p_chat_id and status = 'open'), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(jsonb_build_object('name', s.name, 'price', s.price, 'unit', s.unit, 'exclusive', s.exclusive,
                            'booked', case when s.exclusive then coalesce((select jsonb_agg(jsonb_build_array(b.starts_on, b.ends_on) order by b.starts_on)
                                                                           from service_bookings b
                                                                           where b.service_id = s.id and b.hotel_id = p_hotel and b.status = 'booked'
                                                                             and b.ends_on >= (now() at time zone hotel_tz(p_hotel))::date), '[]'::jsonb)
                                           else '[]'::jsonb end) order by s.sort, s.name)
                          from hotel_services s where s.hotel_id = p_hotel and s.active), '[]'::jsonb)
  )
$$;
