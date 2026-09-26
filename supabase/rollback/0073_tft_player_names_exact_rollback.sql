-- Rollback zu 0073: nur die exakte Suche entfernen, Tabelle und
-- Praefix-Suche aus 0072 bleiben.
drop function if exists public.search_tft_player_names_exact(text, integer);
notify pgrst, 'reload schema';
