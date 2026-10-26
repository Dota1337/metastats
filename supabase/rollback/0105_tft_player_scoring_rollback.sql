-- Rueckbau 0105 (nur Box). Vorher LOBBY_CAPTURE=0 setzen und den Timer
-- metastats-player-scoring-population.timer abschalten, sonst schreiben
-- Erfassung und Nachtlauf gegen fehlende Tabellen (beide fangen das ab und
-- melden es, der Match-Cache laeuft weiter).
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction -f supabase/rollback/0105_tft_player_scoring_rollback.sql
drop table if exists public.tft_player_scoring_population;
drop table if exists public.tft_match_lobby;
