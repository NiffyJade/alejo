-- Enquiries and conversion: measure how many people ask, how many book, and follow up the ones who did not (run after 017; safe to re-run).
--
-- Until now the bot kept messages only for guests it already knew, so a person who asked about rooms and never booked left no trace.
-- From now on every guest message is logged with the chat it came from (chat_id) and what the bot understood it to be (intent).
-- History from before this file was applied cannot be reconstructed: the report counts from the first logged message (tracking_since).
--
--   messages.chat_id / intent   the Telegram chat, and availability | book | info | other | cancel_draft | followup
--   booking_drafts.followup_sent_at   the one follow-up for an unfinished booking has been sent (never more than one per draft)
--   booking_drafts.tg_name      the Telegram profile name, so the dashboard and the follow-up can say who it is
--   hotel_settings FOLLOWUP_ENABLED   'yes' (default) or 'no': the scheduler only follows up while it is not 'no'
--   enquiry_report(days)        staff-only report used by the dashboard's Enquiries page

alter table messages add column if not exists chat_id bigint;
alter table messages add column if not exists intent  text;
create index if not exists messages_chat_idx on messages (chat_id, created_at);
-- known guests: fill in the chat for messages already logged
update messages m set chat_id = g.telegram_chat_id
from guests g where g.id = m.guest_id and m.chat_id is null and g.telegram_chat_id is not null;

alter table booking_drafts add column if not exists followup_sent_at timestamptz;
alter table booking_drafts add column if not exists tg_name text;

insert into hotel_settings (key, value) values ('FOLLOWUP_ENABLED', 'yes') on conflict (key) do nothing;

-- ---------------------------------------------------------------- the report
-- An "enquiry" is a conversation: one chat's inbound messages, where a gap of more than 12 hours starts a new one.
-- booked        a Telegram booking was made by that chat from the start of the conversation until 2 days after its last message
-- needed_person the bot handed something in that conversation to staff (an escalation)
-- after_hours   the conversation began outside 08:00-20:59 Lagos time
-- open          asked about rooms or dates, did not book, last message within 3 days (the list staff can act on); lost = the same, older
create or replace function enquiry_report(p_days int default 7) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_days  int := least(greatest(coalesce(p_days, 7), 1), 90);
  v_since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 90));
  v_out   jsonb;
begin
  if not is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;

  with inbound as (
    select chat_id, created_at, intent,
           lag(created_at) over (partition by chat_id order by created_at) as prev
    from messages
    where direction = 'in' and chat_id is not null and created_at >= v_since - interval '2 days'
  ), numbered as (
    select *, sum((prev is null or created_at - prev > interval '12 hours')::int) over (partition by chat_id order by created_at) as sess
    from inbound
  ), sessions0 as (
    select chat_id, sess, min(created_at) as started_at, max(created_at) as last_at, count(*) as msgs,
           coalesce(bool_or(intent in ('availability', 'book')), false) as asked_rooms,
           coalesce(bool_or(intent = 'book'), false) as wanted_booking
    from numbered group by chat_id, sess
  ), sessions as (
    select * from sessions0 where started_at >= v_since
  ), enriched as (
    select s.*,
      exists (select 1 from bookings b join guests g on g.id = b.guest_id
              where g.telegram_chat_id = s.chat_id and b.source = 'telegram'
                and b.created_at >= s.started_at and b.created_at <= s.last_at + interval '2 days'
                and not exists (select 1 from sessions0 s2 where s2.chat_id = s.chat_id and s2.started_at > s.started_at and s2.started_at <= b.created_at)) as booked,
      exists (select 1 from escalations e
              where e.guest_chat_id = s.chat_id and e.created_at >= s.started_at - interval '1 minute' and e.created_at <= s.last_at + interval '1 minute') as escalated,
      exists (select 1 from messages m
              where m.chat_id = s.chat_id and m.direction = 'out' and m.intent = 'followup'
                and m.created_at >= s.started_at and m.created_at <= s.last_at + interval '12 hours') as followed_up,
      not (extract(hour from s.started_at at time zone 'Africa/Lagos') between 8 and 20) as after_hours,
      coalesce((select g.name from guests g where g.telegram_chat_id = s.chat_id), d.guest_name, d.tg_name) as who,
      d.check_in as want_in, d.check_out as want_out, d.room_type as want_type, d.phone as want_phone
    from sessions s left join booking_drafts d on d.chat_id = s.chat_id
  )
  select jsonb_build_object(
    'days', v_days,
    'tracking_since', (select min(created_at) from messages where chat_id is not null and direction = 'in'),
    'enquiries', count(*),
    'asked_rooms', count(*) filter (where asked_rooms),
    'wanted_booking', count(*) filter (where wanted_booking),
    'booked', count(*) filter (where booked),
    'booked_of_room_enquiries', count(*) filter (where asked_rooms and booked),
    'needed_person', count(*) filter (where escalated),
    'answered_alone', count(*) filter (where not escalated),
    'after_hours', count(*) filter (where after_hours),
    'median_staff_reply_minutes', (select round((percentile_cont(0.5) within group (order by extract(epoch from (e.answered_at - e.created_at)) / 60))::numeric, 0)
                                   from escalations e where e.created_at >= v_since and e.status = 'answered' and e.answered_at is not null and e.guest_chat_id is not null),
    'followups_sent', (select count(*) from messages m where m.direction = 'out' and m.intent = 'followup' and m.created_at >= v_since),
    'booked_after_followup', count(*) filter (where booked and followed_up),
    'lost', count(*) filter (where asked_rooms and not booked and last_at < now() - interval '3 days'),
    'open', coalesce(jsonb_agg(jsonb_build_object('chat_id', chat_id, 'name', who, 'last_at', last_at, 'followed_up', followed_up,
              'check_in', want_in, 'check_out', want_out, 'room_type', want_type, 'phone', want_phone) order by last_at desc)
              filter (where asked_rooms and not booked and last_at >= now() - interval '3 days'), '[]'::jsonb)
  ) into v_out from enriched;

  return v_out;
end
$$;

revoke execute on function enquiry_report(int) from public, anon;
grant  execute on function enquiry_report(int) to authenticated;
