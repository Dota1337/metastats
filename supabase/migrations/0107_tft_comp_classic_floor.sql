-- 0107: Patch-Vergleich in gemeinsamer Zaehlart + klassische Schattenzeilen je Rang.
--
-- WARUM: Ein Patch mit Katalog- UND klassischen Tagen (18.5b: klassisch
-- 22.–23.10., Katalog ab 24.10.) liess sich bisher mit keinem Vorpatch
-- vergleichen (compDeltaAssign → null, Patch-Beweger leer). Neu vergleicht er
-- sich ueber seine klassischen Tage mit einem rein klassischen Vorpatch. Diese
-- Tage liefen aber mit Mindestspielen 3 je Zeile statt 8 (~10 % der Spiele in
-- Zeilen unter 8) — der Pickrate-Nenner waere verzerrt. Deshalb:
--
--  * get_tft_comp_stats_for_diff: + p_min_row_games (LETZTER Parameter,
--    default null). Gesetzt zaehlen Zeilen mit games < Wert weder in den Zeilen
--    noch im Nenner (participants). Aufrufer setzen 8 nur fuer die klassische
--    Seite eines gemischten Patches (compMinRowGames, snapshot-matrix.ts).
--  * tft_daily_comp_classic_bucket — klassische Cluster je Region×Tag×Rang
--    (inkl. pro_pool), an klassischen UND Katalog-Tagen, 40 Tage aufbewahrt.
--    Kuenftige Wechsel der Zaehlart haben so eine klassische Spur je Rang.
--    Noch kein Leser (erst wenn ein Patch-Paar sie voll abdeckt).
--
-- Plan und Verdicts: .claude/plan-current.md (29.10.2026).
--
-- REIHENFOLGE: diese Migration ZUERST, dann der Code (Vercel + Box) — der neue
-- Code ruft p_min_row_games. Rueckweg: ERST Code zurueck, DANN
-- supabase/rollback/0107_tft_comp_classic_floor_rollback.sql — umgekehrt ruft
-- der neue Code p_min_row_games gegen die alte Funktion (502 wie am 18.10., 0098).

begin;
set local lock_timeout = '5s';

-- get_tft_comp_stats_for_diff -------------------------------------------
drop function public.get_tft_comp_stats_for_diff(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_end_day date, p_assign text);

CREATE FUNCTION public.get_tft_comp_stats_for_diff(p_regions text[], p_buckets text[], p_days integer DEFAULT 3, p_patch text DEFAULT NULL::text, p_set integer DEFAULT NULL::integer, p_min_games integer DEFAULT 30, p_end_day date DEFAULT NULL::date, p_assign text DEFAULT NULL::text, p_min_row_games integer DEFAULT NULL::integer)
 RETURNS TABLE(cluster_key text, games bigint, sum_placement bigint, top4 bigint, top1 bigint, participants bigint)
 LANGUAGE sql
 STABLE
AS $function$
  -- Zaehlart (0102): Region×Tage mit Katalog-Marker. 'catalog' = nur diese,
  -- 'classic' = alle anderen, null = alle (wie bis 0098). Eine Liste, einmal
  -- gerechnet (unkorreliert) — crawl_meta hat je Region×Tag eine Zeile je Rang.
  -- Zeilen-Grenze (0107): p_min_row_games gesetzt → Zeilen darunter zaehlen
  -- weder in den Zeilen noch im Nenner.
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
      and (p_min_row_games is null or games >= p_min_row_games)
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
      and (p_min_row_games is null or f.games >= p_min_row_games)
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
revoke all on function public.get_tft_comp_stats_for_diff(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_end_day date, p_assign text, p_min_row_games integer) from public, anon, authenticated, service_role;
grant execute on function public.get_tft_comp_stats_for_diff(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_end_day date, p_assign text, p_min_row_games integer) to service_role;

-- tft_daily_comp_classic_bucket -------------------------------------------
-- Klassische Cluster (Format wie tft_daily_comp_stats.cluster_key vor dem
-- Katalog) je Region×Tag×Rang. patch roh (z. B. 18.5b), bucket = Einzelrang
-- inkl. pro_pool. Schreiben/Aufraeumen per run_id wie tft_daily_comp_classic.
create table if not exists public.tft_daily_comp_classic_bucket (
  region text not null,
  set_number integer not null,
  patch text not null,
  day date not null,
  bucket text not null,
  cluster_key text not null,
  games integer not null,
  sum_placement integer not null,
  top4 integer not null,
  top1 integer not null,
  run_id text,
  primary key (region, set_number, day, bucket, cluster_key)
);
create index if not exists idx_tft_daily_comp_classic_bucket_set_patch_day
  on public.tft_daily_comp_classic_bucket (set_number, patch, day);
alter table public.tft_daily_comp_classic_bucket enable row level security;
revoke all on public.tft_daily_comp_classic_bucket from anon, authenticated;

-- Selbstpruefung: eine Signatur je Funktion, Rechte nur service_role, Tabelle dicht.
do $$
declare
  w text := 'get_tft_comp_stats_for_diff(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_end_day date, p_assign text, p_min_row_games integer)';
  n int;
  fid oid;
begin
  select p.oid into fid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = w;
  if fid is null then raise exception '0107: Signatur fehlt: %', w; end if;
  if has_function_privilege('anon', fid, 'execute')
     or has_function_privilege('authenticated', fid, 'execute')
     or not has_function_privilege('service_role', fid, 'execute') then
    raise exception '0107: Rechte falsch: %', w;
  end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname in ('get_tft_comp_stats', 'get_tft_comp_stats_for_diff');
  if n <> 2 then raise exception '0107: get_tft_comp_stats/_for_diff haben zusammen % Signaturen', n; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.tft_daily_comp_classic_bucket'::regclass) then
    raise exception '0107: RLS aus auf tft_daily_comp_classic_bucket';
  end if;
  if has_table_privilege('anon', 'public.tft_daily_comp_classic_bucket', 'select')
     or has_table_privilege('authenticated', 'public.tft_daily_comp_classic_bucket', 'select') then
    raise exception '0107: anon/authenticated liest tft_daily_comp_classic_bucket';
  end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
