-- Rollback zu 0115: get_tft_item_carriers wieder in der Fassung von 0096 (ein Zweig mit
-- `p_api_names is null or …`), Index idx_tft_daily_item_api_day weg. Keine App-Aenderung noetig.
-- Mit scripts/db-exec.mjs einspielen (kein Transaktionsblock wegen CONCURRENTLY).
set statement_timeout = 0;
set lock_timeout = '5s';

create or replace function public.get_tft_item_carriers(
  p_api_names text[],
  p_regions text[],
  p_buckets text[],
  p_days integer default 3,
  p_patch text default null,
  p_set integer default null,
  p_end_day date default null
)
returns table(api_name text, carriers jsonb)
language sql
stable
as $$
  with users as (
    select f.api_name, u->>'characterId' as k,
           sum((u->>'games')::bigint) as g,
           sum(coalesce((u->>'sumPlacement')::bigint, 0)) as sp,
           sum(coalesce((u->>'top4')::bigint, 0)) as t4,
           sum(coalesce((u->>'top1')::bigint, 0)) as t1
    from public.tft_daily_item_stats f
    cross join lateral jsonb_array_elements(f.top_users) u
    where (p_api_names is null or f.api_name = any(p_api_names))
      and f.region = any(p_regions)
      and f.bucket = any(p_buckets)
      and f.day >= coalesce(p_end_day + 1, current_date) - (p_days || ' days')::interval and f.day <= coalesce(p_end_day, current_date)
      and (p_patch is null or f.patch = p_patch)
      and (p_set is null or f.set_number = p_set)
      and u->>'characterId' is not null
    group by 1, 2
  )
  select api_name, jsonb_agg(jsonb_build_array(k, g, sp, t4, t1) order by g desc, k collate "C")
  from (select u.*, row_number() over (partition by u.api_name order by u.g desc, u.k collate "C") as rn from users u) x
  where rn <= 15
  group by api_name
$$;

set lock_timeout = 0;

drop index concurrently if exists public.idx_tft_daily_item_api_day;

notify pgrst, 'reload schema';
