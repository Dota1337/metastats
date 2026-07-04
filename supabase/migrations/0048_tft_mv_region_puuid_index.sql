-- 0048: composite index to eliminate the external-merge-sort on the marketvalue
-- leaderboard + movers RPCs (C3, 2026-07-04).
--
-- get_tft_latest_marketvalues (0007) and get_tft_marketvalue_movers both do
-- `where region = ? order by puuid, snapshot_date desc` (distinct on puuid =
-- latest-per-player). The existing indexes ((region, snapshot_date desc),
-- (puuid, snapshot_date desc), (region, snapshot_date desc, final_value desc))
-- none match that order, so Postgres external-sorts the whole region history
-- (measured: external merge Disk 9496kB / 803ms for kr, AFTER a fresh VACUUM,
-- and it grows unbounded with history — VACUUM-immune). This composite gives
-- exactly the (puuid, snapshot_date desc) order at a fixed region equality
-- prefix, so the distinct-on becomes a first-row-per-group skip with no sort
-- node. The outer `order by final_value desc limit` then sorts only the
-- deduplicated apex set (low-thousands rows), an in-memory top-N.
--
-- CONCURRENTLY: build online, no write-lock on the live table. The DROP guards
-- the invalid-index trap — a failed prior CONCURRENTLY leaves an INVALID index
-- that a plain `if not exists` would treat as present and skip forever.
-- Apply OFF the daily-crawl VACUUM window (VACUUM + CONCURRENTLY both wait on
-- concurrent txns). db-exec.mjs autocommits per statement (no BEGIN wrapper),
-- which CONCURRENTLY requires.

drop index if exists idx_tft_mv_region_puuid_date;

create index concurrently idx_tft_mv_region_puuid_date
  on tft_player_marketvalue_snapshots (region, puuid, snapshot_date desc);
