-- Service recovery: a guest's request or complaint is tracked until it is settled, not just answered once.
-- Builds on `escalations` (one row per thing the AI handed to staff). Safe to run twice.
--   kind        what the guest asked for: a question, a request (towels, AC repair, airport ride), a complaint, or an emergency
--   category    which team it belongs to (maintenance, housekeeping, food, transport, booking, other), null for plain questions
--   reminded_at / remind_count   the scheduler re-alerts the staff group while an item stays open (see "Hotel Guest Journey - Scheduler")
--   guest_checked_at             set when the guest has been asked "is it sorted?" after staff answered, so they are asked once

alter table escalations add column if not exists kind text not null default 'question';
alter table escalations add column if not exists category text;
alter table escalations add column if not exists reminded_at timestamptz;
alter table escalations add column if not exists remind_count int not null default 0;
alter table escalations add column if not exists guest_checked_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'escalations_kind_check') then
    alter table escalations add constraint escalations_kind_check check (kind in ('question','request','complaint','emergency'));
  end if;
end $$;

-- the scheduler reads open non-question items every 15 minutes
create index if not exists escalations_open_service_idx on escalations (created_at) where status = 'open' and kind <> 'question';
-- the follow-up reads recently answered items that still need the "is it sorted?" message
create index if not exists escalations_followup_idx on escalations (answered_at) where status = 'answered' and kind <> 'question' and guest_checked_at is null;
