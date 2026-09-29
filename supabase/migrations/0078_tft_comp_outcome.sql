-- 0078: Comp-Ergebnisse je Unit und Item (2026-09-29).
--
-- Eigene Tabelle neben tft_daily_comp_stats, gleicher Schluessel. Speist die
-- neuen Bloecke der Comp-Detailseite: Platzverteilung 1-8, Endlevel-Ergebnis,
-- Unit-Wirkung je Spielerlevel, Item-Wirkung je Unit und 3er-Kombis.
-- Geschrieben vom Tagessammler (scripts/lib/tft-supabase-writer.mjs, Block 9),
-- gelesen ueber get_tft_comp_outcome aus /api/tft/comps.
--
-- Warum nicht als Spalten in tft_daily_comp_stats: ~9 KB jsonb je Zeile in einer
-- Tabelle mit 6 Indizes, die auch die Comp-Liste bedient. Hier trifft ein
-- Schreibfehler nur die neuen Bloecke.
--
-- Kein Nachrechnen alter Tage: die Rohpartien werden nicht gespeichert. Die
-- Bloecke laufen ab dem ersten Sammeltag an; die Route zeigt sie erst, wenn fuer
-- JEDE Zeile aus tft_daily_comp_stats im Fenster eine Zeile hier existiert
-- (rows_outcome = rows_stats).
--
-- Tupel-Formate (Reihenfolge fest, Aggregator finalize() -> outcome):
--   placement_hist  int[8]                     Spiele auf Platz 1..8
--   level_stats     {"<lvl>": [n,s,q,t4,t1]}   alle Boards, nach Endlevel
--   level_stats_s5  {"<lvl>": [n,s,q,t4,t1]}   nur Boards, die Stage 5 erreicht haben
--   units           {"<cid>": [n,s,q,t4,t1,n3,s3,q3,t43]}
--                    n..t1  = Boards mit der Unit
--                    n3..t43 = Kopien mit genau 3 fertigen Items (ohne Thief's Gloves)
--   unit_levels     {"<cid>": {"<lvl>": [n,s,q]}}
--   unit_items      {"<cid>": {"<item>": [c,s,q,t4,k]}}  c = Kopien mit Item, k = Item-Anzahl
--   unit_sets       {"<cid>": {"a|b|c": [c,s,t4]}}
-- s = Summe Platzierung, q = Summe Platzierung^2 (fuer die Unsicherheit).
--
-- Rueckbau: drop function get_tft_comp_outcome; drop table tft_daily_comp_outcome.

create table if not exists public.tft_daily_comp_outcome (
  region          text not null,
  bucket          text not null,
  patch           text not null,
  set_number      int  not null,
  day             date not null,
  cluster_key     text not null,
  games           int  not null default 0,
  placement_hist  int[] not null default '{}',
  level_stats     jsonb compression lz4 not null default '{}'::jsonb,
  level_stats_s5  jsonb compression lz4 not null default '{}'::jsonb,
  units           jsonb compression lz4 not null default '{}'::jsonb,
  unit_levels     jsonb compression lz4 not null default '{}'::jsonb,
  unit_items      jsonb compression lz4 not null default '{}'::jsonb,
  unit_sets       jsonb compression lz4 not null default '{}'::jsonb,
  primary key (region, bucket, patch, set_number, day, cluster_key)
);

create index if not exists idx_tft_daily_comp_outcome_key_day
  on public.tft_daily_comp_outcome (cluster_key, day);

alter table public.tft_daily_comp_outcome enable row level security;
revoke all on public.tft_daily_comp_outcome from anon, authenticated;

create or replace function public.get_tft_comp_outcome(
  p_cluster_keys text[],
  p_regions      text[],
  p_buckets      text[],
  p_days         int  default 3,
  p_patch        text default null,
  p_set          int  default null
)
returns jsonb
language sql
stable
set search_path = public
as $$
  with base as (
    select o.*
    from tft_daily_comp_outcome o
    where o.cluster_key = any(p_cluster_keys)
      and o.region = any(p_regions)
      and o.bucket = any(p_buckets)
      and o.bucket <> 'pro_pool'
      and o.day >= current_date - (p_days || ' days')::interval
      and (p_patch is null or o.patch = p_patch)
      and (p_set is null or o.set_number = p_set)
  ),
  cov as (
    select count(*)::int as n
    from tft_daily_comp_stats s
    where s.cluster_key = any(p_cluster_keys)
      and s.region = any(p_regions)
      and s.bucket = any(p_buckets)
      and s.bucket <> 'pro_pool'
      and s.day >= current_date - (p_days || ' days')::interval
      and (p_patch is null or s.patch = p_patch)
      and (p_set is null or s.set_number = p_set)
  ),
  ph as (
    select coalesce(jsonb_agg(v order by i), '[]'::jsonb) as j
    from (
      select t.i, sum(t.v)::bigint as v
      from base, unnest(base.placement_hist) with ordinality as t(v, i)
      group by t.i
    ) x
  ),
  -- {"lvl": [..]} ueber alle Zeilen elementweise summieren
  lv_flat as (
    select 'all'::text as kind, e.key as lvl, a.i, sum(a.v::numeric) as v
    from base, jsonb_each(base.level_stats) e, jsonb_array_elements_text(e.value) with ordinality as a(v, i)
    group by e.key, a.i
    union all
    select 's5', e.key, a.i, sum(a.v::numeric)
    from base, jsonb_each(base.level_stats_s5) e, jsonb_array_elements_text(e.value) with ordinality as a(v, i)
    group by e.key, a.i
  ),
  lv_arr as (
    select kind, lvl, jsonb_agg(v order by i) as arr from lv_flat group by kind, lvl
  ),
  lv as (
    select
      coalesce(jsonb_object_agg(lvl, arr) filter (where kind = 'all'), '{}'::jsonb) as lv_all,
      coalesce(jsonb_object_agg(lvl, arr) filter (where kind = 's5'),  '{}'::jsonb) as lv_s5
    from lv_arr
  ),
  u_flat as (
    select e.key as cid, a.i, sum(a.v::numeric) as v
    from base, jsonb_each(base.units) e, jsonb_array_elements_text(e.value) with ordinality as a(v, i)
    group by e.key, a.i
  ),
  u_arr as (
    select cid, jsonb_agg(v order by i) as arr from u_flat group by cid
  ),
  u_top as (
    select cid, arr from (
      select cid, arr, row_number() over (order by (arr->>0)::numeric desc, cid) as rn from u_arr
    ) r where rn <= 24
  ),
  ul_flat as (
    select e.key as cid, l.key as lvl, a.i, sum(a.v::numeric) as v
    from base, jsonb_each(base.unit_levels) e, jsonb_each(e.value) l,
         jsonb_array_elements_text(l.value) with ordinality as a(v, i)
    where e.key in (select cid from u_top)
    group by e.key, l.key, a.i
  ),
  ul as (
    select cid, jsonb_object_agg(lvl, arr) as j
    from (select cid, lvl, jsonb_agg(v order by i) as arr from ul_flat group by cid, lvl) x
    group by cid
  ),
  -- Items: min. 5 Kopien, die 16 haeufigsten je Unit
  ui_flat as (
    select e.key as cid, it.key as item, a.i, sum(a.v::numeric) as v
    from base, jsonb_each(base.unit_items) e, jsonb_each(e.value) it,
         jsonb_array_elements_text(it.value) with ordinality as a(v, i)
    where e.key in (select cid from u_top)
    group by e.key, it.key, a.i
  ),
  ui as (
    select cid, jsonb_object_agg(item, arr) as j
    from (
      select cid, item, arr,
             row_number() over (partition by cid order by (arr->>0)::numeric desc, item) as rn
      from (select cid, item, jsonb_agg(v order by i) as arr from ui_flat group by cid, item) x
      where (arr->>0)::numeric >= 5
    ) r
    where rn <= 16
    group by cid
  ),
  -- 3er-Kombis: min. 5 Kopien, die 8 haeufigsten je Unit
  us_flat as (
    select e.key as cid, st.key as combo, a.i, sum(a.v::numeric) as v
    from base, jsonb_each(base.unit_sets) e, jsonb_each(e.value) st,
         jsonb_array_elements_text(st.value) with ordinality as a(v, i)
    where e.key in (select cid from u_top)
    group by e.key, st.key, a.i
  ),
  us as (
    select cid, jsonb_object_agg(combo, arr) as j
    from (
      select cid, combo, arr,
             row_number() over (partition by cid order by (arr->>0)::numeric desc, combo) as rn
      from (select cid, combo, jsonb_agg(v order by i) as arr from us_flat group by cid, combo) x
      where (arr->>0)::numeric >= 5
    ) r
    where rn <= 8
    group by cid
  ),
  units_out as (
    select coalesce(jsonb_object_agg(t.cid, jsonb_build_object(
      't',    t.arr,
      'lv',   coalesce(ul.j, '{}'::jsonb),
      'it',   coalesce(ui.j, '{}'::jsonb),
      'sets', coalesce(us.j, '{}'::jsonb)
    )), '{}'::jsonb) as j
    from u_top t
    left join ul on ul.cid = t.cid
    left join ui on ui.cid = t.cid
    left join us on us.cid = t.cid
  )
  select jsonb_build_object(
    'games',          (select coalesce(sum(games), 0) from base),
    'rows_outcome',   (select count(*) from base),
    'rows_stats',     (select n from cov),
    'placement_hist', (select j from ph),
    'level_stats',    (select lv_all from lv),
    'level_stats_s5', (select lv_s5 from lv),
    'units',          (select j from units_out)
  );
$$;

revoke all on function public.get_tft_comp_outcome(text[], text[], text[], int, text, int) from public, anon, authenticated;
grant execute on function public.get_tft_comp_outcome(text[], text[], text[], int, text, int) to service_role;
