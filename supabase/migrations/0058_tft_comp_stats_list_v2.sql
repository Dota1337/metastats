-- 0058: get_tft_comp_stats_list_v2 — jsonb-Merge SQL-seitig statt in JS.
--
-- Ausgangslage (gemessen 2026-08-17/18, 15 Regionen / 9d / mg490):
-- 0027 macht `jsonb_agg(f.typical_units)` und schickt damit JEDES Tages-Array
-- einzeln ueber die Leitung. Gemessen bei bucket=all: 144,67 MB Payload,
-- 19,6 s — der Route-Cap liegt bei 8 s, also 502 auf dem Default-Filter der
-- Comps-Seite. Die DB-Zeit ist dabei der kleinere Posten; der Rest ist
-- Serialisierung, Transfer und JS-Parse.
--
-- Diese Fassung merged pro Cluster in SQL, sodass EINE zusammengefasste Liste
-- statt zehntausender Tages-Arrays rausgeht (Praezedenz: 0028 fuer Items, dort
-- 76,4 s → 3,1 s). Gemessen hier: 144,67 MB → 4,48 MB.
--
-- 0027 bleibt unveraendert bestehen. Rollback = ein Bezeichner in
-- app/api/tft/comps/route.ts (`_v2` weg), keine DB-Aenderung noetig.
--
-- Bewusste Festlegungen:
--
--  1. KEIN Top-N-Cut, weder bei typical_units noch bei carry_items. Der Gewinn
--     kommt aus dem Merge, nicht aus dem Schnitt. Ein Cut wuerde die
--     Aequivalenz brechen, weil die JS-Seite `isExcludedUnit` /
--     `setContainsExcludedItem` NACH dem Cut filtert.
--  2. `jsonb_to_recordset` statt `->>`-Ketten (gemessen 679 ms statt ~2,5 s).
--     Alle Lese-Aliase der JS-Seite (mergeJsonbCountArrays,
--     app/lib/tft-supabase-reader.ts:345-356) sind als eigene Spalten
--     deklariert und per coalesce in derselben Reihenfolge aufgeloest.
--     Fehlende Keys liefert jsonb_to_recordset als NULL — das ist genau das
--     Verhalten von `??` in JS.
--  3. `topItems` wird mitgemergt. Fehlt es, bleibt `cur.nested` leer,
--     `topItems` wird undefined und die Item-Icons unter jeder Unit
--     verschwinden — ohne Fehler, ohne Log. Cut bei 3 an derselben Stelle wie
--     JS (vor dem Exclude-Filter).
--  4. `typical_augments` → '[]'::jsonb. In allen 519.712 Rows leer
--     (`typical_augments=neq.[]` → count 0); JS macht daraus ebenfalls [].
--  5. Deterministischer Tiebreak (`order by count desc, <id>`) wie 0028. Heute
--     ist die Aufloesung zufaellig (184/469 Cluster haben einen Tie auf
--     Carry-Position 3/4), ein Byte-Vergleich alt-gegen-alt scheitert deshalb
--     schon ohne diese Migration.
--  6. `participants` kommt aus `sum(games)` ueber das UNGEFILTERTE agg statt
--     aus einem zweiten Scan — rechnerisch dieselbe Zahl wie die `parts`-CTE
--     in 0027, aber ohne den zweiten Index-Scan.
--  7. `multiplicity` wird NICHT uebernommen. Das ist kein Versehen: die
--     JS-Merge-Funktion kennt das Feld nicht und laesst es heute schon fallen,
--     d.h. `showDouble` in CompRow/CompCard ist auf dem Listen-Pfad bereits
--     immer false. Es hier durchzureichen waere eine Verhaltensaenderung, kein
--     Aequivalenz-Erhalt — gehoert in einen eigenen Task.
--  8. Ueberall wo ein String in eine Sortierung eingeht: `collate "C"`. Die
--     JS-Seite sortiert mit `[...e.items].sort()` bzw. Map-Reihenfolge, also
--     nach UTF-16-Codepoint; die DB-Default-Collation ordnet Unterstriche und
--     Ziffern anders ein. Betrifft den carry-Set-Schluessel (dort waere es ein
--     anderer Gruppierungs-Schluessel) und beide Tiebreaks (dort waere es eine
--     andere, aber gleichwertige Auswahl — nur eben nicht nachpruefbar).
--  9. CTE-Zuschnitt: ein Tabellen-Scan, eine Expansion, schmaler Tuplestore.
--     Gemessen wurde beides (all/9d/all, je 3 warme Laeufe):
--       - gemeinsame `units_raw`-CTE (1 Scan, 1 Expansion, ~480 MB Temp-I/O):
--         8,4-8,7 s
--       - jeder Zweig expandiert selbst (2 Scans, 2 Expansionen, kein grosser
--         Tuplestore): 11,2-11,6 s
--     Die doppelte Expansion kostet also mehr als das Temp-I/O spart. Es bleibt
--     bei der geteilten CTE; die Lese-Aliase werden aber schon in der
--     Projektion aufgeloest (8 Spalten statt 15), damit der Tuplestore so
--     schmal wie moeglich bleibt. Der Index-Scan selbst ist warm 42 ms und
--     spielt in dieser Rechnung keine Rolle.
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
  -- Ein einziger Index-Scan ueber die Tabelle; `materialized` verhindert, dass
  -- PG die CTE in ihre Verwendungsstellen inlinet und mehrfach scannt.
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
  -- Die jsonb-Expansion laeuft nur fuer Cluster, die auch ausgeliefert werden.
  base_keep as (
    select b.cluster_key, b.typical_units, b.carry_items
    from base b
    join keep k on k.cluster_key = b.cluster_key
  ),
  -- Geteilte Zwischenstufe fuer Unit-Summen UND topItems. Sie wird zweimal
  -- gelesen und deshalb materialisiert — die Projektion loest die Lese-Aliase
  -- deshalb SOFORT auf (8 Spalten statt 15), damit der Tuplestore schmal
  -- bleibt. Reihenfolge der coalesce-Argumente = Reihenfolge der `??`-Ketten
  -- in mergeJsonbCountArrays (app/lib/tft-supabase-reader.ts:345-356).
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
      "topItems"                jsonb
    )
    where u."characterId" is not null and u."characterId" <> ''
  ),
  units_agg as (
    select
      cluster_key,
      character_id,
      -- Aussen kein coalesce noetig: sum() ueber mindestens eine Zeile mit
      -- 0-Default liefert nie NULL.
      sum(v_count)                as c_count,
      sum(v_sum_placement)        as c_sum_placement,
      sum(v_games)                as c_games,
      sum(v_carry_item_games)     as c_carry_item_games,
      sum(v_games_with_unit)      as c_games_with_unit,
      sum(v_games_with_outcome)   as c_games_with_outcome,
      sum(v_top1)                 as c_top1,
      sum(v_top4)                 as c_top4
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
    where rn <= 3
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
          'top4',             ua.c_top4
        )
        -- `topItems` nur wenn nicht leer — JS laesst den Key in dem Fall
        -- ebenfalls weg (`if (!counter || counter.size === 0) continue`).
        || case
             when it.top_items is null then '{}'::jsonb
             else jsonb_build_object('topItems', it.top_items)
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
    -- Der Set-Schluessel ist das SORTIERTE Item-Array inklusive Duplikate
    -- (zwei Gargoyles sind ein anderer Build als einer) — genau das macht
    -- mergeCarryItems mit `[...e.items].sort().join('|')`.
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
    -- Aeussere Einer-Klammer, damit die JS-Seite (mergeJsonbCountArrays /
    -- concatArrays in tft-comp-family-merge.ts) ihr Array-von-Arrays behaelt.
    -- Ein erneuter Merge ueber eine bereits gemergte Liste ist idempotent.
    case when uj.merged is null then '[]'::jsonb else jsonb_build_array(uj.merged) end,
    '[]'::jsonb,
    case when cj.merged is null then '[]'::jsonb else jsonb_build_array(cj.merged) end
  from keep k
  left join units_json uj on uj.cluster_key = k.cluster_key
  left join carry_json cj on cj.cluster_key = k.cluster_key
$$;

-- Rechte wie in 0055 (Sicherheitswelle C5): eine neue Funktion bekommt per
-- Default EXECUTE fuer PUBLIC. service_role und postgres behalten alles.
revoke execute on function public.get_tft_comp_stats_list_v2(text[],text[],integer,text,integer,integer)
  from public, anon, authenticated;
