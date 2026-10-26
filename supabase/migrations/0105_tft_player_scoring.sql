-- 0105: Lobby je Match + Bezugswerte fuer die Spieler-Bewertung im Vergleich
-- (/tft/compare, Plan 2026-10-26).
--
-- HETZNER-LOCAL-PG ONLY — NICHT auf Supabase anwenden.
-- Anwenden auf der Box:  psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction -f supabase/migrations/0105_tft_player_scoring.sql
--
-- tft_player_match_cache haelt je Match nur den abgerufenen Spieler. Fuer die
-- Lobby-Erwartung (erwarteter Platz aus den Raengen aller 8) und fuer
-- "umkaempft" (Gegner mit demselben Carry) braucht es alle 8 Endbretter. Das
-- volle Riot-Match liegt nur kurz in fetchOne (tft-match-cache-pg.mjs) vor —
-- dort schreibt scripts/lib/tft-match-lobby.mjs eine Zeile je Match.
--
-- participants: nur Rohfakten, kompakt (Schluessel siehe tft-match-lobby.mjs).
-- Carry, Familie und Leiterpunkte bildet das Rechen-Modul beim Lesen, mit
-- derselben Funktion fuer Spieler und Gegner — eine gespeicherte Ableitung
-- wuerde die Klassifikation von heute einfrieren.
--
-- ranks: traegt der Nachtlauf nach (build-player-scoring-population.mjs), nur
-- Staende VOR dem Spiel (ein Stand danach enthaelt dessen LP). Die Rangliste
-- tft_ladder_daily haelt nur 10 Tage; nach 8 Tagen wird eingefroren.
--
-- Aufbewahrung: nur das laufende Set (infra/hetzner/metastats-pg-prune.sh).

create table if not exists public.tft_match_lobby (
  match_id          text        not null primary key,
  region            text        not null,
  set_number        integer     not null,
  game_datetime     bigint      not null,
  game_version      text,
  participants      jsonb       not null,
  ranks             jsonb,
  known_count       smallint    not null default 0,
  ranks_resolved_at timestamptz,
  ranks_frozen      boolean     not null default false,
  captured_at       timestamptz not null default now()
);

-- Nachtlauf: "noch nicht eingefrorene Lobbys des Sets", Rechen-Modul liest per match_id.
create index if not exists idx_tft_match_lobby_open
  on public.tft_match_lobby (set_number, game_datetime) where not ranks_frozen;

-- Bezugswerte je (Region, Set, Patch). region 'all' und patch 'all' sind die
-- Rueckfall-Zeilen. Der Nachtlauf tauscht alle Zeilen eines Sets in EINER
-- Transaktion aus; ein Abbruch laesst die alten stehen.
create table if not exists public.tft_player_scoring_population (
  region      text        not null,
  set_number  integer     not null,
  patch       text        not null,
  computed_at timestamptz not null,
  dists       jsonb       not null,
  primary key (region, set_number, patch)
);

-- Falls die Datei doch einmal auf Supabase landet: dort nie oeffentlich lesbar.
alter table public.tft_match_lobby enable row level security;
alter table public.tft_player_scoring_population enable row level security;
revoke all on public.tft_match_lobby from public;
revoke all on public.tft_player_scoring_population from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.tft_match_lobby from anon, authenticated';
    execute 'revoke all on public.tft_player_scoring_population from anon, authenticated';
  end if;
end $$;
