-- 0094: Comp-Duelle als Tagessumme ueber alle Regionen (2026-10-11).
--
-- tft_daily_comp_matchups (0092) haelt je Region, Rang, Patch und Tag eine
-- Zeile je Familien-Paar. Fast jede Anfrage der App summiert ueber alle 15
-- Regionen und alle Patches — und liest dafuer jede Regionen-Zeile einzeln.
-- Gemessen 11.10.2026 mit einem einzigen Datentag: get_tft_comp_matchups Ø
-- 1.609 ms, max 15.070 ms; Companion-Muster 51 x 51 ueber 3 Tage ~32.700
-- Puffer (~255 MB = ganzer shared_buffers). Ohne Region schrumpft ein Tag von
-- 1.120.566 auf 502.504 Zeilen.
--
-- Diese Tabelle haelt dieselben Zahlen ohne Region und ohne Patch. Ohne
-- patch-Spalte faellt sie aus dem Patch-Umbenenner (tft-patch-relabel.mjs
-- CATALOG_SQL verlangt set_number + patch + day) und kann dort keine Summen
-- verlieren. Gelesen wird sie nur ohne Patch-Filter — das ist jede Anfrage
-- der App; ein ausdruecklicher Patch geht weiter an die Regionen-Tabelle.
--
-- Schluessel (comp_fam, bucket, day, opp_fam, set_number): „Familie gegen
-- alle" (Detail, Duell) liest nur die Raenge und Tage des Filters (perf-critic
-- 11.10.: ~160 statt 1.269 Puffer fuer die Top-Familie, 3 Tage, diamond_plus).
--
-- Gebildet wird sie vom Tagessammler nach dem Lauf
-- (crawl-allranks-all-regions.mjs) ueber refresh_tft_comp_matchups_all, je Tag
-- in einem eigenen Aufruf. Ein Tag gilt als gebaut, wenn sein Marker in
-- tft_comp_matchups_all_days dieselbe Zeilenzahl und dieselben Regionen
-- nennt wie die Regionen-Tabelle; sonst baut der naechste Lauf ihn neu. So
-- heilen abgebrochene Laeufe, Nachtraege einzelner Regionen und andere
-- Schreiber von selbst, solange der Tag in der Aufbewahrung liegt.
--
-- get_tft_comp_matchups_all liest gebaute Tage aus dieser Tabelle und alle
-- anderen Tage des Fensters (z. B. den laufenden Tag) aus der
-- Regionen-Tabelle — gleiche Antwort wie get_tft_comp_matchups mit
-- p_patch = null.
--
-- Rueckbau:
--   drop function get_tft_comp_matchups_all(text[], text[], text[], text[], int, int, int);
--   drop function refresh_tft_comp_matchups_all(date, text[], date);
--   drop table tft_comp_matchups_all_days;
--   drop table tft_daily_comp_matchups_all;

begin;

set local lock_timeout = '2s';

create table if not exists public.tft_daily_comp_matchups_all (
  bucket      text not null,
  set_number  int  not null,
  day         date not null,
  comp_fam    text not null,
  opp_fam     text not null,
  games       int  not null default 0,
  better      int  not null default 0,
  constraint tft_daily_comp_matchups_all_pkey
    primary key (comp_fam, bucket, day, opp_fam, set_number) include (games, better)
);

-- Neu bauen und Aufbewahrung loeschen je Tag.
create index if not exists idx_tft_daily_comp_matchups_all_day
  on public.tft_daily_comp_matchups_all (day);

create table if not exists public.tft_comp_matchups_all_days (
  day         date primary key,
  src_rows    bigint not null,
  regions     text[] not null,
  rows_built  bigint not null,
  built_at    timestamptz not null default now()
);

alter table public.tft_daily_comp_matchups_all enable row level security;
alter table public.tft_comp_matchups_all_days enable row level security;
revoke all on public.tft_daily_comp_matchups_all from anon, authenticated;
revoke all on public.tft_comp_matchups_all_days from anon, authenticated;

-- Wie 0047/0092: der taegliche Massen-Schreibvorgang laesst die
-- Sichtbarkeits-Karte kalt.
alter table public.tft_daily_comp_matchups_all set (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_vacuum_cost_limit = 2000
);

-- Einen Tag pruefen und bei Bedarf neu bilden; Tage vor p_keep_from loeschen.
-- p_regions = die aktiven Regionen des Sammlers (Testregionen wie
-- zz_writetest fliessen so nie ein). Rueckgabe: was getan wurde.
create or replace function public.refresh_tft_comp_matchups_all(
  p_day        date,
  p_regions    text[],
  p_keep_from  date
)
returns jsonb
language plpgsql
set search_path = public
set work_mem = '128MB'
as $$
declare
  regs     text[];
  n        bigint;
  marker   tft_comp_matchups_all_days%rowtype;
  built    bigint;
  dropped  bigint;
begin
  select array_agg(r order by r) into regs from (select distinct unnest(p_regions) as r) x;
  if regs is null then
    raise exception 'p_regions is empty';
  end if;

  delete from tft_daily_comp_matchups_all where day < p_keep_from;
  get diagnostics dropped = row_count;
  delete from tft_comp_matchups_all_days where day < p_keep_from;

  if p_day < p_keep_from then
    return jsonb_build_object('day', p_day, 'action', 'outside', 'dropped', dropped);
  end if;

  select count(*) into n from tft_daily_comp_matchups where day = p_day and region = any(regs);
  select * into marker from tft_comp_matchups_all_days where day = p_day;

  if n = 0 then
    delete from tft_daily_comp_matchups_all where day = p_day;
    delete from tft_comp_matchups_all_days where day = p_day;
    return jsonb_build_object('day', p_day, 'action', 'empty', 'dropped', dropped);
  end if;

  if marker.day is not null and marker.src_rows = n and marker.regions = regs then
    return jsonb_build_object('day', p_day, 'action', 'fresh', 'src', n, 'dropped', dropped);
  end if;

  delete from tft_daily_comp_matchups_all where day = p_day;
  insert into tft_daily_comp_matchups_all (bucket, set_number, day, comp_fam, opp_fam, games, better)
    select bucket, set_number, day, comp_fam, opp_fam, sum(games)::int, sum(better)::int
    from tft_daily_comp_matchups
    where day = p_day and region = any(regs)
    group by bucket, set_number, day, comp_fam, opp_fam;
  get diagnostics built = row_count;

  insert into tft_comp_matchups_all_days (day, src_rows, regions, rows_built, built_at)
  values (p_day, n, regs, built, now())
  on conflict (day) do update
    set src_rows = excluded.src_rows, regions = excluded.regions,
        rows_built = excluded.rows_built, built_at = excluded.built_at;

  return jsonb_build_object('day', p_day, 'action', 'built', 'src', n, 'rows', built, 'dropped', dropped);
end;
$$;

-- Wie get_tft_comp_matchups (0092) mit p_patch = null. Tage, deren Marker
-- genau p_regions nennt, kommen aus der Tagessumme, alle anderen Fenstertage
-- aus der Regionen-Tabelle.
create or replace function public.get_tft_comp_matchups_all(
  p_fams       text[],
  p_opp_fams   text[],
  p_regions    text[],
  p_buckets    text[],
  p_days       int  default 3,
  p_set        int  default null,
  p_min_games  int  default 1
)
returns jsonb
language sql
stable
set search_path = public
as $$
  with regs as (
    select array_agg(r order by r) as a from (select distinct unnest(p_regions) as r) x
  ),
  built as (
    select d.day
    from tft_comp_matchups_all_days d, regs
    where d.day >= current_date - (p_days || ' days')::interval
      and d.regions = regs.a
  ),
  base as (
    select m.comp_fam, m.opp_fam, m.day, m.games, m.better
    from tft_daily_comp_matchups_all m
    where m.comp_fam = any(p_fams)
      and m.bucket = any(p_buckets)
      and m.day >= current_date - (p_days || ' days')::interval
      and m.day = any(array(select day from built))
      and (p_opp_fams is null or m.opp_fam = any(p_opp_fams))
      and (p_set is null or m.set_number = p_set)
    union all
    select m.comp_fam, m.opp_fam, m.day, m.games, m.better
    from tft_daily_comp_matchups m
    where m.comp_fam = any(p_fams)
      and m.day >= current_date - (p_days || ' days')::interval
      and m.day <> all(array(select day from built))
      and m.region = any(p_regions)
      and m.bucket = any(p_buckets)
      and (p_opp_fams is null or m.opp_fam = any(p_opp_fams))
      and (p_set is null or m.set_number = p_set)
  ),
  agg as (
    select comp_fam, opp_fam, sum(games)::bigint as g, sum(better)::bigint as b
    from base
    group by comp_fam, opp_fam
    having sum(games) >= p_min_games
  )
  select jsonb_build_object(
    'days', (select count(distinct day) from base),
    'rows', (select coalesce(jsonb_agg(jsonb_build_array(comp_fam, opp_fam, g, b)), '[]'::jsonb) from agg)
  );
$$;

revoke all on function public.refresh_tft_comp_matchups_all(date, text[], date) from public, anon, authenticated;
grant execute on function public.refresh_tft_comp_matchups_all(date, text[], date) to service_role;
revoke all on function public.get_tft_comp_matchups_all(text[], text[], text[], text[], int, int, int) from public, anon, authenticated;
grant execute on function public.get_tft_comp_matchups_all(text[], text[], text[], text[], int, int, int) to service_role;

commit;

notify pgrst, 'reload schema';
