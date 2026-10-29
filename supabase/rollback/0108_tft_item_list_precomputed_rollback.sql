-- Rollback zu supabase/migrations/0108_tft_item_list_precomputed.sql
--
-- Nicht automatisch angewendet — bewusst ausserhalb von supabase/migrations.
--
-- Anwenden:
--   node scripts/db-exec.mjs supabase/rollback/0108_tft_item_list_precomputed_rollback.sql
--
-- Reihenfolge: ZUERST den Lese- und Schreibpfad abschalten — Vercel-Env
-- TFT_ITEM_PRECOMPUTED_DISABLED=1 (oder Code zurueck) und auf der Box
-- PRECOMPUTE_ITEMS=0 in /etc/metastats-crawler/env. Die Route faellt bei
-- fehlender Funktion zwar auf die Live-Abfrage zurueck, loggt dann aber bei
-- jeder schweren Anfrage einen Fehler; das Skript zaehlt jeden Item-Job als
-- Fehler.

drop function if exists public.get_tft_item_list_precomputed(text, int, text, text, int, date);
drop table if exists public.tft_item_list_precomputed;

notify pgrst, 'reload schema';
