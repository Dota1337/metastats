-- 0028: lean item-stats RPC for the LIST view.
--
-- get_tft_item_stats (0002) does `jsonb_agg(f.top_users)`, which collects EVERY
-- per-day top_users array (one per region×bucket×day row) into a single giant
-- jsonb array and ships it to the API, which then flattens + re-groups + takes
-- the top-8 carriers per item in JS. Building that giant intermediate jsonb is
-- the bottleneck: all-bucket / 7-day measured ~76s and tripped the 20s
-- statement timeout → 502 for users; even diamond / 3-day was ~9s.
--
-- This lean variant does the carrier merge IN SQL: unnest the per-day
-- top_users, sum games per characterId, keep the top 8, and return that compact
-- list. To keep the route untouched, the compact list is wrapped in a
-- single-element outer array — the exact `jsonb[]` shape the API's
-- mergeJsonbCountArrays already expects (it re-sums + re-slices, which is
-- idempotent on an already-merged list). Scalar sums (games / placement / top4)
-- are unchanged.
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
    select f.api_name, f.games, f.sum_placement, f.top4, f.top_users
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
      sum(games)::bigint        as games,
      sum(sum_placement)::bigint as sum_placement,
      sum(top4)::bigint          as top4
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
      -- character_id tiebreak makes the top-8 deterministic when carriers are
      -- tied on games (the old jsonb_agg + JS-Map merge left this arbitrary).
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
    (select total from totals),
    -- Wrap the pre-merged top-8 in a single-element outer array so the API's
    -- mergeJsonbCountArrays (which iterates an array-of-arrays) keeps working.
    case when ut.merged is null then '[]'::jsonb else jsonb_build_array(ut.merged) end
  from agg a
  left join users_top ut on ut.api_name = a.api_name
$$;
