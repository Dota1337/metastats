-- 0085: Companion-Zellen 0-basiert + Partien je Unit.
--
-- Die App liefert Zellen 1-basiert (1-28, companion gep.ts:21), Heatmap und
-- MetaTFT rechnen 0-basiert (Reihe*7+Spalte, Reihe 0 hinten). Geprueft am
-- 2026-10-04 an zwei Set-18-Spielen: Carrys auf 1-7, Tanks auf 22-28, also
-- nur verschieben, nicht spiegeln. Dieselbe Umrechnung steht in
-- scripts/lib/companion-positions.mjs (boardCell).
--
-- unit_matches: Spiele, in denen die Unit in dieser Comp stand. Daran
-- entscheidet /api/tft/positions/by-units, ob die eigenen Daten reichen.

alter table tft_position_comp_cell
  add column if not exists unit_matches integer not null default 0;

-- Gleiche Signatur wie 0030, damit die Sicht tft_position_unit_cell und ihre
-- Rechte unveraendert bleiben. Nur eigene Bretter: Gegner-Bretter zaehlten in
-- App 0.1.0 anders.
create or replace function tft_position_unit_cell_data()
returns table (
  unit text,
  cell int,
  observations bigint,
  distinct_observers bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    unit,
    (cell - 1)::int as cell,
    count(*)::bigint as observations,
    count(distinct observer_puuid)::bigint as distinct_observers
  from tft_position_observations
  where kind = 'own' and cell between 1 and 28
  group by unit, cell - 1;
$$;

-- create or replace behaelt die Rechte; der Entzug aus 0055 wird zur
-- Sicherheit wiederholt.
revoke execute on function public.tft_position_unit_cell_data() from public, anon, authenticated;

notify pgrst, 'reload schema';
