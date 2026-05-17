-- TFT position observations from the Overwolf companion app.
-- Schema is intentionally narrow + de-duplicating: every observation is
-- keyed on (match_id, observer_puuid, kind, cell, unit) so duplicate
-- submits (e.g. companion-app restart mid-match) don't double-count.
--
-- One match produces ~30-50 own-board observations + ~50-200 opponent
-- observations across all rounds. With ~500 active users that's
-- ~125k rows per day before aggregation.

create extension if not exists "uuid-ossp";

create table if not exists tft_position_observations (
  id              uuid primary key default uuid_generate_v4(),
  match_id        text not null,
  region          text,
  observer_puuid  text,          -- the player whose client submitted (null = anon)
  observer_placement smallint,   -- where the observer finished (1-8)
  kind            text not null check (kind in ('own', 'opp')),
  cell            smallint not null,
  unit            text not null,
  level           smallint,
  items           jsonb default '[]'::jsonb,
  round           smallint,      -- best-effort, may be 0 if unknown
  observed_at     timestamptz default now(),
  client_version  text
);

-- De-dup the same observation if the client retries. We don't unique on
-- round because the same (match, observer, kind, cell, unit) tuple can
-- legitimately appear in multiple rounds (positioning unchanged across
-- combat rounds) and we want the count to reflect that observation frequency.
create unique index if not exists tft_position_observations_unique
  on tft_position_observations (match_id, observer_puuid, kind, cell, unit, round);

create index if not exists tft_position_observations_match
  on tft_position_observations (match_id);

create index if not exists tft_position_observations_observed_at
  on tft_position_observations (observed_at desc);

-- Aggregated view: position frequency per (unit, cell) globally. The
-- comp-page reads from this after we map each observation to a comp-cluster
-- via the join on tft_player_match_cache.comp_cluster_key — but for the
-- first MVP we don't need that join, just the raw unit-cell heatmap.
-- (Comp-bound aggregation comes once the aggregator picks this up.)
create or replace view tft_position_unit_cell as
  select
    unit,
    cell,
    count(*) as observations,
    count(distinct observer_puuid) as distinct_observers
  from tft_position_observations
  group by unit, cell;
