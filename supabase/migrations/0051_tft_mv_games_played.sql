-- 0051: Spielzaehler auf den Marktwert-Snapshots
--
-- WOZU: Die Marktwert-Pipeline fasst taeglich alle 52.091 D2+ Spieler an und
-- faehrt fuer jeden eine eigene Riot-Call-Kette — auch fuer die grosse
-- Mehrheit, die an dem Tag nicht gespielt hat. Mit dem gespeicherten
-- Spielzaehler laesst sich das gegen die gebuendelten Liga-Eintraege
-- vergleichen (~30-60 Calls pro Region statt ~10.876) und der Match-Fetch auf
-- die tatsaechlich Aktiven beschraenken.
--
-- TFT-Semantik: der Liga-Eintrag liefert `wins` (Top-4-Platzierungen) und
-- `losses` (Platz 5-8). Gespeichert wird die SUMME — die Gesamtzahl gewerteter
-- Spiele. Die Einzelwerte sind hier bewusst NICHT interessant, wir wollen nur
-- wissen, ob sich etwas bewegt hat.
--
-- HINWEIS an kuenftige Migrationen: scripts/db-exec.mjs zerlegt Statements
-- naiv am Semikolon, OHNE Kommentare zu beruecksichtigen. Ein Semikolon in
-- einem `--`-Kommentar zerreisst das Statement und fuehrt zu einem
-- "syntax error at or near ..." (hier passiert am 2026-08-02). psql -f auf der
-- Box ist davon nicht betroffen. Also: keine Semikolons in Kommentaren.
--
-- Additiv und nullable: bestehende Upserts (tft-marketvalue-pipeline.mjs,
-- refresh-api-server.mjs) fuehren die Spalte nicht und laufen unveraendert
-- weiter. NULL bedeutet "kein Vortageswert bekannt" und wird von der
-- Aktivitaetserkennung als AKTIV gewertet — der erste Lauf nach dieser
-- Migration rechnet also einmal alles durch, danach greift die Inkrementalitaet.
--
-- Diese Tabelle lebt auf der Hetzner-Local-PG UND gespiegelt auf Supabase
-- (siehe reference_hetzner_supabase_db_split.md) — die Migration muss auf
-- BEIDEN laufen.

alter table tft_player_marketvalue_snapshots
  add column if not exists games_played integer;

comment on column tft_player_marketvalue_snapshots.games_played is
  'wins+losses aus dem Riot-Liga-Eintrag zum Snapshot-Zeitpunkt = Gesamtzahl gewerteter Spiele. Dient der Aktivitaetserkennung: unveraendert gegenueber dem Vortag => Spieler hat nicht gespielt => kein Match-Fetch noetig. NULL = unbekannt => als aktiv behandeln.';

-- Der Lookup der Aktivitaetserkennung ist "letzter Snapshot je puuid in einer
-- Region". Der Index aus 0048 (region, puuid, snapshot_date desc) deckt genau
-- dieses distinct-on-Muster bereits ab — hier ist kein weiterer noetig.
