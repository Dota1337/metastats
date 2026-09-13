-- Vorab berechnete Comp-Listen fuer die schweren Kombinationen (Plan D, 2026-09-13).
--
-- Warum: get_tft_comp_stats_list_v2 braucht fuer Region "alle" x breite
-- Rang-Gruppen x 7 Tage 16-21 s (Messung von der Box, 2026-09-13). Besucher
-- haben 8 s, der Publisher 20 s (Rolle service_role) — beide scheitern mit 502.
-- scripts/precompute-comp-windows.mjs rechnet diese Kombinationen vor jedem
-- Publisher-Lauf direkt an der DB (eigene 120-s-Grenze, eine nach der anderen)
-- und legt die fertigen v2-Zeilen hier ab. /api/tft/comps liest zuerst hier.
--
-- comp_rows ist die unveraenderte v2-Ausgabe mit p_min_games = min_games.
-- Da v2 participants VOR dem Mindestspiele-Filter zaehlt, darf die Route
-- jede Anfrage mit p_min_games >= min_games durch Nachfiltern bedienen.
--
-- Schluessel:
--   patch_key       '' = aktuell ungefiltert (p_patch null), sonst der Patch-String
--   regions_key     sortiert, kommagetrennt
--   buckets_key     sortiert, kommagetrennt
--   data_start      erster Tag, der in die Liste eingeht: current_date - p_days,
--                   bei festem Patch aber nie vor dessen erstem Tag. Damit teilen
--                   sich alle Tagesstufen, die den ganzen Patch umfassen, EINEN
--                   Eintrag (18.2 am 13.09.: sieben Stufen, ein Ergebnis).
--   patch_first_day nur bei festem Patch gesetzt, sonst null.
-- Ein Eintrag vom Vortag passt nie auf ein heutiges Fenster, weil die
-- Lese-Funktion data_start aus dem heutigen current_date ableitet.

create table if not exists public.tft_comp_list_precomputed (
  patch_key       text        not null,
  set_number      int         not null,
  regions_key     text        not null,
  buckets_key     text        not null,
  data_start      date        not null,
  patch_first_day date,
  last_day        date        not null,
  min_games       int         not null,
  comp_rows       jsonb       not null,
  computed_at     timestamptz not null default now(),
  primary key (patch_key, set_number, regions_key, buckets_key, data_start)
);

alter table public.tft_comp_list_precomputed enable row level security;
revoke all on public.tft_comp_list_precomputed from anon, authenticated;

-- Jeder Lauf ersetzt die Zeilen komplett; grosse jsonb-Werte -> haeufiger aufraeumen.
alter table public.tft_comp_list_precomputed set (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.05
);

create or replace function public.get_tft_comp_list_precomputed(
  p_patch_key   text,
  p_set         int,
  p_regions_key text,
  p_buckets_key text,
  p_days        int
)
returns table (
  last_day    date,
  min_games   int,
  computed_at timestamptz,
  comp_rows   jsonb
)
language sql
stable
as $$
  select t.last_day, t.min_games, t.computed_at, t.comp_rows
  from public.tft_comp_list_precomputed t
  where t.patch_key = p_patch_key
    and t.set_number = p_set
    and t.regions_key = p_regions_key
    and t.buckets_key = p_buckets_key
    and t.data_start = greatest(current_date - p_days, coalesce(t.patch_first_day, current_date - p_days))
  limit 1;
$$;

revoke execute on function public.get_tft_comp_list_precomputed(text, int, text, text, int) from public, anon, authenticated;
grant execute on function public.get_tft_comp_list_precomputed(text, int, text, text, int) to service_role;

notify pgrst, 'reload schema';
