-- Guest-journey schema for the AI hotel receptionist (single hotel, thin version).
-- Run once in the Supabase SQL editor. Safe to re-run (IF NOT EXISTS).
-- All access is through the service-role key from n8n, so RLS is enabled with no policies:
-- anon/authenticated users can read and write nothing.

-- Hotel facts that fill the [[PLACEHOLDERS]] in knowledge answers (wifi, hours, fees...).
create table if not exists hotel_settings (
  key         text primary key,
  value       text not null default '',
  updated_at  timestamptz not null default now()
);

-- Answers the AI is allowed to use. [[KEY]] in an answer is replaced from hotel_settings;
-- an entry whose placeholders are still blank is NOT answerable (the AI escalates instead).
create table if not exists knowledge_entries (
  id          text primary key,
  category    text not null,
  question    text not null,
  answer      text not null,
  source      text not null default 'seed',   -- 'seed' | 'staff' (learned from a staff reply)
  created_at  timestamptz not null default now()
);

create table if not exists guests (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  phone             text,
  email             text,
  telegram_chat_id  bigint unique,             -- set when the guest taps Start from their link
  created_at        timestamptz not null default now()
);

create table if not exists bookings (
  id                 uuid primary key default gen_random_uuid(),
  guest_id           uuid not null references guests(id) on delete cascade,
  room_number        text,
  room_type          text,
  check_in           date not null,
  check_out          date not null check (check_out > check_in),
  status             text not null default 'booked'
                     check (status in ('booked','checked_in','checked_out','cancelled')),
  start_token        text not null unique default replace(gen_random_uuid()::text, '-', ''),
  stay_code          text not null default ((100000 + floor(random() * 900000))::int)::text,
  confirmation_sent_at       timestamptz,
  reminder_sent_at           timestamptz,
  checked_in_at              timestamptz,
  checkout_reminder_sent_at  timestamptz,
  checked_out_at             timestamptz,
  thanks_sent_at             timestamptz,
  created_at         timestamptz not null default now()
);
create index if not exists bookings_check_in_idx  on bookings (check_in)  where status in ('booked','checked_in');
create index if not exists bookings_check_out_idx on bookings (check_out) where status in ('booked','checked_in');

-- Questions the AI could not answer, waiting for staff.
create table if not exists escalations (
  id                uuid primary key default gen_random_uuid(),
  booking_id        uuid references bookings(id) on delete set null,
  guest_id          uuid references guests(id) on delete set null,
  guest_chat_id     bigint not null,
  question          text not null,
  status            text not null default 'open' check (status in ('open','answered')),
  staff_message_id  bigint,                    -- the staff-group message to reply to
  staff_answer      text,
  created_at        timestamptz not null default now(),
  answered_at       timestamptz
);
create index if not exists escalations_staff_msg_idx on escalations (staff_message_id);

create table if not exists messages (
  id          bigserial primary key,
  guest_id    uuid references guests(id) on delete set null,
  direction   text not null check (direction in ('in','out')),
  text        text not null,
  created_at  timestamptz not null default now()
);

alter table hotel_settings     enable row level security;
alter table knowledge_entries  enable row level security;
alter table guests             enable row level security;
alter table bookings           enable row level security;
alter table escalations        enable row level security;
alter table messages           enable row level security;
