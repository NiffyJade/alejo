-- One round trip for everything the Telegram bot needs to answer a message (run after 009/010; safe to re-run).
-- Before this the bot made six separate database calls per message (guest, draft, knowledge, settings, rooms, history),
-- each about a second on the hosted n8n, which was most of the reply delay.

create or replace function bot_context(p_chat_id bigint) returns jsonb
language sql stable as $$
  with g as (select id, name, phone from guests where telegram_chat_id = p_chat_id)
  select jsonb_build_object(
    'guest', (select to_jsonb(g) || jsonb_build_object('bookings', coalesce((
                select jsonb_agg(jsonb_build_object('id', b.id, 'room_number', b.room_number, 'room_type', b.room_type,
                                                    'check_in', b.check_in, 'check_out', b.check_out, 'status', b.status))
                from bookings b where b.guest_id = g.id), '[]'::jsonb)) from g),
    'draft', (select to_jsonb(d) from booking_drafts d where d.chat_id = p_chat_id),
    'knowledge', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'category', category, 'question', question, 'answer', answer))
                           from knowledge_entries), '[]'::jsonb),
    'settings', coalesce((select jsonb_object_agg(key, value) from hotel_settings), '{}'::jsonb),
    'rooms', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'nightly_rate', nightly_rate) order by nightly_rate nulls last)
                       from room_types where active), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('direction', direction, 'text', text) order by created_at desc)
                         from (select direction, text, created_at from messages
                               where guest_id = (select id from g) order by created_at desc limit 6) m), '[]'::jsonb)
  )
$$;

revoke execute on function bot_context(bigint) from public, anon, authenticated;
grant  execute on function bot_context(bigint) to service_role;
