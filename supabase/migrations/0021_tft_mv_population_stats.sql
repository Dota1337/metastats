-- Population stats for the weighted skill-score multiplier (2026-05-25).
-- One row per (region, set_number): the robust median+MAD of each raw metric
-- across the whole rated cohort, plus the expected dmg-rate per placement.
--
-- Written by the daily batch (collect-tft-marketvalues, two-pass) after Pass 1.
-- Read by the on-demand single-player refresh (refresh-api-server), which can't
-- compute a population on its own — it normalises the one player against these.
-- Applied to BOTH the Hetzner crawler PG and Supabase (the batch writes both).

create table if not exists tft_mv_population_stats (
  region       text        not null,
  set_number   integer     not null,
  medians      jsonb       not null,            -- { performance:{median,mad,n}, metaRelative:{…}, … }
  expected_dmg jsonb       not null,            -- { "1": rate, "2": rate, … } population mean dmgRate per placement
  comp_meta    jsonb       not null default '{}'::jsonb,  -- { clusterKey: { avgPlacement, games } } cohort comp benchmark for metaRelative
  player_count integer     not null default 0,  -- # players that fed the population
  computed_at  timestamptz not null default now(),
  primary key (region, set_number)
);

alter table tft_mv_population_stats enable row level security;
create policy "anon read" on tft_mv_population_stats for select using (true);
