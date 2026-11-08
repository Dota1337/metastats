-- 0117: LoL-Match-Ablage speichert Riots Team-Teil (info.teams) mit (2026-11-08).
--
-- NUR SUPABASE (lol_player_match_cache liegt nur dort, collect-lol-matches.mjs
-- schreibt ueber SUPABASE_DB_URL || DATABASE_URL).
--   node scripts/db-exec.mjs supabase/migrations/0117_lol_match_cache_teams.sql
--
-- WARUM: Die Spielerseite zeigt in der Objektiv-Kontrolle jetzt den Drachen-
-- Anteil des Teams und den ersten Drachen (stats-categories.ts, Team-Teil aus
-- match-processor.ts teamObjectivesFor). Live liefert Riot info.teams in jeder
-- Match-Antwort; die Ablage verwarf ihn bisher (buildRow speicherte nur den
-- Teilnehmer). Gemessen an EUW1_8039501777: 2 Teams, 990 Byte, also rund
-- +13 % je Zeile. Aeltere Zeilen bleiben null, nachgeladen wird nicht (der
-- Sammler schreibt mit on conflict do nothing); die Saison-Ansicht zeigt die
-- Team-Zeilen erst ab 10 Spielen mit Team-Teil.
--
-- Ohne Default: dann ist ADD COLUMN nur ein Eintrag im Katalog, die 1,6-GB-
-- Tabelle wird nicht umgeschrieben. lock_timeout, damit ein laufender Sammler-
-- Insert die Sperre nicht lange aufhaelt; scheitert sie, einfach neu starten.
--
-- Reihenfolge: ERST diese Migration, DANN Sammler-Deploy (sonst scheitert jeder
-- Insert an der fehlenden Spalte) und Neustart metastats-lol-matchfill.
--
-- Rollback: alter table public.lol_player_match_cache drop column if exists teams;
-- (vorher den Sammler auf den alten Stand bringen).

set lock_timeout = '5s';

alter table public.lol_player_match_cache add column if not exists teams jsonb;
