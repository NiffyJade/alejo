-- Proactive follow-up: a guest due to arrive today who has not checked in by the evening gets one friendly message
-- ("running late? tell us roughly when and we will let the team know"). This column makes sure it is sent once per booking.
-- Safe to run twice.
alter table bookings add column if not exists arrival_check_sent_at timestamptz;
