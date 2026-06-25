-- Sub-Region-Resume Inflight-Table für daily-marketvalue-snapshot driver (2026-06-25).
--
-- HETZNER-LOCAL-PG ONLY — NICHT auf Supabase anwenden.
-- Per-Player-State pro Region pro UTC-Tag während Pass-1-Gather läuft. Erlaubt
-- mid-Region-Resume nach Crash / Conflicts=SIGTERM ohne Re-Fetch aller Riot-Calls.
-- Lebt auf Hetzner-Local-PG analog tft_player_marketvalue_snapshots Original
-- (siehe reference_hetzner_supabase_db_split.md — alle per-player Tables sind hier).
--
-- Geschrieben von scripts/daily-marketvalue-snapshot.mjs Pass 1 (gather), gelesen
-- von Pass 1 (Skip-Set bei Resume) UND Pass 2 (snapshotPlayer-Iteration aus DB
-- statt In-Memory gathered). Cleanup: Region-Done-TX + stale-day-Cleanup beim
-- Driver-Start + Set-Bump-Cleanup (set_number != current_set).
--
-- Multi-Review-Verdicts adressiert:
--   logic-flow F4: Pass 2 iteriert AUS dieser Tabelle (nicht aus In-Memory)
--   architect F3: Set-Bump-Cleanup via set_number-Spalte
--   data-skeptic F3: `ranked` jsonb gestrichen (wins=0/losses=0 statisch im Driver)
--   perf-critic F1: raw_metrics tatsächlich 1-3 KB (nicht 30-50 KB) — Index-Strategie OK
--   perf-critic F3: 1 Composite-Index (day, region) statt 2 separate Indizes

create table if not exists tft_mv_inflight_raw (
  puuid         text        not null,
  region       text        not null,
  day          date        not null,
  set_number   smallint    not null,
  raw_metrics  jsonb       not null,
  persisted_at timestamptz not null default now(),
  primary key (puuid, region, day)
);

-- Composite-Index deckt BEIDE Queries: Pass-1-Read (WHERE region=X AND day=today
-- — Index-Suffix-Match via Filter), Stale-Cleanup (WHERE day < today
-- — Index-Prefix-Match). Bei <100k Rows oft auch SeqScan kompetitiv,
-- aber Index ist Boilerplate-Cost vernachlässigbar (Tabelle ist meist
-- <30k Rows da Region-Done-Cleanup nach success aufräumt).
create index if not exists idx_tft_mv_inflight_raw_day_region
  on tft_mv_inflight_raw (day, region);
