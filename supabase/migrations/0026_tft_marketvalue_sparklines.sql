-- TFT marketvalue sparklines (2026-05-29)
-- Per-player short final_value series for the leaderboard's top-N players
-- (by latest value) in a region — drives the per-row sparkline on the Top tab.
-- Read-only RPC over the existing snapshots table: no table/column change and
-- the data is already present (daily snapshots), so this shows immediately.

create or replace function get_tft_marketvalue_sparklines(
  p_region text,
  p_limit int default 100,
  p_days int default 14
)
returns table (
  puuid text,
  snapshot_date date,
  final_value int
)
language sql
stable
as $$
  with latest as (
    -- each player's most recent value in the region
    select distinct on (puuid) puuid, final_value
    from tft_player_marketvalue_snapshots
    where region = p_region
    order by puuid, snapshot_date desc
  ),
  top_players as (
    select puuid from latest order by final_value desc limit p_limit
  )
  select s.puuid, s.snapshot_date, s.final_value
  from tft_player_marketvalue_snapshots s
  join top_players tp on tp.puuid = s.puuid
  where s.region = p_region
    and s.snapshot_date >= current_date - (p_days || ' days')::interval
  order by s.puuid, s.snapshot_date
$$;
