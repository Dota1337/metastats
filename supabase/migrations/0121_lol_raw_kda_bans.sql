-- 0121: K/D/A je Teilnehmer und Bans je Match in der LoL-Rohablage.
--
-- HETZNER-LOCAL-PG ONLY — NICHT auf Supabase anwenden.
-- Anwenden auf der Box:
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction -f supabase/migrations/0121_lol_raw_kda_bans.sql
--
-- Die Champion-Liste und die Startseite (EUW) rechnen ihre Zahlen seit dem
-- 08.11.2026 aus der Rohablage (scripts/aggregate-lol-builds.mjs →
-- Blob lol/champion-stats/euw1.json). Sieg- und Pickrate gingen schon, fuer KDA
-- und Bannrate fehlten die Werte. Geschrieben von scripts/collect-lol-matches.mjs
-- ab diesem Stand; aeltere Zeilen bleiben null (die Rohablage speichert das
-- Match-JSON nicht, nachladen hiesse jedes Match neu bei Riot holen).
--
-- Ohne Default: neue Spalten sind dann reine Katalog-Aenderung, die Tabelle
-- (3 Mio Zeilen) wird nicht umgeschrieben. lock_timeout, weil der Sammler
-- laufend schreibt und die Verdichtung einen Lesezeiger offen haelt.

set lock_timeout = '5s';

alter table lol_match_participant_raw
  add column if not exists kills   smallint,
  add column if not exists deaths  smallint,
  add column if not exists assists smallint;

-- Je Match eine Zeile: Riots Bans beider Teams (championId > 0), schon je Match
-- entdoppelt — beide Teams koennen denselben Champion bannen. Leeres Feld = Match
-- ohne Bans, nicht „unbekannt". Patch, Region und Rang kommen ueber match_id aus
-- lol_match_participant_raw bzw. lol_rank_match_queue.
create table if not exists lol_match_raw_bans (
  match_id    text        primary key,
  bans        smallint[]  not null,
  fetched_at  timestamptz not null default now()
);
