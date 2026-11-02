-- 0116: Traeger der Item-Detailseite schnell (User 02.11.2026, „Erst Index, dann messen").
--
-- get_tft_item_carriers (0096) fuer EIN Item las die ganze Woche aller Items: gemessen 02.11.
-- 29 Besucheraufrufe seit dem DB-Neustart Ø 4.489 ms, max 12.670 ms, 8.262 Bloecke von Platte
-- je Aufruf (pg_stat_statements); kalte Woche mit festen Werten 15.379 ms, 27.021 Bloecke.
-- Die Route bricht nach 8 s ab → die Tabelle „Top Carriers" fehlte.
-- Zwei Ursachen, beide noetig:
--   1. Kein Index beginnt mit api_name. Der Unique-Index (region, bucket, patch, set_number, day,
--      api_name) hat patch/set_number vor day — ohne Patch-Filter laeuft der Scan je Region × Rang
--      ueber die ganze Historie.
--   2. PostgREST bettet die Funktion ein (LATERAL … get_tft_item_carriers(p_api_names := …)).
--      `(p_api_names is null or api_name = any(p_api_names))` bleibt dann ein nachtraeglicher
--      Filter (Plan: Index Scan idx_tft_daily_item_lookup, Filter auf api_name) — kein Index
--      koennte ihn nutzen. Deshalb zwei Zweige (UNION ALL): der Zweig fuer genannte Items hat
--      `api_name = any(p_api_names)` ohne ODER, der Zweig fuer „alle" (Vorrat detail-builds) wird
--      per One-Time-Filter abgeschaltet, wenn Items genannt sind. Gleiche Signatur, gleiche
--      Ausgabe (vorher/nachher byte-gleich verglichen, 6 Faelle), keine App-Aenderung.
-- Index (api_name, day) ohne INCLUDE: die Schluessel wiederholen sich stark (Deduplizierung),
-- region filtert nichts (alle 15 Regionen in jeder Abfrage „alle"). Andere Leser der Tabelle
-- (item_stats, item_stats_list, velocity) filtern nicht nach api_name.
--
-- CONCURRENTLY: kein Transaktionsblock. Mit scripts/db-exec.mjs einspielen (Anweisung fuer
-- Anweisung), NICHT waehrend Tageslauf/VACUUM danach (05:45 UTC +) und nicht parallel zu anderer
-- DDL auf der Tabelle. statement_timeout = 0 zuerst: der Session-Pooler hat 2 min, global 20 s.
-- Kein lock_timeout fuer den Index-Bau (die Warte-Phasen sind Sperr-Wartezeiten, ein Abbruch
-- hinterliesse einen ungueltigen Index); bricht er ab, raeumt die erste Zeile ihn beim naechsten
-- Versuch weg.
-- Rueckbau: supabase/rollback/0116_tft_item_carriers_api_name_index_rollback.sql
set statement_timeout = 0;

drop index concurrently if exists public.idx_tft_daily_item_api_day;

create index concurrently idx_tft_daily_item_api_day
  on public.tft_daily_item_stats (api_name, day);

set lock_timeout = '5s';

create or replace function public.get_tft_item_carriers(
  p_api_names text[],
  p_regions text[],
  p_buckets text[],
  p_days integer default 3,
  p_patch text default null,
  p_set integer default null,
  p_end_day date default null
)
returns table(api_name text, carriers jsonb)
language sql
stable
as $$
  with src as (
    -- Genannte Items: api_name als Index-Bedingung (idx_tft_daily_item_api_day).
    select f.api_name, f.top_users
    from public.tft_daily_item_stats f
    where p_api_names is not null
      and f.api_name = any(p_api_names)
      and f.region = any(p_regions)
      and f.bucket = any(p_buckets)
      and f.day >= coalesce(p_end_day + 1, current_date) - (p_days || ' days')::interval and f.day <= coalesce(p_end_day, current_date)
      and (p_patch is null or f.patch = p_patch)
      and (p_set is null or f.set_number = p_set)
    union all
    -- Alle Items (Vorrat detail-builds, nur Publisher).
    select f.api_name, f.top_users
    from public.tft_daily_item_stats f
    where p_api_names is null
      and f.region = any(p_regions)
      and f.bucket = any(p_buckets)
      and f.day >= coalesce(p_end_day + 1, current_date) - (p_days || ' days')::interval and f.day <= coalesce(p_end_day, current_date)
      and (p_patch is null or f.patch = p_patch)
      and (p_set is null or f.set_number = p_set)
  ),
  users as (
    select s.api_name, u->>'characterId' as k,
           sum((u->>'games')::bigint) as g,
           sum(coalesce((u->>'sumPlacement')::bigint, 0)) as sp,
           sum(coalesce((u->>'top4')::bigint, 0)) as t4,
           sum(coalesce((u->>'top1')::bigint, 0)) as t1
    from src s
    cross join lateral jsonb_array_elements(s.top_users) u
    where u->>'characterId' is not null
    group by 1, 2
  )
  select api_name, jsonb_agg(jsonb_build_array(k, g, sp, t4, t1) order by g desc, k collate "C")
  from (select u.*, row_number() over (partition by u.api_name order by u.g desc, u.k collate "C") as rn from users u) x
  where rn <= 15
  group by api_name
$$;

-- Selbstpruefung: Index gueltig, eine Signatur, Rechte nur service_role (create or replace
-- behaelt sie, hier nur bestaetigt).
do $$
declare
  w text := 'get_tft_item_carriers(p_api_names text[], p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_end_day date)';
  n int;
  fid oid;
begin
  if not exists (
    select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
    where c.relname = 'idx_tft_daily_item_api_day' and i.indisvalid and i.indisready
  ) then
    raise exception '0116: idx_tft_daily_item_api_day fehlt oder ist ungueltig';
  end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'get_tft_item_carriers';
  if n <> 1 then raise exception '0116: get_tft_item_carriers hat % Signaturen', n; end if;
  select p.oid into fid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = w;
  if fid is null then raise exception '0116: Signatur fehlt: %', w; end if;
  if has_function_privilege('anon', fid, 'execute')
     or has_function_privilege('authenticated', fid, 'execute')
     or not has_function_privilege('service_role', fid, 'execute') then
    raise exception '0116: Rechte falsch';
  end if;
end;
$$;

notify pgrst, 'reload schema';
