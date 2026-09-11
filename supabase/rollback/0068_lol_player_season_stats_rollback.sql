-- Rollback zu supabase/migrations/0068_lol_player_season_stats.sql
--
-- Nicht automatisch angewendet — bewusst ausserhalb von supabase/migrations.
--
-- Anwenden:
--   node scripts/db-exec.mjs supabase/rollback/0068_lol_player_season_stats_rollback.sql
--
-- Unbedenklich: die Tabelle haelt nur Rechenergebnisse. Die Rohdaten in
-- lol_player_match_cache bleiben unberuehrt, und jede Zeile hier entsteht beim
-- naechsten Seitenaufruf neu. Vorher LOL_SEASON_STATS_ENABLED in Vercel auf
-- etwas anderes als 'true' setzen, sonst antwortet die Route mit Fehler 500.

drop table if exists public.lol_player_season_stats;

notify pgrst, 'reload schema';
