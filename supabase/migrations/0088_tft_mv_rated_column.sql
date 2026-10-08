-- 0088: Marktwert-Zeilen "nicht bewertet" (rated = false)
--
-- Diese Tabelle lebt auf der Hetzner-Local-PG UND gespiegelt auf Supabase — die
-- Migration muss auf BEIDEN laufen, und zwar BEVOR Code live geht, der die
-- Spalte schreibt oder liest (Tagesrechnung, Spiegel, Vertraege, 0089).
--   Supabase:  node scripts/db-exec.mjs supabase/migrations/0088_tft_mv_rated_column.sql
--   Box:       psql "$DATABASE_URL" -f supabase/migrations/0088_tft_mv_rated_column.sql
--
-- Warum: Wer unter Diamond 2 faellt, bekam bisher einfach keine neue Zeile mehr.
-- Seite und Vergleichsgruppe arbeiteten dann wochenlang mit dem letzten Wert
-- weiter. Ab jetzt schreibt die Tagesrechnung eine Platzhalter-Zeile mit
-- rated = false und final_value 0. Alle Leser filtern NACH dem Entdoppeln je
-- Spieler auf rated, sonst taucht der vorletzte, noch bewertete Tag wieder auf.
--
-- default true: alle bestehenden Zeilen sind bewertet. Seit PG11 ist das ein
-- reiner Katalog-Eintrag ohne Umschreiben der Tabelle (Supabase 17, Box 16).
-- lock_timeout: der kurze exklusive Lock darf sich nicht hinter einer laufenden
-- Tagesrechnung anstellen und dabei alle Leser mitblockieren. Laeuft er ab,
-- einfach spaeter wiederholen.
--
-- Rollback: alter table tft_player_marketvalue_snapshots drop column rated
-- (erst NACH dem Rueckbau von 0089 und des Codes, der die Spalte schreibt).

set lock_timeout = '5s';

alter table tft_player_marketvalue_snapshots
  add column if not exists rated boolean not null default true;

comment on column tft_player_marketvalue_snapshots.rated is
  'false = Platzhalter nicht bewertet (unter Diamond 2 oder ohne Rang), final_value 0. Nie in Ranglisten, Aufsteigern, Verlauf oder Vergleichsgruppe.';
