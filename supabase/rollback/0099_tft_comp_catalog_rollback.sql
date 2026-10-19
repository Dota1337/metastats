-- Rollback 0099: Comp-Katalog entfernen, get_tft_comp_stats auf den Stand 0095 (ohne p_cluster_traits).
-- Nur zusammen mit dem Code-Rueckbau ausfuehren (oder vorher COMP_CATALOG_READ=0 setzen): die
-- Detail-Route ruft p_cluster_traits, solange der Katalog-Lesepfad aktiv ist.

begin;

set local lock_timeout = '2s';

drop function if exists public.get_tft_comp_catalogs(p_set integer, p_patches text[]);
drop function if exists public.get_tft_comp_classic_units(p_set integer, p_patch text, p_start date, p_end date);
drop table if exists public.tft_comp_catalog_entry;
drop table if exists public.tft_comp_catalog;

drop function public.get_tft_comp_stats(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_cluster_prefix text, p_end_day date, p_cluster_traits text[]);
CREATE FUNCTION public.get_tft_comp_stats(p_regions text[], p_buckets text[], p_days integer DEFAULT 3, p_patch text DEFAULT NULL::text, p_set integer DEFAULT NULL::integer, p_min_games integer DEFAULT 30, p_cluster_prefix text DEFAULT NULL::text, p_end_day date DEFAULT NULL::date)
 RETURNS TABLE(cluster_key text, games bigint, sum_placement bigint, top4 bigint, top1 bigint, sum_level bigint, sum_last_round bigint, sum_players_eliminated bigint, sum_gold_left bigint, participants bigint, typical_units_merged jsonb, typical_augments_merged jsonb, carry_items_merged jsonb, last_round_dist_merged jsonb, top4_by_round_merged jsonb, level_dist_merged jsonb, level_sum_last_round_merged jsonb, carry_star_dist_merged jsonb, contested_dist_merged jsonb, bucket_breakdown jsonb)
 LANGUAGE sql
 STABLE
AS $function$
  with parts as (
    select coalesce(sum(games), 0)::bigint as total
    from tft_daily_comp_stats
    where region = any(p_regions)
      and bucket = any(p_buckets)
      and day >= coalesce(p_end_day + 1, current_date) - (p_days || ' days')::interval and day <= coalesce(p_end_day, current_date)
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
      sum(coalesce(f.sum_players_eliminated, 0))::bigint as sum_players_eliminated,
      sum(coalesce(f.sum_gold_left, 0))::bigint as sum_gold_left,
      jsonb_agg(f.typical_units)    as typical_units_merged,
      jsonb_agg(f.typical_augments) as typical_augments_merged,
      jsonb_agg(f.carry_items)      as carry_items_merged,
      jsonb_agg(f.last_round_dist)  as last_round_dist_merged,
      jsonb_agg(f.top4_by_round)    as top4_by_round_merged,
      jsonb_agg(f.level_dist)       as level_dist_merged,
      jsonb_agg(f.level_sum_last_round) as level_sum_last_round_merged,
      jsonb_agg(coalesce(f.carry_star_dist, '{}'::jsonb)) as carry_star_dist_merged,
      jsonb_agg(coalesce(f.contested_dist,  '{}'::jsonb)) as contested_dist_merged
    from tft_daily_comp_stats f
    where f.region = any(p_regions)
      and f.bucket = any(p_buckets)
      and f.day >= coalesce(p_end_day + 1, current_date) - (p_days || ' days')::interval and f.day <= coalesce(p_end_day, current_date)
      and (p_patch is null or f.patch = p_patch)
      and (p_set is null or f.set_number = p_set)
      and (p_cluster_prefix is null or starts_with(f.cluster_key, p_cluster_prefix))
    group by f.cluster_key
  ),
  bkt as (
    select
      f.cluster_key,
      f.bucket,
      sum(f.games)::bigint as games,
      sum(f.sum_placement)::bigint as sum_placement
    from tft_daily_comp_stats f
    where f.region = any(p_regions)
      and f.bucket = any(p_buckets)
      and f.day >= coalesce(p_end_day + 1, current_date) - (p_days || ' days')::interval and f.day <= coalesce(p_end_day, current_date)
      and (p_patch is null or f.patch = p_patch)
      and (p_set is null or f.set_number = p_set)
      and (p_cluster_prefix is null or starts_with(f.cluster_key, p_cluster_prefix))
    group by f.cluster_key, f.bucket
  ),
  bkt_json as (
    select
      b.cluster_key,
      jsonb_object_agg(
        b.bucket,
        jsonb_build_object('games', b.games, 'sum_placement', b.sum_placement)
      ) as bucket_breakdown
    from bkt b
    group by b.cluster_key
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
    a.carry_star_dist_merged,
    a.contested_dist_merged,
    bj.bucket_breakdown
  from agg a
  left join bkt_json bj on bj.cluster_key = a.cluster_key
  where a.games >= p_min_games
$function$;
revoke all on function public.get_tft_comp_stats(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_cluster_prefix text, p_end_day date) from public, anon, authenticated, service_role;
grant execute on function public.get_tft_comp_stats(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_cluster_prefix text, p_end_day date) to service_role;

commit;

notify pgrst, 'reload schema';
