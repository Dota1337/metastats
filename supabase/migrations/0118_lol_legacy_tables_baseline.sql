-- 0118 — Aufbau der drei alten LoL-Tabellen festhalten (08.11.2026)
--
-- players, ranked_stats und market_value_history sind aelter als der
-- Migrations-Ordner und wurden damals von Hand in Supabase angelegt. Die
-- Schnittstellen-Karte (scripts/check-api-map.mjs) fuehrte sie deshalb als
-- "benutzt, aber in keiner Migration". Diese Datei schreibt den Aufbau so auf,
-- wie er am 08.11.2026 in der Live-Datenbank steht (gelesen aus
-- information_schema + pg_indexes), damit ein Neuaufbau ihn kennt.
--
-- Auf der Live-Datenbank aendert das Einspielen nichts: alle Anweisungen sind
-- "if not exists" bzw. setzen nur, was schon gesetzt ist (RLS an, nur
-- service_role darf lesen und schreiben).

create table if not exists players (
  id              uuid primary key default gen_random_uuid(),
  summoner_name   text not null,
  summoner_id     text unique,
  puuid           text unique,
  region          text not null,
  summoner_level  integer,
  profile_icon_id integer,
  created_at      timestamp default now(),
  updated_at      timestamp default now(),
  market_value    integer,
  tier            text,
  rank            text,
  winrate         numeric,
  searched_by     text[]
);

create table if not exists ranked_stats (
  id            uuid primary key default gen_random_uuid(),
  player_id     uuid references players(id) on delete cascade,
  queue_type    text,
  tier          text,
  rank          text,
  league_points integer,
  wins          integer,
  losses        integer,
  winrate       numeric,
  created_at    timestamp default now(),
  updated_at    timestamp default now()
);

create table if not exists market_value_history (
  id              uuid primary key default gen_random_uuid(),
  player_id       uuid references players(id) on delete cascade,
  market_value    integer not null,
  recorded_at     timestamp default now(),
  split_id        text,
  games_analyzed  integer,
  base_value      integer,
  multiplier      numeric,
  split_estimated boolean not null default false
);

create index if not exists market_value_history_player_split_idx
  on market_value_history (player_id, split_id, recorded_at desc);
create index if not exists market_value_history_recorded_idx
  on market_value_history (recorded_at desc);

alter table players enable row level security;
alter table ranked_stats enable row level security;
alter table market_value_history enable row level security;

revoke all on players from anon, authenticated;
revoke all on ranked_stats from anon, authenticated;
revoke all on market_value_history from anon, authenticated;
