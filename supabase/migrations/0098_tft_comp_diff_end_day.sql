-- 0098: get_tft_comp_stats_for_diff bekommt p_end_day wie die 14 Funktionen in 0095.
--
-- Der Patch-Vergleich rechnet seit 18.10.2026 je ganzem Patch (erster bis
-- letzter Tag, patchDiffWindowArgs in app/lib/snapshot-matrix.ts) und uebergibt
-- dafuer p_end_day — fuer Units, Items und Traits gab es den seit 0095, fuer
-- diese Comp-Funktion nicht. Folge: der stuendliche Box-Lauf
-- (scripts/publish-meta-pulse-diffs.mjs) brach ab 15:27 UTC mit „function ...
-- does not exist" ab, und /api/tft/patch-diff?entity=comp fuer eine einzelne
-- Region lieferte 502.
--
-- Gleiche Regel wie 0095, am ENDE `p_end_day date default null`:
--   mit p_end_day:  day >= p_end_day + 1 - p_days  and day <= p_end_day   (genau p_days Tage)
--   ohne:           day >= current_date - p_days   and day <= current_date (altes Fenster)
-- Aufrufer ohne den Schluessel (Meta Pulse, app/api/tft/meta-pulse/route.ts)
-- laufen unveraendert weiter.
--
-- Alte Signatur wird geloescht statt ueberladen (PGRST203, siehe 0095). Rumpf =
-- pg_get_functiondef der Live-DB vom 18.10.2026 (gleich 0035), nur Signatur und
-- die zwei Fensterzeilen geaendert. Rechte wie vorher: nur service_role.
--
-- Ausfuehren: node scripts/db-exec.mjs supabase/migrations/0098_tft_comp_diff_end_day.sql
-- Rollback:   supabase/rollback/0098_tft_comp_diff_end_day_rollback.sql

begin;

set local lock_timeout = '2s';

drop function public.get_tft_comp_stats_for_diff(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer);

CREATE FUNCTION public.get_tft_comp_stats_for_diff(p_regions text[], p_buckets text[], p_days integer DEFAULT 3, p_patch text DEFAULT NULL::text, p_set integer DEFAULT NULL::integer, p_min_games integer DEFAULT 30, p_end_day date DEFAULT NULL::date)
 RETURNS TABLE(cluster_key text, games bigint, sum_placement bigint, top4 bigint, top1 bigint, participants bigint)
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
      sum(f.top1)::bigint as top1
    from tft_daily_comp_stats f
    where f.region = any(p_regions)
      and f.bucket = any(p_buckets)
      and f.day >= coalesce(p_end_day + 1, current_date) - (p_days || ' days')::interval and f.day <= coalesce(p_end_day, current_date)
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
revoke all on function public.get_tft_comp_stats_for_diff(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_end_day date) from public, anon, authenticated, service_role;
grant execute on function public.get_tft_comp_stats_for_diff(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_end_day date) to service_role;

commit;

-- PostgREST kennt die neue Signatur erst nach dem Neuladen des Schemas.
notify pgrst, 'reload schema';
