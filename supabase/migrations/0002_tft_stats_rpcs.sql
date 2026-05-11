-- TFT stats RPC functions (2026-05-11)
-- Group-by-aggregation functions called from the API routes. Each one takes
-- the same shape — arrays of regions/buckets to merge plus day range and
-- patch/set filters — and returns one row per entity with summed games,
-- summed placements (so the API can divide for averages), and the
-- bucket-wide participant count for pickRate denominators.
--
-- participants is computed from comp_stats so it never depends on the
-- crawl_meta table being populated (the older imported JSONs don't have
-- participantsByBucket, hence no meta row).

-- ── Units ──────────────────────────────────────────────────────────────────
create or replace function get_tft_unit_stats(
  p_regions text[],
  p_buckets text[],
  p_days int default 3,
  p_patch text default null,
  p_set int default null
)
returns table (
  character_id text,
  games bigint,
  sum_placement bigint,
  top4 bigint,
  top1 bigint,
  participants bigint
)
language sql
stable
as $$
  with parts as (
    select coalesce(sum(games), 0)::bigint as total
    from tft_daily_comp_stats
    where region = any(p_regions)
      and bucket = any(p_buckets)
      and day >= current_date - (p_days || ' days')::interval
      and (p_patch is null or patch = p_patch)
      and (p_set is null or set_number = p_set)
  )
  select
    f.character_id,
    sum(f.games)::bigint,
    sum(f.sum_placement)::bigint,
    sum(f.top4)::bigint,
    sum(f.top1)::bigint,
    (select total from parts)
  from tft_daily_unit_stats f
  where f.region = any(p_regions)
    and f.bucket = any(p_buckets)
    and f.day >= current_date - (p_days || ' days')::interval
    and (p_patch is null or f.patch = p_patch)
    and (p_set is null or f.set_number = p_set)
  group by f.character_id
$$;

-- ── Items ──────────────────────────────────────────────────────────────────
-- top_users merging: concat all jsonb arrays in the filter set, then in the
-- API code we re-group by characterId and pick the top 5. Cheaper to ship
-- the raw list to the API (small per-item) than to do the re-aggregation in SQL.
create or replace function get_tft_item_stats(
  p_regions text[],
  p_buckets text[],
  p_days int default 3,
  p_patch text default null,
  p_set int default null
)
returns table (
  api_name text,
  games bigint,
  sum_placement bigint,
  top4 bigint,
  total_item_slots bigint,
  top_users_merged jsonb
)
language sql
stable
as $$
  with totals as (
    select coalesce(sum(games), 0)::bigint as total
    from tft_daily_item_stats
    where region = any(p_regions)
      and bucket = any(p_buckets)
      and day >= current_date - (p_days || ' days')::interval
      and (p_patch is null or patch = p_patch)
      and (p_set is null or set_number = p_set)
  )
  select
    f.api_name,
    sum(f.games)::bigint,
    sum(f.sum_placement)::bigint,
    sum(f.top4)::bigint,
    (select total from totals),
    jsonb_agg(f.top_users)
  from tft_daily_item_stats f
  where f.region = any(p_regions)
    and f.bucket = any(p_buckets)
    and f.day >= current_date - (p_days || ' days')::interval
    and (p_patch is null or f.patch = p_patch)
    and (p_set is null or f.set_number = p_set)
  group by f.api_name
$$;

-- ── Augments ───────────────────────────────────────────────────────────────
create or replace function get_tft_augment_stats(
  p_regions text[],
  p_buckets text[],
  p_days int default 3,
  p_patch text default null,
  p_set int default null,
  p_slot int default null     -- null = merge across all slots
)
returns table (
  api_name text,
  slot int,
  games bigint,
  sum_placement bigint,
  top4 bigint,
  participants bigint
)
language sql
stable
as $$
  with parts as (
    select coalesce(sum(games), 0)::bigint as total
    from tft_daily_comp_stats
    where region = any(p_regions)
      and bucket = any(p_buckets)
      and day >= current_date - (p_days || ' days')::interval
      and (p_patch is null or patch = p_patch)
      and (p_set is null or set_number = p_set)
  )
  select
    f.api_name,
    case when p_slot is null then null else p_slot end as slot,
    sum(f.games)::bigint,
    sum(f.sum_placement)::bigint,
    sum(f.top4)::bigint,
    (select total from parts) * (case when p_slot is null then 3 else 1 end)
  from tft_daily_augment_stats f
  where f.region = any(p_regions)
    and f.bucket = any(p_buckets)
    and f.day >= current_date - (p_days || ' days')::interval
    and (p_patch is null or f.patch = p_patch)
    and (p_set is null or f.set_number = p_set)
    and (p_slot is null or f.slot = p_slot)
  group by f.api_name
$$;

-- ── Traits ─────────────────────────────────────────────────────────────────
create or replace function get_tft_trait_stats(
  p_regions text[],
  p_buckets text[],
  p_days int default 3,
  p_patch text default null,
  p_set int default null
)
returns table (
  name text,
  activation int,
  games bigint,
  sum_placement bigint,
  top4 bigint,
  participants bigint
)
language sql
stable
as $$
  with parts as (
    select coalesce(sum(games), 0)::bigint as total
    from tft_daily_comp_stats
    where region = any(p_regions)
      and bucket = any(p_buckets)
      and day >= current_date - (p_days || ' days')::interval
      and (p_patch is null or patch = p_patch)
      and (p_set is null or set_number = p_set)
  )
  select
    f.name,
    f.activation,
    sum(f.games)::bigint,
    sum(f.sum_placement)::bigint,
    sum(f.top4)::bigint,
    (select total from parts)
  from tft_daily_trait_stats f
  where f.region = any(p_regions)
    and f.bucket = any(p_buckets)
    and f.day >= current_date - (p_days || ' days')::interval
    and (p_patch is null or f.patch = p_patch)
    and (p_set is null or f.set_number = p_set)
  group by f.name, f.activation
$$;

-- ── Comps ──────────────────────────────────────────────────────────────────
create or replace function get_tft_comp_stats(
  p_regions text[],
  p_buckets text[],
  p_days int default 3,
  p_patch text default null,
  p_set int default null,
  p_min_games int default 30
)
returns table (
  cluster_key text,
  games bigint,
  sum_placement bigint,
  top4 bigint,
  top1 bigint,
  participants bigint,
  typical_units_merged jsonb,
  typical_augments_merged jsonb,
  carry_items_merged jsonb
)
language sql
stable
as $$
  with parts as (
    select coalesce(sum(games), 0)::bigint as total
    from tft_daily_comp_stats
    where region = any(p_regions)
      and bucket = any(p_buckets)
      and day >= current_date - (p_days || ' days')::interval
      and (p_patch is null or patch = p_patch)
      and (p_set is null or set_number = p_set)
  ),
  agg as (
    select
      f.cluster_key,
      sum(f.games)::bigint as games,
      sum(f.sum_placement)::bigint as sum_placement,
      sum(f.top4)::bigint as top4,
      sum(f.top1)::bigint as top1,
      jsonb_agg(f.typical_units)    as typical_units_merged,
      jsonb_agg(f.typical_augments) as typical_augments_merged,
      jsonb_agg(f.carry_items)      as carry_items_merged
    from tft_daily_comp_stats f
    where f.region = any(p_regions)
      and f.bucket = any(p_buckets)
      and f.day >= current_date - (p_days || ' days')::interval
      and (p_patch is null or f.patch = p_patch)
      and (p_set is null or f.set_number = p_set)
    group by f.cluster_key
  )
  select
    a.cluster_key,
    a.games,
    a.sum_placement,
    a.top4,
    a.top1,
    (select total from parts),
    a.typical_units_merged,
    a.typical_augments_merged,
    a.carry_items_merged
  from agg a
  where a.games >= p_min_games
$$;

-- ── Comp pairs (counter edges) ─────────────────────────────────────────────
create or replace function get_tft_comp_pairs(
  p_regions text[],
  p_days int default 3,
  p_patch text default null,
  p_set int default null,
  p_min_games int default 10
)
returns table (
  a_key text,
  b_key text,
  games bigint,
  a_better bigint
)
language sql
stable
as $$
  select
    f.a_key,
    f.b_key,
    sum(f.games)::bigint,
    sum(f.a_better)::bigint
  from tft_daily_comp_pairs f
  where f.region = any(p_regions)
    and f.day >= current_date - (p_days || ' days')::interval
    and (p_patch is null or f.patch = p_patch)
    and (p_set is null or f.set_number = p_set)
  group by f.a_key, f.b_key
  having sum(f.games) >= p_min_games
$$;

-- ── Patches in scope ───────────────────────────────────────────────────────
-- Returns each (patch, set) combination that has data in the last N days,
-- ordered newest patch first. Frontend uses this to populate the patch
-- dropdown — current = first row, previous = second.
create or replace function get_tft_available_patches(p_days int default 30)
returns table (
  patch text,
  set_number int,
  first_day date,
  last_day date,
  total_matches bigint
)
language sql
stable
as $$
  select
    patch,
    set_number,
    min(day) as first_day,
    max(day) as last_day,
    sum(matches_analyzed)::bigint as total_matches
  from tft_daily_crawl_meta
  where day >= current_date - (p_days || ' days')::interval
  group by patch, set_number
  order by max(day) desc, patch desc
$$;
