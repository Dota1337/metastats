-- 0041_tft_comp_daily_trend.sql
-- Per-day trend RPC for one comp slug. Backs the Trends-Time-Series chart on
-- /tft/comps/[slug]: shows the comp's avg-placement, top-4-rate, top-1-rate
-- and sample volume as a 7/14/30-day line chart so the user sees rises and
-- falls within the patch, not just before/after.
--
-- Pickrate weggelassen — der Denominator (alle comps an dem Tag) ist eine
-- separate Aggregat-Frage die nicht in dieselbe RPC gehört. Wenn der UI das
-- braucht, eigene RPC nachschieben.

create or replace function get_tft_comp_daily_trend(
  p_cluster_key text,
  p_regions text[],
  p_buckets text[],
  p_days int
)
returns table (
  day date,
  games bigint,
  sum_placement bigint,
  top4 bigint,
  top1 bigint
)
language sql stable
as $$
  select day::date,
         sum(games)::bigint as games,
         sum(sum_placement)::bigint as sum_placement,
         sum(top4)::bigint as top4,
         sum(top1)::bigint as top1
  from tft_daily_comp_stats
  where region = any(p_regions)
    and bucket = any(p_buckets)
    and cluster_key = p_cluster_key
    and day > current_date - p_days
  group by day
  order by day asc;
$$;

grant execute on function get_tft_comp_daily_trend(text, text[], text[], int)
  to anon, authenticated, service_role;
