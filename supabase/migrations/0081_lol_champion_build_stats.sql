-- 0081: LoL-Champion-Builds je Rang (Summen fuer /api/champions/[id]/builds).
--
-- Geschrieben von scripts/aggregate-lol-builds.mjs auf der Box (Timer), gelesen
-- von der Route ueber den Service-Schluessel. Die Rohdaten (alle 10 Teilnehmer
-- je Match) liegen NICHT hier, sondern im Box-Postgres (0082) — was Vercel
-- liest, liegt auf Supabase, alles andere auf der Box.
--
-- Eine Zeile = Spiele/Siege einer Auspraegung (dim/key) fuer Champion + Rolle +
-- exakten Rang + Patch, bei dim 'total' und 'item' zusaetzlich je Schicht
-- (stratum = (fertigeItems-1)*3 + Dauerstufe; -1 = kein fertiges Item; sonst 0).
-- Rang-Gruppen (Emerald+ usw.) summiert die Route, damit die Gruppen nur an
-- einer Stelle stehen (app/lib/rank-groups.ts).
--
-- dim: total | item | boots | build | rune | keystone | spells | vs
-- Bei dim 'vs' ist key die Gegner-Champion-ID derselben Rolle, wins = eigene Siege.

set lock_timeout = '3s';
set statement_timeout = '60s';

create table if not exists public.lol_champion_build_stats (
  region      text        not null,
  patch       text        not null,
  champion    int         not null,
  role        text        not null,
  tier        text        not null,
  dim         text        not null,
  key         text        not null,
  stratum     smallint    not null default 0,
  games       int         not null,
  wins        int         not null,
  updated_at  timestamptz not null default now(),
  primary key (region, patch, champion, role, tier, dim, key, stratum)
);

-- Frische-Vertrag und "welche Patches gibt es" lesen nur diese Spalten.
create index if not exists lol_champion_build_stats_updated
  on public.lol_champion_build_stats (updated_at);

-- Die Route sucht zuerst ohne Patch ("welcher Patch hat genug Spiele?"); der
-- Primaerschluessel hilft dort nur ueber region.
create index if not exists lol_champion_build_stats_champ_dim
  on public.lol_champion_build_stats (region, champion, dim, patch);

alter table public.lol_champion_build_stats enable row level security;
revoke all on public.lol_champion_build_stats from anon, authenticated;

notify pgrst, 'reload schema';
