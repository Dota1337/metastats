-- Rollback zu 0114: Kombinationen der Item-Detailseite ohne eigene Funktion. Vorher den Code
-- zurueckdrehen (Route ruft sonst eine fehlende Funktion: die Kombinationen fallen auf „failed",
-- die Traeger bleiben).
set lock_timeout = '5s';

drop function if exists public.get_tft_item_set_combos(text, text[], text[], text[], integer, text, integer, date);

notify pgrst, 'reload schema';
