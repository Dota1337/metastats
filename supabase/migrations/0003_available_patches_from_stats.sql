-- Fix get_tft_available_patches to derive from the stats tables instead of
-- the (sometimes empty) crawl_meta table. Imports of older JSON files don't
-- carry a participantsByBucket row, so they never populate crawl_meta — but
-- they DO populate every other table. We use tft_daily_comp_stats as the
-- "did we crawl this day?" canary since it always has at least one row per
-- (region, bucket, day, patch, set) tuple where the player had any board
-- the aggregator could classify.
--
-- Plus: backfill crawl_meta for any (region, bucket, day, patch, set) that
-- already has comp_stats rows but no meta — so the new daily crawler doesn't
-- start with a participants=0 row for the older imported data.

create or replace function get_tft_available_patches(p_days int default 30)
returns table (
  patch text,
  set_number int,
  first_day date,
  last_day date,
  total_matches bigint
)
language sql
stable
as $$
  select
    patch,
    set_number,
    min(day) as first_day,
    max(day) as last_day,
    sum(games)::bigint as total_matches
  from tft_daily_comp_stats
  where day >= current_date - (p_days || ' days')::interval
  group by patch, set_number
  order by max(day) desc, patch desc
$$;

-- Backfill crawl_meta. Each (region, bucket, day, patch, set) tuple in
-- comp_stats represents a crawl that happened; the sum of comp_stats.games
-- per tuple is exactly the participants count for that bucket. We insert
-- only the rows that aren't already in crawl_meta so re-running this
-- migration is safe and won't clobber the real participants numbers the
-- post-aggregator-update crawler writes.

insert into tft_daily_crawl_meta (
  region, bucket, day, patch, set_number,
  matches_analyzed, matches_skipped, participants, finished_at
)
select
  c.region,
  c.bucket,
  c.day,
  c.patch,
  c.set_number,
  0 as matches_analyzed,   -- unknown for backfill; current crawler fills this
  0 as matches_skipped,
  sum(c.games)::int as participants,
  now() as finished_at
from tft_daily_comp_stats c
left join tft_daily_crawl_meta m
  on m.region = c.region
  and m.bucket = c.bucket
  and m.day = c.day
  and m.set_number = c.set_number
where m.region is null   -- only insert where no meta row exists
group by c.region, c.bucket, c.day, c.patch, c.set_number;
