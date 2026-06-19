-- 0043: Lean Items-RPC with top1 sum (Phase A3).
--
-- Replaces 0028. Same shape + `top1 bigint` extra column. coalesce(top1, 0)
-- so historical NULL rows degrade gracefully rather than nuking the SUM.
-- API-side check: `top1Rate = sum_top1 > 0 ? sum_top1 / games : null` so the
-- UI can render "—" while the back-fill from forward-only daily-crawls
-- bootstraps over ~7-10 days.

-- DROP first — RETURN TABLE shape changed (added top1 column) and Postgres
-- doesn't allow that via CREATE OR REPLACE alone.
drop function if exists get_tft_item_stats_list(text[], text[], int, text, int);

create or replace function get_tft_item_stats_list(
  p_regions text[],
  p_buckets text[],
  p_days int default 3,
  p_patch text default null,
  p_set int default null
)
returns table (
  api_name text,
  games bigint,
  sum_placement bigint,
  top4 bigint,
  top1 bigint,
  total_item_slots bigint,
  top_users_merged jsonb
)
language sql
stable
as $$
  with totals as (
    select coalesce(sum(games), 0)::bigint as total
    from tft_daily_item_stats
    where region = any(p_regions)
      and bucket = any(p_buckets)
      and day >= current_date - (p_days || ' days')::interval
      and (p_patch is null or patch = p_patch)
      and (p_set is null or set_number = p_set)
  ),
  base as (
    select f.api_name, f.games, f.sum_placement, f.top4, f.top1, f.top_users
    from tft_daily_item_stats f
    where f.region = any(p_regions)
      and f.bucket = any(p_buckets)
      and f.day >= current_date - (p_days || ' days')::interval
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
$$;
