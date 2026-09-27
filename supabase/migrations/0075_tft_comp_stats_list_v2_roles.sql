-- 0075: Rollen-Felder und 8 statt 3 Items je Einheit in get_tft_comp_stats_list_v2.
--
-- Warum: /tft/comps erkennt Carries und Tank-Traeger seit 2026-09-27 an den
-- Items (app/lib/tft-comp-roles.ts) und zeigt nur fertige Items ab 15 % der
-- Spiele, hoechstens drei. Mit nur drei gespeicherten Items blieben nach dem
-- Wegfall von Komponenten oft nur zwei uebrig, obwohl ein viertes die Schwelle
-- schafft. Der Sammler schreibt deshalb 8 Items je Einheit, einmal pro Spiel
-- gezaehlt, und zwei neue Felder:
--   carryItemGamesAll  Spiele mit mind. einem Carry-Item (inkl. Hand of Justice
--                      und Edge of Night)
--   tankItemGames      Summe der verschiedenen Tank-Items je Spiel
-- (scripts/lib/tft-build-aggregator.mjs). Beide werden hier nur ausgegeben,
-- wenn jede Tages-Zeile im Fenster sie traegt — sonst faellt die Seite auf die
-- Schaetzung aus den Items zurueck.
--
-- Sonst identisch zu 0065. Nach dem Einspielen muss
-- scripts/publish-snapshot-bundle.mjs laufen, sonst sehen Besucher nichts.
--
-- Rollback: 0065 erneut einspielen (gleiche Signatur, create or replace).

create or replace function get_tft_comp_stats_list_v2(
  p_regions text[],
  p_buckets text[],
  p_days int default 3,
  p_patch text default null,
  p_set int default null,
  p_min_games int default 30
)
returns table (
  cluster_key text,
  games bigint,
  sum_placement bigint,
  top4 bigint,
  top1 bigint,
  sum_level bigint,
  sum_last_round bigint,
  participants bigint,
  typical_units_merged jsonb,
  typical_augments_merged jsonb,
  carry_items_merged jsonb
)
language sql
stable
as $$
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
      and f.day >= current_date - (p_days || ' days')::interval
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
    select * from agg where games >= p_min_games
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
$$;

revoke execute on function public.get_tft_comp_stats_list_v2(text[],text[],integer,text,integer,integer)
  from public, anon, authenticated;
