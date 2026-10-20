-- 0103: Comp-Liste zaehlt die Mindestspiele je Comp statt je Zeile.
--
-- WARUM: Die Liste filterte jede Tageszeile (Trait@Stufe_Carry) gegen die
-- Listen-Schwelle, bevor die Zeilen ihrer Comp zugeordnet wurden. Gemessen
-- 20.10.2026 euw1/Diamond+/3 Tage: Juggernaut·Ashe zeigte 213 Spiele / Ø 3,67,
-- ihre Zeilen ab 30 Spielen ergeben 586 / Ø 4,37 (= Detailseite). Die Route
-- rechnet jetzt die kleinen Zeilen (30 bis unter der Schwelle) als schlanke
-- Zusatzliste in die Comp-Summe ein (get_tft_comp_stats_for_diff). Comps,
-- deren Zeilen ALLE unter der Schwelle liegen, deren Summe aber darueber,
-- brauchen fuer ihr Brett die volle Zeile — dafuer dieser Parameter.
-- Plan und Verdicts: .claude/plan-current.md.
--
--  * get_tft_comp_stats_list_v2: + p_cluster_keys (LETZTER Parameter, Standard
--    null). Gesetzt → nur diese cluster_keys ab p_min_games; null → wie 0095.
--
-- Abwaertsvertraeglich: alle bisherigen Aufrufer (Route, Box-Skript
-- precompute-comp-windows.mjs mit benannten Argumenten) sehen dasselbe.
-- Rueckweg: ERST Code zurueck (oder COMP_LIST_MINOR_ROWS=0), DANN
-- supabase/rollback/0103_tft_comp_list_cluster_keys_rollback.sql.

begin;
set local lock_timeout = '5s';

-- get_tft_comp_stats_list_v2 --------------------------------------------
drop function public.get_tft_comp_stats_list_v2(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_min_share numeric, p_min_cap integer, p_end_day date);
CREATE FUNCTION public.get_tft_comp_stats_list_v2(p_regions text[], p_buckets text[], p_days integer DEFAULT 3, p_patch text DEFAULT NULL::text, p_set integer DEFAULT NULL::integer, p_min_games integer DEFAULT 30, p_min_share numeric DEFAULT NULL::numeric, p_min_cap integer DEFAULT NULL::integer, p_end_day date DEFAULT NULL::date, p_cluster_keys text[] DEFAULT NULL::text[])
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
  -- 0103: mit p_cluster_keys genau diese Zeilen (ab p_min_games, ohne
  -- Anteil-Filter) — die Route holt so das Brett von Comps, deren Zeilen alle
  -- unter der Listen-Schwelle liegen, deren Summe aber darueber. Ohne
  -- p_cluster_keys unveraendert.
  keep as (
    select * from agg
    where case
      when p_cluster_keys is not null then cluster_key = any(p_cluster_keys) and games >= p_min_games
      else games >= case
        when p_min_share is null or p_min_cap is null then p_min_games
        else greatest(p_min_games, least(p_min_cap, round(p_min_share * (select coalesce(sum(a2.games), 0) from agg a2))))
      end
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
revoke all on function public.get_tft_comp_stats_list_v2(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_min_share numeric, p_min_cap integer, p_end_day date, p_cluster_keys text[]) from public, anon, authenticated, service_role;
grant execute on function public.get_tft_comp_stats_list_v2(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_min_share numeric, p_min_cap integer, p_end_day date, p_cluster_keys text[]) to service_role;

commit;

notify pgrst, 'reload schema';
