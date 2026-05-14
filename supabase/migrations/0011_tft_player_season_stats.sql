-- Per-player, per-set aggregate stats. Populated by the Hetzner-side
-- crawler (scripts/collect-tft-marketvalues.mjs) and synced here by
-- scripts/sync-marketvalue-to-supabase.mjs. One row per (puuid, region,
-- set_number). The Vercel API reads this table for set-wide player views;
-- it never has to walk match-cache rows itself.

create table if not exists tft_player_season_stats (
  puuid              text not null,
  region             text not null,
  set_number         int  not null,
  sample_size        int  not null default 0,
  avg_placement      numeric(5,3),
  top4_rate          numeric(5,4),
  top1_rate          numeric(5,4),
  bottom4_rate       numeric(5,4),
  placement_stddev   numeric(5,3),
  best_top4_streak   int,
  unique_comps       int,
  dominant_share     numeric(5,4),
  meta_pick_share    numeric(5,4),
  item_slam_score    numeric(5,4),
  first_match_at     timestamptz,
  last_match_at      timestamptz,
  updated_at         timestamptz not null default now(),
  primary key (puuid, region, set_number)
);

create index if not exists idx_season_stats_region_set
  on tft_player_season_stats(region, set_number, sample_size desc);

alter table tft_player_season_stats enable row level security;
create policy "anon read" on tft_player_season_stats for select using (true);
