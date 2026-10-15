-- Rollback zu supabase/migrations/0096_tft_daily_unit_builds.sql
--
-- Nicht automatisch angewendet — bewusst ausserhalb von supabase/migrations.
--
-- Anwenden:
--   node scripts/db-exec.mjs supabase/rollback/0096_tft_daily_unit_builds_rollback.sql
--
-- Reihenfolge: ZUERST den Writer-Block 8b (scripts/lib/tft-supabase-writer.mjs,
-- „Unit-Builds") auf der Box entfernen — er faengt Fehler ab, wuerde aber jede
-- Nacht eine Fehlermeldung je Region loggen — und die App-Lader
-- (app/lib/tft-detail-builds.ts) zurueckbauen. Ohne die Funktionen fehlen auf
-- den Detailseiten nur die Item-Abschnitte; Kernwerte und Comps bleiben.

begin;
set local lock_timeout = '2s';
drop function if exists public.get_tft_unit_builds(text[], text[], text[], integer, text, integer, date);
drop function if exists public.get_tft_item_carriers(text[], text[], text[], integer, text, integer, date);
drop table if exists public.tft_daily_unit_builds;
commit;

notify pgrst, 'reload schema';
