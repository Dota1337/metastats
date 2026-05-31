-- 0027: lean comp-stats RPC for the LIST view.
--
-- get_tft_comp_stats (0024) aggregates SEVEN jsonb columns per cluster via
-- jsonb_agg — but the comp LIST (CompRow / baseComp) only ever reads three of
-- them (typical_units, typical_augments, carry_items). The other four
-- (last_round_dist, top4_by_round, level_dist, level_sum_last_round) plus the
-- bucket_breakdown sub-aggregate are DETAIL-only (enrichComp), yet the list
-- path paid for all of them on every request.
--
-- EXPLAIN ANALYZE of the default filter (diamond, all 17 regions, 3 days)
-- measured the GroupAggregate at ~2.9s of a 3.1s total — almost entirely the
-- jsonb_agg of those wide jsonb rows. This lean variant aggregates only the
-- three list-rendered jsonb columns and drops the per-bucket CTEs, so the
-- list path skips that work entirely. The full RPC stays for the detail view.
create or replace function get_tft_comp_stats_list(
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
  participants bigint,
  typical_units_merged jsonb,
  typical_augments_merged jsonb,
  carry_items_merged jsonb
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
  agg as (
    select
      f.cluster_key,
      sum(f.games)::bigint as games,
      sum(f.sum_placement)::bigint as sum_placement,
      sum(f.top4)::bigint as top4,
      sum(f.top1)::bigint as top1,
      sum(coalesce(f.sum_level, 0))::bigint as sum_level,
      sum(coalesce(f.sum_last_round, 0))::bigint as sum_last_round,
      jsonb_agg(f.typical_units)    as typical_units_merged,
      jsonb_agg(f.typical_augments) as typical_augments_merged,
      jsonb_agg(f.carry_items)      as carry_items_merged
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
    (select total from parts),
    a.typical_units_merged,
    a.typical_augments_merged,
    a.carry_items_merged
  from agg a
  where a.games >= p_min_games
$$;
