-- 0060: optionaler Cluster-Prefix-Filter fuer die Detail-RPC
--
-- Problem (2026-08-18 gemessen): `get_tft_comp_stats` liefert fuer EINEN Slug
-- alle Cluster mit allen sieben jsonb-Spalten. all/7d/diamond+ = 100,70 MB in
-- 11.897 ms, live ueber die Route sogar mit days=9 (Stale-Bump). Ein einzelner
-- Publisher-Request lag bei 16,7 s gegen einen statement_timeout von 20 s
-- (0020) — sobald mehrere parallel gegen den 1-Core-Compute laufen, reissen
-- sie ihn. Ergebnis war ein Detail-Republish mit 92 von 240 Permutationen auf
-- HTTP 502, Verteilung nach Region: all 43, kr 17, euw1 17, na1 15 (je 60).
-- Mehr Client-Timeout haette daran nichts geaendert; der Payload ist das
-- Problem, nicht die Geduld.
--
-- Die Detail-Route braucht von all diesen Clustern genau zwei Gruppen:
--   1. die Family-Geschwister des Slugs (selectFamilyMembers, Family-Identitaet
--      `<trait>__<carry>` — Level und Augment konsolidiert, User-Entscheid C)
--   2. den sameCore-Fallback, wenn der exakte Slug im Fenster leer ist —
--      derselbe Trait, derselbe Carry.
-- Beide liegen unter demselben Trait. Deshalb filtert der Parameter auf den
-- TRAIT-Prefix (`TFT17_SpaceGroove@`) und nicht auf die volle Family: das
-- Level steht im Key VOR dem Carry, ein Carry-genauer Prefix ist also nicht
-- praefigierbar. Die exakte Family-Auswahl bleibt unveraendert in JS
-- (`familyKeyForMerge`) — bewusst KEINE zweite Parse-Implementierung in SQL,
-- die auseinanderdriften koennte.
--
-- `starts_with()` statt `like`, weil Trait-Namen `_` enthalten (TFT17_…) und
-- `_` in LIKE ein Platzhalter ist. Kein Index noetig: die Tages-Rows werden
-- ohnehin ueber (region, bucket, day) gescannt, gespart wird an jsonb_agg und
-- am Transfer.
--
-- `participants` bleibt bewusst UNGEFILTERT (CTE `parts`) — das ist die
-- globale Teilnehmerzahl und der Nenner der Pick-Rate. Wuerde der Prefix dort
-- mitgreifen, saehe jede Detail-Page eine falsch aufgeblaehte Pick-Rate.
--
-- Rollback = den Parameter im Aufruf weglassen (Default null -> exakt das
-- Verhalten von 0034). Kein Migrations-Rollback noetig.
--
-- MITGEFIXT: `bucket_breakdown` war seit 0034 falsch. `jsonb_object_agg` ueber
-- die Tages-Rows bekommt denselben Bucket-Key einmal PRO TAG; bei doppelten
-- Keys gewinnt der zuletzt aggregierte Wert, also stand dort ein einzelner
-- willkuerlicher Tag statt der Fenster-Summe. Gemessen am 2026-08-18 fuer
-- euw1/9d/diamond+: `TFT17_SpaceGroove@3_TFT17_Nami` meldete master 276 Spiele,
-- nach der Korrektur 613 — und welcher Tag gewann, haing an der Scan-
-- Reihenfolge, weshalb schon der blosse Prefix-Filter die Zahlen verschob.
-- Der Wert speist den Skill-Cap-Index der Detail-Page (`enrichComp`, Gate
-- „>= 20 Spiele pro Bucket"), der damit auf einem Neuntel der Datenlage stand.
-- Deshalb jetzt eine eigene Gruppierung nach (cluster_key, bucket) mit Summe —
-- deterministisch und unabhaengig vom Ausfuehrungsplan.

drop function if exists get_tft_comp_stats(text[], text[], int, text, int, int);
drop function if exists get_tft_comp_stats(text[], text[], int, text, int, int, text);

create or replace function get_tft_comp_stats(
  p_regions text[],
  p_buckets text[],
  p_days int default 3,
  p_patch text default null,
  p_set int default null,
  p_min_games int default 30,
  p_cluster_prefix text default null
)
returns table (
  cluster_key text,
  games bigint,
  sum_placement bigint,
  top4 bigint,
  top1 bigint,
  sum_level bigint,
  sum_last_round bigint,
  sum_players_eliminated bigint,
  sum_gold_left bigint,
  participants bigint,
  typical_units_merged jsonb,
  typical_augments_merged jsonb,
  carry_items_merged jsonb,
  last_round_dist_merged jsonb,
  top4_by_round_merged jsonb,
  level_dist_merged jsonb,
  level_sum_last_round_merged jsonb,
  carry_star_dist_merged jsonb,
  contested_dist_merged jsonb,
  bucket_breakdown jsonb
)
language sql
stable
as $$
  with parts as (
    select coalesce(sum(games), 0)::bigint as total
    from tft_daily_comp_stats
    where region = any(p_regions)
      and bucket = any(p_buckets)
      and day >= current_date - (p_days || ' days')::interval
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
      and f.day >= current_date - (p_days || ' days')::interval
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
      and f.day >= current_date - (p_days || ' days')::interval
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
$$;

notify pgrst, 'reload schema';
