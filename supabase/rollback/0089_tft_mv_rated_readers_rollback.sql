-- Rollback fuer 0089_tft_mv_rated_readers.sql
--   node scripts/db-exec.mjs supabase/rollback/0089_tft_mv_rated_readers_rollback.sql
--
-- Stellt die Funktionsrumpfe von vor 0089 wieder her (0071 fuer latest, movers,
-- sparklines, 0007 fuer history, 0018 fuer team). Danach zeigen die Leser
-- Platzhalter-Zeilen (rated = false, final_value 0) wieder an. Deshalb zuerst
-- den Code zurueckrollen, der Platzhalter schreibt, und die Platzhalter loeschen
--   delete from tft_player_marketvalue_snapshots where not rated
-- (auf Box UND Supabase), erst dann diese Datei.
--
-- Der Index idx_tft_mv_region_set_puuid_date_rated darf bleiben, er deckt die
-- alten Abfragen genauso ab wie der ersetzte idx_tft_mv_region_set_puuid_date.

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
language plpgsql stable as $$
#variable_conflict use_column
begin
  if p_set is null then
    return query
    with latest as (
      select distinct on (s.puuid)
        s.puuid, s.game_name, s.tag_line, s.tier, s.rank, s.lp, s.ladder_rank,
        s.base_value, s.multiplier, s.final_value, s.sample_size, s.damping, s.agents,
        s.snapshot_date
      from tft_player_marketvalue_snapshots s
      where s.region = p_region
      order by s.puuid, s.snapshot_date desc
    )
    select l.* from latest l
    order by l.final_value desc
    limit p_limit;
  else
    return query
    with latest as (
      select distinct on (s.puuid) s.puuid, s.snapshot_date, s.final_value
      from tft_player_marketvalue_snapshots s
      where s.region = p_region
        and s.set_number = p_set
      order by s.puuid, s.snapshot_date desc
    ),
    top_n as (
      select l.puuid, l.snapshot_date, l.final_value from latest l
      order by l.final_value desc
      limit p_limit
    )
    select
      s.puuid, s.game_name, s.tag_line, s.tier, s.rank, s.lp, s.ladder_rank,
      s.base_value, s.multiplier, s.final_value, s.sample_size, s.damping, s.agents,
      s.snapshot_date
    from top_n t
    join tft_player_marketvalue_snapshots s
      on s.puuid = t.puuid and s.region = p_region and s.snapshot_date = t.snapshot_date
    order by t.final_value desc;
  end if;
end
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
language plpgsql stable as $$
#variable_conflict use_column
begin
  if p_set is null then
    return query
    with newest as (
      select distinct on (s.puuid)
        s.puuid, s.game_name, s.tag_line, s.tier, s.rank, s.lp,
        s.final_value as current_value,
        s.snapshot_date as current_date_
      from tft_player_marketvalue_snapshots s
      where s.region = p_region
      order by s.puuid, s.snapshot_date desc
    ),
    baseline as (
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
    limit p_limit;
  else
    return query
    with newest as (
      select distinct on (s.puuid)
        s.puuid, s.final_value as current_value, s.snapshot_date as current_date_
      from tft_player_marketvalue_snapshots s
      where s.region = p_region
        and s.set_number = p_set
      order by s.puuid, s.snapshot_date desc
    ),
    paired as (
      select n.puuid, n.current_value, n.current_date_, b.previous_value
      from newest n
      cross join lateral (
        select s.final_value as previous_value
        from tft_player_marketvalue_snapshots s
        where s.region = p_region
          and s.set_number = p_set
          and s.puuid = n.puuid
          and s.snapshot_date <= n.current_date_ - (p_window || ' days')::interval
        order by s.snapshot_date desc
        limit 1
      ) b
    ),
    ranked as (
      select p.puuid, p.current_value, p.current_date_, p.previous_value,
        case when p_direction = 'up' then (p.current_value - p.previous_value)
             else (p.previous_value - p.current_value) end as sort_key
      from paired p
      where (p_direction = 'up'   and p.current_value > p.previous_value)
         or (p_direction = 'down' and p.current_value < p.previous_value)
      order by sort_key desc
      limit p_limit
    )
    select
      s.puuid, s.game_name, s.tag_line, s.tier, s.rank, s.lp,
      r.current_value, r.previous_value,
      (r.current_value - r.previous_value) as delta,
      case when r.previous_value > 0
           then round(((r.current_value - r.previous_value)::numeric / r.previous_value) * 100, 2)
           else 0 end as delta_pct
    from ranked r
    join tft_player_marketvalue_snapshots s
      on s.puuid = r.puuid and s.region = p_region and s.snapshot_date = r.current_date_
    order by r.sort_key desc;
  end if;
end
$$;

create or replace function get_tft_marketvalue_sparklines(
  p_region text,
  p_limit integer default 100,
  p_days integer default 14,
  p_set integer default null
)
returns table (puuid text, snapshot_date date, final_value integer)
language plpgsql stable as $$
#variable_conflict use_column
begin
  if p_set is null then
    return query
    with latest as (
      select distinct on (s.puuid) s.puuid, s.final_value
      from tft_player_marketvalue_snapshots s
      where s.region = p_region
      order by s.puuid, s.snapshot_date desc
    ),
    top_players as (
      select l.puuid from latest l order by l.final_value desc limit p_limit
    )
    select s.puuid, s.snapshot_date, s.final_value
    from tft_player_marketvalue_snapshots s
    join top_players tp on tp.puuid = s.puuid
    where s.region = p_region
      and s.snapshot_date >= current_date - (p_days || ' days')::interval
    order by s.puuid, s.snapshot_date;
  else
    return query
    with latest as (
      select distinct on (s.puuid) s.puuid, s.final_value
      from tft_player_marketvalue_snapshots s
      where s.region = p_region
        and s.set_number = p_set
      order by s.puuid, s.snapshot_date desc
    ),
    top_players as (
      select l.puuid from latest l order by l.final_value desc limit p_limit
    )
    select s.puuid, s.snapshot_date, s.final_value
    from tft_player_marketvalue_snapshots s
    join top_players tp on tp.puuid = s.puuid
    where s.region = p_region
      and s.set_number = p_set
      and s.snapshot_date >= current_date - (p_days || ' days')::interval
    order by s.puuid, s.snapshot_date;
  end if;
end
$$;

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

notify pgrst, 'reload schema';
