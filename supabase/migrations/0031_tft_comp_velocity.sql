-- 0031: Velocity-RPC für Comps — Trending/Δ-Layer (Sprint W1-A)
--
-- Liefert pro cluster_key zwei parallele Aggregationen ("now" vs "prev"), so
-- dass die API Δ (avg-place, pickrate, top4) berechnen kann ohne zwei
-- separate Scans. p_days = Fenstergröße (sowohl now als auch prev),
-- p_shift_days = wie weit prev zurückliegt (relative Verschiebung).
--
-- Für nicht-überlappende Fenster gilt p_shift_days >= p_days; bei Default 3/3
-- vergleicht die RPC die letzten 3 Tage (today−2..today) gegen die 3 Tage
-- davor (today−5..today−3). Mit p_shift_days=7 vergleichen wir die letzten 3
-- Tage gegen die 3 Tage vor einer Woche ("7-Day-Velocity").
--
-- Implementation: EIN Sequential Scan über das 2×Window-Range, dann
-- FILTER-Aggregation für now/prev. Halbiert die IO ggü. zwei separaten
-- Aggregationen — relevant auf Nano-Compute.

create or replace function get_tft_comp_velocity(
  p_regions text[],
  p_buckets text[],
  p_set int default null,
  p_patch text default null,
  p_days int default 3,
  p_shift_days int default 3,
  p_min_games int default 30
)
returns table (
  cluster_key text,
  games_now bigint,
  games_prev bigint,
  sum_placement_now bigint,
  sum_placement_prev bigint,
  top4_now bigint,
  top4_prev bigint,
  top1_now bigint,
  top1_prev bigint,
  participants_now bigint,
  participants_prev bigint
)
language sql
stable
as $$
  with totals as (
    select
      coalesce(sum(games) filter (
        where day > current_date - (p_days || ' days')::interval
      ), 0)::bigint as parts_now,
      coalesce(sum(games) filter (
        where day > current_date - ((p_days + p_shift_days) || ' days')::interval
          and day <= current_date - (p_shift_days || ' days')::interval
      ), 0)::bigint as parts_prev
    from tft_daily_comp_stats
    where region = any(p_regions)
      and bucket = any(p_buckets)
      and day > current_date - ((p_days + p_shift_days) || ' days')::interval
      and (p_patch is null or patch = p_patch)
      and (p_set is null or set_number = p_set)
  ),
  agg as (
    select
      cluster_key,
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
      sum(top1) filter (
        where day > current_date - (p_days || ' days')::interval
      )::bigint as top1_now,
      sum(top1) filter (
        where day > current_date - ((p_days + p_shift_days) || ' days')::interval
          and day <= current_date - (p_shift_days || ' days')::interval
      )::bigint as top1_prev
    from tft_daily_comp_stats
    where region = any(p_regions)
      and bucket = any(p_buckets)
      and day > current_date - ((p_days + p_shift_days) || ' days')::interval
      and (p_patch is null or patch = p_patch)
      and (p_set is null or set_number = p_set)
    group by cluster_key
  )
  select
    a.cluster_key,
    coalesce(a.games_now, 0),
    coalesce(a.games_prev, 0),
    coalesce(a.sum_placement_now, 0),
    coalesce(a.sum_placement_prev, 0),
    coalesce(a.top4_now, 0),
    coalesce(a.top4_prev, 0),
    coalesce(a.top1_now, 0),
    coalesce(a.top1_prev, 0),
    (select parts_now from totals),
    (select parts_prev from totals)
  from agg a
  where coalesce(a.games_now, 0) + coalesce(a.games_prev, 0) >= p_min_games
$$;

notify pgrst, 'reload schema';
