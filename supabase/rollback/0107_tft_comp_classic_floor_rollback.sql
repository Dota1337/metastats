-- Rollback 0107: get_tft_comp_stats_for_diff auf den Stand von 0102 (ohne
-- p_min_row_games), Tabelle tft_daily_comp_classic_bucket entfernen.
-- REIHENFOLGE: erst den Code auf Vercel und der Box zuruecksetzen, dann dies —
-- der 0107-Code ruft p_min_row_games und schreibt die neue Tabelle.

begin;
set local lock_timeout = '5s';

drop table if exists public.tft_daily_comp_classic_bucket;

drop function public.get_tft_comp_stats_for_diff(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_end_day date, p_assign text, p_min_row_games integer);

CREATE FUNCTION public.get_tft_comp_stats_for_diff(p_regions text[], p_buckets text[], p_days integer DEFAULT 3, p_patch text DEFAULT NULL::text, p_set integer DEFAULT NULL::integer, p_min_games integer DEFAULT 30, p_end_day date DEFAULT NULL::date, p_assign text DEFAULT NULL::text)
 RETURNS TABLE(cluster_key text, games bigint, sum_placement bigint, top4 bigint, top1 bigint, participants bigint)
 LANGUAGE sql
 STABLE
AS $function$
  -- Zaehlart (0102): Region×Tage mit Katalog-Marker. 'catalog' = nur diese,
  -- 'classic' = alle anderen, null = alle (wie bis 0098). Eine Liste, einmal
  -- gerechnet (unkorreliert) — crawl_meta hat je Region×Tag eine Zeile je Rang.
  with marked as (
    select m.region, m.day
    from tft_daily_crawl_meta m
    where p_assign is not null
      and m.region = any(p_regions)
      and m.day >= coalesce(p_end_day + 1, current_date) - (p_days || ' days')::interval and m.day <= coalesce(p_end_day, current_date)
      and (p_set is null or m.set_number = p_set)
    group by m.region, m.day
    having bool_or(m.catalog_id is not null)
  ),
  parts as (
    select coalesce(sum(games), 0)::bigint as total
    from tft_daily_comp_stats
    where region = any(p_regions)
      and bucket = any(p_buckets)
      and day >= coalesce(p_end_day + 1, current_date) - (p_days || ' days')::interval and day <= coalesce(p_end_day, current_date)
      and (p_patch is null or patch = p_patch)
      and (p_set is null or set_number = p_set)
      and (p_assign is null
        or (p_assign = 'catalog' and (region, day) in (select region, day from marked))
        or (p_assign = 'classic' and (region, day) not in (select region, day from marked)))
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
      and f.day >= coalesce(p_end_day + 1, current_date) - (p_days || ' days')::interval and f.day <= coalesce(p_end_day, current_date)
      and (p_patch is null or f.patch = p_patch)
      and (p_set is null or f.set_number = p_set)
      and (p_assign is null
        or (p_assign = 'catalog' and (f.region, f.day) in (select region, day from marked))
        or (p_assign = 'classic' and (f.region, f.day) not in (select region, day from marked)))
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
revoke all on function public.get_tft_comp_stats_for_diff(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_end_day date, p_assign text) from public, anon, authenticated, service_role;
grant execute on function public.get_tft_comp_stats_for_diff(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_end_day date, p_assign text) to service_role;

-- Selbstpruefung: genau eine Signatur, Rechte nur service_role.
do $$
declare
  n int;
begin
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'get_tft_comp_stats_for_diff'
     and pg_get_function_identity_arguments(p.oid) = 'p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_end_day date, p_assign text';
  if n <> 1 then raise exception 'Rollback 0107: Signatur von 0102 fehlt'; end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname in ('get_tft_comp_stats', 'get_tft_comp_stats_for_diff');
  if n <> 2 then raise exception 'Rollback 0107: get_tft_comp_stats/_for_diff haben zusammen % Signaturen', n; end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
