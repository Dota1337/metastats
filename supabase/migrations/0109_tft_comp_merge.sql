-- 0109: Comps zusammenlegen (User 31.10.2026: „Lege die Comps zusammen (reroll
-- Comps bleiben nach wie vor eine eigene Comp), damit wir den Durchschnitt immer
-- richtig haben").
--
-- WARUM: Der Katalog ordnet Bretter nach ihrem Trait zu. Eine Linie wie Elderwood
-- mit Soraka, die auf hoher Stufe Gnar und Lux dazunimmt, zerfaellt so in mehrere
-- Comps. Die Zuordnung Comp → Grund-Comp steht hier, fest je Patch-Familie: pro
-- Filter neu gerechnet kippte sie je nach Rang und Zeitraum.
--
-- Schreiber: scripts/build-comp-merges.mjs (Box, ExecStartPre des Publishers),
-- nur Zugaenge — eine Zeile aendert sich innerhalb der Patch-Familie nie.
-- Leser: tft-comp-catalog-resolver.ts ueber get_tft_comp_merges.
-- Rueckweg: supabase/rollback/0109_tft_comp_merge_rollback.sql
-- (vorher COMP_MERGE_READ=0 oder Code-Rueckbau).

begin;
set local lock_timeout = '2s';

create table if not exists public.tft_comp_merge (
  set_number integer not null,
  patch_family text not null,
  from_key text not null,
  to_key text not null,
  rule text not null,
  from_games integer not null,
  to_games integer not null,
  created_at timestamptz not null default now(),
  primary key (set_number, patch_family, from_key),
  constraint tft_comp_merge_not_self check (from_key <> to_key)
);
alter table public.tft_comp_merge enable row level security;
revoke all on public.tft_comp_merge from anon, authenticated;

create or replace function public.get_tft_comp_merges(p_set integer)
returns table(patch_family text, from_key text, to_key text)
language sql
stable
as $$
  select m.patch_family, m.from_key, m.to_key
  from public.tft_comp_merge m
  where m.set_number = p_set
$$;
revoke all on function public.get_tft_comp_merges(integer) from public, anon, authenticated, service_role;
grant execute on function public.get_tft_comp_merges(integer) to service_role;

commit;
