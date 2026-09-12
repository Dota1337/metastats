-- Meistgespielte fertige Items je Champion und Tag (2026-09-12).
--
-- WARUM: /tft/units soll neben jedem Champion die 6 meistgespielten Items
-- zeigen, passend zu Patch/Tage/Region/Rang. tft_daily_unit_stats kennt nur
-- Summen je Champion. Eine Zeile pro Champion x Item waeren ~137k Zeilen/Tag
-- (15x unit_stats); eine jsonb-Spalte direkt in unit_stats wuerde jede
-- Unit-Zeile breiter und die bestehende Liste kalt langsamer machen. Deshalb
-- eine Nebentabelle mit derselben Zeilenzahl wie unit_stats und einer
-- Item-Liste je Zeile.
--
-- items = [{item, games, top4, sumPlacement}], hoechstens 15 Eintraege, schon
-- ohne Bauteile, Embleme und Thief's Gloves/Empty Bag (gefiltert im
-- Aggregator, scripts/lib/tft-build-aggregator.mjs, VOR der Kappung).
--
-- Rueckweg: supabase/rollback/0069_tft_daily_unit_top_items_rollback.sql

create table if not exists tft_daily_unit_top_items (
  region text not null,
  bucket text not null,
  patch text not null,
  set_number int not null,
  day date not null,
  character_id text not null,
  items jsonb not null default '[]'::jsonb,
  primary key (region, bucket, patch, set_number, day, character_id)
);
create index if not exists idx_tft_daily_unit_top_items_lookup
  on tft_daily_unit_top_items(region, bucket, day, set_number);

alter table public.tft_daily_unit_top_items enable row level security;
revoke all on public.tft_daily_unit_top_items from anon, authenticated;

-- Gleiche Filter wie get_tft_unit_stats (0002). Summiert je Champion x Item
-- ueber alle Zeilen im Filter und gibt die p_top meistgespielten zurueck.
-- Gleichstand: Item-Name in fester Byte-Reihenfolge, damit die Anzeige nicht
-- zwischen zwei Aufrufen springt.
create or replace function get_tft_unit_top_items(
  p_regions text[],
  p_buckets text[],
  p_days int default 3,
  p_patch text default null,
  p_set int default null,
  p_top int default 6
)
returns table (
  character_id text,
  item text,
  games bigint
)
language sql
stable
as $$
  with summed as (
    select t.character_id, e.item, sum(e.games)::bigint as games
    from tft_daily_unit_top_items t
    cross join lateral jsonb_to_recordset(t.items) as e(item text, games int)
    where t.region = any(p_regions)
      and t.bucket = any(p_buckets)
      and t.day >= current_date - (p_days || ' days')::interval
      and (p_patch is null or t.patch = p_patch)
      and (p_set is null or t.set_number = p_set)
      and e.item is not null
    group by t.character_id, e.item
  ), ranked as (
    select s.*, row_number() over (
      partition by s.character_id
      order by s.games desc, s.item collate "C"
    ) as rn
    from summed s
  )
  select r.character_id, r.item, r.games
  from ranked r
  where r.rn <= p_top
  order by r.character_id, r.rn
$$;

revoke execute on function public.get_tft_unit_top_items(text[], text[], int, text, int, int)
  from public, anon, authenticated;
grant execute on function public.get_tft_unit_top_items(text[], text[], int, text, int, int)
  to service_role;

-- Autovacuum wie 0047 — taeglicher Bulk-Upsert, sonst kalte Visibility-Map.
alter table public.tft_daily_unit_top_items set (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_vacuum_cost_limit = 2000);

notify pgrst, 'reload schema';
