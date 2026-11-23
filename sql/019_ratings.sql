-- Post-checkout ratings (run after 018; safe to re-run).
--
-- About 30 minutes after checkout the scheduler thanks a guest on Telegram and now also asks "How was your stay?" with five buttons.
--   bookings.rating / rated_at       the guest's 1-5 score (they may tap again to change it, within 14 days of checkout)
--   bookings.rating_prompted_at      when the rating buttons were sent (so the response rate counts only guests who were asked)
--   record_rating(...)               records a tap; a score of 3 or less opens ONE complaint item for that stay (escalations,
--                                    kind complaint, category other), which then follows the normal service-recovery rules:
--                                    staff alert, re-alerts every 30 minutes, "is it sorted?" to the guest
--   ratings_summary(days)            figures for the weekly staff digest (service role)
--   ratings_report(days)             the same, for the dashboard's Ratings page (signed-in staff only)

alter table bookings add column if not exists rating smallint check (rating between 1 and 5);
alter table bookings add column if not exists rated_at timestamptz;
alter table bookings add column if not exists rating_prompted_at timestamptz;
create index if not exists bookings_rated_idx on bookings (rated_at) where rated_at is not null;

-- ---------------------------------------------------------------- recording a tap
create or replace function record_rating(p_booking_id uuid, p_chat_id bigint, p_rating int) returns jsonb
language plpgsql as $$
declare
  v_b    bookings%rowtype;
  v_g    guests%rowtype;
  v_prev int;
  v_esc  uuid;
begin
  if p_rating is null or p_rating not between 1 and 5 then return jsonb_build_object('ok', false, 'reason', 'rating'); end if;
  select * into v_b from bookings where id = p_booking_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into v_g from guests where id = v_b.guest_id;
  -- only the guest whose Telegram chat is linked to the booking can rate it
  if v_g.telegram_chat_id is distinct from p_chat_id then return jsonb_build_object('ok', false, 'reason', 'not_yours'); end if;
  if v_b.status <> 'checked_out' then return jsonb_build_object('ok', false, 'reason', 'not_finished'); end if;
  if v_b.checked_out_at is not null and v_b.checked_out_at < now() - interval '14 days' then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  v_prev := v_b.rating;
  update bookings set rating = p_rating, rated_at = now() where id = p_booking_id;

  if p_rating <= 3 and not exists (select 1 from escalations where booking_id = p_booking_id and question like 'Rated their stay%') then
    insert into escalations (booking_id, guest_id, guest_chat_id, question, kind, category)
    values (p_booking_id, v_g.id, p_chat_id, 'Rated their stay ' || p_rating || ' out of 5', 'complaint', 'other')
    returning id into v_esc;
  end if;

  return jsonb_build_object('ok', true, 'rating', p_rating, 'previous', v_prev, 'new_item', v_esc is not null, 'escalation_id', v_esc,
    'guest_name', v_g.name, 'room_type', v_b.room_type, 'room_number', v_b.room_number, 'check_in', v_b.check_in, 'check_out', v_b.check_out);
end
$$;

-- ---------------------------------------------------------------- figures
create or replace function ratings_summary(p_days int default 7) returns jsonb
language plpgsql stable as $$
declare
  v_days       int := least(greatest(coalesce(p_days, 7), 1), 365);
  v_since      timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 365));
  v_prev_since timestamptz := now() - make_interval(days => 2 * least(greatest(coalesce(p_days, 7), 1), 365));
  v_out        jsonb;
begin
  select jsonb_build_object(
    'days', v_days,
    'rated', count(*),
    'asked', (select count(*) from bookings where rating_prompted_at >= v_since),
    'average', round(avg(b.rating)::numeric, 1),
    'previous_average', (select round(avg(rating)::numeric, 1) from bookings where rated_at >= v_prev_since and rated_at < v_since),
    'previous_rated', (select count(*) from bookings where rated_at >= v_prev_since and rated_at < v_since),
    'distribution', jsonb_build_object('1', count(*) filter (where b.rating = 1), '2', count(*) filter (where b.rating = 2), '3', count(*) filter (where b.rating = 3),
                                       '4', count(*) filter (where b.rating = 4), '5', count(*) filter (where b.rating = 5)),
    'low_count', count(*) filter (where b.rating <= 3),
    'tracking_since', (select min(rating_prompted_at) from bookings where rating_prompted_at is not null),
    'by_room', coalesce((select jsonb_agg(jsonb_build_object('room_type', x.t, 'average', x.a, 'count', x.c) order by x.t)
                         from (select room_type as t, round(avg(rating)::numeric, 1) as a, count(*) as c from bookings where rated_at >= v_since group by room_type) x), '[]'::jsonb),
    'low', coalesce(jsonb_agg(jsonb_build_object('booking_id', b.id, 'guest_id', g.id, 'name', g.name, 'room_type', b.room_type, 'room_number', b.room_number,
                              'check_in', b.check_in, 'check_out', b.check_out, 'rating', b.rating, 'rated_at', b.rated_at,
                              'item_open', exists (select 1 from escalations e where e.booking_id = b.id and e.status = 'open' and e.question like 'Rated their stay%'))
                              order by b.rated_at desc) filter (where b.rating <= 3), '[]'::jsonb)
  ) into v_out
  from bookings b join guests g on g.id = b.guest_id
  where b.rated_at >= v_since;
  return v_out;
end
$$;

create or replace function ratings_report(p_days int default 7) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  return ratings_summary(p_days);
end
$$;

revoke execute on function record_rating(uuid, bigint, int) from public, anon, authenticated;
revoke execute on function ratings_summary(int) from public, anon, authenticated;
revoke execute on function ratings_report(int) from public, anon;
grant  execute on function record_rating(uuid, bigint, int) to service_role;
grant  execute on function ratings_summary(int) to service_role;
grant  execute on function ratings_report(int) to authenticated;
