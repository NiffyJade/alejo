-- Keeps Telegram's "typing..." showing until the bot's answer is ready (run after 011; safe to re-run).
--
-- Telegram shows "typing..." for only 5 seconds per signal. A helper n8n workflow ("Typing Keepalive") re-sends it every few
-- seconds while the bot works; this table is how it knows when to stop:
--   * the helper sets started_at (and clears finished_at) when a message arrives,
--   * bot_availability (called by the bot just before it composes and sends the reply) sets finished_at in the same call, so
--     stopping costs the reply no extra time.

create table if not exists bot_typing (
  chat_id      bigint primary key,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz
);
alter table bot_typing enable row level security;

create or replace function bot_availability(
  p_check_in   date,
  p_check_out  date,
  p_room_type  text   default null,
  p_chat_id    bigint default null
) returns table (room_type text, available_rooms int, nightly_rate numeric)
language plpgsql as $$
begin
  if p_chat_id is not null then
    update bot_typing set finished_at = now() where chat_id = p_chat_id;
  end if;
  return query select * from room_availability(p_check_in, p_check_out, p_room_type);
end
$$;

revoke execute on function bot_availability(date, date, text, bigint) from public, anon, authenticated;
grant  execute on function bot_availability(date, date, text, bigint) to service_role;
