-- 0043 Family-Mode-Erweiterung fuer Trend-RPC. Optionaler p_cluster_keys
-- text-Array fuer Familien-Aggregation (Detail-Page Familien-Merge 2026-06-20).
-- Backward-Compat: alter Single-Slug-Aufruf laeuft weiter wenn p_cluster_keys
-- null bleibt. Plus optional p_min_games_per_day Floor gegen verrauschte
-- Daily-Aggregate (data-skeptic Finding 4).

create or replace function get_tft_comp_daily_trend(
  p_cluster_key text,
  p_regions text[],
  p_buckets text[],
  p_days int,
  p_cluster_keys text[] default null,
  p_min_games_per_day int default 0
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
  with raw as (
    select day::date as day,
           sum(games)::bigint as games,
           sum(sum_placement)::bigint as sum_placement,
           sum(top4)::bigint as top4,
           sum(top1)::bigint as top1
    from tft_daily_comp_stats
    where region = any(p_regions)
      and bucket = any(p_buckets)
      and (
        (p_cluster_keys is null and cluster_key = p_cluster_key)
        or (p_cluster_keys is not null and cluster_key = any(p_cluster_keys))
      )
      and day > current_date - p_days
    group by day::date
  )
  select day, games, sum_placement, top4, top1
  from raw
  where games >= p_min_games_per_day
  order by day asc;
$$;

grant execute on function get_tft_comp_daily_trend(text, text[], text[], int, text[], int)
  to anon, authenticated, service_role;
