-- Rollback 0072: Namensverzeichnis komplett entfernen. Die Suche in der Nav
-- faellt dann auf "Keine Spieler gefunden" zurueck, der Crawler protokolliert
-- einen Schreibfehler und laeuft weiter (Exit-Code unberuehrt).

set statement_timeout = 0;

drop function if exists public.search_tft_player_names(text, text, integer);
drop function if exists public.upsert_tft_player_names(jsonb);
drop table if exists public.tft_player_names;
drop function if exists public.tft_name_norm(text);

notify pgrst, 'reload schema';
