-- TFT player marketvalue daily snapshots (2026-05-12).
-- Each row = one (puuid, region, snapshot_date) tuple, holding the full
-- breakdown computed by app/lib/tft-marketvalue. Master+ only — anyone
-- below Master responds with rated:false and is not persisted.
--
-- Read patterns:
--   * latest snapshot per region (regional top-N ladder)        -> idx region/date
--   * full history of a single player (player-page line chart)  -> idx puuid/date
--   * top-mover window (largest finalValue delta 7d/30d)        -> derived in RPC
--     by self-joining the table on (puuid, snapshot_date - window).

create table if not exists tft_player_marketvalue_snapshots (
  puuid         text  not null,
  region        text  not null,                  -- 'euw1','kr','na1',…
  snapshot_date date  not null,
  game_name     text,
  tag_line      text,
  tier          text  not null,                  -- 'CHALLENGER','GRANDMASTER','MASTER'
  rank          text,                            -- 'I' (apex tiers usually empty)
  lp            integer not null default 0,
  ladder_rank   integer,                         -- regional ladder position at snapshot time, may be null
  base_value    integer not null default 0,
  multiplier    numeric(5,3) not null default 1, -- clamped [0.45, 1.65]
  final_value   integer not null default 0,
  sample_size   integer not null default 0,      -- # of match snapshots in calc
  damping       numeric(3,2) not null default 1, -- sample-size damping factor
  agents        jsonb  not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  primary key (puuid, region, snapshot_date)
);

create index if not exists idx_tft_mv_region_date
  on tft_player_marketvalue_snapshots(region, snapshot_date desc);

create index if not exists idx_tft_mv_puuid_date
  on tft_player_marketvalue_snapshots(puuid, snapshot_date desc);

-- Top-N by region/date (final_value desc) — supports the leaderboard view.
create index if not exists idx_tft_mv_region_value
  on tft_player_marketvalue_snapshots(region, snapshot_date desc, final_value desc);

alter table tft_player_marketvalue_snapshots enable row level security;
create policy "anon read" on tft_player_marketvalue_snapshots for select using (true);

-- RPC: latest snapshot per player in a region, ordered by final_value desc.
-- Used by /tft/marktwert page (top-N ladder) and player header (single-player
-- lookup by puuid filter applied client-side after fetch).
create or replace function get_tft_latest_marketvalues(
  p_region text,
  p_limit  int default 100
) returns table (
  puuid text,
  game_name text,
  tag_line text,
  tier text,
  rank text,
  lp integer,
  ladder_rank integer,
  base_value integer,
  multiplier numeric,
  final_value integer,
  sample_size integer,
  damping numeric,
  agents jsonb,
  snapshot_date date
) language sql stable as $$
  with latest as (
    select distinct on (puuid)
      puuid, game_name, tag_line, tier, rank, lp, ladder_rank,
      base_value, multiplier, final_value, sample_size, damping, agents,
      snapshot_date
    from tft_player_marketvalue_snapshots
    where region = p_region
    order by puuid, snapshot_date desc
  )
  select * from latest
  order by final_value desc
  limit p_limit
$$;

-- RPC: marketvalue history for a single player, newest first.
create or replace function get_tft_marketvalue_history(
  p_puuid  text,
  p_region text,
  p_days   int default 90
) returns table (
  snapshot_date date,
  tier text,
  rank text,
  lp integer,
  ladder_rank integer,
  base_value integer,
  multiplier numeric,
  final_value integer,
  sample_size integer
) language sql stable as $$
  select snapshot_date, tier, rank, lp, ladder_rank,
         base_value, multiplier, final_value, sample_size
  from tft_player_marketvalue_snapshots
  where puuid = p_puuid
    and region = p_region
    and snapshot_date >= current_date - (p_days || ' days')::interval
  order by snapshot_date desc
$$;

-- RPC: top movers in a region over a given window.
-- Returns players whose final_value changed the most between (today, today - window).
-- Direction 'up' = biggest gainers; 'down' = biggest losers.
create or replace function get_tft_marketvalue_movers(
  p_region    text,
  p_window    int default 7,
  p_direction text default 'up',
  p_limit     int default 20
) returns table (
  puuid text,
  game_name text,
  tag_line text,
  tier text,
  rank text,
  lp integer,
  current_value integer,
  previous_value integer,
  delta integer,
  delta_pct numeric
) language sql stable as $$
  with newest as (
    select distinct on (puuid)
      puuid, game_name, tag_line, tier, rank, lp,
      final_value as current_value,
      snapshot_date as current_date_
    from tft_player_marketvalue_snapshots
    where region = p_region
    order by puuid, snapshot_date desc
  ),
  baseline as (
    -- Closest snapshot to (newest.current_date - window) for each puuid
    select distinct on (s.puuid)
      s.puuid,
      s.final_value as previous_value,
      s.snapshot_date as previous_date_
    from tft_player_marketvalue_snapshots s
    join newest n on n.puuid = s.puuid
    where s.region = p_region
      and s.snapshot_date <= n.current_date_ - (p_window || ' days')::interval
    order by s.puuid, s.snapshot_date desc
  )
  select
    n.puuid, n.game_name, n.tag_line, n.tier, n.rank, n.lp,
    n.current_value, b.previous_value,
    (n.current_value - b.previous_value) as delta,
    case when b.previous_value > 0
         then round(((n.current_value - b.previous_value)::numeric / b.previous_value) * 100, 2)
         else 0 end as delta_pct
  from newest n
  join baseline b on b.puuid = n.puuid
  where (p_direction = 'up'   and n.current_value > b.previous_value)
     or (p_direction = 'down' and n.current_value < b.previous_value)
  order by
    case when p_direction = 'up' then (n.current_value - b.previous_value)
         else (b.previous_value - n.current_value) end desc
  limit p_limit
$$;
