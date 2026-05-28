-- 0023: backfill TFT patch namespace
--
-- The TFT crawler historically stored Riot's Match-V1 game_version verbatim,
-- which reports the LoL-side patch ("16.11") rather than the TFT patch players
-- see in-game ("17.4"). collect-tft-allranks.mjs now normalizes new rows to
-- the TFT namespace, so this one-time migration relabels the existing set-17
-- rows the same way — otherwise the current patch would be split across two
-- labels ("16.11" old rows + "17.4" new rows) and the comp/unit/item views
-- would only ever see half the data after the crawler switch.
--
-- Mapping uses the anchor from tft-set.json (lolPatch 16.10 ↔ latestPatch 17.3):
--   tftMinor = 3 + (major - 16) * 25 + (minor - 10)   →  16.9→17.2, 16.11→17.4
-- Only set_number = 17 rows whose patch is LoL-shaped ("16.x") are touched;
-- already-TFT labels ("17.2", "17.2b") and other sets are left untouched, so
-- re-running this migration is a no-op.

create or replace function _tft_lol_to_tft_patch(p text)
returns text language sql immutable as $$
  select case
    when p ~ '^16\.'
      then '17.' || (3 + (split_part(p, '.', 1)::int - 16) * 25
                       + (split_part(p, '.', 2)::int - 10))::text
    else p
  end
$$;

-- crawl_meta: `patch` is NOT part of the PK (region, bucket, day, set_number),
-- so there is one row per crawl day and no collision is possible — straight update.
update tft_daily_crawl_meta
  set patch = _tft_lol_to_tft_patch(patch)
  where set_number = 17 and patch ~ '^16\.';

-- The six stats tables carry `patch` in their unique key. Analysis of the live
-- data shows no LoL→TFT target collides with an existing native-TFT row (the
-- stray "17.2" rows sit on different days than "16.9"), but the NOT EXISTS guard
-- makes the relabel collision-safe regardless: a colliding row is left as-is
-- rather than violating the unique constraint.

update tft_daily_unit_stats t
  set patch = _tft_lol_to_tft_patch(t.patch)
  where t.set_number = 17 and t.patch ~ '^16\.'
    and not exists (
      select 1 from tft_daily_unit_stats x
      where x.region = t.region and x.bucket = t.bucket and x.set_number = t.set_number
        and x.day = t.day and x.character_id = t.character_id
        and x.patch = _tft_lol_to_tft_patch(t.patch));

update tft_daily_item_stats t
  set patch = _tft_lol_to_tft_patch(t.patch)
  where t.set_number = 17 and t.patch ~ '^16\.'
    and not exists (
      select 1 from tft_daily_item_stats x
      where x.region = t.region and x.bucket = t.bucket and x.set_number = t.set_number
        and x.day = t.day and x.api_name = t.api_name
        and x.patch = _tft_lol_to_tft_patch(t.patch));

update tft_daily_augment_stats t
  set patch = _tft_lol_to_tft_patch(t.patch)
  where t.set_number = 17 and t.patch ~ '^16\.'
    and not exists (
      select 1 from tft_daily_augment_stats x
      where x.region = t.region and x.bucket = t.bucket and x.set_number = t.set_number
        and x.day = t.day and x.api_name = t.api_name and x.slot = t.slot
        and x.patch = _tft_lol_to_tft_patch(t.patch));

update tft_daily_trait_stats t
  set patch = _tft_lol_to_tft_patch(t.patch)
  where t.set_number = 17 and t.patch ~ '^16\.'
    and not exists (
      select 1 from tft_daily_trait_stats x
      where x.region = t.region and x.bucket = t.bucket and x.set_number = t.set_number
        and x.day = t.day and x.name = t.name and x.activation = t.activation
        and x.patch = _tft_lol_to_tft_patch(t.patch));

update tft_daily_comp_stats t
  set patch = _tft_lol_to_tft_patch(t.patch)
  where t.set_number = 17 and t.patch ~ '^16\.'
    and not exists (
      select 1 from tft_daily_comp_stats x
      where x.region = t.region and x.bucket = t.bucket and x.set_number = t.set_number
        and x.day = t.day and x.cluster_key = t.cluster_key
        and x.patch = _tft_lol_to_tft_patch(t.patch));

update tft_daily_comp_pairs t
  set patch = _tft_lol_to_tft_patch(t.patch)
  where t.set_number = 17 and t.patch ~ '^16\.'
    and not exists (
      select 1 from tft_daily_comp_pairs x
      where x.region = t.region and x.bucket = t.bucket and x.set_number = t.set_number
        and x.day = t.day and x.a_key = t.a_key and x.b_key = t.b_key
        and x.patch = _tft_lol_to_tft_patch(t.patch));

drop function _tft_lol_to_tft_patch(text);
