-- 0091: Embleme der Comp, je Spiel gezaehlt (2026-10-10).
--
-- Neue Spalte emblems in tft_daily_comp_outcome (0078) und eigene Abfrage
-- get_tft_comp_emblems fuer die Detailseite („Embleme der Comp" unter den
-- Artefakten). Die Item-Spalten aus 0078 zaehlen nur Kopien mit genau 3
-- fertigen Items und unterzaehlen Embleme deshalb stark; diese Spalte zaehlt
-- je Spiel, ob ein Emblem auf dem Brett liegt, egal wie viele Items die Unit
-- traegt. Geschrieben vom Tagessammler (tft-build-aggregator.mjs
-- serializeOutcome, tft-supabase-writer.mjs Block 9).
--
-- Format (Aggregator, Reihenfolge fest):
--   emblems  {"g": <Spiele der Zeile>,
--             "e": {"<item>": {"t": [n,s,q,t4,t1], "h": {"<cid>": <Spiele>}}}}
--   g steht im selben Objekt wie die Zaehler: schreibt ein alter Lauf die
--   Zeile neu, bleiben Zaehler und Nenner zusammen. NULL = Zeile stammt aus
--   der Zeit vor 0091 und zaehlt weder im Zaehler noch im Nenner.
--   Embleme aus Augments und Phantom-Gegenstaende sammelt der Aggregator nicht.
--
-- Eigene Abfrage statt Erweiterung von get_tft_comp_outcome: die liegt bei
-- grossen Fenstern nahe am 8-s-Limit der Route; reisst eine gemeinsame
-- Abfrage es, waeren alle Ergebnis-Bloecke weg. Liest nur emblems.
--
-- Reihenfolge beim Einspielen: diese Migration VOR dem Push des Sammlers —
-- sonst lehnt PostgREST die unbekannte Spalte ab und Block 9 verliert den Tag
-- (kein Nachrechnen, 0078).
--
-- Rueckbau: drop function get_tft_comp_emblems(text[], text[], text[], int, text, int);
--           alter table tft_daily_comp_outcome drop column emblems;

begin;

set local lock_timeout = '2s';

-- lz4 wie die anderen jsonb-Spalten der Tabelle (Standard der DB ist pglz).
alter table public.tft_daily_comp_outcome
  add column if not exists emblems jsonb compression lz4;

create or replace function public.get_tft_comp_emblems(
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
    select o.emblems
    from tft_daily_comp_outcome o
    where o.cluster_key = any(p_cluster_keys)
      and o.region = any(p_regions)
      and o.bucket = any(p_buckets)
      and o.bucket <> 'pro_pool'
      and o.day >= current_date - (p_days || ' days')::interval
      and (p_patch is null or o.patch = p_patch)
      and (p_set is null or o.set_number = p_set)
      and o.emblems is not null
  ),
  e_flat as (
    select e.key as item, a.i, sum(a.v::numeric) as v
    from base, jsonb_each(coalesce(base.emblems->'e', '{}'::jsonb)) e,
         jsonb_array_elements_text(e.value->'t') with ordinality as a(v, i)
    group by e.key, a.i
  ),
  -- Die 6 haeufigsten; die Seite zeigt davon 3.
  e_top as (
    select item, arr from (
      select item, arr, row_number() over (order by (arr->>0)::numeric desc, item) as rn
      from (select item, jsonb_agg(v order by i) as arr from e_flat group by item) x
    ) r where rn <= 6
  ),
  -- Traeger: die 5 haeufigsten je Emblem.
  h as (
    select item, jsonb_object_agg(cid, n) as j
    from (
      select item, cid, n, row_number() over (partition by item order by n desc, cid) as rn
      from (
        select e.key as item, hh.key as cid, sum(hh.value::numeric) as n
        from base, jsonb_each(coalesce(base.emblems->'e', '{}'::jsonb)) e,
             jsonb_each_text(coalesce(e.value->'h', '{}'::jsonb)) hh
        where e.key in (select item from e_top)
        group by e.key, hh.key
      ) x
    ) r
    where rn <= 5
    group by item
  )
  select jsonb_build_object(
    'emblem_games', (select coalesce(sum((emblems->>'g')::numeric), 0) from base),
    'rows_emblems', (select count(*) from base),
    'emblems', (
      select coalesce(jsonb_object_agg(t.item, jsonb_build_object('t', t.arr, 'h', coalesce(h.j, '{}'::jsonb))), '{}'::jsonb)
      from e_top t left join h on h.item = t.item
    )
  );
$$;

revoke all on function public.get_tft_comp_emblems(text[], text[], text[], int, text, int) from public, anon, authenticated;
grant execute on function public.get_tft_comp_emblems(text[], text[], text[], int, text, int) to service_role;

commit;

notify pgrst, 'reload schema';
