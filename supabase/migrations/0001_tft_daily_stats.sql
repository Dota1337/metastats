-- TFT daily-stats schema (2026-05-11)
-- Tables for the daily multi-region TFT crawler. Each row is one
-- (region, bucket, patch, set, day, entity) tuple. Reads aggregate
-- across day-ranges and region-aggregates at query time.

-- Per-unit (champion) daily stats
create table if not exists tft_daily_unit_stats (
  id bigint generated always as identity primary key,
  region text not null,
  bucket text not null,                -- 'iron','bronze',…,'challenger'
  patch text not null,
  set_number int not null,
  day date not null,
  character_id text not null,
  games int not null default 0,
  sum_placement int not null default 0,
  top4 int not null default 0,
  top1 int not null default 0,
  unique (region, bucket, patch, set_number, day, character_id)
);
create index if not exists idx_tft_daily_unit_lookup
  on tft_daily_unit_stats(region, bucket, day, set_number);
create index if not exists idx_tft_daily_unit_day_patch
  on tft_daily_unit_stats(day, patch, set_number);

-- Per-item daily stats. top_users holds the top 5 champions for this item
-- as jsonb: [{characterId, games, sumPlacement}].
create table if not exists tft_daily_item_stats (
  id bigint generated always as identity primary key,
  region text not null,
  bucket text not null,
  patch text not null,
  set_number int not null,
  day date not null,
  api_name text not null,
  games int not null default 0,
  sum_placement int not null default 0,
  top4 int not null default 0,
  top_users jsonb not null default '[]'::jsonb,
  unique (region, bucket, patch, set_number, day, api_name)
);
create index if not exists idx_tft_daily_item_lookup
  on tft_daily_item_stats(region, bucket, day, set_number);
create index if not exists idx_tft_daily_item_day_patch
  on tft_daily_item_stats(day, patch, set_number);

-- Per-augment daily stats, stratified by stage slot (0=2-1, 1=3-2, 2=4-2)
create table if not exists tft_daily_augment_stats (
  id bigint generated always as identity primary key,
  region text not null,
  bucket text not null,
  patch text not null,
  set_number int not null,
  day date not null,
  api_name text not null,
  slot int not null,
  games int not null default 0,
  sum_placement int not null default 0,
  top4 int not null default 0,
  unique (region, bucket, patch, set_number, day, api_name, slot)
);
create index if not exists idx_tft_daily_augment_lookup
  on tft_daily_augment_stats(region, bucket, day, set_number);
create index if not exists idx_tft_daily_augment_day_patch
  on tft_daily_augment_stats(day, patch, set_number);

-- Per-trait daily stats, one row per (trait, activation level)
create table if not exists tft_daily_trait_stats (
  id bigint generated always as identity primary key,
  region text not null,
  bucket text not null,
  patch text not null,
  set_number int not null,
  day date not null,
  name text not null,
  activation int not null,
  games int not null default 0,
  sum_placement int not null default 0,
  top4 int not null default 0,
  unique (region, bucket, patch, set_number, day, name, activation)
);
create index if not exists idx_tft_daily_trait_lookup
  on tft_daily_trait_stats(region, bucket, day, set_number);
create index if not exists idx_tft_daily_trait_day_patch
  on tft_daily_trait_stats(day, patch, set_number);

-- Per-comp-cluster daily stats. cluster_key matches the format the
-- aggregator emits: `${primaryTrait}@${level}_${carryUnit}`.
create table if not exists tft_daily_comp_stats (
  id bigint generated always as identity primary key,
  region text not null,
  bucket text not null,
  patch text not null,
  set_number int not null,
  day date not null,
  cluster_key text not null,
  games int not null default 0,
  sum_placement int not null default 0,
  top4 int not null default 0,
  top1 int not null default 0,
  typical_units jsonb not null default '[]'::jsonb,
  typical_augments jsonb not null default '[]'::jsonb,
  carry_items jsonb not null default '[]'::jsonb,
  unique (region, bucket, patch, set_number, day, cluster_key)
);
create index if not exists idx_tft_daily_comp_lookup
  on tft_daily_comp_stats(region, bucket, day, set_number);
create index if not exists idx_tft_daily_comp_day_patch
  on tft_daily_comp_stats(day, patch, set_number);

-- Per-crawl metadata — useful for diagnostics and for the pickRate
-- denominator (sum of participants per region/day/bucket).
create table if not exists tft_daily_crawl_meta (
  region text not null,
  bucket text not null,
  day date not null,
  patch text not null,
  set_number int not null,
  matches_analyzed int not null default 0,
  matches_skipped int not null default 0,
  participants int not null default 0,   -- matches × 8 for this bucket
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  primary key (region, bucket, day, set_number)
);

-- Comp pair counter edges — used for the per-comp "beats / loses to" view.
-- Aggregated per (region, bucket, patch, set, day) so we can roll up the
-- right slice when the frontend filter changes.
create table if not exists tft_daily_comp_pairs (
  id bigint generated always as identity primary key,
  region text not null,
  bucket text not null,
  patch text not null,
  set_number int not null,
  day date not null,
  a_key text not null,
  b_key text not null,                   -- sorted < b_key for dedup
  games int not null default 0,
  a_better int not null default 0,
  unique (region, bucket, patch, set_number, day, a_key, b_key)
);
create index if not exists idx_tft_daily_comp_pairs_lookup
  on tft_daily_comp_pairs(region, bucket, day, set_number);

-- RLS: enabled for safety; service role bypasses RLS for writes.
alter table tft_daily_unit_stats    enable row level security;
alter table tft_daily_item_stats    enable row level security;
alter table tft_daily_augment_stats enable row level security;
alter table tft_daily_trait_stats   enable row level security;
alter table tft_daily_comp_stats    enable row level security;
alter table tft_daily_crawl_meta    enable row level security;
alter table tft_daily_comp_pairs    enable row level security;

-- Anonymous users may read everything (these are public meta stats).
create policy "anon read" on tft_daily_unit_stats    for select using (true);
create policy "anon read" on tft_daily_item_stats    for select using (true);
create policy "anon read" on tft_daily_augment_stats for select using (true);
create policy "anon read" on tft_daily_trait_stats   for select using (true);
create policy "anon read" on tft_daily_comp_stats    for select using (true);
create policy "anon read" on tft_daily_crawl_meta    for select using (true);
create policy "anon read" on tft_daily_comp_pairs    for select using (true);
