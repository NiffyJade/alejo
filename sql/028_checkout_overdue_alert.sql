-- 028: remember that the staff group was told a guest is past checkout time (once per stay). Needs nothing else.
--   python -I execution/supabase_admin.py sql sql/028_checkout_overdue_alert.sql        (atomic: all or nothing)
--
-- The scheduler now sends ONE message to the staff group when a guest is still marked "checked in" 30 minutes after the hotel's checkout
-- time on their checkout day. It stamps this column when it does, so the same stay is never announced twice. Nothing else changes: a stay
-- is still closed automatically the day after its checkout date, and nobody is checked out by this alert.

alter table bookings add column if not exists checkout_overdue_alert_sent_at timestamptz;
