-- 023: find a hotel from the secret it was given (Telegram webhook secret, phone-assistant secret, booking-webhook secret).
-- Used by the n8n workflows: every incoming call carries its hotel's secret, so the call itself says which hotel it is for.
-- Service role only. Apply:  python -I execution/supabase_admin.py sql sql/023_hotel_secret_lookup.sql

alter table hotel_secrets add column if not exists vapi_tools_secret      text;
alter table hotel_secrets add column if not exists booking_webhook_secret text;

-- a secret belongs to exactly one hotel
create unique index if not exists hotel_secrets_tg_secret_uq      on hotel_secrets (telegram_webhook_secret) where telegram_webhook_secret is not null;
create unique index if not exists hotel_secrets_vapi_secret_uq    on hotel_secrets (vapi_tools_secret)      where vapi_tools_secret is not null;
create unique index if not exists hotel_secrets_booking_secret_uq on hotel_secrets (booking_webhook_secret) where booking_webhook_secret is not null;

-- p_kind: 'telegram' | 'vapi' | 'booking'. Always returns an object: {found:false} or {found:true, hotel:{...}} (never the secrets themselves).
create or replace function hotel_by_secret(p_kind text, p_secret text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_id uuid;
begin
  if coalesce(p_secret, '') = '' or length(p_secret) < 16 then return jsonb_build_object('found', false); end if;
  select hotel_id into v_id from hotel_secrets
  where case p_kind when 'telegram' then telegram_webhook_secret
                    when 'vapi'     then vapi_tools_secret
                    when 'booking'  then booking_webhook_secret end = p_secret;
  if v_id is null then return jsonb_build_object('found', false); end if;
  return coalesce((select jsonb_build_object('found', true, 'hotel', jsonb_build_object(
            'id', h.id, 'slug', h.slug, 'name', h.name, 'timezone', h.timezone, 'staff_chat_id', h.staff_chat_id, 'bot_username', h.bot_username))
          from hotels h where h.id = v_id and h.active), jsonb_build_object('found', false));
end
$$;
revoke execute on function hotel_by_secret(text, text) from public, anon, authenticated;
grant  execute on function hotel_by_secret(text, text) to service_role;
