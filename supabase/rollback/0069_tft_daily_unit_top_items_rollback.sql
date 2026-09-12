-- Rollback zu supabase/migrations/0069_tft_daily_unit_top_items.sql
--
-- Nicht automatisch angewendet — bewusst ausserhalb von supabase/migrations.
--
-- Anwenden:
--   node scripts/db-exec.mjs supabase/rollback/0069_tft_daily_unit_top_items_rollback.sql
--
-- Reihenfolge: ZUERST den Writer-Block (scripts/lib/tft-supabase-writer.mjs,
-- Abschnitt „Unit-Top-Items") auf der Box entfernen — er faengt Fehler zwar ab,
-- wuerde aber jede Nacht eine Fehlermeldung je Region loggen. Die Route
-- /api/tft/units ueberlebt ein fehlendes RPC (ausser im Publisher-Modus, dort
-- bricht die Permutation bewusst ab). Die Rohdaten sind nicht betroffen:
-- Items stecken weiter im Match-Cache und in den JSON-Dateien.

drop function if exists public.get_tft_unit_top_items(text[], text[], int, text, int, int);
drop table if exists public.tft_daily_unit_top_items;

notify pgrst, 'reload schema';
