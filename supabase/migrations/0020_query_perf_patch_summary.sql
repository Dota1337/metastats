-- 0020: query performance
--
-- Two recurring 57014 ("canceling statement due to statement timeout")
-- sources observed on prod 2026-05-24:
--   1. get_tft_available_patches(180) does a day-range scan + group-by over
--      tft_daily_comp_stats and sum(games). Without a covering index it pays
--      a heap fetch per row across ~whole set → erratic 1.4s..>11s, tipping
--      into the role statement_timeout under DB load.
--   2. The server-side reads run as service_role; its statement_timeout was
--      short enough that the patch-list + marketvalue reads 500'd.

-- this session only — don't let the index build get killed by a timeout
set statement_timeout = 0;

-- Covering index: lets the patch-summary query do an index-only scan
-- (day range → patch/set_number/games straight from the index, no heap).
-- The daily-stats tables are append-only between crawls, so the visibility
-- map stays all-visible and the planner can actually use index-only scans.
create index if not exists idx_tft_daily_comp_patch_summary
  on tft_daily_comp_stats (day, patch, set_number) include (games);

-- Give the server-side roles headroom. 20s is well above the ~2-7s these
-- reads take now that the covering index is in place, but stops the
-- occasional load-spike from surfacing as a 500 to the user.
alter role service_role  set statement_timeout = '20s';
alter role authenticated set statement_timeout = '20s';
