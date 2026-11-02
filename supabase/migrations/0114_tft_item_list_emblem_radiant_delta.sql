-- Items-Seite (User 02.11.2026): der Umschalter im Fenster heisst „Delta | Häufigste Träger" und
-- soll auch bei Emblemen und Radiants erscheinen. Dafuer brauchen beide ein Delta:
-- - Embleme: Basis ist die Unit mit ihren normalen Items OHNE Abzug. Embleme stehen nie in
--   unit_base, der Abzug der anderen Zweige wuerde etwas abziehen, das nie drin war. 1 % bleibt.
--   Augment-Embleme und Phantom-Embleme bleiben ohne Delta (feedback_no_augment_stats).
-- - Mindestzahl fuer jedes Delta 50 Kopien statt 100 (User 02.11.2026, gilt fuer alle Items).
-- - Radiants: ohne die 1-%-Regel (sie sind selten, Median-Anteil 0,19 %).
--   Radiant-Diebeshandschuhe geben jede Runde zwei zufaellige Radiants, der Sammler zaehlt sie
--   mit (tft-build-aggregator.mjs, byItem). Deshalb kein Delta, wenn die erwarteten
--   Handschuh-Kopien (2 je Handschuh-Spiel, verteilt auf alle Radiants) ueber 20 % liegen.
-- Normale Items rechnen sonst wie 0113 (bei 100 Kopien gemessen: 880 von 880 Deltas gleich).
-- Die Rangliste nach Ø (rn_avg, 0113) entfaellt mit dem Ø-Knopf. Signatur und Rechte bleiben.
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
  gloves as (
    select character_id, g::numeric as g_gloves
    from users
    where api_name ~* 'ThiefsGloves.*Radiant'
  ),
  radiant_pool as (
    select greatest(count(distinct api_name), 1)::numeric as n
    from users
    where api_name ~* 'Radiant$' and api_name !~* 'Potion|ThiefsGloves'
  ),
  users_scored as (
    select
      u.api_name, u.character_id, u.g, u.sp,
      case
        when u.api_name ~* '_Component_|Potion|Tactician|Phantom|Emblem.*Augment' or u.g < 50 then null
        when u.api_name ~* 'Emblem' then
          case when u.g >= 0.01 * ug.games
            then round(u.sp::numeric / u.g - ub.sp_items / nullif(ub.g_items, 0), 3) end
        when u.api_name ~* 'Radiant$' then
          case when 2 * coalesce(gl.g_gloves, 0) / rp.n <= 0.2 * u.g
            then round(u.sp::numeric / u.g - (ub.sp_items - u.sp) / nullif(ub.g_items - u.g, 0), 3) end
        when u.g >= 0.01 * ug.games
          then round(u.sp::numeric / u.g - (ub.sp_items - u.sp) / nullif(ub.g_items - u.g, 0), 3)
      end as delta
    from users u
    left join unit_base ub on ub.character_id = u.character_id
    left join unit_games ug on ug.character_id = u.character_id
    left join gloves gl on gl.character_id = u.character_id
    cross join radiant_pool rp
  ),
  users_ranked as (
    select
      api_name, character_id, g, sp, delta,
      row_number() over (partition by api_name order by g desc, character_id) as rn,
      row_number() over (partition by api_name order by delta asc nulls last, character_id) as rn_best
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
    where rn <= 12 or (delta is not null and rn_best <= 12)
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
