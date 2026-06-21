-- 0045: get_tft_available_patches RPC auf tft_daily_crawl_meta umstellen.
--
-- 2026-06-21: existing RPC liest aus tft_daily_comp_stats (223k Rows total,
-- 138k letzte 30d) und timeoutet konsistent nach 25s auf Production. Direct-
-- REST-Call wirft "canceling statement due to statement timeout" trotz
-- existing Index `idx_tft_daily_comp_patch_summary (day, patch, set_number)
-- INCLUDE (games)` aus Migration 0020.
--
-- Root-Cause (data-skeptic-Verdict): Visibility-Map ist KOMPLETT leer
-- (`last_vacuum=never`, `n_live_tup=0`), Auto-Vacuum-Daemon sieht die Tabelle
-- nicht. Index-Only-Scan muss bei 95.591 von 138.612 Rows in den Heap fallen
-- (69% Heap-Fetches). Auf Production-Nano-Pooler eskaliert das zu Timeout.
--
-- Fix: RPC liest stattdessen aus `tft_daily_crawl_meta` (3.392 Rows, 66x
-- kleiner). Migration 0003 hat crawl_meta seit dem Backfill mit denselben
-- (region, bucket, day, patch, set_number)-Tupeln gefuellt. `participants`
-- ist Aequivalent zu `sum(games)` aus comp_stats fuer den Use-Case "wieviele
-- Matches in diesem Patch".
--
-- Cascade-Effekt: getAvailablePatches() in Vercel-API hat 8s Default-Timeout.
-- Bei comp_stats-Read → Timeout → patches=[] → filters.patch=null → snapshot-
-- skip → Live-RPC-Fall-Through → weitere 8s Timeout → 502. crawl_meta-Read
-- ist 1.8ms (data-skeptic-Probe) → kein Timeout-Risiko mehr.
--
-- Output-Schema identisch zur 0003-Version. Caller (tft-supabase-reader.ts)
-- bleibt unveraendert.

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
    sum(participants)::bigint as total_matches
  from tft_daily_crawl_meta
  where day >= current_date - (p_days || ' days')::interval
    and patch is not null
  group by patch, set_number
  order by max(day) desc, patch desc
$$;

grant execute on function get_tft_available_patches(int)
  to anon, authenticated, service_role;
