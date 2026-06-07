-- 0036: Velocity-RPC für Items — Trending/Δ-Layer
--
-- Analog zu get_tft_comp_velocity (0031). Liefert pro api_name zwei parallele
-- Aggregationen ("now" vs "prev"), so dass die API Δ (avg-place, top4,
-- pickrate) berechnen kann ohne zwei separate Scans.
--   p_days       = Fenstergröße (sowohl now als auch prev gleich lang)
--   p_shift_days = wie weit prev zurückliegt (relative Verschiebung)
--
-- Bei p_days=3, p_shift_days=3: now = letzte 3 Tage; prev = die 3 Tage davor.
-- Bei p_days=3, p_shift_days=7: now = letzte 3 Tage; prev = 3 Tage vor 7 Tagen.
--
-- Items haben kein patch-Pinning hier — die Velocity-Frage ("was hat sich
-- über die letzten N Tage verschoben?") überspannt Patches, ähnlich wie bei
-- der Comp-RPC.
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
      )::bigint as top4_prev
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
    coalesce(a.games_now, 0),
    coalesce(a.games_prev, 0),
    coalesce(a.sum_placement_now, 0),
    coalesce(a.sum_placement_prev, 0),
    coalesce(a.top4_now, 0),
    coalesce(a.top4_prev, 0),
    (select slots_now from totals),
    (select slots_prev from totals)
  from agg a
  where coalesce(a.games_now, 0) + coalesce(a.games_prev, 0) >= p_min_games
$$;

grant execute on function get_tft_item_velocity(text[], text[], int, text, int, int, int) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
