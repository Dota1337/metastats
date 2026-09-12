-- Marktwert-Lesepfade wieder unter das 20-s-Limit der service_role (0020:25).
--
-- Befund vom 13.09.2026: /api/tft/marktwert/{leaderboard,movers,sparklines}
-- fuer euw1 -> 500 "canceling statement due to statement timeout" nach 20,7 s,
-- kr 14,1 s. Ursache ist die Oder-Bedingung aus 0063
-- `(p_set is null or set_number = p_set)`: PostgREST ruft die Funktionen mit
-- einem generischen Plan, in dem p_set ein Parameter ist. Die Bedingung ist
-- dann kein Index-Schluessel mehr, sondern ein Filter nach dem Lesen.
-- Gemessen mit plan_cache_mode = force_generic_plan: Index Scan ueber alle
-- euw1-Zeilen, 285.191 per Filter verworfen, 24-44 s.
--
-- Drei Hebel:
-- 1. Zwei Zweige (p_set null / gesetzt), damit `set_number = p_set` ein echter
--    Gleichheits-Schluessel wird.
-- 2. Schmaler Index (region, set_number, puuid, snapshot_date desc) include
--    (final_value): das Entdoppeln je Spieler laeuft als Index-Only-Scan statt
--    ueber 986-Byte-Zeilen mit agents-jsonb.
-- 3. Die breiten Spalten werden erst fuer die Top-N ueber den Primaerschluessel
--    (puuid, region, snapshot_date) nachgeladen.
--
-- idx_tft_mv_region_puuid_date (0048) bleibt: den nutzen der p_set-null-Zweig
-- und get_tft_team_marketvalues (0018).
--
-- CONCURRENTLY wie 0048: kein Schreib-Lock, ausserhalb des VACUUM-Fensters
-- ausfuehren. db-exec.mjs committet je Statement, das braucht CONCURRENTLY.
-- Signaturen und Rueckgabetypen bleiben gleich -> create or replace, keine
-- Routen-Aenderung.

set statement_timeout = 0;

drop index if exists idx_tft_mv_region_set_puuid_date;

create index concurrently idx_tft_mv_region_set_puuid_date
  on tft_player_marketvalue_snapshots (region, set_number, puuid, snapshot_date desc)
  include (final_value);

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

-- Rechte-Form wie 0055/0070. 0063 hatte nur PUBLIC entzogen; anon und
-- authenticated standen dadurch weiter auf EXECUTE (gemessen 13.09.).
revoke all on function get_tft_latest_marketvalues(text, integer, integer) from public, anon, authenticated;
revoke all on function get_tft_marketvalue_movers(text, integer, text, integer, integer) from public, anon, authenticated;
revoke all on function get_tft_marketvalue_sparklines(text, integer, integer, integer) from public, anon, authenticated;
grant execute on function get_tft_latest_marketvalues(text, integer, integer) to service_role;
grant execute on function get_tft_marketvalue_movers(text, integer, text, integer, integer) to service_role;
grant execute on function get_tft_marketvalue_sparklines(text, integer, integer, integer) to service_role;

notify pgrst, 'reload schema';
