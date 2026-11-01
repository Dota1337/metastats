-- Items-Seite (User 01.11.2026): der Knopf „Ø Platzierung" im Fenster zeigt die 10 Units
-- mit dem besten Ø, nicht dieselben 10 wie bei Delta in anderer Reihenfolge. Dafuer
-- braucht die Traeger-Liste eine dritte Rangliste: die 12 besten nach Ø unter den
-- bewerteten Units (gleiche Schwelle wie Delta: 100 Kopien, 1 % der Spiele der Unit).
-- Sortiert bleibt die Liste nach Kopien, ein Leser, der die ersten 12 nimmt, sieht also
-- dasselbe wie vorher. Signatur und Rechte bleiben, deshalb CREATE OR REPLACE.
set lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_tft_item_stats_list(p_regions text[], p_buckets text[], p_days integer DEFAULT 3, p_patch text DEFAULT NULL::text, p_set integer DEFAULT NULL::integer, p_end_day date DEFAULT NULL::date)
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
      sum((u->>'games')::bigint) as g,
      sum((u->>'sumPlacement')::bigint) as sp
    from base b
    cross join lateral jsonb_array_elements(b.top_users) u
    group by b.api_name, (u->>'characterId')
  ),
  unit_games as (
    select f.character_id, sum(f.games)::numeric as games
    from tft_daily_unit_stats f
    where f.region = any(p_regions)
      and f.bucket = any(p_buckets)
      and f.day >= coalesce(p_end_day + 1, current_date) - (p_days || ' days')::interval and f.day <= coalesce(p_end_day, current_date)
      and (p_patch is null or f.patch = p_patch)
      and (p_set is null or f.set_number = p_set)
    group by f.character_id
  ),
  unit_base as (
    select character_id, sum(sp)::numeric as sp_items, sum(g)::numeric as g_items
    from users
    where api_name !~* '_Component_|Emblem|Potion|Tactician'
    group by character_id
  ),
  users_scored as (
    select
      u.api_name, u.character_id, u.g, u.sp,
      case
        when u.api_name !~* '_Component_|Emblem|Potion|Tactician'
          and u.g >= 100 and u.g >= 0.01 * ug.games
        then round(u.sp::numeric / u.g - (ub.sp_items - u.sp) / nullif(ub.g_items - u.g, 0), 3)
      end as delta
    from users u
    left join unit_base ub on ub.character_id = u.character_id
    left join unit_games ug on ug.character_id = u.character_id
  ),
  users_ranked as (
    select
      api_name, character_id, g, sp, delta,
      row_number() over (partition by api_name order by g desc, character_id) as rn,
      row_number() over (partition by api_name order by delta asc nulls last, character_id) as rn_best,
      row_number() over (partition by api_name order by case when delta is not null then sp::numeric / nullif(g, 0) end asc nulls last, character_id) as rn_avg
    from users_scored
  ),
  users_top as (
    select
      api_name,
      jsonb_agg(
        jsonb_build_object('characterId', character_id, 'games', g, 'sumPlacement', sp)
          || case when delta is null then '{}'::jsonb else jsonb_build_object('delta', delta) end
        order by g desc, character_id
      ) as merged
    from users_ranked
    where rn <= 12 or (delta is not null and (rn_best <= 12 or rn_avg <= 12))
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
