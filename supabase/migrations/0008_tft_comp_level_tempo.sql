-- Add leveling-tempo columns to the comp stats table (2026-05-12).
-- `sum_level` / `sum_last_round` are crawler-side sums; the API divides by
-- `games` to surface avgLevel + avgLastRound on the comp-detail page. Lets
-- users see "this comp tends to be Lvl 8 by 5-1" without having to dig
-- into individual matches.

alter table tft_daily_comp_stats
  add column if not exists sum_level int not null default 0,
  add column if not exists sum_last_round int not null default 0;

-- Update get_tft_comp_stats to return the new sums alongside existing
-- aggregations. Drop+recreate so the return type matches.
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
      sum(f.sum_level)::bigint as sum_level,
      sum(f.sum_last_round)::bigint as sum_last_round,
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
