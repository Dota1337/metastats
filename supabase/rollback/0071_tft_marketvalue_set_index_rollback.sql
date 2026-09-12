-- Rollback 0071: Funktionsruempfe zurueck auf 0063, schmalen Index weg.
-- idx_tft_mv_region_puuid_date (0048) bleibt unberuehrt.

set statement_timeout = 0;

create or replace function get_tft_latest_marketvalues(
  p_region text,
  p_limit integer default 100,
  p_set integer default null
)
returns table (
  puuid text, game_name text, tag_line text, tier text, rank text, lp integer,
  ladder_rank integer, base_value integer, multiplier numeric, final_value integer,
  sample_size integer, damping numeric, agents jsonb, snapshot_date date
)
language sql stable as $$
  with latest as (
    select distinct on (puuid)
      puuid, game_name, tag_line, tier, rank, lp, ladder_rank,
      base_value, multiplier, final_value, sample_size, damping, agents,
      snapshot_date
    from tft_player_marketvalue_snapshots
    where region = p_region
      and (p_set is null or set_number = p_set)
    order by puuid, snapshot_date desc
  )
  select * from latest
  order by final_value desc
  limit p_limit
$$;

create or replace function get_tft_marketvalue_movers(
  p_region text,
  p_window integer default 7,
  p_direction text default 'up',
  p_limit integer default 20,
  p_set integer default null
)
returns table (
  puuid text, game_name text, tag_line text, tier text, rank text, lp integer,
  current_value integer, previous_value integer, delta integer, delta_pct numeric
)
language sql stable as $$
  with newest as (
    select distinct on (puuid)
      puuid, game_name, tag_line, tier, rank, lp,
      final_value as current_value,
      snapshot_date as current_date_
    from tft_player_marketvalue_snapshots
    where region = p_region
      and (p_set is null or set_number = p_set)
    order by puuid, snapshot_date desc
  ),
  baseline as (
    select distinct on (s.puuid)
      s.puuid,
      s.final_value as previous_value,
      s.snapshot_date as previous_date_
    from tft_player_marketvalue_snapshots s
    join newest n on n.puuid = s.puuid
    where s.region = p_region
      and (p_set is null or s.set_number = p_set)
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

create or replace function get_tft_marketvalue_sparklines(
  p_region text,
  p_limit integer default 100,
  p_days integer default 14,
  p_set integer default null
)
returns table (puuid text, snapshot_date date, final_value integer)
language sql stable as $$
  with latest as (
    select distinct on (puuid) puuid, final_value
    from tft_player_marketvalue_snapshots
    where region = p_region
      and (p_set is null or set_number = p_set)
    order by puuid, snapshot_date desc
  ),
  top_players as (
    select puuid from latest order by final_value desc limit p_limit
  )
  select s.puuid, s.snapshot_date, s.final_value
  from tft_player_marketvalue_snapshots s
  join top_players tp on tp.puuid = s.puuid
  where s.region = p_region
    and (p_set is null or s.set_number = p_set)
    and s.snapshot_date >= current_date - (p_days || ' days')::interval
  order by s.puuid, s.snapshot_date
$$;

revoke all on function get_tft_latest_marketvalues(text, integer, integer) from public, anon, authenticated;
revoke all on function get_tft_marketvalue_movers(text, integer, text, integer, integer) from public, anon, authenticated;
revoke all on function get_tft_marketvalue_sparklines(text, integer, integer, integer) from public, anon, authenticated;
grant execute on function get_tft_latest_marketvalues(text, integer, integer) to service_role;
grant execute on function get_tft_marketvalue_movers(text, integer, text, integer, integer) to service_role;
grant execute on function get_tft_marketvalue_sparklines(text, integer, integer, integer) to service_role;

drop index concurrently if exists idx_tft_mv_region_set_puuid_date;

notify pgrst, 'reload schema';
