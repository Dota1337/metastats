-- Comp-bound position aggregate. Joins tft_position_observations against
-- the per-match comp_cluster_key (resolved server-side via the Hetzner
-- match cache) so the heatmap on /tft/comps/[slug] can show the
-- comp-specific position distribution rather than only the global one.
--
-- Populated by scripts/aggregate-position-observations.mjs (Hetzner-side
-- job) every N hours: it reads new observations from Supabase, fetches
-- the comp_cluster_key for each (match_id, observer_puuid) from the
-- local match cache, then upserts here. The aggregator is incremental —
-- the last_observed_at column lets us only re-process new rows.

create table if not exists tft_position_comp_cell (
  cluster_key     text not null,
  unit            text not null,
  cell            smallint not null,
  observations    integer not null default 0,
  distinct_matches integer not null default 0,
  last_observed_at timestamptz default now(),
  primary key (cluster_key, unit, cell)
);

create index if not exists tft_position_comp_cell_cluster on tft_position_comp_cell (cluster_key);
create index if not exists tft_position_comp_cell_observed_at on tft_position_comp_cell (last_observed_at desc);

-- High-water mark per (source-table, key) so the incremental aggregator
-- doesn't re-scan the entire observations table on every run.
create table if not exists tft_position_aggregator_state (
  source         text primary key,
  last_observed_at timestamptz not null default '1970-01-01'::timestamptz,
  last_run_at    timestamptz default now()
);
