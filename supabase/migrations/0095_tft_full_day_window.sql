-- 0095: „N Tage" = die letzten N vollstaendigen Tage (User 15.10.2026, Weg A2).
--
-- Bis hierher rechnete jede Tages-Abfrage `day >= current_date - p_days` ohne
-- Obergrenze. Sobald die erste Region den neuen Tag liefert (~08:14 CEST), zaehlte
-- der halb gefuellte Tag mit, waehrend der Vorrat vom Vorabend das alte Fenster
-- zeigte (Executioner Azir Meister+ 3 Tage: 6612 Vorrat gegen 5439 live).
--
-- Jede Funktion bekommt am ENDE `p_end_day date default null`:
--   mit p_end_day:  day >= p_end_day + 1 - p_days  and day <= p_end_day   (genau p_days Tage)
--   ohne:           day >= current_date - p_days   and day <= current_date (altes Fenster;
--                   die Obergrenze aendert nichts, es gibt keine Tage nach heute)
-- Die App uebergibt p_end_day nur, wenn sie einen Endtag kennt (rpcWindowArgs in
-- app/lib/tft-supabase-reader.ts); ohne Endtag ruft sie wie bisher ohne den Schluessel.
--
-- Die alte Signatur wird geloescht statt ueberladen — zwei Signaturen, die sich
-- nur im letzten Standardwert unterscheiden, beantwortet PostgREST mit PGRST203.
-- Rumpfe = pg_get_functiondef der Live-DB vom 15.10.2026, nur Signatur und
-- Fensterzeilen geaendert (erzeugt mit gen-0095.mjs, Pruefung: Zahl der
-- ersetzten Zeilen je Funktion, kein nacktes current_date uebrig).
--
-- Rechte: nur noch service_role. Alle Aufrufer laufen ueber callRpc mit dem
-- Service-Schluessel (grep callRpc in app/). Das schliesst nebenbei die offene
-- Luecke anon-execute:get_tft_comp_stats (infra/security-baseline.json, seit 0060).
-- Rechte vor 0095:
--   get_tft_comp_stats: vorher public, anon, authenticated, service_role
--   get_tft_comp_stats_list_v2: vorher service_role
--   get_tft_comp_outcome: vorher service_role
--   get_tft_comp_emblems: vorher service_role
--   get_tft_comp_matchups: vorher service_role
--   get_tft_comp_matchups_all: vorher service_role
--   get_tft_comp_pairs: vorher service_role
--   get_tft_unit_stats: vorher service_role
--   get_tft_unit_top_items: vorher service_role
--   get_tft_item_stats_list: vorher service_role
--   get_tft_trait_stats: vorher service_role
--   get_tft_trait_unitcount_stats: vorher service_role
--   get_tft_region_divergence: vorher service_role
--   get_tft_comp_list_precomputed: vorher service_role
--
-- Vorab-Liste tft_comp_list_precomputed: neue Spalte window_end (letzter Tag des
-- Fensters) im Primaerschluessel. Ohne sie haetten Zeilen fuer (Endtag E, N Tage)
-- und (E-1, N-1) denselben Schluessel. Bestehende Zeilen: window_end = last_day
-- (so rechnete das alte Fenster). Ein Ausloeser setzt window_end = last_day, wenn
-- ein Schreiber es weglaesst — damit laeuft das alte Box-Skript bis zu seinem
-- Austausch unveraendert weiter.
--
-- Ausfuehren: node scripts/db-exec.mjs supabase/migrations/0095_tft_full_day_window.sql
-- NICHT zwischen 20:00 und 23:30 CEST (Vorab-Rechnung + Publisher lesen diese Funktionen).
-- Rollback:   supabase/rollback/0095_tft_full_day_window_rollback.sql

begin;

set local lock_timeout = '2s';

alter table public.tft_comp_list_precomputed add column window_end date;
update public.tft_comp_list_precomputed set window_end = last_day;
alter table public.tft_comp_list_precomputed alter column window_end set not null;

create function public.tft_comp_list_precomputed_window_end() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.window_end is null then
    new.window_end := new.last_day;
  end if;
  return new;
end;
$$;
revoke all on function public.tft_comp_list_precomputed_window_end() from public, anon, authenticated;

create trigger tft_comp_list_precomputed_window_end
  before insert or update on public.tft_comp_list_precomputed
  for each row execute function public.tft_comp_list_precomputed_window_end();

alter table public.tft_comp_list_precomputed drop constraint tft_comp_list_precomputed_pkey;
alter table public.tft_comp_list_precomputed
  add constraint tft_comp_list_precomputed_pkey
  primary key (patch_key, set_number, regions_key, buckets_key, data_start, window_end);

-- get_tft_comp_stats ----------------------------------------------------
drop function public.get_tft_comp_stats(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_cluster_prefix text);
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

-- get_tft_comp_stats_list_v2 --------------------------------------------
drop function public.get_tft_comp_stats_list_v2(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_min_share numeric, p_min_cap integer);
CREATE FUNCTION public.get_tft_comp_stats_list_v2(p_regions text[], p_buckets text[], p_days integer DEFAULT 3, p_patch text DEFAULT NULL::text, p_set integer DEFAULT NULL::integer, p_min_games integer DEFAULT 30, p_min_share numeric DEFAULT NULL::numeric, p_min_cap integer DEFAULT NULL::integer, p_end_day date DEFAULT NULL::date)
 RETURNS TABLE(cluster_key text, games bigint, sum_placement bigint, top4 bigint, top1 bigint, sum_level bigint, sum_last_round bigint, participants bigint, typical_units_merged jsonb, typical_augments_merged jsonb, carry_items_merged jsonb)
 LANGUAGE sql
 STABLE
AS $function$
  with base as materialized (
    select
      f.cluster_key,
      f.games,
      f.sum_placement,
      f.top4,
      f.top1,
      f.sum_level,
      f.sum_last_round,
      f.typical_units,
      f.carry_items
    from tft_daily_comp_stats f
    where f.region = any(p_regions)
      and f.bucket = any(p_buckets)
      and f.day >= coalesce(p_end_day + 1, current_date) - (p_days || ' days')::interval and f.day <= coalesce(p_end_day, current_date)
      and (p_patch is null or f.patch = p_patch)
      and (p_set is null or f.set_number = p_set)
  ),
  agg as (
    select
      b.cluster_key,
      sum(b.games)::bigint as games,
      sum(b.sum_placement)::bigint as sum_placement,
      sum(b.top4)::bigint as top4,
      sum(b.top1)::bigint as top1,
      sum(coalesce(b.sum_level, 0))::bigint as sum_level,
      sum(coalesce(b.sum_last_round, 0))::bigint as sum_last_round
    from base b
    group by b.cluster_key
  ),
  keep as (
    select * from agg
    where games >= case
      when p_min_share is null or p_min_cap is null then p_min_games
      else greatest(p_min_games, least(p_min_cap, round(p_min_share * (select coalesce(sum(a2.games), 0) from agg a2))))
    end
  ),
  base_keep as (
    select b.cluster_key, b.typical_units, b.carry_items
    from base b
    join keep k on k.cluster_key = b.cluster_key
  ),
  units_raw as (
    select
      bk.cluster_key,
      u."characterId" as character_id,
      coalesce(u."count", u."games", 0)                     as v_count,
      coalesce(u."sumPlacement", u."sum_placement", 0)      as v_sum_placement,
      coalesce(u."games", 0)                                as v_games,
      coalesce(u."carryItemGames", u."carry_item_games", 0) as v_carry_item_games,
      coalesce(u."gamesWithUnit", u."games_with_unit", 0)   as v_games_with_unit,
      coalesce(
        u."gamesWithOutcome",
        u."gamesWithUnitOutcome",
        u."games_with_outcome",
        u."games_with_unit_outcome",
        0
      )                                                     as v_games_with_outcome,
      coalesce(u."top1", 0)                                 as v_top1,
      coalesce(u."top4", 0)                                 as v_top4,
      -- Sofort in absolute Doppel-Spiele umgerechnet statt `multiplicity`
      -- roh durch den Tuplestore zu tragen: eine Spalte statt zwei, und der
      -- Aggregations-Schritt bleibt eine simple Summe. `greatest(...,0)`
      -- faengt Werte < 1, die es nicht geben duerfte.
      greatest(coalesce(u."multiplicity", 1) - 1, 0)
        * coalesce(u."gamesWithUnit", u."games_with_unit", 0)  as v_dup_games,
      coalesce(u."star3Games", u."star3_games", 0)          as v_star3_games,
      u."carryItemGamesAll"                                 as v_carry_all,
      u."tankItemGames"                                     as v_tank,
      u."topItems"                                          as top_items
    from base_keep bk
    cross join lateral jsonb_to_recordset(
      case when jsonb_typeof(bk.typical_units) = 'array' then bk.typical_units else '[]'::jsonb end
    ) as u(
      "characterId"             text,
      "count"                   numeric,
      "games"                   numeric,
      "sumPlacement"            numeric,
      "sum_placement"           numeric,
      "carryItemGames"          numeric,
      "carry_item_games"        numeric,
      "gamesWithUnit"           numeric,
      "games_with_unit"         numeric,
      "gamesWithOutcome"        numeric,
      "gamesWithUnitOutcome"    numeric,
      "games_with_outcome"      numeric,
      "games_with_unit_outcome" numeric,
      "top1"                    numeric,
      "top4"                    numeric,
      "multiplicity"            numeric,
      "star3Games"              numeric,
      "star3_games"             numeric,
      "carryItemGamesAll"       numeric,
      "tankItemGames"           numeric,
      "topItems"                jsonb
    )
    where u."characterId" is not null and u."characterId" <> ''
  ),
  units_agg as (
    select
      cluster_key,
      character_id,
      sum(v_count)                as c_count,
      sum(v_sum_placement)        as c_sum_placement,
      sum(v_games)                as c_games,
      sum(v_carry_item_games)     as c_carry_item_games,
      sum(v_games_with_unit)      as c_games_with_unit,
      sum(v_games_with_outcome)   as c_games_with_outcome,
      sum(v_top1)                 as c_top1,
      sum(v_top4)                 as c_top4,
      sum(v_dup_games)            as c_dup_games,
      sum(v_star3_games)          as c_star3_games,
      -- Rollen-Felder nur, wenn jede Tages-Zeile sie traegt (count(x) zaehlt
      -- keine NULLs): eine Teilsumme ueber ein gemischtes Fenster wuerde die
      -- Carry-Quote druecken. Gleiche Regel wie mergeJsonbCountArrays.
      count(*)                    as c_rows,
      sum(v_carry_all)            as c_carry_all,
      count(v_carry_all)          as c_carry_all_rows,
      sum(v_tank)                 as c_tank,
      count(v_tank)               as c_tank_rows
    from units_raw
    group by cluster_key, character_id
  ),
  items_agg as (
    select
      ur.cluster_key,
      ur.character_id,
      it."apiName" as api_name,
      sum(coalesce(it."count", it."games", 0)) as c
    from units_raw ur
    cross join lateral jsonb_to_recordset(
      case when jsonb_typeof(ur.top_items) = 'array' then ur.top_items else '[]'::jsonb end
    ) as it("apiName" text, "count" numeric, "games" numeric)
    where it."apiName" is not null and it."apiName" <> ''
    group by ur.cluster_key, ur.character_id, it."apiName"
  ),
  items_ranked as (
    select
      cluster_key, character_id, api_name, c,
      row_number() over (
        partition by cluster_key, character_id order by c desc, api_name collate "C"
      ) as rn
    from items_agg
  ),
  items_top as (
    select
      cluster_key,
      character_id,
      jsonb_agg(
        jsonb_build_object('apiName', api_name, 'count', c)
        order by c desc, api_name collate "C"
      ) as top_items
    from items_ranked
    where rn <= 8
    group by cluster_key, character_id
  ),
  units_json as (
    select
      ua.cluster_key,
      jsonb_agg(
        jsonb_build_object(
          'characterId',      ua.character_id,
          'count',            ua.c_count,
          'sumPlacement',     ua.c_sum_placement,
          'games',            ua.c_games,
          'carryItemGames',   ua.c_carry_item_games,
          'gamesWithUnit',    ua.c_games_with_unit,
          'gamesWithOutcome', ua.c_games_with_outcome,
          'top1',             ua.c_top1,
          'top4',             ua.c_top4,
          'star3Games',       ua.c_star3_games
        )
        || case
             when it.top_items is null then '{}'::jsonb
             else jsonb_build_object('topItems', it.top_items)
           end
        -- Nur bei echten Doppel-Spielen und ab Mindestprobe 5 auf der Summe;
        -- identische Bedingung wie in mergeJsonbCountArrays.
        || case
             when ua.c_dup_games > 0 and ua.c_games_with_unit >= 5
               then jsonb_build_object(
                 'multiplicity', 1 + ua.c_dup_games / ua.c_games_with_unit
               )
             else '{}'::jsonb
           end
        || case
             when ua.c_carry_all_rows > 0 and ua.c_carry_all_rows = ua.c_rows
               then jsonb_build_object('carryItemGamesAll', ua.c_carry_all)
             else '{}'::jsonb
           end
        || case
             when ua.c_tank_rows > 0 and ua.c_tank_rows = ua.c_rows
               then jsonb_build_object('tankItemGames', ua.c_tank)
             else '{}'::jsonb
           end
        order by ua.c_count desc, ua.character_id collate "C"
      ) as merged
    from units_agg ua
    left join items_top it
      on it.cluster_key = ua.cluster_key
     and it.character_id = ua.character_id
    group by ua.cluster_key
  ),
  carry_agg as (
    select
      bk.cluster_key,
      s.items,
      sum(coalesce(ci."count", 0)) as c
    from base_keep bk
    cross join lateral jsonb_to_recordset(
      case when jsonb_typeof(bk.carry_items) = 'array' then bk.carry_items else '[]'::jsonb end
    ) as ci("items" jsonb, "count" numeric)
    cross join lateral (
      select array_agg(x order by x collate "C") as items
      from jsonb_array_elements_text(
        case when jsonb_typeof(ci."items") = 'array' then ci."items" else '[]'::jsonb end
      ) x
    ) s
    group by bk.cluster_key, s.items
  ),
  carry_json as (
    select
      cluster_key,
      jsonb_agg(
        jsonb_build_object('items', to_jsonb(items), 'count', c)
        order by c desc, array_to_string(items, '|') collate "C"
      ) as merged
    from carry_agg
    where items is not null and array_length(items, 1) > 0
    group by cluster_key
  )
  select
    k.cluster_key,
    k.games,
    k.sum_placement,
    k.top4,
    k.top1,
    k.sum_level,
    k.sum_last_round,
    (select coalesce(sum(a.games), 0)::bigint from agg a),
    case when uj.merged is null then '[]'::jsonb else jsonb_build_array(uj.merged) end,
    '[]'::jsonb,
    case when cj.merged is null then '[]'::jsonb else jsonb_build_array(cj.merged) end
  from keep k
  left join units_json uj on uj.cluster_key = k.cluster_key
  left join carry_json cj on cj.cluster_key = k.cluster_key
$function$;
revoke all on function public.get_tft_comp_stats_list_v2(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_min_share numeric, p_min_cap integer, p_end_day date) from public, anon, authenticated, service_role;
grant execute on function public.get_tft_comp_stats_list_v2(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_min_share numeric, p_min_cap integer, p_end_day date) to service_role;

-- get_tft_comp_outcome --------------------------------------------------
drop function public.get_tft_comp_outcome(p_cluster_keys text[], p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer);
CREATE FUNCTION public.get_tft_comp_outcome(p_cluster_keys text[], p_regions text[], p_buckets text[], p_days integer DEFAULT 3, p_patch text DEFAULT NULL::text, p_set integer DEFAULT NULL::integer, p_end_day date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with base as (
    select o.*
    from tft_daily_comp_outcome o
    where o.cluster_key = any(p_cluster_keys)
      and o.region = any(p_regions)
      and o.bucket = any(p_buckets)
      and o.bucket <> 'pro_pool'
      and o.day >= coalesce(p_end_day + 1, current_date) - (p_days || ' days')::interval and o.day <= coalesce(p_end_day, current_date)
      and (p_patch is null or o.patch = p_patch)
      and (p_set is null or o.set_number = p_set)
  ),
  cov as (
    select count(*)::int as n
    from tft_daily_comp_stats s
    where s.cluster_key = any(p_cluster_keys)
      and s.region = any(p_regions)
      and s.bucket = any(p_buckets)
      and s.bucket <> 'pro_pool'
      and s.day >= coalesce(p_end_day + 1, current_date) - (p_days || ' days')::interval and s.day <= coalesce(p_end_day, current_date)
      and (p_patch is null or s.patch = p_patch)
      and (p_set is null or s.set_number = p_set)
  ),
  ph as (
    select coalesce(jsonb_agg(v order by i), '[]'::jsonb) as j
    from (
      select t.i, sum(t.v)::bigint as v
      from base, unnest(base.placement_hist) with ordinality as t(v, i)
      group by t.i
    ) x
  ),
  lv_flat as (
    select 'all'::text as kind, e.key as lvl, a.i, sum(a.v::numeric) as v
    from base, jsonb_each(base.level_stats) e, jsonb_array_elements_text(e.value) with ordinality as a(v, i)
    group by e.key, a.i
    union all
    select 's5', e.key, a.i, sum(a.v::numeric)
    from base, jsonb_each(base.level_stats_s5) e, jsonb_array_elements_text(e.value) with ordinality as a(v, i)
    group by e.key, a.i
  ),
  lv_arr as (
    select kind, lvl, jsonb_agg(v order by i) as arr from lv_flat group by kind, lvl
  ),
  lv as (
    select
      coalesce(jsonb_object_agg(lvl, arr) filter (where kind = 'all'), '{}'::jsonb) as lv_all,
      coalesce(jsonb_object_agg(lvl, arr) filter (where kind = 's5'),  '{}'::jsonb) as lv_s5
    from lv_arr
  ),
  u_flat as (
    select e.key as cid, a.i, sum(a.v::numeric) as v
    from base, jsonb_each(base.units) e, jsonb_array_elements_text(e.value) with ordinality as a(v, i)
    group by e.key, a.i
  ),
  u_arr as (
    select cid, jsonb_agg(v order by i) as arr from u_flat group by cid
  ),
  u_top as (
    select cid, arr from (
      select cid, arr, row_number() over (order by (arr->>0)::numeric desc, cid) as rn from u_arr
    ) r where rn <= 24
  ),
  ul_flat as (
    select e.key as cid, l.key as lvl, a.i, sum(a.v::numeric) as v
    from base, jsonb_each(base.unit_levels) e, jsonb_each(e.value) l,
         jsonb_array_elements_text(l.value) with ordinality as a(v, i)
    where e.key in (select cid from u_top)
    group by e.key, l.key, a.i
  ),
  ul as (
    select cid, jsonb_object_agg(lvl, arr) as j
    from (select cid, lvl, jsonb_agg(v order by i) as arr from ul_flat group by cid, lvl) x
    group by cid
  ),
  ui_flat as (
    select e.key as cid, it.key as item, a.i, sum(a.v::numeric) as v
    from base, jsonb_each(base.unit_items) e, jsonb_each(e.value) it,
         jsonb_array_elements_text(it.value) with ordinality as a(v, i)
    where e.key in (select cid from u_top)
    group by e.key, it.key, a.i
  ),
  ui as (
    select cid, jsonb_object_agg(item, arr) as j
    from (
      select cid, item, arr,
             row_number() over (partition by cid order by (arr->>0)::numeric desc, item) as rn
      from (select cid, item, jsonb_agg(v order by i) as arr from ui_flat group by cid, item) x
      where (arr->>0)::numeric >= 5
    ) r
    where rn <= 16
    group by cid
  ),
  us_flat as (
    select e.key as cid, st.key as combo, a.i, sum(a.v::numeric) as v
    from base, jsonb_each(base.unit_sets) e, jsonb_each(e.value) st,
         jsonb_array_elements_text(st.value) with ordinality as a(v, i)
    where e.key in (select cid from u_top)
    group by e.key, st.key, a.i
  ),
  us as (
    select cid, jsonb_object_agg(combo, arr) as j
    from (
      select cid, combo, arr,
             row_number() over (partition by cid order by (arr->>0)::numeric desc, combo) as rn
      from (select cid, combo, jsonb_agg(v order by i) as arr from us_flat group by cid, combo) x
      where (arr->>0)::numeric >= 5
    ) r
    where rn <= 8
    group by cid
  ),
  units_out as (
    select coalesce(jsonb_object_agg(t.cid, jsonb_build_object(
      't',    t.arr,
      'lv',   coalesce(ul.j, '{}'::jsonb),
      'it',   coalesce(ui.j, '{}'::jsonb),
      'sets', coalesce(us.j, '{}'::jsonb)
    )), '{}'::jsonb) as j
    from u_top t
    left join ul on ul.cid = t.cid
    left join ui on ui.cid = t.cid
    left join us on us.cid = t.cid
  )
  select jsonb_build_object(
    'games',          (select coalesce(sum(games), 0) from base),
    'rows_outcome',   (select count(*) from base),
    'rows_stats',     (select n from cov),
    'placement_hist', (select j from ph),
    'level_stats',    (select lv_all from lv),
    'level_stats_s5', (select lv_s5 from lv),
    'units',          (select j from units_out)
  );
$function$;
revoke all on function public.get_tft_comp_outcome(p_cluster_keys text[], p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_end_day date) from public, anon, authenticated, service_role;
grant execute on function public.get_tft_comp_outcome(p_cluster_keys text[], p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_end_day date) to service_role;

-- get_tft_comp_emblems --------------------------------------------------
drop function public.get_tft_comp_emblems(p_cluster_keys text[], p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer);
CREATE FUNCTION public.get_tft_comp_emblems(p_cluster_keys text[], p_regions text[], p_buckets text[], p_days integer DEFAULT 3, p_patch text DEFAULT NULL::text, p_set integer DEFAULT NULL::integer, p_end_day date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with base as (
    select o.emblems
    from tft_daily_comp_outcome o
    where o.cluster_key = any(p_cluster_keys)
      and o.region = any(p_regions)
      and o.bucket = any(p_buckets)
      and o.bucket <> 'pro_pool'
      and o.day >= coalesce(p_end_day + 1, current_date) - (p_days || ' days')::interval and o.day <= coalesce(p_end_day, current_date)
      and (p_patch is null or o.patch = p_patch)
      and (p_set is null or o.set_number = p_set)
      and o.emblems is not null
  ),
  e_flat as (
    select e.key as item, a.i, sum(a.v::numeric) as v
    from base, jsonb_each(coalesce(base.emblems->'e', '{}'::jsonb)) e,
         jsonb_array_elements_text(e.value->'t') with ordinality as a(v, i)
    group by e.key, a.i
  ),
  e_top as (
    select item, arr from (
      select item, arr, row_number() over (order by (arr->>0)::numeric desc, item) as rn
      from (select item, jsonb_agg(v order by i) as arr from e_flat group by item) x
    ) r where rn <= 6
  ),
  h as (
    select item, jsonb_object_agg(cid, n) as j
    from (
      select item, cid, n, row_number() over (partition by item order by n desc, cid) as rn
      from (
        select e.key as item, hh.key as cid, sum(hh.value::numeric) as n
        from base, jsonb_each(coalesce(base.emblems->'e', '{}'::jsonb)) e,
             jsonb_each_text(coalesce(e.value->'h', '{}'::jsonb)) hh
        where e.key in (select item from e_top)
        group by e.key, hh.key
      ) x
    ) r
    where rn <= 5
    group by item
  )
  select jsonb_build_object(
    'emblem_games', (select coalesce(sum((emblems->>'g')::numeric), 0) from base),
    'rows_emblems', (select count(*) from base),
    'emblems', (
      select coalesce(jsonb_object_agg(t.item, jsonb_build_object('t', t.arr, 'h', coalesce(h.j, '{}'::jsonb))), '{}'::jsonb)
      from e_top t left join h on h.item = t.item
    )
  );
$function$;
revoke all on function public.get_tft_comp_emblems(p_cluster_keys text[], p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_end_day date) from public, anon, authenticated, service_role;
grant execute on function public.get_tft_comp_emblems(p_cluster_keys text[], p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_end_day date) to service_role;

-- get_tft_comp_matchups -------------------------------------------------
drop function public.get_tft_comp_matchups(p_fams text[], p_opp_fams text[], p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer);
CREATE FUNCTION public.get_tft_comp_matchups(p_fams text[], p_opp_fams text[], p_regions text[], p_buckets text[], p_days integer DEFAULT 3, p_patch text DEFAULT NULL::text, p_set integer DEFAULT NULL::integer, p_min_games integer DEFAULT 1, p_end_day date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with base as (
    select m.comp_fam, m.opp_fam, m.day, m.games, m.better
    from tft_daily_comp_matchups m
    where m.comp_fam = any(p_fams)
      and m.day >= coalesce(p_end_day + 1, current_date) - (p_days || ' days')::interval and m.day <= coalesce(p_end_day, current_date)
      and m.region = any(p_regions)
      and m.bucket = any(p_buckets)
      and (p_opp_fams is null or m.opp_fam = any(p_opp_fams))
      and (p_patch is null or m.patch = p_patch)
      and (p_set is null or m.set_number = p_set)
  ),
  agg as (
    select comp_fam, opp_fam, sum(games)::bigint as g, sum(better)::bigint as b
    from base
    group by comp_fam, opp_fam
    having sum(games) >= p_min_games
  )
  select jsonb_build_object(
    'days', (select count(distinct day) from base),
    'rows', (select coalesce(jsonb_agg(jsonb_build_array(comp_fam, opp_fam, g, b)), '[]'::jsonb) from agg)
  );
$function$;
revoke all on function public.get_tft_comp_matchups(p_fams text[], p_opp_fams text[], p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_end_day date) from public, anon, authenticated, service_role;
grant execute on function public.get_tft_comp_matchups(p_fams text[], p_opp_fams text[], p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_end_day date) to service_role;

-- get_tft_comp_matchups_all ---------------------------------------------
drop function public.get_tft_comp_matchups_all(p_fams text[], p_opp_fams text[], p_regions text[], p_buckets text[], p_days integer, p_set integer, p_min_games integer);
CREATE FUNCTION public.get_tft_comp_matchups_all(p_fams text[], p_opp_fams text[], p_regions text[], p_buckets text[], p_days integer DEFAULT 3, p_set integer DEFAULT NULL::integer, p_min_games integer DEFAULT 1, p_end_day date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with regs as (
    select array_agg(r order by r) as a from (select distinct unnest(p_regions) as r) x
  ),
  built as (
    select d.day
    from tft_comp_matchups_all_days d, regs
    where d.day >= coalesce(p_end_day + 1, current_date) - (p_days || ' days')::interval and d.day <= coalesce(p_end_day, current_date)
      and d.regions = regs.a
  ),
  base as (
    select m.comp_fam, m.opp_fam, m.day, m.games, m.better
    from tft_daily_comp_matchups_all m
    where m.comp_fam = any(p_fams)
      and m.bucket = any(p_buckets)
      and m.day >= coalesce(p_end_day + 1, current_date) - (p_days || ' days')::interval and m.day <= coalesce(p_end_day, current_date)
      and m.day = any(array(select day from built))
      and (p_opp_fams is null or m.opp_fam = any(p_opp_fams))
      and (p_set is null or m.set_number = p_set)
    union all
    select m.comp_fam, m.opp_fam, m.day, m.games, m.better
    from tft_daily_comp_matchups m
    where m.comp_fam = any(p_fams)
      and m.day >= coalesce(p_end_day + 1, current_date) - (p_days || ' days')::interval and m.day <= coalesce(p_end_day, current_date)
      and m.day <> all(array(select day from built))
      and m.region = any(p_regions)
      and m.bucket = any(p_buckets)
      and (p_opp_fams is null or m.opp_fam = any(p_opp_fams))
      and (p_set is null or m.set_number = p_set)
  ),
  agg as (
    select comp_fam, opp_fam, sum(games)::bigint as g, sum(better)::bigint as b
    from base
    group by comp_fam, opp_fam
    having sum(games) >= p_min_games
  )
  select jsonb_build_object(
    'days', (select count(distinct day) from base),
    'rows', (select coalesce(jsonb_agg(jsonb_build_array(comp_fam, opp_fam, g, b)), '[]'::jsonb) from agg)
  );
$function$;
revoke all on function public.get_tft_comp_matchups_all(p_fams text[], p_opp_fams text[], p_regions text[], p_buckets text[], p_days integer, p_set integer, p_min_games integer, p_end_day date) from public, anon, authenticated, service_role;
grant execute on function public.get_tft_comp_matchups_all(p_fams text[], p_opp_fams text[], p_regions text[], p_buckets text[], p_days integer, p_set integer, p_min_games integer, p_end_day date) to service_role;

-- get_tft_comp_pairs ----------------------------------------------------
drop function public.get_tft_comp_pairs(p_regions text[], p_days integer, p_patch text, p_set integer, p_min_games integer);
CREATE FUNCTION public.get_tft_comp_pairs(p_regions text[], p_days integer DEFAULT 3, p_patch text DEFAULT NULL::text, p_set integer DEFAULT NULL::integer, p_min_games integer DEFAULT 10, p_end_day date DEFAULT NULL::date)
 RETURNS TABLE(a_key text, b_key text, games bigint, a_better bigint)
 LANGUAGE sql
 STABLE
AS $function$
  select
    f.a_key,
    f.b_key,
    sum(f.games)::bigint,
    sum(f.a_better)::bigint
  from tft_daily_comp_pairs f
  where f.region = any(p_regions)
    and f.day >= coalesce(p_end_day + 1, current_date) - (p_days || ' days')::interval and f.day <= coalesce(p_end_day, current_date)
    and (p_patch is null or f.patch = p_patch)
    and (p_set is null or f.set_number = p_set)
  group by f.a_key, f.b_key
  having sum(f.games) >= p_min_games
$function$;
revoke all on function public.get_tft_comp_pairs(p_regions text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_end_day date) from public, anon, authenticated, service_role;
grant execute on function public.get_tft_comp_pairs(p_regions text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_end_day date) to service_role;

-- get_tft_unit_stats ----------------------------------------------------
drop function public.get_tft_unit_stats(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer);
CREATE FUNCTION public.get_tft_unit_stats(p_regions text[], p_buckets text[], p_days integer DEFAULT 3, p_patch text DEFAULT NULL::text, p_set integer DEFAULT NULL::integer, p_end_day date DEFAULT NULL::date)
 RETURNS TABLE(character_id text, games bigint, sum_placement bigint, top4 bigint, top1 bigint, participants bigint)
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
  )
  select
    f.character_id,
    sum(f.games)::bigint,
    sum(f.sum_placement)::bigint,
    sum(f.top4)::bigint,
    sum(f.top1)::bigint,
    (select total from parts)
  from tft_daily_unit_stats f
  where f.region = any(p_regions)
    and f.bucket = any(p_buckets)
    and f.day >= coalesce(p_end_day + 1, current_date) - (p_days || ' days')::interval and f.day <= coalesce(p_end_day, current_date)
    and (p_patch is null or f.patch = p_patch)
    and (p_set is null or f.set_number = p_set)
  group by f.character_id
$function$;
revoke all on function public.get_tft_unit_stats(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_end_day date) from public, anon, authenticated, service_role;
grant execute on function public.get_tft_unit_stats(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_end_day date) to service_role;

-- get_tft_unit_top_items ------------------------------------------------
drop function public.get_tft_unit_top_items(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_top integer);
CREATE FUNCTION public.get_tft_unit_top_items(p_regions text[], p_buckets text[], p_days integer DEFAULT 3, p_patch text DEFAULT NULL::text, p_set integer DEFAULT NULL::integer, p_top integer DEFAULT 6, p_end_day date DEFAULT NULL::date)
 RETURNS TABLE(character_id text, item text, games bigint)
 LANGUAGE sql
 STABLE
AS $function$
  with summed as (
    select t.character_id, e.item, sum(e.games)::bigint as games
    from tft_daily_unit_top_items t
    cross join lateral jsonb_to_recordset(t.items) as e(item text, games int)
    where t.region = any(p_regions)
      and t.bucket = any(p_buckets)
      and t.day >= coalesce(p_end_day + 1, current_date) - (p_days || ' days')::interval and t.day <= coalesce(p_end_day, current_date)
      and (p_patch is null or t.patch = p_patch)
      and (p_set is null or t.set_number = p_set)
      and e.item is not null
    group by t.character_id, e.item
  ), ranked as (
    select s.*, row_number() over (
      partition by s.character_id
      order by s.games desc, s.item collate "C"
    ) as rn
    from summed s
  )
  select r.character_id, r.item, r.games
  from ranked r
  where r.rn <= p_top
  order by r.character_id, r.rn
$function$;
revoke all on function public.get_tft_unit_top_items(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_top integer, p_end_day date) from public, anon, authenticated, service_role;
grant execute on function public.get_tft_unit_top_items(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_top integer, p_end_day date) to service_role;

-- get_tft_item_stats_list -----------------------------------------------
drop function public.get_tft_item_stats_list(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer);
CREATE FUNCTION public.get_tft_item_stats_list(p_regions text[], p_buckets text[], p_days integer DEFAULT 3, p_patch text DEFAULT NULL::text, p_set integer DEFAULT NULL::integer, p_end_day date DEFAULT NULL::date)
 RETURNS TABLE(api_name text, games bigint, sum_placement bigint, top4 bigint, top1 bigint, total_item_slots bigint, top_users_merged jsonb)
 LANGUAGE sql
 STABLE
AS $function$
  with totals as (
    select coalesce(sum(games), 0)::bigint as total
    from tft_daily_item_stats
    where region = any(p_regions)
      and bucket = any(p_buckets)
      and day >= coalesce(p_end_day + 1, current_date) - (p_days || ' days')::interval and day <= coalesce(p_end_day, current_date)
      and (p_patch is null or patch = p_patch)
      and (p_set is null or set_number = p_set)
  ),
  base as (
    select f.api_name, f.games, f.sum_placement, f.top4, f.top1, f.top_users
    from tft_daily_item_stats f
    where f.region = any(p_regions)
      and f.bucket = any(p_buckets)
      and f.day >= coalesce(p_end_day + 1, current_date) - (p_days || ' days')::interval and f.day <= coalesce(p_end_day, current_date)
      and (p_patch is null or f.patch = p_patch)
      and (p_set is null or f.set_number = p_set)
  ),
  agg as (
    select
      api_name,
      sum(games)::bigint                    as games,
      sum(sum_placement)::bigint            as sum_placement,
      sum(top4)::bigint                     as top4,
      sum(coalesce(top1, 0))::bigint        as top1
    from base
    group by api_name
  ),
  users as (
    select
      b.api_name,
      (u->>'characterId') as character_id,
      sum((u->>'games')::bigint) as g
    from base b
    cross join lateral jsonb_array_elements(b.top_users) u
    group by b.api_name, (u->>'characterId')
  ),
  users_ranked as (
    select
      api_name, character_id, g,
      row_number() over (partition by api_name order by g desc, character_id) as rn
    from users
  ),
  users_top as (
    select
      api_name,
      jsonb_agg(
        jsonb_build_object('characterId', character_id, 'games', g)
        order by g desc
      ) as merged
    from users_ranked
    where rn <= 8
    group by api_name
  )
  select
    a.api_name,
    a.games,
    a.sum_placement,
    a.top4,
    a.top1,
    (select total from totals),
    case when ut.merged is null then '[]'::jsonb else jsonb_build_array(ut.merged) end
  from agg a
  left join users_top ut on ut.api_name = a.api_name
$function$;
revoke all on function public.get_tft_item_stats_list(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_end_day date) from public, anon, authenticated, service_role;
grant execute on function public.get_tft_item_stats_list(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_end_day date) to service_role;

-- get_tft_trait_stats ---------------------------------------------------
drop function public.get_tft_trait_stats(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer);
CREATE FUNCTION public.get_tft_trait_stats(p_regions text[], p_buckets text[], p_days integer DEFAULT 3, p_patch text DEFAULT NULL::text, p_set integer DEFAULT NULL::integer, p_end_day date DEFAULT NULL::date)
 RETURNS TABLE(name text, activation integer, games bigint, sum_placement bigint, top4 bigint, participants bigint)
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
  )
  select
    f.name,
    f.activation,
    sum(f.games)::bigint,
    sum(f.sum_placement)::bigint,
    sum(f.top4)::bigint,
    (select total from parts)
  from tft_daily_trait_stats f
  where f.region = any(p_regions)
    and f.bucket = any(p_buckets)
    and f.day >= coalesce(p_end_day + 1, current_date) - (p_days || ' days')::interval and f.day <= coalesce(p_end_day, current_date)
    and (p_patch is null or f.patch = p_patch)
    and (p_set is null or f.set_number = p_set)
  group by f.name, f.activation
$function$;
revoke all on function public.get_tft_trait_stats(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_end_day date) from public, anon, authenticated, service_role;
grant execute on function public.get_tft_trait_stats(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_end_day date) to service_role;

-- get_tft_trait_unitcount_stats -----------------------------------------
drop function public.get_tft_trait_unitcount_stats(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_name text);
CREATE FUNCTION public.get_tft_trait_unitcount_stats(p_regions text[], p_buckets text[], p_days integer DEFAULT 3, p_patch text DEFAULT NULL::text, p_set integer DEFAULT NULL::integer, p_name text DEFAULT NULL::text, p_end_day date DEFAULT NULL::date)
 RETURNS TABLE(name text, num_units integer, games bigint, sum_placement bigint, top4 bigint)
 LANGUAGE sql
 STABLE
AS $function$
  select
    f.name,
    f.num_units,
    sum(f.games)::bigint,
    sum(f.sum_placement)::bigint,
    sum(f.top4)::bigint
  from tft_daily_trait_unitcount_stats f
  where f.region = any(p_regions)
    and f.bucket = any(p_buckets)
    and f.day >= coalesce(p_end_day + 1, current_date) - (p_days || ' days')::interval and f.day <= coalesce(p_end_day, current_date)
    and (p_patch is null or f.patch = p_patch)
    and (p_set is null or f.set_number = p_set)
    and (p_name is null or f.name = p_name)
  group by f.name, f.num_units
$function$;
revoke all on function public.get_tft_trait_unitcount_stats(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_name text, p_end_day date) from public, anon, authenticated, service_role;
grant execute on function public.get_tft_trait_unitcount_stats(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_name text, p_end_day date) to service_role;

-- get_tft_region_divergence ---------------------------------------------
drop function public.get_tft_region_divergence(p_buckets text[], p_set integer, p_patch text, p_days integer, p_min_games integer);
CREATE FUNCTION public.get_tft_region_divergence(p_buckets text[], p_set integer DEFAULT NULL::integer, p_patch text DEFAULT NULL::text, p_days integer DEFAULT 3, p_min_games integer DEFAULT 100, p_end_day date DEFAULT NULL::date)
 RETURNS TABLE(cluster_key text, games_kr bigint, games_eu bigint, games_na bigint, avg_place_kr double precision, avg_place_eu double precision, avg_place_na double precision, pickrate_kr double precision, pickrate_eu double precision, pickrate_na double precision)
 LANGUAGE sql
 STABLE
AS $function$
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
          and t.day > coalesce(p_end_day, current_date) - (p_days + 14)
          and t.day <= coalesce(p_end_day, current_date)
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
$function$;
revoke all on function public.get_tft_region_divergence(p_buckets text[], p_set integer, p_patch text, p_days integer, p_min_games integer, p_end_day date) from public, anon, authenticated, service_role;
grant execute on function public.get_tft_region_divergence(p_buckets text[], p_set integer, p_patch text, p_days integer, p_min_games integer, p_end_day date) to service_role;

-- get_tft_comp_list_precomputed -----------------------------------------
drop function public.get_tft_comp_list_precomputed(p_patch_key text, p_set integer, p_regions_key text, p_buckets_key text, p_days integer);
CREATE FUNCTION public.get_tft_comp_list_precomputed(p_patch_key text, p_set integer, p_regions_key text, p_buckets_key text, p_days integer, p_end_day date DEFAULT NULL::date)
 RETURNS TABLE(last_day date, window_end date, min_games integer, computed_at timestamp with time zone, comp_rows jsonb)
 LANGUAGE sql
 STABLE
AS $function$
  -- Mit p_end_day: genau das Fenster [p_end_day - p_days + 1, p_end_day] (dataWindow
  -- hat den Patch-Start schon eingerechnet). Ohne: Schluessel wie in 0070, nur
  -- Zeilen alter Art (window_end = last_day), damit eine Zeile mit kuerzerem
  -- Fenster nie fuer das offene Fenster einspringt.
  select t.last_day, t.window_end, t.min_games, t.computed_at, t.comp_rows
  from public.tft_comp_list_precomputed t
  where t.patch_key = p_patch_key
    and t.set_number = p_set
    and t.regions_key = p_regions_key
    and t.buckets_key = p_buckets_key
    and (
      (p_end_day is not null and t.window_end = p_end_day and t.data_start = p_end_day - p_days + 1)
      or (p_end_day is null and t.window_end = t.last_day
          and t.data_start = greatest(current_date - p_days, coalesce(t.patch_first_day, current_date - p_days)))
    )
  limit 1;
$function$;
revoke all on function public.get_tft_comp_list_precomputed(p_patch_key text, p_set integer, p_regions_key text, p_buckets_key text, p_days integer, p_end_day date) from public, anon, authenticated, service_role;
grant execute on function public.get_tft_comp_list_precomputed(p_patch_key text, p_set integer, p_regions_key text, p_buckets_key text, p_days integer, p_end_day date) to service_role;

-- Selbstpruefung: je Funktion genau eine Signatur, die neue; Rechte nur service_role.
do $$
declare
  want text[] := array['get_tft_comp_stats(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_cluster_prefix text, p_end_day date)',
                       'get_tft_comp_stats_list_v2(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_min_share numeric, p_min_cap integer, p_end_day date)',
                       'get_tft_comp_outcome(p_cluster_keys text[], p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_end_day date)',
                       'get_tft_comp_emblems(p_cluster_keys text[], p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_end_day date)',
                       'get_tft_comp_matchups(p_fams text[], p_opp_fams text[], p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_end_day date)',
                       'get_tft_comp_matchups_all(p_fams text[], p_opp_fams text[], p_regions text[], p_buckets text[], p_days integer, p_set integer, p_min_games integer, p_end_day date)',
                       'get_tft_comp_pairs(p_regions text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_end_day date)',
                       'get_tft_unit_stats(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_end_day date)',
                       'get_tft_unit_top_items(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_top integer, p_end_day date)',
                       'get_tft_item_stats_list(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_end_day date)',
                       'get_tft_trait_stats(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_end_day date)',
                       'get_tft_trait_unitcount_stats(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_name text, p_end_day date)',
                       'get_tft_region_divergence(p_buckets text[], p_set integer, p_patch text, p_days integer, p_min_games integer, p_end_day date)',
                       'get_tft_comp_list_precomputed(p_patch_key text, p_set integer, p_regions_key text, p_buckets_key text, p_days integer, p_end_day date)'];
  w text;
  n int;
  fid oid;
  bad int;
begin
  foreach w in array want loop
    select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.proname = split_part(w, '(', 1);
    if n <> 1 then raise exception '0095: % hat % Signaturen', split_part(w, '(', 1), n; end if;
    select p.oid into fid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = w;
    if fid is null then raise exception '0095: neue Signatur fehlt: %', w; end if;
    if has_function_privilege('anon', fid, 'execute')
       or has_function_privilege('authenticated', fid, 'execute')
       or not has_function_privilege('service_role', fid, 'execute') then
      raise exception '0095: Rechte falsch fuer %', w;
    end if;
  end loop;
  select count(*) into bad from public.tft_comp_list_precomputed where window_end is null;
  if bad <> 0 then raise exception '0095: % Vorab-Zeilen ohne window_end', bad; end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
