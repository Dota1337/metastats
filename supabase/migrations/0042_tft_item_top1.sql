-- 0042: Top1 (win-count) column for tft_daily_item_stats.
--
-- Phase A3 — Items list win-rate. Units/Comps already had top1 since 0001;
-- items were the only stats sparte without a win-rate column. data-skeptic
-- found that backfilling from tft_player_match_cache is semantically
-- incompatible with the live aggregator (bucket comes from the source-
-- discovery-player-tier in collect-tft-allranks.mjs, not from the cache —
-- the cache has neither bucket nor patch nor game_version columns).
--
-- Strategy: forward-fill only. The aggregator patch (tft-build-aggregator.mjs
-- newItemBucket + writer) ships in the same release, so the column gets
-- populated from the next daily crawl onward. Historical rows keep top1=NULL
-- so the API can render "—" instead of a misleading 0% win-rate (memory
-- feedback_no_fake_values).
--
-- DEFAULT NULL (not 0) deliberately: 0 would lie about historical rows
-- ("this item never won") when in truth we just didn't aggregate it yet.
-- Reader-side `top1Rate = top1 != null ? top1 / games : null` distinguishes
-- the two cases cleanly.

alter table tft_daily_item_stats
  add column if not exists top1 int;

comment on column tft_daily_item_stats.top1 is
  'Top1 (win) count per item-day-bucket. NULL = not aggregated (historical rows before 0042). Forward-filled from collect-tft-allranks.mjs aggregator output.';
