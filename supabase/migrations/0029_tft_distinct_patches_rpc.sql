-- 0029: distinct-patches RPC for /api/tft/sets/current.
--
-- The route used to pull every (patch, day) row for the current set
-- (~hundreds of thousands as the daily crawl grows) and reduce them to
-- distinct(patch) + min(day) client-side. At Vercel build time the
-- transfer + parse alone tripped the 60s static-prerender limit.
--
-- This RPC does the reduction server-side and returns at most O(patches)
-- rows (typically 1–6 per set).
--
-- Index choice: a leading set_number means the planner can either index-
-- only-scan or do a tiny bitmap range; without it both existing indexes
-- have set_number trailing and degenerate to a full scan.

create index if not exists idx_tft_daily_unit_set_patch_day
  on tft_daily_unit_stats(set_number, patch, day);

create or replace function get_tft_distinct_patches_for_set(p_set int)
returns table (
  patch text,
  first_day date
)
language sql
stable
as $$
  select patch, min(day)::date as first_day
  from tft_daily_unit_stats
  where set_number = p_set
    and patch is not null
  group by patch
  order by min(day) asc;
$$;

grant execute on function get_tft_distinct_patches_for_set(int)
  to anon, authenticated, service_role;
