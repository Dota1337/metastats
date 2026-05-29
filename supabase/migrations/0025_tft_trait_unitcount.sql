-- TFT num_units per trait (2026-05-29)
-- Per-trait distribution by ACTUAL unit count (not just the activated
-- breakpoint) → answers "does overcapping a trait help?" (e.g. running 7
-- units of a 6-breakpoint trait). Mirrors tft_daily_trait_stats with
-- num_units in place of activation. Backfills from the next daily crawl.

create table if not exists tft_daily_trait_unitcount_stats (
  id bigint generated always as identity primary key,
  region text not null,
  bucket text not null,
  patch text not null,
  set_number int not null,
  day date not null,
  name text not null,
  num_units int not null,
  games int not null default 0,
  sum_placement int not null default 0,
  top4 int not null default 0,
  unique (region, bucket, patch, set_number, day, name, num_units)
);
create index if not exists idx_tft_daily_trait_uc_lookup
  on tft_daily_trait_unitcount_stats(region, bucket, day, set_number);
create index if not exists idx_tft_daily_trait_uc_day_patch
  on tft_daily_trait_unitcount_stats(day, patch, set_number);

-- Public aggregate stats (no PII) — same RLS posture as the other daily tables.
alter table tft_daily_trait_unitcount_stats enable row level security;
create policy "anon read" on tft_daily_trait_unitcount_stats for select using (true);

create or replace function get_tft_trait_unitcount_stats(
  p_regions text[],
  p_buckets text[],
  p_days int default 3,
  p_patch text default null,
  p_set int default null,
  p_name text default null
)
returns table (
  name text,
  num_units int,
  games bigint,
  sum_placement bigint,
  top4 bigint
)
language sql
stable
as $$
  select
    f.name,
    f.num_units,
    sum(f.games)::bigint,
    sum(f.sum_placement)::bigint,
    sum(f.top4)::bigint
  from tft_daily_trait_unitcount_stats f
  where f.region = any(p_regions)
    and f.bucket = any(p_buckets)
    and f.day >= current_date - (p_days || ' days')::interval
    and (p_patch is null or f.patch = p_patch)
    and (p_set is null or f.set_number = p_set)
    and (p_name is null or f.name = p_name)
  group by f.name, f.num_units
$$;
