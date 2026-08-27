-- Set-Achse fuer die Marktwert-Snapshots.
--
-- Befund vom 27.08.2026: die Spielerseite zeigte einen Multiplikator aus 510
-- Spielen, obwohl Set 18 einen Tag alt war. Ursache: die Snapshot-Tabelle hat
-- keine Set-Spalte, und jede Lese-RPC nimmt per `distinct on (puuid) ... order
-- by snapshot_date desc` schlicht die neueste Zeile — egal aus welchem Set.
-- Nach einem Set-Wechsel ist das monatelang die Zeile aus dem alten Set.
--
-- Der Primaerschluessel bleibt bewusst (puuid, region, snapshot_date):
-- scripts/refresh-api-server.mjs:214 schreibt mit
-- `on_conflict=puuid,region,snapshot_date` gegen genau diesen Index. Eine
-- Erweiterung des Schluessels wuerde diesen Upsert mit 42P10 brechen, und der
-- einzige Fall, den sie abdecken wuerde (zwei Sets am selben Tag fuer denselben
-- Spieler), tritt nur am Wechseltag auf — dort gewinnt die neuere Zeile, was
-- richtig ist.
--
-- set_number bleibt NULLable: der Hetzner-Writer wird erst nach dieser
-- Migration ausgerollt. Die Leser filtern auf `set_number = p_set`, NULL faellt
-- also raus — das ist die sichere Richtung.

alter table tft_player_marketvalue_snapshots
  add column if not exists set_number smallint;

comment on column tft_player_marketvalue_snapshots.set_number is
  'TFT-Set, aus dem base_value/multiplier stammen. Vor 2026-08-26 = 17.';

-- Backfill an der Set-Grenze, NICHT pauschal 17: am 26.08. hat me1 bereits
-- 11 Zeilen im neuen Set geschrieben (gemessen 27.08.).
update tft_player_marketvalue_snapshots
   set set_number = case when snapshot_date < date '2026-08-26' then 17 else 18 end
 where set_number is null;

create index if not exists tft_mv_snapshots_region_set_date_idx
  on tft_player_marketvalue_snapshots (region, set_number, snapshot_date desc);

-- ---------------------------------------------------------------------------
-- Lese-RPCs bekommen einen Set-Parameter. p_set = null heisst "wie bisher,
-- ueber alle Sets" — dabei bleibt es fuer Aufrufer, die es nicht wissen muessen
-- (Ops-Werkzeuge). Die Produkt-Routen reichen CURRENT_SET durch.
--
-- Drop statt Replace, weil ein zusaetzlicher Parameter in Postgres eine neue
-- Funktion waere und beide Signaturen nebeneinander stuenden.
-- ---------------------------------------------------------------------------

drop function if exists get_tft_latest_marketvalues(text, integer);
create function get_tft_latest_marketvalues(
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

drop function if exists get_tft_marketvalue_movers(text, integer, text, integer);
create function get_tft_marketvalue_movers(
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

drop function if exists get_tft_marketvalue_sparklines(text, integer, integer);
create function get_tft_marketvalue_sparklines(
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

-- Rechte wie vor dem Drop: nur service_role. Ohne diese Zeilen stuenden die
-- Funktionen nach dem Neuanlegen wieder auf PUBLIC EXECUTE (Default) —
-- siehe 0055_revoke_anon_read.sql.
revoke all on function get_tft_latest_marketvalues(text, integer, integer) from public;
revoke all on function get_tft_marketvalue_movers(text, integer, text, integer, integer) from public;
revoke all on function get_tft_marketvalue_sparklines(text, integer, integer, integer) from public;
grant execute on function get_tft_latest_marketvalues(text, integer, integer) to service_role;
grant execute on function get_tft_marketvalue_movers(text, integer, text, integer, integer) to service_role;
grant execute on function get_tft_marketvalue_sparklines(text, integer, integer, integer) to service_role;

notify pgrst, 'reload schema';
