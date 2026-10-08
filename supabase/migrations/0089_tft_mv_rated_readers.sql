-- 0089: Marktwert-Lesefunktionen ueberspringen Platzhalter "nicht bewertet"
--
-- NUR SUPABASE. Die Funktionen gibt es nur dort (Vercel liest Supabase), auf
-- der Box existiert keine davon (gemessen 08.10.: pg_proc like
-- get_tft_%market% -> 0 Zeilen). Voraussetzung: 0088 ist angewendet.
--   node scripts/db-exec.mjs supabase/migrations/0089_tft_mv_rated_readers.sql
--
-- Regel fuer jeden Leser: ERST die neueste Zeile je Spieler bestimmen, DANN auf
-- rated filtern. Wer filtert, bevor er entdoppelt, holt fuer einen abgestiegenen
-- Spieler den letzten bewerteten Tag zurueck und zeigt den alten Wert weiter.
-- Aufsteiger-Basis genauso: neueste Zeile vor dem Stichtag, dann rated.
--
-- Index-Tausch: die Entdoppelung im Set-Zweig laeuft seit 0071 als
-- Index-Only-Scan ueber (region, set_number, puuid, snapshot_date desc)
-- include (final_value). Liest sie jetzt auch rated, muesste sie jede Zeile
-- aus der Tabelle holen (986-Byte-Zeilen, 0071). Der neue Index nimmt rated mit
-- auf. Gemessen 08.10.: alter Index 314 MB, Tabelle 3987 MB, 1,58 Mio Zeilen.
-- Der alte Index wird nur entfernt, wenn der neue gueltig ist. db-exec.mjs
-- laeuft nach einem Fehler weiter, deshalb sitzt die Pruefung im DO-Block.
-- Ein abgebrochener Lauf hinterlaesst einen ungueltigen neuen Index, der erste
-- DO-Block raeumt ihn beim naechsten Lauf weg.
--
-- Signaturen und Rueckgabetypen bleiben gleich -> create or replace, die
-- Rechte aus 0055/0071 bleiben erhalten, keine Routen-Aenderung noetig.
--
-- Rollback: node scripts/db-exec.mjs supabase/rollback/0089_tft_mv_rated_readers_rollback.sql
-- (stellt die Rumpfe aus 0071, 0007 und 0018 wieder her, der neue Index darf
-- bleiben, er deckt auch die alten Abfragen ab).

set statement_timeout = 0;

set lock_timeout = '5s';

do $$
begin
  if exists (
    select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
    where c.relname = 'idx_tft_mv_region_set_puuid_date_rated' and not i.indisvalid
  ) then
    drop index idx_tft_mv_region_set_puuid_date_rated;
  end if;
end
$$;

set lock_timeout = 0;

create index concurrently if not exists idx_tft_mv_region_set_puuid_date_rated
  on tft_player_marketvalue_snapshots (region, set_number, puuid, snapshot_date desc)
  include (final_value, rated);

set lock_timeout = '5s';

do $$
begin
  if exists (
    select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
    where c.relname = 'idx_tft_mv_region_set_puuid_date_rated' and i.indisvalid
  ) then
    drop index if exists idx_tft_mv_region_set_puuid_date;
  else
    raise exception 'idx_tft_mv_region_set_puuid_date_rated fehlt oder ist ungueltig, alter Index bleibt';
  end if;
end
$$;

set lock_timeout = 0;

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
        s.snapshot_date, s.rated
      from tft_player_marketvalue_snapshots s
      where s.region = p_region
      order by s.puuid, s.snapshot_date desc
    )
    select
      l.puuid, l.game_name, l.tag_line, l.tier, l.rank, l.lp, l.ladder_rank,
      l.base_value, l.multiplier, l.final_value, l.sample_size, l.damping, l.agents,
      l.snapshot_date
    from latest l
    where l.rated
    order by l.final_value desc
    limit p_limit;
  else
    return query
    with latest as (
      select distinct on (s.puuid) s.puuid, s.snapshot_date, s.final_value, s.rated
      from tft_player_marketvalue_snapshots s
      where s.region = p_region
        and s.set_number = p_set
      order by s.puuid, s.snapshot_date desc
    ),
    top_n as (
      select l.puuid, l.snapshot_date, l.final_value from latest l
      where l.rated
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
    with newest_all as (
      select distinct on (s.puuid)
        s.puuid, s.game_name, s.tag_line, s.tier, s.rank, s.lp,
        s.final_value as current_value,
        s.snapshot_date as current_date_,
        s.rated
      from tft_player_marketvalue_snapshots s
      where s.region = p_region
      order by s.puuid, s.snapshot_date desc
    ),
    newest as (
      select na.puuid, na.game_name, na.tag_line, na.tier, na.rank, na.lp,
        na.current_value, na.current_date_
      from newest_all na
      where na.rated
    ),
    baseline as (
      select distinct on (s.puuid)
        s.puuid,
        s.final_value as previous_value,
        s.snapshot_date as previous_date_,
        s.rated
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
    join baseline b on b.puuid = n.puuid and b.rated
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
        s.puuid, s.final_value as current_value, s.snapshot_date as current_date_, s.rated
      from tft_player_marketvalue_snapshots s
      where s.region = p_region
        and s.set_number = p_set
      order by s.puuid, s.snapshot_date desc
    ),
    paired as (
      select n.puuid, n.current_value, n.current_date_, b.previous_value
      from newest n
      cross join lateral (
        select s.final_value as previous_value, s.rated as previous_rated
        from tft_player_marketvalue_snapshots s
        where s.region = p_region
          and s.set_number = p_set
          and s.puuid = n.puuid
          and s.snapshot_date <= n.current_date_ - (p_window || ' days')::interval
        order by s.snapshot_date desc
        limit 1
      ) b
      where n.rated and b.previous_rated
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
      select distinct on (s.puuid) s.puuid, s.final_value, s.rated
      from tft_player_marketvalue_snapshots s
      where s.region = p_region
      order by s.puuid, s.snapshot_date desc
    ),
    top_players as (
      select l.puuid from latest l where l.rated order by l.final_value desc limit p_limit
    )
    select s.puuid, s.snapshot_date, s.final_value
    from tft_player_marketvalue_snapshots s
    join top_players tp on tp.puuid = s.puuid
    where s.region = p_region
      and s.rated
      and s.snapshot_date >= current_date - (p_days || ' days')::interval
    order by s.puuid, s.snapshot_date;
  else
    return query
    with latest as (
      select distinct on (s.puuid) s.puuid, s.final_value, s.rated
      from tft_player_marketvalue_snapshots s
      where s.region = p_region
        and s.set_number = p_set
      order by s.puuid, s.snapshot_date desc
    ),
    top_players as (
      select l.puuid from latest l where l.rated order by l.final_value desc limit p_limit
    )
    select s.puuid, s.snapshot_date, s.final_value
    from tft_player_marketvalue_snapshots s
    join top_players tp on tp.puuid = s.puuid
    where s.region = p_region
      and s.set_number = p_set
      and s.rated
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
    and rated
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
      s.tier, s.lp, s.snapshot_date, s.rated
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
    join latest_per_pro l on l.puuid = p.puuid and l.rated
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

select c.relname as index_name, i.indisvalid as gueltig,
       pg_size_pretty(pg_relation_size(c.oid)) as groesse
from pg_index i join pg_class c on c.oid = i.indexrelid
where c.relname in ('idx_tft_mv_region_set_puuid_date_rated', 'idx_tft_mv_region_set_puuid_date');

notify pgrst, 'reload schema';
