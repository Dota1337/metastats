-- 0038: Anchor-Offset für get_tft_comp_velocity
--
-- Problem: Während Erstfill liegen Stats-Tage mehrere Tage hinter
-- current_date. Wenn der User „Letzter Tag" (days=1) + „vs vor 3 Tagen"
-- (shift=3) wählt, gibt es im now-Window (day > today-1d) gar keine Daten,
-- weil der letzte Crawl-Tag z.B. 4 Tage alt ist. Der App-Reader hat zwar
-- einen Stale-Bump auf p_days, der verschiebt aber sowohl now- als auch
-- prev-Fenster gleichzeitig und verwischt die Semantik des Vergleichs.
--
-- Fix: optionaler Anker-Offset (`p_anchor_offset_days`). now-Window ankert
-- an `current_date - p_anchor_offset_days` statt `current_date`. App-Reader
-- übergibt die staleness des letzten Stats-Tags — damit gilt now = „letzte
-- N verfügbare Tage", prev = „die N Tage davor", egal wie stale die
-- Pipeline gerade ist. Default 0 = altes Verhalten (rückwärtskompatibel).

create or replace function get_tft_comp_velocity(
  p_regions text[],
  p_buckets text[],
  p_set int default null,
  p_patch text default null,
  p_days int default 3,
  p_shift_days int default 3,
  p_min_games int default 30,
  p_anchor_offset_days int default 0
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
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - (p_days || ' days')::interval
          and day <= current_date - (p_anchor_offset_days || ' days')::interval
      ), 0)::bigint as parts_now,
      coalesce(sum(games) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - ((p_days + p_shift_days) || ' days')::interval
          and day <= (current_date - (p_anchor_offset_days || ' days')::interval) - (p_shift_days || ' days')::interval
      ), 0)::bigint as parts_prev
    from tft_daily_comp_stats
    where region = any(p_regions)
      and bucket = any(p_buckets)
      and day > (current_date - (p_anchor_offset_days || ' days')::interval) - ((p_days + p_shift_days) || ' days')::interval
      and day <= current_date - (p_anchor_offset_days || ' days')::interval
      and (p_patch is null or patch = p_patch)
      and (p_set is null or set_number = p_set)
  ),
  agg as (
    select
      cluster_key,
      sum(games) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - (p_days || ' days')::interval
          and day <= current_date - (p_anchor_offset_days || ' days')::interval
      )::bigint as games_now,
      sum(games) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - ((p_days + p_shift_days) || ' days')::interval
          and day <= (current_date - (p_anchor_offset_days || ' days')::interval) - (p_shift_days || ' days')::interval
      )::bigint as games_prev,
      sum(sum_placement) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - (p_days || ' days')::interval
          and day <= current_date - (p_anchor_offset_days || ' days')::interval
      )::bigint as sum_placement_now,
      sum(sum_placement) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - ((p_days + p_shift_days) || ' days')::interval
          and day <= (current_date - (p_anchor_offset_days || ' days')::interval) - (p_shift_days || ' days')::interval
      )::bigint as sum_placement_prev,
      sum(top4) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - (p_days || ' days')::interval
          and day <= current_date - (p_anchor_offset_days || ' days')::interval
      )::bigint as top4_now,
      sum(top4) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - ((p_days + p_shift_days) || ' days')::interval
          and day <= (current_date - (p_anchor_offset_days || ' days')::interval) - (p_shift_days || ' days')::interval
      )::bigint as top4_prev,
      sum(top1) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - (p_days || ' days')::interval
          and day <= current_date - (p_anchor_offset_days || ' days')::interval
      )::bigint as top1_now,
      sum(top1) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - ((p_days + p_shift_days) || ' days')::interval
          and day <= (current_date - (p_anchor_offset_days || ' days')::interval) - (p_shift_days || ' days')::interval
      )::bigint as top1_prev
    from tft_daily_comp_stats
    where region = any(p_regions)
      and bucket = any(p_buckets)
      and day > (current_date - (p_anchor_offset_days || ' days')::interval) - ((p_days + p_shift_days) || ' days')::interval
      and day <= current_date - (p_anchor_offset_days || ' days')::interval
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
