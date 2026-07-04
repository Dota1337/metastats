-- 0049: prize-money currency provenance (W1, 2026-07-04).
--
-- crawl-tft-tournaments.mjs used to collapse `usdprize || localprize`, storing
-- native-currency amounts (KRW/JPY/CNY) unconverted into prize_usd — Legends Cup
-- showed ₩20M as "$20,000,000" (real: ~$15k). The crawler now detects the page's
-- localcurrency and converts event-dated via ECB rates (scripts/lib/fx-rates.mjs).
-- These additive columns carry the provenance: the native amount, its currency,
-- and the applied rate + effective banking day. prize_usd / prize_pool_usd keep
-- their name and now genuinely hold USD (converted or explicit usdprize).
-- Rows where no honest conversion is possible (unknown/mixed currency, no event
-- date, currency outside the ECB basket like VND/TWD/RUB) keep prize_usd NULL
-- with the native amount persisted — never a guessed rate.

alter table tft_tournaments
  add column if not exists prize_pool_native numeric,
  add column if not exists prize_pool_currency text,
  add column if not exists fx_rate numeric,
  add column if not exists fx_date date;

alter table tft_tournament_results
  add column if not exists prize_native numeric,
  add column if not exists prize_currency text,
  add column if not exists fx_rate numeric,
  add column if not exists fx_date date;
