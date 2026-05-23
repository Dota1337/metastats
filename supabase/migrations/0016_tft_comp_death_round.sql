-- TFT comp death-round histogram (2026-05-22)
-- Adds per-comp last_round distribution so the comp detail UI can show
-- "Comp X dies most often on round 22, and 73% of survivors past round 26
-- finish top 4." Bin keys are last_round as string ints; values are games
-- and top4-game counts so the UI can compute survival → top4 probabilities.

alter table tft_daily_comp_stats
  add column if not exists last_round_dist jsonb not null default '{}'::jsonb,
  add column if not exists top4_by_round jsonb not null default '{}'::jsonb;

-- Replace get_tft_comp_stats to forward the two new fields via the same
-- jsonb_agg merge pattern already used for typical_units etc. Drop first
-- because the return-type changed (added two columns).
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
  participants bigint,
  typical_units_merged jsonb,
  typical_augments_merged jsonb,
  carry_items_merged jsonb,
  last_round_dist_merged jsonb,
  top4_by_round_merged jsonb
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
      jsonb_agg(f.typical_units)    as typical_units_merged,
      jsonb_agg(f.typical_augments) as typical_augments_merged,
      jsonb_agg(f.carry_items)      as carry_items_merged,
      jsonb_agg(f.last_round_dist)  as last_round_dist_merged,
      jsonb_agg(f.top4_by_round)    as top4_by_round_merged
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
    (select total from parts),
    a.typical_units_merged,
    a.typical_augments_merged,
    a.carry_items_merged,
    a.last_round_dist_merged,
    a.top4_by_round_merged
  from agg a
  where a.games >= p_min_games
$$;
