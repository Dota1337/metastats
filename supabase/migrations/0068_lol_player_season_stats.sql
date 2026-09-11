-- Vorberechnete Leistungsanalyse je Spieler und Saison/Split (2026-09-11, Phase 2).
--
-- WARUM: Die Analyse auf /player/[slug] soll ueber alle gespeicherten
-- Ranked-Spiele einer Saison laufen, nicht nur ueber die letzten 30. Die
-- Rohdaten liegen in lol_player_match_cache (0067). Ein Spieler mit voller
-- Saison bringt ~950 Zeilen mit je ~8 KB mit — gemessen 5,78 MB und ~0,5 s pro
-- Lesevorgang. Das einmal zu rechnen ist tragbar, bei jedem Seitenaufruf nicht.
-- Deshalb rechnet app/api/player-season-stats/route.ts beim ersten Aufruf und
-- legt das Ergebnis hier ab; danach wird nur noch gelesen.
--
-- MUSTER: tft_player_season_stats (0011) — Rohspeicher plus vorberechnete Zeile.
--
-- UNGUELTIG WIRD eine Zeile, sobald eine der drei Pruefgroessen nicht mehr
-- passt: Zahl der gespeicherten Spiele im Zeitraum (games_raw), Zeitpunkt des
-- juengsten davon (newest_match_at) oder die Rechen-Version (calc_version,
-- wird im Code hochgezaehlt, wenn sich die Bewertung aendert). Die Route
-- vergleicht das bei jedem Aufruf mit einer kleinen Zaehl-Abfrage.
--
-- Rueckweg: supabase/rollback/0068_lol_player_season_stats_rollback.sql

create table if not exists lol_player_season_stats (
  puuid            text not null,
  period_id        text not null,              -- 's2026' oder 's2026-split2' (public/seasons.json)

  -- Pruefgroessen fuer die Gueltigkeit
  games_raw        int  not null,              -- gespeicherte Ranked-Spiele im Zeitraum, vor dem Remake-Filter
  newest_match_at  timestamptz,
  calc_version     int  not null,

  -- Ergebnis
  games_analyzed   int  not null,              -- nach dem Remake-Filter
  first_game_at    timestamptz,
  last_game_at     timestamptz,
  overview         jsonb,                      -- null = zu wenige Spiele fuer eine Bewertung

  computed_at      timestamptz not null default now(),

  primary key (puuid, period_id)
);

-- Kein oeffentliches Leserecht, wie 0067. Gelesen wird nur ueber die Route mit
-- dem Service-Schluessel.
revoke select on public.lol_player_season_stats from anon, authenticated;

notify pgrst, 'reload schema';
