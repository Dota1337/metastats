-- Rollback 0098: alte Signatur von get_tft_comp_stats_for_diff (Stand 0035) zurueck.
-- Danach bricht der Patch-Vergleich der Comps mit p_end_day wieder ab — nur
-- zusammen mit dem Code-Rueckbau von b8ef1ee5 ausfuehren.

begin;

set local lock_timeout = '2s';

drop function public.get_tft_comp_stats_for_diff(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_end_day date);

CREATE FUNCTION public.get_tft_comp_stats_for_diff(p_regions text[], p_buckets text[], p_days integer DEFAULT 3, p_patch text DEFAULT NULL::text, p_set integer DEFAULT NULL::integer, p_min_games integer DEFAULT 30)
 RETURNS TABLE(cluster_key text, games bigint, sum_placement bigint, top4 bigint, top1 bigint, participants bigint)
 LANGUAGE sql
 STABLE
AS $function$
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
$function$;
revoke all on function public.get_tft_comp_stats_for_diff(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer) from public, anon, authenticated, service_role;
grant execute on function public.get_tft_comp_stats_for_diff(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer) to service_role;

commit;

notify pgrst, 'reload schema';
