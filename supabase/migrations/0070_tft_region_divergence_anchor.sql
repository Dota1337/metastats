-- 0070: Region-Divergenz — Fenster am juengsten Datentag statt am Kalendertag
--
-- Vorher (0032) zaehlte das Fenster ab current_date. Hinkt der Crawl einen Tag
-- hinterher, fiel bei p_days=3 ein Drittel des Fensters auf Tage ohne Daten.
-- Jetzt: anker = juengster Tag IRGENDEINER der Regionen kr/euw1/na1 (greatest,
-- User-Entscheid 2026-09-13), Fenster = (anker - p_days, anker]. Halb gecrawlte
-- Tage bleiben drin (ebenfalls User-Entscheid).
--
-- Den Anker holt je Region und Rang ein Einzel-Nachschlag (order by day desc
-- limit 1) auf dem Index aus 0062 (region, bucket, set_number, day). Die
-- Untergrenze current_date - (p_days + 14) haelt den Nachschlag kurz, falls
-- eine Region lange keine Daten hat.
--
-- Gleiche Signatur und Rueckgabe wie 0032 → create or replace reicht, keine
-- Aufrufer-Aenderung. Rollback: supabase/rollback/0070_tft_region_divergence_anchor_rollback.sql

create or replace function get_tft_region_divergence(
  p_buckets text[],
  p_set int default null,
  p_patch text default null,
  p_days int default 3,
  p_min_games int default 100
)
returns table (
  cluster_key text,
  games_kr bigint,
  games_eu bigint,
  games_na bigint,
  avg_place_kr double precision,
  avg_place_eu double precision,
  avg_place_na double precision,
  pickrate_kr double precision,
  pickrate_eu double precision,
  pickrate_na double precision
)
language sql
stable
as $$
  with latest as (
    select (
      select max(x.day)
      from unnest(p_buckets) b(bk),
      lateral (
        select t.day
        from tft_daily_comp_stats t
        where t.region = r.region
          and t.bucket = b.bk
          and (p_set is null or t.set_number = p_set)
          and (p_patch is null or t.patch = p_patch)
          and t.day > current_date - (p_days + 14)
        order by t.day desc
        limit 1
      ) x
    ) as last_day
    from (values ('kr'), ('euw1'), ('na1')) r(region)
  ),
  bounds as (
    select max(last_day) as hi, max(last_day) - p_days as lo from latest
  ),
  parts as (
    select
      coalesce(sum(games) filter (where region = 'kr'),   0)::bigint as parts_kr,
      coalesce(sum(games) filter (where region = 'euw1'), 0)::bigint as parts_eu,
      coalesce(sum(games) filter (where region = 'na1'),  0)::bigint as parts_na
    from tft_daily_comp_stats
    where region in ('kr','euw1','na1')
      and bucket = any(p_buckets)
      and day > (select lo from bounds)
      and day <= (select hi from bounds)
      and (p_patch is null or patch = p_patch)
      and (p_set is null or set_number = p_set)
  ),
  agg as (
    select
      cluster_key,
      coalesce(sum(games) filter (where region = 'kr'),   0)::bigint as games_kr,
      coalesce(sum(games) filter (where region = 'euw1'), 0)::bigint as games_eu,
      coalesce(sum(games) filter (where region = 'na1'),  0)::bigint as games_na,
      coalesce(sum(sum_placement) filter (where region = 'kr'),   0)::bigint as sp_kr,
      coalesce(sum(sum_placement) filter (where region = 'euw1'), 0)::bigint as sp_eu,
      coalesce(sum(sum_placement) filter (where region = 'na1'),  0)::bigint as sp_na
    from tft_daily_comp_stats
    where region in ('kr','euw1','na1')
      and bucket = any(p_buckets)
      and day > (select lo from bounds)
      and day <= (select hi from bounds)
      and (p_patch is null or patch = p_patch)
      and (p_set is null or set_number = p_set)
    group by cluster_key
  )
  select
    a.cluster_key,
    a.games_kr,
    a.games_eu,
    a.games_na,
    case when a.games_kr > 0 then a.sp_kr::float8 / a.games_kr else null end,
    case when a.games_eu > 0 then a.sp_eu::float8 / a.games_eu else null end,
    case when a.games_na > 0 then a.sp_na::float8 / a.games_na else null end,
    case when (select parts_kr from parts) > 0
         then a.games_kr::float8 / (select parts_kr from parts) else null end,
    case when (select parts_eu from parts) > 0
         then a.games_eu::float8 / (select parts_eu from parts) else null end,
    case when (select parts_na from parts) > 0
         then a.games_na::float8 / (select parts_na from parts) else null end
  from agg a
  where greatest(a.games_kr, a.games_eu, a.games_na) >= p_min_games
$$;

-- 0055 hat die Funktion fuer public/anon/authenticated gesperrt; create or
-- replace behaelt die Rechte zwar, aber wir setzen sie explizit neu.
revoke all on function get_tft_region_divergence(text[], integer, text, integer, integer) from public, anon, authenticated;
grant execute on function get_tft_region_divergence(text[], integer, text, integer, integer) to service_role;

notify pgrst, 'reload schema';
