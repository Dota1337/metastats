-- 0123: Verknuepfung metastats-Konto ↔ Riot-Konto (Riot-Anmeldung, Plan 14.11.2026).
--
-- Eine Zeile je Konto, ein Riot-Konto je Zeile (User-Entscheid: keine
-- Zweitkonten). Zuordnung ueber rso_puuid = die puuid aus Riots accounts/me
-- bei der Anmeldung. Sie wird NIE mit Spieldaten verbunden — puuids haengen am
-- Riot-Schluessel. Fuer TFT-Daten zaehlt tft_puuid (mit RIOT_API_KEY_TFT
-- aufgeloest), LoL laeuft ueber Name + lol_region (data-skeptic 14.11.2026).
--
-- Keine Riot-Tokens: der Zugangsschluessel wird einmal benutzt und verworfen.
-- Schreibweg nur ueber Server-Routen mit Service-Schluessel
-- (app/lib/riot-rso-server.ts); anon/authenticated haben keine Rechte.
-- Konto loeschen (auth.users) nimmt die Zeile per cascade mit.
--
-- Rollback: drop table public.user_riot_links;  Nebenwirkung: Konten, die nur
-- ueber Riot angelegt wurden, kommen danach nicht mehr hinein.

set lock_timeout = '5s';

create table if not exists public.user_riot_links (
  user_id     uuid        primary key references auth.users (id) on delete cascade,
  rso_puuid   text        not null unique,
  tft_puuid   text        unique,
  game_name   text        not null,
  tag_line    text        not null,
  has_tft     boolean,
  lol_region  text,
  linked_at   timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.user_riot_links enable row level security;
revoke all on public.user_riot_links from anon, authenticated;
