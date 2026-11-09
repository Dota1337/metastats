-- Rollback 0122: LoL-Namensverzeichnis entfernen.
--
-- Reihenfolge: ERST den Code zuruecknehmen (die Routen fallen sonst auf das
-- TFT-Verzeichnis zurueck und schreiben Fehler ins Log, brechen aber nicht).
--
-- tft_name_norm bleibt stehen — die Funktion gehoert zu 0072 und wird von der
-- TFT-Suche weiter gebraucht.

set statement_timeout = 0;

drop function if exists public.search_lol_player_names_exact(text, integer);
drop function if exists public.search_lol_player_names(text, text, integer);
drop function if exists public.delete_lol_player_name(text, text);
drop function if exists public.upsert_lol_player_names(jsonb);
drop table if exists public.lol_player_names;

notify pgrst, 'reload schema';
