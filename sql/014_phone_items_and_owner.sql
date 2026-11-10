-- Service recovery, part 2.
--   1. Phone callers have no Telegram chat, so an escalation can now exist without guest_chat_id (and without a guest row).
--      caller_name / caller_phone say who to call back. These items are closed from the dashboard (Resolve) after the call-back.
--   2. An item can be taken by a staff member: assigned_to is their name, assigned_at when. Anyone on staff may take or release it.
-- Safe to run twice.

alter table escalations alter column guest_chat_id drop not null;
alter table escalations add column if not exists caller_name text;
alter table escalations add column if not exists caller_phone text;
alter table escalations add column if not exists assigned_to text;
alter table escalations add column if not exists assigned_at timestamptz;
