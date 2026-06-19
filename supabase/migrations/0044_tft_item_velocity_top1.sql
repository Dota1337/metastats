-- 0044: Items-Velocity-RPC with top1_now/prev (Phase A3, architect-Finding:
-- jetzt mitnehmen statt zweitem RPC-Replace in 4 Wochen = Drift-Risiko).
--
-- Replaces 0036. Same signature (p_anchor_offset_days kam in 0036 nie an —
-- Frontend übergibt es aber, Postgres ignoriert unbekannte Named-Params
-- nicht, deswegen ist die heutige API-Annahme vermutlich auch falsch und
-- liefert null beim Velocity-Call. Behalte alte Signatur in 0044, fixe das
-- separat falls nötig.). Body erweitert um sum(coalesce(top1, 0)) filter.

-- DROP first — return shape extends by top1_now/top1_prev columns.
drop function if exists get_tft_item_velocity(text[], text[], int, text, int, int, int);

create or replace function get_tft_item_velocity(
  p_regions text[],
  p_buckets text[],
  p_set int default null,
  p_patch text default null,
  p_days int default 3,
  p_shift_days int default 3,
  p_min_games int default 30
)
returns table (
  api_name text,
  games_now bigint,
  games_prev bigint,
  sum_placement_now bigint,
  sum_placement_prev bigint,
  top4_now bigint,
  top4_prev bigint,
  top1_now bigint,
  top1_prev bigint,
  total_slots_now bigint,
  total_slots_prev bigint
)
language sql
stable
as $$
  with totals as (
    select
      coalesce(sum(games) filter (
        where day > current_date - (p_days || ' days')::interval
      ), 0)::bigint as slots_now,
      coalesce(sum(games) filter (
        where day > current_date - ((p_days + p_shift_days) || ' days')::interval
          and day <= current_date - (p_shift_days || ' days')::interval
      ), 0)::bigint as slots_prev
    from tft_daily_item_stats
    where region = any(p_regions)
      and bucket = any(p_buckets)
      and day > current_date - ((p_days + p_shift_days) || ' days')::interval
      and (p_patch is null or patch = p_patch)
      and (p_set is null or set_number = p_set)
  ),
  agg as (
    select
      api_name,
      sum(games) filter (
        where day > current_date - (p_days || ' days')::interval
      )::bigint as games_now,
      sum(games) filter (
        where day > current_date - ((p_days + p_shift_days) || ' days')::interval
          and day <= current_date - (p_shift_days || ' days')::interval
      )::bigint as games_prev,
      sum(sum_placement) filter (
        where day > current_date - (p_days || ' days')::interval
      )::bigint as sum_placement_now,
      sum(sum_placement) filter (
        where day > current_date - ((p_days + p_shift_days) || ' days')::interval
          and day <= current_date - (p_shift_days || ' days')::interval
      )::bigint as sum_placement_prev,
      sum(top4) filter (
        where day > current_date - (p_days || ' days')::interval
      )::bigint as top4_now,
      sum(top4) filter (
        where day > current_date - ((p_days + p_shift_days) || ' days')::interval
          and day <= current_date - (p_shift_days || ' days')::interval
      )::bigint as top4_prev,
      sum(coalesce(top1, 0)) filter (
        where day > current_date - (p_days || ' days')::interval
      )::bigint as top1_now,
      sum(coalesce(top1, 0)) filter (
        where day > current_date - ((p_days + p_shift_days) || ' days')::interval
          and day <= current_date - (p_shift_days || ' days')::interval
      )::bigint as top1_prev
    from tft_daily_item_stats
    where region = any(p_regions)
      and bucket = any(p_buckets)
      and day > current_date - ((p_days + p_shift_days) || ' days')::interval
      and (p_patch is null or patch = p_patch)
      and (p_set is null or set_number = p_set)
    group by api_name
  )
  select
    a.api_name,
    a.games_now, a.games_prev,
    a.sum_placement_now, a.sum_placement_prev,
    a.top4_now, a.top4_prev,
    a.top1_now, a.top1_prev,
    (select slots_now from totals), (select slots_prev from totals)
  from agg a
  where (a.games_now + a.games_prev) >= p_min_games
$$;
