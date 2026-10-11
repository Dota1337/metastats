-- 0093: Index fuer get_tft_set_bucket_coverage ohne Heap-Zugriff (2026-10-11).
--
-- resolveDefaultBucket (tft-supabase-reader.ts:239) fragt bei jedem Aufruf mit
-- bucketAuto=1 — alle TFT-Filterseiten und vier Companion-Routen — die
-- Spiele-Verteilung des laufenden Sets ueber 7 Tage ab (0062). Gemessen
-- 11.10.2026: der Plan nimmt idx_tft_daily_comp_day_patch und holt `bucket`
-- und `games` aus dem Heap — 57.669 Zeilen, 8.990 Puffer (~70 MB). Warm 50 ms,
-- kalt von Platte Ø 4.216 ms / max 8.993 ms (pg_stat_statements, 77 Aufrufe
-- seit 10.10.). Der Cache haelt 6 h je Instanz, jede kalte Instanz zahlt das.
--
-- Statt eines siebten Index auf der Tabelle, in die der Tageslauf schreibt,
-- bekommt idx_tft_daily_comp_patch_summary (0020: day, patch, set_number
-- INCLUDE games) zusaetzlich `bucket` in den INCLUDE-Teil. Gleicher Schluessel,
-- also bedient er seine bisherigen Abfragen weiter (gemessen: 672 Zugriffe mit
-- je 1 Zeile, Patch-Uebersicht); die Coverage-Abfrage wird zum
-- Index-Only-Scan (~340 Seiten statt 8.990). Die Sichtbarkeits-Karte haelt das
-- VACUUM nach dem Tageslauf warm (crawl-allranks-all-regions.mjs).
--
-- CONCURRENTLY: kein Transaktionsblock. Mit scripts/db-exec.mjs einspielen
-- (Anweisung fuer Anweisung, autocommit), NICHT waehrend des VACUUM nach dem
-- Tageslauf — beide warten auf laufende Transaktionen (siehe 0048). Bricht der
-- Aufbau ab, bleibt ein ungueltiger Index zurueck: die erste Zeile raeumt ihn
-- beim naechsten Versuch weg.
--
-- Rueckbau:
--   create index concurrently idx_tft_daily_comp_patch_summary
--     on tft_daily_comp_stats (day, patch, set_number) include (games);
--   drop index concurrently idx_tft_daily_comp_patch_bucket_summary;

set statement_timeout = 0;

drop index concurrently if exists idx_tft_daily_comp_patch_bucket_summary;

create index concurrently idx_tft_daily_comp_patch_bucket_summary
  on public.tft_daily_comp_stats (day, patch, set_number) include (games, bucket);

drop index concurrently if exists idx_tft_daily_comp_patch_summary;
