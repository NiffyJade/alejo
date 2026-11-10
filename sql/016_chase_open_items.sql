-- Service recovery, part 3: a guest who chases an open request ("any update?") should not create a second item.
--   chase_count / last_chased_at   how often the guest has chased this item, and when staff were last re-alerted about it
--   bot_context now also returns the chat's open items, so the bot can tell a chaser from a new request in the same single call.
-- Safe to run twice (bot_context is replaced with the 011 version plus open_items).

alter table escalations add column if not exists chase_count int not null default 0;
alter table escalations add column if not exists last_chased_at timestamptz;

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
                               where guest_id = (select id from g) order by created_at desc limit 6) m), '[]'::jsonb),
    'open_items', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'category', category, 'question', left(question, 120),
                                                                'created_at', created_at, 'chase_count', chase_count,
                                                                'last_chased_at', last_chased_at, 'assigned_to', assigned_to) order by created_at)
                            from escalations where guest_chat_id = p_chat_id and status = 'open'), '[]'::jsonb)
  )
$$;

revoke execute on function bot_context(bigint) from public, anon, authenticated;
grant  execute on function bot_context(bigint) to service_role;
