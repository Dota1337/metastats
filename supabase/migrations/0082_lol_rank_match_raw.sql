-- 0082: Rohdaten fuer die LoL-Champion-Builds je Rang.
--
-- HETZNER-LOCAL-PG ONLY — NICHT auf Supabase anwenden.
-- Anwenden auf der Box:  psql "$DATABASE_URL" -f supabase/migrations/0082_lol_rank_match_raw.sql
--
-- Geschrieben von scripts/collect-lol-matches.mjs (beide Modi: Spieler-Historie
-- und Rang-Stichprobe), gelesen von scripts/aggregate-lol-builds.mjs. Liegt auf
-- der Box, weil nur die Verdichtung sie liest und Supabase-Platz knapp ist
-- (10 Zeilen je Match).

-- Ein Match = zehn Zeilen, je Teilnehmer eine. Nur reine Match-Daten: ueber welchen
-- Spieler und in welchem Rang das Match gefunden wurde, steht in
-- lol_rank_match_queue (seed_puuid, seed_tier). So bekommt ein Match, das zuerst
-- ueber die Spieler-Historie kam, seinen Rang spaeter noch nachgetragen.
create table if not exists lol_match_participant_raw (
  match_id         text        not null,
  participant_id   smallint    not null,
  puuid            text        not null,
  region           text        not null,
  queue_id         int         not null,
  game_creation    timestamptz not null,
  game_duration    int         not null,        -- Sekunden
  early_surrender  boolean     not null default false,
  patch_major      smallint    not null,
  patch_minor      smallint    not null,
  champion_id      int         not null,
  team_id          smallint    not null,
  team_position    text        not null,        -- '' bei Remake/Sondermodus
  win              boolean     not null,
  items            int[]       not null,        -- item0..item5, item6 (Trinket) fehlt bewusst
  runes            int[],                       -- primary,keystone,p1,p2,p3,secondary,s1,s2,off,flex,def
  summoners        int[]       not null,
  fetched_at       timestamptz not null default now(),
  primary key (match_id, participant_id)
);

create index if not exists lol_match_participant_raw_patch
  on lol_match_participant_raw (patch_major, patch_minor);

-- Arbeitsliste der Rang-Stichprobe. Dedup ueber den Primaerschluessel: ein
-- Match, das schon hier steht, wird nie ein zweites Mal bei Riot abgerufen.
-- Die Spieler-Historie traegt ihre Matches ebenfalls als 'done' ein.
create table if not exists lol_rank_match_queue (
  match_id     text        primary key,
  region       text        not null,
  seed_puuid   text,
  seed_tier    text,
  status       text        not null default 'pending',   -- pending | running | done | failed
  attempts     int         not null default 0,
  claimed_at   timestamptz,
  last_error   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists lol_rank_match_queue_pending
  on lol_rank_match_queue (created_at) where status = 'pending';
