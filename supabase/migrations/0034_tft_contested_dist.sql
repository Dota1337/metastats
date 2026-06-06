-- 0034: Contested-Distribution auf tft_daily_comp_stats (Sprint W4-B)
--
-- Pro-Frage: "Wenn 2-3 Lobby-Spieler die selbe Comp forcen, wie weit
-- kollabiert mein avg-place?". contested_dist ist jsonb in der Form
--   { "1": {games, sumPlacement, top4, top1},  -- solo (kein Rivale)
--     "2": {games, …},                          -- 1 weiterer Spieler
--     "3": {games, …} }                         -- 2+ weitere Spieler (capped)
--
-- Aggregator zählt das pro Match VOR der per-participant-loop, sodass die
-- Attribution byte-genau ist (jeder Participant kriegt den Contested-Level
-- des eigenen cluster_keys in der Lobby).
--
-- Additiv — ältere Rows haben '{}', der Crawler füllt ab dem nächsten Tag.

alter table tft_daily_comp_stats
  add column if not exists contested_dist jsonb not null default '{}'::jsonb;

drop function if exists get_tft_comp_stats(text[], text[], int, text, int, int);

create or replace function get_tft_comp_stats(
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
      jsonb_agg(coalesce(f.contested_dist,  '{}'::jsonb)) as contested_dist_merged,
      jsonb_object_agg(
        f.bucket,
        jsonb_build_object('games', f.games, 'sum_placement', f.sum_placement)
      ) filter (where f.bucket = any(p_buckets)) as bucket_breakdown
    from tft_daily_comp_stats f
    where f.region = any(p_regions)
      and f.bucket = any(p_buckets)
      and f.day >= current_date - (p_days || ' days')::interval
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
    a.bucket_breakdown
  from agg a
  where a.games >= p_min_games
$$;

notify pgrst, 'reload schema';
