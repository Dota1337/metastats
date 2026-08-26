-- Peak (Hoechstwert) des Marktwerts je Spieler und Set (2026-08-26).
--
-- Warum eine eigene Tabelle: tft_player_marketvalue_snapshots (0007) hat KEINE
-- set_number-Spalte. Solange nur Set 17 darin liegt, ist jede Zeile eindeutig
-- Set 17. Sobald public/tft-set.json auf 18 gebumpt und auf die Box deployt
-- ist, schreibt scripts/daily-marketvalue-snapshot.mjs Set-18-Zeilen in
-- dieselbe Tabelle — ohne Unterscheidungsmerkmal. Ein
-- `max(final_value) group by puuid` mischt dann still beide Sets. Die Grenze
-- waere danach nur noch ueber den Commit-Zeitpunkt von tft-set.json
-- rekonstruierbar, nicht mehr aus den Daten selbst.
--
-- Deshalb: Peak VOR dem Bump einfrieren, mit explizitem set_number.
-- Muster uebernommen von tft_player_season_stats (0011) — die vorhandene
-- per-Set-Tabelle.
--
-- Ein Peak = die vollstaendige Snapshot-Zeile mit dem hoechsten final_value.
-- base_value/multiplier/damping/sample_size wandern mit, weil final_value
-- allein spaeter weder erklaerbar noch reproduzierbar ist: final_value ist
-- base_value x multiplier, und base_value ist reine Rang/LP-Kurve
-- (scripts/lib/tft-marketvalue-pipeline.mjs:201). Der Peak ist damit faktisch
-- "bester Ladder-Stand des Sets", nicht "bestes Skill-Fenster".
--
-- Peak pro puuid, nicht pro (puuid, region): gemessen hat genau 1 von 53.312
-- puuids ueberhaupt mehr als eine Region. Die Region der Peak-Zeile wird als
-- Attribut mitgefuehrt.

create table if not exists tft_player_marketvalue_peaks (
  puuid              text not null,
  set_number         int  not null,

  -- Identitaet und Ladder-Stand ZUM Zeitpunkt des Peaks
  region             text not null,
  game_name          text,
  tag_line           text,
  snapshot_date      date not null,
  tier               text not null,
  rank               text,
  lp                 integer not null default 0,
  ladder_rank        integer,

  -- die volle Marktwert-Zerlegung der Peak-Zeile
  base_value         integer not null default 0,
  multiplier         numeric(5,3) not null default 1,
  final_value        integer not null default 0,
  sample_size        integer not null default 0,
  damping            numeric(3,2) not null default 1,

  -- Qualitaets- und Abdeckungs-Kontext, damit die Zahl spaeter einordbar ist
  low_confidence     boolean not null default false, -- damping < 1
  snapshot_count     integer not null default 0,     -- Snapshots des Spielers im Set
  first_snapshot_date date,
  last_snapshot_date  date,

  frozen_at          timestamptz not null default now(),
  primary key (puuid, set_number)
);

-- Leserichtung: regionale Bestenliste "hoechster je erreichter Marktwert".
create index if not exists idx_mv_peaks_set_region_value
  on tft_player_marketvalue_peaks(set_number, region, final_value desc);

-- Leserichtung: globale Bestenliste ueber alle Regionen.
create index if not exists idx_mv_peaks_set_value
  on tft_player_marketvalue_peaks(set_number, final_value desc);

alter table tft_player_marketvalue_peaks enable row level security;
create policy "anon read" on tft_player_marketvalue_peaks for select using (true);

comment on table tft_player_marketvalue_peaks is
  'Eingefrorener Hoechstwert je Spieler und Set. Abdeckungs-Vorbehalt fuer '
  'Set 17: die Snapshot-Pipeline lief nicht durchgaengig auf allen Regionen '
  '(Juli 2026 nur 5 statt 15 Regionen), der Peak ist daher der hoechste '
  'BEOBACHTETE Wert, nicht zwingend der hoechste tatsaechliche.';
