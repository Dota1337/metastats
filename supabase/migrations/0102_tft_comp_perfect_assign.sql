-- 0102: Comp-Katalog Phase 3 — Perfekt-Zahlen lesen, Vergleiche nur bei gleicher Zaehlart.
--
-- WARUM: Ab dem ersten Katalog-Tag (fruehestens 24.10.2026) ordnet der Sammler
-- jedes Brett seiner Comp zu und zaehlt „perfekt getroffen“ mit (0101). Die
-- Detailseite bekommt einen Schalter „Alle Spiele | Perfekt getroffen“ und
-- braucht dafuer die Perfekt-Summen. Vergleiche (Patch gegen Vorpatch,
-- Aufsteiger) duerfen klassisch und je Brett gezaehlte Tage nicht mischen:
-- gemessen 20.10.2026 (V1, 43.648 Bretter) verschiebt allein der Wechsel der
-- Zaehlart einzelne Comps um Median +0,04, 10–90 % −0,24…+0,34 Plaetze.
-- Plan und Verdicts: .claude/plan-current.md, Phase 3.
--
--  * get_tft_comp_stats: + perfect_games, perfect_sum_placement, perfect_top4,
--    perfect_top1 (null = keine Zeile bewertet) und perfect_base_games (Spiele
--    nur bewerteter Zeilen = Nenner fuer den Anteil).
--  * get_tft_comp_stats_for_diff: + p_assign ('catalog' | 'classic' | null),
--    LETZTER Parameter (die Box ruft positionsweise mit 6 Argumenten).
--  * get_tft_comp_velocity (8 Argumente): Zaehlart-Regel intern, Signatur gleich.
--  * get_tft_comp_marked_days: Katalog-Tage je Patch (Region×Tage) — daraus
--    entscheiden Seite und Box, welche Zaehlart ein Patch-Vergleich nimmt.
--
-- Alles abwaertsvertraeglich: ohne Katalog-Tage liefern alle Funktionen genau
-- das Bisherige. Rueckweg: ERST Code (Vercel + Box) zurueck, DANN
-- supabase/rollback/0102_tft_comp_perfect_assign_rollback.sql — umgekehrt ruft
-- der neue Code p_assign gegen die alte Funktion (502 wie am 18.10., 0098).

begin;
set local lock_timeout = '5s';

-- get_tft_comp_stats ----------------------------------------------------
drop function public.get_tft_comp_stats(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_cluster_prefix text, p_end_day date, p_cluster_traits text[], p_cluster_families text[]);
CREATE FUNCTION public.get_tft_comp_stats(p_regions text[], p_buckets text[], p_days integer DEFAULT 3, p_patch text DEFAULT NULL::text, p_set integer DEFAULT NULL::integer, p_min_games integer DEFAULT 30, p_cluster_prefix text DEFAULT NULL::text, p_end_day date DEFAULT NULL::date, p_cluster_traits text[] DEFAULT NULL::text[], p_cluster_families text[] DEFAULT NULL::text[])
 RETURNS TABLE(cluster_key text, games bigint, sum_placement bigint, top4 bigint, top1 bigint, sum_level bigint, sum_last_round bigint, sum_players_eliminated bigint, sum_gold_left bigint, participants bigint, typical_units_merged jsonb, typical_augments_merged jsonb, carry_items_merged jsonb, last_round_dist_merged jsonb, top4_by_round_merged jsonb, level_dist_merged jsonb, level_sum_last_round_merged jsonb, carry_star_dist_merged jsonb, contested_dist_merged jsonb, bucket_breakdown jsonb, perfect_games bigint, perfect_sum_placement bigint, perfect_top4 bigint, perfect_top1 bigint, perfect_base_games bigint)
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
      jsonb_agg(coalesce(f.contested_dist,  '{}'::jsonb)) as contested_dist_merged,
      -- Perfekt (0101): null = keine Zeile bewertet; Basis = Spiele nur bewerteter Zeilen.
      sum(f.perfect_games)::bigint as perfect_games,
      sum(f.perfect_sum_placement)::bigint as perfect_sum_placement,
      sum(f.perfect_top4)::bigint as perfect_top4,
      sum(f.perfect_top1)::bigint as perfect_top1,
      coalesce(sum(f.games) filter (where f.perfect_games is not null), 0)::bigint as perfect_base_games
    from tft_daily_comp_stats f
    where f.region = any(p_regions)
      and f.bucket = any(p_buckets)
      and f.day >= coalesce(p_end_day + 1, current_date) - (p_days || ' days')::interval and f.day <= coalesce(p_end_day, current_date)
      and (p_patch is null or f.patch = p_patch)
      and (p_set is null or f.set_number = p_set)
      and (p_cluster_prefix is null or starts_with(f.cluster_key, p_cluster_prefix))
      and (p_cluster_traits is null or split_part(f.cluster_key, '@', 1) = any(p_cluster_traits))
      and (p_cluster_families is null or regexp_replace(f.cluster_key, '^(.+)@[0-9]+_([^#*~]+).*$', '\1__\2') = any(p_cluster_families))
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
      and (p_cluster_traits is null or split_part(f.cluster_key, '@', 1) = any(p_cluster_traits))
      and (p_cluster_families is null or regexp_replace(f.cluster_key, '^(.+)@[0-9]+_([^#*~]+).*$', '\1__\2') = any(p_cluster_families))
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
    bj.bucket_breakdown,
    a.perfect_games,
    a.perfect_sum_placement,
    a.perfect_top4,
    a.perfect_top1,
    a.perfect_base_games
  from agg a
  left join bkt_json bj on bj.cluster_key = a.cluster_key
  where a.games >= p_min_games
$function$;
revoke all on function public.get_tft_comp_stats(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_cluster_prefix text, p_end_day date, p_cluster_traits text[], p_cluster_families text[]) from public, anon, authenticated, service_role;
grant execute on function public.get_tft_comp_stats(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_cluster_prefix text, p_end_day date, p_cluster_traits text[], p_cluster_families text[]) to service_role;

-- get_tft_comp_stats_for_diff -------------------------------------------
drop function public.get_tft_comp_stats_for_diff(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_end_day date);

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

-- get_tft_comp_velocity (8 Argumente) ------------------------------------
CREATE OR REPLACE FUNCTION public.get_tft_comp_velocity(p_regions text[], p_buckets text[], p_set integer DEFAULT NULL::integer, p_patch text DEFAULT NULL::text, p_days integer DEFAULT 3, p_shift_days integer DEFAULT 3, p_min_games integer DEFAULT 30, p_anchor_offset_days integer DEFAULT 0)
 RETURNS TABLE(cluster_key text, games_now bigint, games_prev bigint, sum_placement_now bigint, sum_placement_prev bigint, top4_now bigint, top4_prev bigint, top1_now bigint, top1_prev bigint, participants_now bigint, participants_prev bigint)
 LANGUAGE sql
 STABLE
AS $function$
  -- Zaehlart (0102): hat das neuere Fenster Katalog-Tage, zaehlen in BEIDEN
  -- Fenstern nur Katalog-Tage, sonst nur klassische — ein Vergleich ueber den
  -- Wechsel waere Schein-Bewegung (bis ±0,3 Plaetze je Comp, gemessen 20.10.2026).
  with mk as (
    select m.region, m.day, bool_or(m.catalog_id is not null) as marked
    from tft_daily_crawl_meta m
    where m.region = any(p_regions)
      and m.day > (current_date - (p_anchor_offset_days || ' days')::interval) - ((p_days + p_shift_days) || ' days')::interval
      and m.day <= (current_date - (p_anchor_offset_days || ' days')::interval)
      and (p_set is null or m.set_number = p_set)
    group by m.region, m.day
  ),
  vmode as (
    select coalesce(bool_or(marked) filter (where day > (current_date - (p_anchor_offset_days || ' days')::interval) - (p_days || ' days')::interval), false) as catalog from mk
  ),
  marked as (select region, day from mk where marked),
  totals as (
    select
      coalesce(sum(games) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - (p_days || ' days')::interval
          and day <= current_date - (p_anchor_offset_days || ' days')::interval
      ), 0)::bigint as parts_now,
      coalesce(sum(games) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - ((p_days + p_shift_days) || ' days')::interval
          and day <= (current_date - (p_anchor_offset_days || ' days')::interval) - (p_shift_days || ' days')::interval
      ), 0)::bigint as parts_prev
    from tft_daily_comp_stats
    where region = any(p_regions)
      and bucket = any(p_buckets)
      and day > (current_date - (p_anchor_offset_days || ' days')::interval) - ((p_days + p_shift_days) || ' days')::interval
      and day <= current_date - (p_anchor_offset_days || ' days')::interval
      and (p_patch is null or patch = p_patch)
      and (p_set is null or set_number = p_set)
      and (case when (select catalog from vmode) then (region, day) in (select region, day from marked)
                else (region, day) not in (select region, day from marked) end)
  ),
  agg as (
    select
      cluster_key,
      sum(games) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - (p_days || ' days')::interval
          and day <= current_date - (p_anchor_offset_days || ' days')::interval
      )::bigint as games_now,
      sum(games) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - ((p_days + p_shift_days) || ' days')::interval
          and day <= (current_date - (p_anchor_offset_days || ' days')::interval) - (p_shift_days || ' days')::interval
      )::bigint as games_prev,
      sum(sum_placement) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - (p_days || ' days')::interval
          and day <= current_date - (p_anchor_offset_days || ' days')::interval
      )::bigint as sum_placement_now,
      sum(sum_placement) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - ((p_days + p_shift_days) || ' days')::interval
          and day <= (current_date - (p_anchor_offset_days || ' days')::interval) - (p_shift_days || ' days')::interval
      )::bigint as sum_placement_prev,
      sum(top4) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - (p_days || ' days')::interval
          and day <= current_date - (p_anchor_offset_days || ' days')::interval
      )::bigint as top4_now,
      sum(top4) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - ((p_days + p_shift_days) || ' days')::interval
          and day <= (current_date - (p_anchor_offset_days || ' days')::interval) - (p_shift_days || ' days')::interval
      )::bigint as top4_prev,
      sum(top1) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - (p_days || ' days')::interval
          and day <= current_date - (p_anchor_offset_days || ' days')::interval
      )::bigint as top1_now,
      sum(top1) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - ((p_days + p_shift_days) || ' days')::interval
          and day <= (current_date - (p_anchor_offset_days || ' days')::interval) - (p_shift_days || ' days')::interval
      )::bigint as top1_prev
    from tft_daily_comp_stats
    where region = any(p_regions)
      and bucket = any(p_buckets)
      and day > (current_date - (p_anchor_offset_days || ' days')::interval) - ((p_days + p_shift_days) || ' days')::interval
      and day <= current_date - (p_anchor_offset_days || ' days')::interval
      and (p_patch is null or patch = p_patch)
      and (p_set is null or set_number = p_set)
      and (case when (select catalog from vmode) then (region, day) in (select region, day from marked)
                else (region, day) not in (select region, day from marked) end)
    group by cluster_key
  )
  select
    a.cluster_key,
    coalesce(a.games_now, 0),
    coalesce(a.games_prev, 0),
    coalesce(a.sum_placement_now, 0),
    coalesce(a.sum_placement_prev, 0),
    coalesce(a.top4_now, 0),
    coalesce(a.top4_prev, 0),
    coalesce(a.top1_now, 0),
    coalesce(a.top1_prev, 0),
    (select parts_now from totals),
    (select parts_prev from totals)
  from agg a
  where coalesce(a.games_now, 0) + coalesce(a.games_prev, 0) >= p_min_games
$function$;
revoke all on function public.get_tft_comp_velocity(p_regions text[], p_buckets text[], p_set integer, p_patch text, p_days integer, p_shift_days integer, p_min_games integer, p_anchor_offset_days integer) from public, anon, authenticated, service_role;
grant execute on function public.get_tft_comp_velocity(p_regions text[], p_buckets text[], p_set integer, p_patch text, p_days integer, p_shift_days integer, p_min_games integer, p_anchor_offset_days integer) to service_role;

-- get_tft_comp_marked_days ----------------------------------------------
create or replace function public.get_tft_comp_marked_days(p_set integer, p_regions text[] default null)
returns table(patch text, marked_days integer, region_days integer)
language sql
stable
as $$
  select x.patch, (count(*) filter (where x.marked))::int, count(*)::int
  from (
    select m.patch, m.region, m.day, bool_or(m.catalog_id is not null) as marked
    from public.tft_daily_crawl_meta m
    where m.set_number = p_set
      and (p_regions is null or m.region = any(p_regions))
    group by m.patch, m.region, m.day
  ) x
  group by x.patch
$$;
revoke all on function public.get_tft_comp_marked_days(p_set integer, p_regions text[]) from public, anon, authenticated, service_role;
grant execute on function public.get_tft_comp_marked_days(p_set integer, p_regions text[]) to service_role;

-- Selbstpruefung: je eine Signatur, Rechte nur service_role.
do $$
declare
  w text;
  n int;
  fid oid;
begin
  foreach w in array array[
    'get_tft_comp_stats(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_cluster_prefix text, p_end_day date, p_cluster_traits text[], p_cluster_families text[])',
    'get_tft_comp_stats_for_diff(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_end_day date, p_assign text)',
    'get_tft_comp_velocity(p_regions text[], p_buckets text[], p_set integer, p_patch text, p_days integer, p_shift_days integer, p_min_games integer, p_anchor_offset_days integer)',
    'get_tft_comp_marked_days(p_set integer, p_regions text[])'
  ] loop
    fid := null;
    select p.oid into fid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = w;
    if fid is null then raise exception '0102: Signatur fehlt: %', w; end if;
    if has_function_privilege('anon', fid, 'execute')
       or has_function_privilege('authenticated', fid, 'execute')
       or not has_function_privilege('service_role', fid, 'execute') then
      raise exception '0102: Rechte falsch: %', w;
    end if;
  end loop;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname in ('get_tft_comp_stats', 'get_tft_comp_stats_for_diff');
  if n <> 2 then raise exception '0102: get_tft_comp_stats/_for_diff haben zusammen % Signaturen', n; end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
