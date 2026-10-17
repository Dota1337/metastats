-- Rollback zu supabase/migrations/0097_tft_daily_unit_extras.sql
--
-- Nicht automatisch angewendet — bewusst ausserhalb von supabase/migrations.
--
-- Anwenden:
--   node scripts/db-exec.mjs supabase/rollback/0097_tft_daily_unit_extras_rollback.sql
--
-- Reihenfolge: ZUERST Writer-Block 8c (scripts/lib/tft-supabase-writer.mjs,
-- „Artefakte + Embleme") auf der Box entfernen — er faengt Fehler ab, wuerde
-- aber jede Nacht eine Fehlermeldung je Region loggen — und die Route
-- (app/api/tft/units/route.ts) zurueck auf get_tft_unit_top_items stellen.
-- Unabhaengig von der 0095-Kette: get_tft_unit_top_items bleibt unberuehrt.

begin;
set local lock_timeout = '2s';
drop function if exists public.get_tft_unit_item_stats(text[], text[], integer, text, integer, integer, date);
drop function if exists public.get_tft_unit_extras(text[], text[], integer, text, integer, integer, date);
drop table if exists public.tft_daily_unit_extras;
commit;

notify pgrst, 'reload schema';
