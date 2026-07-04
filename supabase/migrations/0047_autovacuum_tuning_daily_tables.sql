-- 0047: Autovacuum per-table tuning for the crawl-write aggregate tables.
--
-- Root-cause of the recurring 521/522 on heavy TFT stats RPCs (2026-06-30): the
-- daily bulk-upsert leaves the visibility map cold, so index-only-scans degrade
-- to mass heap-fetches (measured 153k fetches / 9s on
-- get_tft_distinct_patches_for_set → 0 / 0.88s after VACUUM). Autovacuum was not
-- keeping up (last_autovacuum NULL after Restart-Reset).
--
-- C1 adds a deterministic post-crawl VACUUM (ANALYZE) in the driver
-- (crawl-allranks-all-regions.mjs). This migration is the defense-in-depth
-- layer: make autovacuum far more aggressive on these tables so it also fires
-- between/independently of the driver run, and — crucially — capture the
-- settings as a reproducible migration. The comp/unit/item/trait_stats plus
-- marketvalue_snapshots settings were applied ad-hoc on 2026-06-30 and would be
-- lost on a DB restore / migration replay. augment_stats and trait_unitcount_stats
-- were never tuned at all. This migration is the single source of truth for all.
--
-- scale_factor 0.02 / 0.01: trigger vacuum at 2% dead tuples, analyze at 1% churn
-- (Postgres defaults are 0.2 / 0.1 = 10x laxer). cost_limit 2000: let autovacuum
-- do 10x more work per round before sleeping (default 200) so it finishes fast
-- on the Supabase micro. Idempotent — re-running is a no-op.

do $$
declare
  t text;
  tables text[] := array[
    'tft_daily_comp_stats',
    'tft_daily_unit_stats',
    'tft_daily_item_stats',
    'tft_daily_trait_stats',
    'tft_daily_comp_pairs',
    'tft_daily_augment_stats',
    'tft_daily_trait_unitcount_stats',
    'tft_daily_crawl_meta',
    'tft_player_marketvalue_snapshots'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is not null then
      execute format(
        'alter table public.%I set ('
        || 'autovacuum_vacuum_scale_factor = 0.02, '
        || 'autovacuum_analyze_scale_factor = 0.01, '
        || 'autovacuum_vacuum_cost_limit = 2000)', t);
    end if;
  end loop;
end $$;
