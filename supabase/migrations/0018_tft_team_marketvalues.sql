-- Team-Marktwert (Sprint 3.4 — 2026-05-22)
-- Aggregates the latest marketvalue snapshot per pro puuid grouped by team.

create or replace function get_tft_team_marketvalues(
  p_region text default null,
  p_limit  int  default 50
) returns table (
  team text,
  roster_size int,
  total_value bigint,
  avg_value numeric,
  top_player_name text,
  top_player_value integer,
  roster jsonb
) language sql stable as $$
  with latest_per_pro as (
    select distinct on (s.puuid)
      s.puuid, s.region, s.final_value, s.game_name, s.tag_line,
      s.tier, s.lp, s.snapshot_date
    from tft_player_marketvalue_snapshots s
    where (p_region is null or s.region = p_region)
    order by s.puuid, s.snapshot_date desc
  ),
  pro_join as (
    select
      coalesce(nullif(trim(p.team), ''), 'No Team') as team,
      l.puuid, l.final_value, p.pro_name,
      coalesce(l.game_name, p.pro_name) as display_name,
      p.role, p.region as pro_region
    from tft_pro_players p
    join latest_per_pro l on l.puuid = p.puuid
  ),
  ranked as (
    select
      team,
      pro_name, display_name, puuid, final_value, role, pro_region,
      row_number() over (partition by team order by final_value desc) as rn
    from pro_join
  )
  select
    team,
    count(*)::int as roster_size,
    sum(final_value)::bigint as total_value,
    avg(final_value)::numeric(12,2) as avg_value,
    (select display_name from ranked r2 where r2.team = ranked.team and r2.rn = 1) as top_player_name,
    (select final_value from ranked r2 where r2.team = ranked.team and r2.rn = 1) as top_player_value,
    jsonb_agg(
      jsonb_build_object(
        'puuid', puuid,
        'proName', pro_name,
        'displayName', display_name,
        'finalValue', final_value,
        'role', role,
        'region', pro_region
      ) order by final_value desc
    ) as roster
  from ranked
  where team <> 'No Team'
  group by team
  order by total_value desc
  limit p_limit
$$;
