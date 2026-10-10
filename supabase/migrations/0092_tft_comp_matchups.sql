-- 0092: Comp-Duelle je Familie und Rang (2026-10-11).
--
-- Neue Tabelle neben tft_daily_comp_pairs. Die alte Tabelle speichert nur
-- Paare mit >= 10 Spielen je Region/Tag UND >= 55 % / <= 45 % (Sammler
-- tft-build-aggregator.mjs:1284-1290): ausgeglichene Paare fehlen fast ganz,
-- Gegner-Listen und jedes Duell sind dadurch nach aussen verzerrt (Messung
-- 10.10.2026: 0 von 944.875 Zeilen im Band 45-55 %). Die alte Tabelle und
-- get_tft_comp_pairs bleiben unveraendert (Wissensgraph, Rueckfall der Leser).
--
-- Inhalt: je Region, Rang (einzelner Tier-Bucket, kein pro_pool), Patch, Tag
-- und Familien-Paar (<trait>__<carry>, wie familyKeyForMerge) die Zahl der
-- Vergleiche (je Spielerpaar in derselben Lobby) und wie oft comp_fam vor
-- opp_fam landete. Jedes Paar steht in BEIDEN Richtungen, damit „alle Gegner
-- von X" ein einziger Indexbereich ist. Keine Mindestzahl beim Schreiben —
-- die Grenze zieht der Leser ueber die Summe aller Regionen/Tage. Paare
-- derselben Familie zaehlt der Sammler nicht.
--
-- Primaerschluessel mit comp_fam/day vorne und INCLUDE (games, better): dient
-- zugleich dem Upsert (on_conflict, Spalten-Menge) und als abdeckender Index
-- fuer die Abfrage. Genau ein eindeutiger Index mit patch — Voraussetzung fuer
-- das Patch-Umbenennen (tft-patch-relabel.mjs classifyTables).
-- (day, region): der Writer loescht je Region/Tag vor dem Schreiben und raeumt
-- Tage ausserhalb der Aufbewahrung ab.
--
-- Geschrieben vom Tagessammler (tft-supabase-writer.mjs Block 10), gelesen
-- ueber get_tft_comp_matchups (Detail-Route, Companion, Duell-Route).
-- Kein Nachrechnen alter Tage: die Rohpartien werden nicht gespeichert.
--
-- Reihenfolge beim Einspielen: VOR dem Push des Sammlers.
--
-- Rueckbau: drop function get_tft_comp_matchups(text[], text[], text[], text[], int, text, int, int);
--           drop table tft_daily_comp_matchups;

begin;

set local lock_timeout = '2s';

create table if not exists public.tft_daily_comp_matchups (
  region      text not null,
  bucket      text not null,
  patch       text not null,
  set_number  int  not null,
  day         date not null,
  comp_fam    text not null,
  opp_fam     text not null,
  games       int  not null default 0,
  better      int  not null default 0,
  constraint tft_daily_comp_matchups_pkey
    primary key (comp_fam, day, region, bucket, opp_fam, set_number, patch) include (games, better)
);

create index if not exists idx_tft_daily_comp_matchups_day_region
  on public.tft_daily_comp_matchups (day, region);

alter table public.tft_daily_comp_matchups enable row level security;
revoke all on public.tft_daily_comp_matchups from anon, authenticated;

-- Wie 0047: der taegliche Massen-Upsert laesst die Sichtbarkeits-Karte kalt.
alter table public.tft_daily_comp_matchups set (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_vacuum_cost_limit = 2000
);

-- Ein jsonb-Wert statt Tabellen-Rueckgabe: PostgREST kappt Tabellen bei 1000
-- Zeilen (HTTP 206, gemessen an get_tft_comp_pairs). rows = [[comp, opp,
-- games, better], ...]; days = Tage mit Zeilen fuer p_fams im Fenster (0 =
-- neue Daten decken das Fenster nicht, Leser nimmt den alten Weg).
create or replace function public.get_tft_comp_matchups(
  p_fams       text[],
  p_opp_fams   text[],
  p_regions    text[],
  p_buckets    text[],
  p_days       int  default 3,
  p_patch      text default null,
  p_set        int  default null,
  p_min_games  int  default 1
)
returns jsonb
language sql
stable
set search_path = public
as $$
  with base as (
    select m.comp_fam, m.opp_fam, m.day, m.games, m.better
    from tft_daily_comp_matchups m
    where m.comp_fam = any(p_fams)
      and m.day >= current_date - (p_days || ' days')::interval
      and m.region = any(p_regions)
      and m.bucket = any(p_buckets)
      and (p_opp_fams is null or m.opp_fam = any(p_opp_fams))
      and (p_patch is null or m.patch = p_patch)
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

revoke all on function public.get_tft_comp_matchups(text[], text[], text[], text[], int, text, int, int) from public, anon, authenticated;
grant execute on function public.get_tft_comp_matchups(text[], text[], text[], text[], int, text, int, int) to service_role;

commit;

notify pgrst, 'reload schema';
