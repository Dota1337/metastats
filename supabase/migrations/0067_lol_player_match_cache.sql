-- Dauerhafter LoL-Match-Speicher je Spieler (2026-09-11, Phase 1).
--
-- WARUM: Die Leistungsanalyse auf /player/[slug] rechnet heute ueber die
-- letzten 30 Spiele (app/api/summoner/route.ts:69, :217, :244;
-- app/api/matches/route.ts:24). Der User will die ganze Saison. Riot gibt pro
-- Account aber hoechstens ~950 Match-IDs heraus — gemessen am 2026-09-11 ueber
-- 6 Accounts: 951/925/921/920/909/776, mit queue=420 genau 948. Aeltere Spiele
-- sind ueber KEINEN Parameter mehr erreichbar. Jeder Tag ohne eigene Ablage ist
-- endgueltig verlorene Historie. Deshalb: einmal holen, dauerhaft behalten.
--
-- MUSTER: tft_player_match_cache (Migration 0004) + tft_player_season_stats
-- (0011). Dort steht der Grund woertlich: "The Vercel API reads this table for
-- set-wide player views; it never has to walk match-cache rows itself."
-- Die vorberechnete Ergebniszeile kommt in Phase 2; hier entsteht nur der
-- Rohspeicher, aus dem sie spaeter gerechnet wird.
--
-- WAS GESPEICHERT WIRD: der Teilnehmer-Datensatz DIESES Spielers, nicht das
-- ganze Match. Gemessen am 2026-09-11 an drei echten Matches
-- (EUW1_7977330387/7977300812/7977113591): ganzes Match 78 KB, ein Teilnehmer
-- 7,6 KB. Bei 10 Spielern pro Match waere das ganze Match zu 90 % Ballast.
-- Die Teamsummen, die app/lib/match-processor.ts:239-242 aus den Mitspielern
-- rechnet, werden beim Sammeln einmal ausgerechnet und als Spalten abgelegt —
-- sonst waeren doch wieder alle 10 Teilnehmer noetig.
--
-- Bewusst NICHT reduziert: aus dem Teilnehmer-Objekt wird kein Feld entfernt.
-- app/lib/match-processor.ts liest heute ~200 Felder daraus; eine
-- Auswahl-Liste im Sammel-Skript waere eine zweite Wahrheit, die beim naechsten
-- neuen Feld still auseinanderlaeuft (siehe reference_dual_module_patterns).
--
-- PATCH STATT DATUM: patch_major/patch_minor kommen aus info.gameVersion des
-- Matches. Die Saison ergibt sich damit aus dem Spiel selbst
-- (public/seasons.json: major 16 = s2026), nicht aus einer Datumsgrenze — genau
-- wie beim TFT die Set-Nummer aus dem Match kommt. Gemessen am 2026-09-11 ueber
-- die volle Tiefe eines Accounts: start=0 -> 16.17, start=300 -> 16.14,
-- start=600 -> 16.12, start=900 -> 16.11. patch_minor traegt zusaetzlich die
-- Split-Grenzen innerhalb einer Saison (public/seasons.json#splits).
--
-- Rueckweg: supabase/rollback/0067_lol_player_match_cache_rollback.sql

create table if not exists lol_player_match_cache (
  puuid          text not null,
  match_id       text not null,

  -- Zuordnung + Filter
  region         text not null,
  queue_id       int  not null,              -- 420 = Ranked Solo/Duo
  game_creation  timestamptz not null,
  game_duration  int  not null,              -- Sekunden
  patch_major    int  not null,              -- 16 aus "16.17.810.4348" -> Saison
  patch_minor    int  not null,              -- 17 -> Split innerhalb der Saison
  game_version   text not null,              -- die volle Zeichenkette, unveraendert

  -- Kopfzahlen fuer Listen und Zaehlungen ohne jsonb-Zugriff
  win            boolean not null,
  champion       text not null default '',
  role           text not null default 'UNKNOWN',

  -- Teamsummen: sonst muessten alle 10 Teilnehmer mitgespeichert werden
  team_kills     int not null default 0,
  team_damage    int not null default 0,
  team_gold      int not null default 0,

  -- der rohe Teilnehmer-Datensatz, unveraendert wie von Riot geliefert
  participant    jsonb not null,

  fetched_at     timestamptz not null default now(),

  primary key (puuid, match_id)
);

-- Leserichtung Phase 2: "alle Ranked-Spiele eines Spielers in Saison X,
-- neueste zuerst". patch_major vor game_creation, weil die Saison der Filter
-- ist und das Datum nur die Sortierung.
create index if not exists idx_lol_match_cache_player_season
  on lol_player_match_cache(puuid, queue_id, patch_major, game_creation desc);

-- Vertragspruefung (infra/contracts.json) fragt "wie frisch ist die juengste
-- Zeile" ueber alle Spieler hinweg.
create index if not exists idx_lol_match_cache_fetched
  on lol_player_match_cache(fetched_at desc);


-- Warteschlange fuer die Erstbefuellung.
--
-- WARUM IN DER DATENBANK und nicht im Arbeitsspeicher: Der Dauerdienst auf der
-- Box wird bei jedem Deploy neu gestartet (infra/hetzner/remote-deploy.sh:95
-- `systemctl try-restart`). Eine Warteschlange im Speicher waere danach leer,
-- und die Erstbefuellung finge bei jedem Deploy von vorn an.
--
-- Uebernahme per `for update skip locked`, damit zwei parallele Laeufe nie
-- denselben Spieler ziehen.
create table if not exists lol_match_fill_queue (
  puuid           text primary key,
  region          text not null,

  status          text not null default 'pending'
                    check (status in ('pending', 'running', 'done', 'failed')),
  -- Hoehere Zahl zuerst. Gespeist aus players.searched_by, damit oft gesuchte
  -- Spieler zuerst vollstaendig sind — bei ~70 Spielern pro Tag und 1.431
  -- Zeilen in `players` (gemessen 2026-09-11) dauert ein voller Durchlauf
  -- rund drei Wochen.
  priority        int not null default 0,

  ids_seen        int not null default 0,    -- wie viele IDs Riot hergab
  matches_cached  int not null default 0,    -- wie viele davon jetzt liegen
  oldest_match_at timestamptz,
  newest_match_at timestamptz,

  attempts        int not null default 0,
  last_error      text,
  claimed_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_lol_fill_queue_pick
  on lol_match_fill_queue(status, priority desc, updated_at asc);


-- Kein oeffentliches Leserecht. Muster aus 0055_revoke_anon_read.sql /
-- 0066_revoke_anon_peaks.sql: neue Tabellen kommen zugesperrt auf die Welt,
-- sonst meldet security_anon_leaks() aus 0056 sie beim naechsten Lauf.
-- Phase 2 liest ueber einen eigenen Endpunkt mit dem Service-Schluessel, nicht
-- mit dem oeffentlichen.
revoke select on public.lol_player_match_cache from anon, authenticated;
revoke select on public.lol_match_fill_queue   from anon, authenticated;

-- PostgREST haelt das Schema im Cache; ohne dieses Signal kennt es die neuen
-- Tabellen minutenlang nicht.
notify pgrst, 'reload schema';
