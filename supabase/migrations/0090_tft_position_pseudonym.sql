-- 0090: Companion-Beobachtungen ohne dauerhaften Riot-Namen
--
--   node scripts/db-exec.mjs supabase/migrations/0090_tft_position_pseudonym.sql
--
-- MUSS laufen, bevor scripts/aggregate-position-observations.mjs mit
-- Versiegelung live geht: der liest und schreibt die neuen Spalten.
--
-- Warum: observer_puuid trug seit App 0.3 den Riot-Namen (Name#TAG) im
-- Klartext, fuer immer, obwohl der Schalter in der App „anonym“ sagte. Der
-- Aggregator brauchte den Namen bei JEDEM Lauf, weil die Comp-Zuordnung nur in
-- einer Datei auf der Box stand. Ab jetzt steht die Zuordnung an den eigenen
-- Zeilen; danach ersetzt der Aggregator den Namen durch ein Pseudonym je Spiel
-- (scripts/lib/companion-positions.mjs) und leert observer_placement.
--   cluster_key   roher Cluster-Schluessel (Familien-Regel hat einen Rueckweg,
--                 feedback_user_override_family_aggregation „Rollback-Pfad“)
--   family_key    `<trait>__<carry>`, das zaehlt der Aggregator
--   queue_id      Warteschlange (nur 1090/1100 zaehlen)
--   classified_at gesetzt = Zuordnung steht fest (auch „keine“ nach 48 h)
-- distinct_observers in tft_position_unit_cell_data() (0085) zaehlt danach
-- Spiele statt Personen — gelesen wird die Spalte nirgends.
--
-- Zusaetzlich: Rechte von anon/authenticated auf beiden Rohtabellen entziehen
-- (security-baseline.json „anon-grant-rest:tft_position_observations“, in 0055
-- vergessen; der Zeilenschutz sperrte schon, das hier ist die zweite Tuer), und
-- die 42 Testzeilen (TEST_…, Beobachter = Konto-ID) loeschen.
--
-- Nullbare Spalten ohne Default: reiner Katalog-Eintrag, kein Umschreiben.
--
-- Rollback: supabase/rollback/0090_tft_position_pseudonym_rollback.sql — erst
-- NACH dem Rueckbau des Aggregators. Die Pseudonyme selbst sind bewusst nicht
-- umkehrbar.

set lock_timeout = '5s';

alter table tft_position_observations
  add column if not exists cluster_key   text,
  add column if not exists family_key    text,
  add column if not exists queue_id      integer,
  add column if not exists classified_at timestamptz;

revoke all on table tft_position_observations    from anon, authenticated;
revoke all on table tft_position_aggregator_state from anon, authenticated;

delete from tft_position_observations where match_id like 'TEST\_%';

notify pgrst, 'reload schema';
