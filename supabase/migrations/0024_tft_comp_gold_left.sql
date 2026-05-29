-- TFT Comp-Eco (2026-05-29)
-- Per-comp Σ gold_left so the comp page can show the economy profile
-- (avg gold left when the game ended) alongside aggro / leveling / skill-cap.
-- Mirrors the sum_players_eliminated column added in 0017; the column
-- backfills from the next daily crawl (existing rows stay 0 → the UI only
-- shows the stat when games > 0 and the value is present, never a fake 0).

alter table tft_daily_comp_stats
  add column if not exists sum_gold_left bigint not null default 0;

-- Re-declare get_tft_comp_stats to also return sum_gold_left. Identical to the
-- 0017 definition with sum_gold_left threaded through the return table, the
-- aggregate, and the final projection.
drop function if exists get_tft_comp_stats(text[], text[], int, text, int, int);
create or replace function get_tft_comp_stats(
  p_regions text[],
  p_buckets text[],
  p_days int default 3,
  p_patch text default null,
  p_set int default null,
  p_min_games int default 30
)
returns table (
  cluster_key text,
  games bigint,
  sum_placement bigint,
  top4 bigint,
  top1 bigint,
  sum_level bigint,
  sum_last_round bigint,
  sum_players_eliminated bigint,
  sum_gold_left bigint,
  participants bigint,
  typical_units_merged jsonb,
  typical_augments_merged jsonb,
  carry_items_merged jsonb,
  last_round_dist_merged jsonb,
  top4_by_round_merged jsonb,
  level_dist_merged jsonb,
  level_sum_last_round_merged jsonb,
  bucket_breakdown jsonb
)
language sql
stable
as $$
  with parts as (
    select coalesce(sum(games), 0)::bigint as total
    from tft_daily_comp_stats
    where region = any(p_regions)
      and bucket = any(p_buckets)
      and day >= current_date - (p_days || ' days')::interval
      and (p_patch is null or patch = p_patch)
      and (p_set is null or set_number = p_set)
  ),
  per_bucket as (
    select
      f.cluster_key,
      f.bucket,
      sum(f.games)::bigint as games,
      sum(f.sum_placement)::bigint as sum_placement
    from tft_daily_comp_stats f
    where f.region = any(p_regions)
      and f.bucket = any(p_buckets)
      and f.day >= current_date - (p_days || ' days')::interval
      and (p_patch is null or f.patch = p_patch)
      and (p_set is null or f.set_number = p_set)
    group by f.cluster_key, f.bucket
  ),
  bucket_json as (
    select
      cluster_key,
      jsonb_object_agg(
        bucket,
        jsonb_build_object('games', games, 'sum_placement', sum_placement)
      ) as bucket_breakdown
    from per_bucket
    group by cluster_key
  ),
  agg as (
    select
      f.cluster_key,
      sum(f.games)::bigint as games,
      sum(f.sum_placement)::bigint as sum_placement,
      sum(f.top4)::bigint as top4,
      sum(f.top1)::bigint as top1,
      sum(coalesce(f.sum_level, 0))::bigint as sum_level,
      sum(coalesce(f.sum_last_round, 0))::bigint as sum_last_round,
      sum(coalesce(f.sum_players_eliminated, 0))::bigint as sum_players_eliminated,
      sum(coalesce(f.sum_gold_left, 0))::bigint as sum_gold_left,
      jsonb_agg(f.typical_units)         as typical_units_merged,
      jsonb_agg(f.typical_augments)      as typical_augments_merged,
      jsonb_agg(f.carry_items)           as carry_items_merged,
      jsonb_agg(f.last_round_dist)       as last_round_dist_merged,
      jsonb_agg(f.top4_by_round)         as top4_by_round_merged,
      jsonb_agg(f.level_dist)            as level_dist_merged,
      jsonb_agg(f.level_sum_last_round)  as level_sum_last_round_merged
    from tft_daily_comp_stats f
    where f.region = any(p_regions)
      and f.bucket = any(p_buckets)
      and f.day >= current_date - (p_days || ' days')::interval
      and (p_patch is null or f.patch = p_patch)
      and (p_set is null or f.set_number = p_set)
    group by f.cluster_key
  )
  select
    a.cluster_key,
    a.games,
    a.sum_placement,
    a.top4,
    a.top1,
    a.sum_level,
    a.sum_last_round,
    a.sum_players_eliminated,
    a.sum_gold_left,
    (select total from parts),
    a.typical_units_merged,
    a.typical_augments_merged,
    a.carry_items_merged,
    a.last_round_dist_merged,
    a.top4_by_round_merged,
    a.level_dist_merged,
    a.level_sum_last_round_merged,
    coalesce(bj.bucket_breakdown, '{}'::jsonb) as bucket_breakdown
  from agg a
  left join bucket_json bj on bj.cluster_key = a.cluster_key
  where a.games >= p_min_games
$$;
