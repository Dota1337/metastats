-- 0097: Werte je Item und Artefakte/Embleme fuer die Units-Liste (17.10.2026).
--
-- WARUM: /tft/units zeigt je Unit die 6 meistgespielten Items. Der User will
-- dazu den Ø-Platz je Item und rechts daneben die meistgespielten Artefakte
-- und Embleme. Die Item-Werte stehen schon in tft_daily_unit_top_items
-- (0069: items = [{item, games, top4, sumPlacement}]), die Lesefunktion gab
-- aber nur games zurueck. Embleme fehlen dort ganz (vor dem Speichern
-- gefiltert), Artefakte nur bruchstueckhaft (Kappe 15 je Unit und Tag).
--
-- Neu:
--   tft_daily_unit_extras    Nebentabelle wie 0069/0096, eine Zeile je Region x
--                            Rang x Tag x Unit. items = [[item, games, top4,
--                            sumPlacement], …], nur Artefakte und Embleme, je
--                            Kopie gezaehlt wie unit_top_items.
--                            source = 'collector' (Sammler, Block 8c) oder
--                            'carriers' (einmal nachgefuellt aus
--                            tft_daily_item_stats.top_users, scripts/oneoff/
--                            backfill-unit-extras.sql — Untergrenze, weil dort
--                            nur die Top-Traeger je Item und Tag stehen).
--   get_tft_unit_item_stats  wie get_tft_unit_top_items (0095), zusaetzlich
--                            top4 + sum_placement, ohne Artefakte (die stehen
--                            rechts im eigenen Block).
--   get_tft_unit_extras      Top p_top Artefakte und Embleme je Unit.
--
-- Bewusst NICHT angefasst: get_tft_unit_top_items (0095 legt es mit p_end_day
-- neu an, der 0095-Rollback setzt es zurueck — eine dritte Fassung hier wuerde
-- die Kette brechen). Faellt weg, wenn nichts mehr es ruft.
--
-- Die Muster fuer Artefakt/Emblem stehen in scripts/lib/tft-build-aggregator.mjs
-- (extraKindOf); scripts/lib/tft-unit-extras.test.mjs prueft, dass beide gleich
-- urteilen.
--
-- Ausfuehren: node scripts/db-exec.mjs supabase/migrations/0097_tft_daily_unit_extras.sql
-- NICHT zwischen 20:00 und 23:30 CEST (Vorab-Rechnung + Publisher).
-- Rueckweg:   supabase/rollback/0097_tft_daily_unit_extras_rollback.sql

begin;
set local lock_timeout = '2s';

create table if not exists public.tft_daily_unit_extras (
  region text not null,
  bucket text not null,
  patch text not null,
  set_number int not null,
  day date not null,
  character_id text not null,
  items jsonb not null default '[]'::jsonb,
  source text not null default 'collector' check (source in ('collector', 'carriers')),
  primary key (region, bucket, patch, set_number, day, character_id)
);
create index if not exists idx_tft_daily_unit_extras_lookup
  on public.tft_daily_unit_extras(region, bucket, day, set_number);

alter table public.tft_daily_unit_extras enable row level security;
revoke all on public.tft_daily_unit_extras from anon, authenticated;

-- Autovacuum wie 0069 — taeglicher Bulk-Upsert + Loeschen, sonst kalte Visibility-Map.
alter table public.tft_daily_unit_extras set (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_vacuum_cost_limit = 2000);

-- Fenster wie 0095: mit p_end_day genau p_days volle Tage, ohne das alte Fenster.
-- Gleichstand: games desc, dann Item in Byte-Reihenfolge.
create or replace function public.get_tft_unit_item_stats(
  p_regions text[],
  p_buckets text[],
  p_days integer default 3,
  p_patch text default null,
  p_set integer default null,
  p_top integer default 6,
  p_end_day date default null
)
returns table(character_id text, item text, games bigint, top4 bigint, sum_placement bigint)
language sql
stable
as $$
  with summed as (
    select t.character_id, e.item,
           sum(e.games)::bigint as games,
           sum(coalesce(e.top4, 0))::bigint as top4,
           sum(coalesce(e."sumPlacement", 0))::bigint as sum_placement
    from public.tft_daily_unit_top_items t
    cross join lateral jsonb_to_recordset(t.items) as e(item text, games int, top4 int, "sumPlacement" int)
    where t.region = any(p_regions)
      and t.bucket = any(p_buckets)
      and t.day >= coalesce(p_end_day + 1, current_date) - (p_days || ' days')::interval and t.day <= coalesce(p_end_day, current_date)
      and (p_patch is null or t.patch = p_patch)
      and (p_set is null or t.set_number = p_set)
      and e.item is not null
      and e.item !~* '_Artifact_'
    group by t.character_id, e.item
  ), ranked as (
    select s.*, row_number() over (
      partition by s.character_id
      order by s.games desc, s.item collate "C"
    ) as rn
    from summed s
  )
  select r.character_id, r.item, r.games, r.top4, r.sum_placement
  from ranked r
  where r.rn <= p_top
  order by r.character_id, r.rn
$$;
revoke all on function public.get_tft_unit_item_stats(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_top integer, p_end_day date) from public, anon, authenticated, service_role;
grant execute on function public.get_tft_unit_item_stats(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_top integer, p_end_day date) to service_role;

-- kind: 'artifact' | 'emblem'. Die Tabelle enthaelt nur solche Items; die
-- Muster hier sind die zweite Sicherung (u. a. gegen Augment-Embleme).
create or replace function public.get_tft_unit_extras(
  p_regions text[],
  p_buckets text[],
  p_days integer default 3,
  p_patch text default null,
  p_set integer default null,
  p_top integer default 3,
  p_end_day date default null
)
returns table(character_id text, kind text, item text, games bigint, top4 bigint, sum_placement bigint)
language sql
stable
as $$
  with e as (
    select x.character_id, r->>0 as item,
           (r->>1)::bigint as g, (r->>2)::bigint as t4, (r->>3)::bigint as sp
    from public.tft_daily_unit_extras x
    cross join lateral jsonb_array_elements(x.items) r
    where x.region = any(p_regions)
      and x.bucket = any(p_buckets)
      and x.day >= coalesce(p_end_day + 1, current_date) - (p_days || ' days')::interval and x.day <= coalesce(p_end_day, current_date)
      and (p_patch is null or x.patch = p_patch)
      and (p_set is null or x.set_number = p_set)
  ), classified as (
    select e.*,
           case when e.item ~* '_Artifact_' then 'artifact'
                when e.item ~* 'Emblem' and e.item !~* '(Augment|Phantom)' then 'emblem'
           end as kind
    from e
  ), summed as (
    select c.character_id, c.kind, c.item,
           sum(c.g)::bigint as games, sum(c.t4)::bigint as top4, sum(c.sp)::bigint as sum_placement
    from classified c
    where c.kind is not null and c.item is not null
    group by c.character_id, c.kind, c.item
  ), ranked as (
    select s.*, row_number() over (
      partition by s.character_id, s.kind
      order by s.games desc, s.item collate "C"
    ) as rn
    from summed s
  )
  select r.character_id, r.kind, r.item, r.games, r.top4, r.sum_placement
  from ranked r
  where r.rn <= p_top
  order by r.character_id, r.kind, r.rn
$$;
revoke all on function public.get_tft_unit_extras(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_top integer, p_end_day date) from public, anon, authenticated, service_role;
grant execute on function public.get_tft_unit_extras(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_top integer, p_end_day date) to service_role;

-- Selbstpruefung: je Funktion genau eine Signatur, Rechte nur service_role, RLS an.
do $$
declare
  want text[] := array['get_tft_unit_item_stats(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_top integer, p_end_day date)',
                       'get_tft_unit_extras(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_top integer, p_end_day date)'];
  w text;
  n int;
  fid oid;
begin
  foreach w in array want loop
    select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.proname = split_part(w, '(', 1);
    if n <> 1 then raise exception '0097: % hat % Signaturen', split_part(w, '(', 1), n; end if;
    select p.oid into fid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = w;
    if fid is null then raise exception '0097: Signatur fehlt: %', w; end if;
    if has_function_privilege('anon', fid, 'execute')
       or has_function_privilege('authenticated', fid, 'execute')
       or not has_function_privilege('service_role', fid, 'execute') then
      raise exception '0097: Rechte falsch fuer %', w;
    end if;
  end loop;
  if not (select relrowsecurity from pg_class where oid = 'public.tft_daily_unit_extras'::regclass) then
    raise exception '0097: RLS aus';
  end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
