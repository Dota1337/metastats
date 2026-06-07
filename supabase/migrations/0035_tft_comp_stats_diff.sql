-- 0035: super-lean comp-stats RPC for the diff/movers pages.
--
-- get_tft_comp_stats_list (0027) already drops the four detail-only jsonb
-- columns, but still aggregates typical_units / typical_augments / carry_items
-- via jsonb_agg. The diff path (meta-pulse "Patch Movers" + patch-diff entity=
-- comp) reads ONLY the scalar columns (games, sum_placement, top4, top1,
-- participants), so even the three remaining jsonb_aggs are pure waste.
--
-- Measured payload: get_tft_comp_stats_list at master/30d/patch=17.4 returns
-- 10.6 MB (~4.6s). 95%+ of that is the jsonb_agg output that the diff path
-- immediately discards. This diff RPC returns only the scalars → ~50 KB,
-- sub-second.
--
-- The list RPC stays for the comp-list page (which actually renders the
-- typical_units chips in CompCard).
create or replace function get_tft_comp_stats_for_diff(
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
  participants bigint
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
      sum(f.top1)::bigint as top1
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
    (select total from parts)
  from agg a
  where a.games >= p_min_games
$$;

grant execute on function get_tft_comp_stats_for_diff(text[], text[], int, text, int, int) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
