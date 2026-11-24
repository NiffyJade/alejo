-- 022: seal the multi-hotel change. Run ONLY after the n8n workflows, edge functions and dashboard pass a hotel on every call
-- (until then the old workflows depend on the BrightSide defaults and the old function signatures this file removes).
--   python -I execution/supabase_admin.py sql sql/022_multi_hotel_seal.sql        (atomic, like 021)
-- After this, a second hotel can be added safely.

-- no more silent "BrightSide" default: a row without a hotel is now an error
do $$
declare t text;
begin
  foreach t in array array['hotel_settings','knowledge_entries','guests','bookings','escalations','messages','room_types',
                           'room_blocks','booking_payments','booking_drafts','bot_typing','staff_users'] loop
    execute format('alter table %I alter column hotel_id drop default', t);
  end loop;
end $$;

-- the per-hotel keys become the real primary keys; the single-hotel keys go
alter table hotel_settings    drop constraint hotel_settings_pkey;
alter table hotel_settings    add constraint hotel_settings_pkey    primary key using index hotel_settings_hk;
alter table knowledge_entries drop constraint knowledge_entries_pkey;
alter table knowledge_entries add constraint knowledge_entries_pkey primary key using index knowledge_entries_hk;
alter table room_types        drop constraint room_types_pkey;
alter table room_types        add constraint room_types_pkey        primary key using index room_types_hk;
alter table booking_drafts    drop constraint booking_drafts_pkey;
alter table booking_drafts    add constraint booking_drafts_pkey    primary key using index booking_drafts_hk;
alter table bot_typing        drop constraint bot_typing_pkey;
alter table bot_typing        add constraint bot_typing_pkey        primary key using index bot_typing_hk;
alter table guests            drop constraint guests_telegram_chat_id_key;     -- the same person may be a guest of two hotels

-- the old single-hotel function signatures
drop function if exists room_availability(date, date, text);
drop function if exists bot_availability(date, date, text, bigint);
drop function if exists bot_context(bigint);
drop function if exists telegram_book_room(bigint, text, text, boolean, text, date, date);
drop function if exists phone_book_room(text, text, text, text, date, date);
drop function if exists record_rating(uuid, bigint, integer);
drop function if exists ratings_summary(integer);
drop function if exists daily_digest();
drop function if exists ratings_report(integer);
drop function if exists enquiry_report(integer);
drop function if exists staff_availability(date, date);
drop function if exists staff_add_block(text, integer, date, date, text);
drop function if exists staff_create_booking(text, text, text, date, date, text, text, boolean, numeric, text);
drop function if exists legacy_hotel();
