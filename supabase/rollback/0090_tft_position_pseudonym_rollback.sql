-- Rollback fuer 0090_tft_position_pseudonym.sql
--   node scripts/db-exec.mjs supabase/rollback/0090_tft_position_pseudonym_rollback.sql
--
-- Erst den Aggregator zurueckrollen (oder seinen Timer stoppen:
-- systemctl disable --now metastats-position-aggregator.timer), sonst bricht er
-- beim Lesen der fehlenden Spalten ab.
--
-- ACHTUNG: Der alte Aggregator braucht Riot-Namen. Versiegelte Zeilen tragen
-- nur noch ein Pseudonym — er haelt das fuer eine Konto-ID, findet niemanden im
-- Spiel und laesst die Spiele weg; die Aufstellungs-Tabelle schrumpft auf die
-- noch nicht versiegelten Spiele. Vorwaerts reparieren ist der bessere Weg.
--
-- Die Rechte von anon/authenticated bleiben entzogen (der Zeilenschutz hat sie
-- ohnehin gesperrt), die geloeschten TEST_-Zeilen kommen nicht zurueck.

set lock_timeout = '5s';

alter table tft_position_observations
  drop column if exists cluster_key,
  drop column if exists family_key,
  drop column if exists queue_id,
  drop column if exists classified_at;

notify pgrst, 'reload schema';
