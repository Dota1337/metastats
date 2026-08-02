-- Zweiter Staleness-Marker: wann wurde die VOLLE Turnier-Historie geholt?
--
-- Hintergrund: Liquipedia erlaubt fuer action=parse nur 1 Request / 30 s. Der
-- Enrich-Schritt holte pro Spieler ZWEI gerenderte Seiten (Hauptseite +
-- /Results), also 60 s pro Spieler. Gemessen an 625 Pros ist das unbezahlbar.
--
-- Die Hauptseite allein traegt Bild, Team und die Infobox-Summe
-- ("Approx. Total Winnings") — genug fuer Einstufung und Verdienst-Anzeige.
-- Die /Results-Unterseite traegt die volle Historie (bei Setsuko 55 statt 11
-- Eintraege) und wird deshalb nur noch in langsamer Rotation geholt.
--
-- Zwei Marker statt einem, weil die beiden Durchgaenge unterschiedlich schnell
-- veralten: last_enriched_at = flacher Lauf (Hauptseite),
-- last_history_enriched_at = tiefer Lauf (inkl. Unterseite).

alter table public.tft_pro_players
  add column if not exists last_history_enriched_at timestamptz;

comment on column public.tft_pro_players.last_history_enriched_at is
  'Letzter Lauf, der die volle /Results-Unterseite geholt und tournament_results geschrieben hat. NULL = nie. Steuert die langsame Tief-Rotation; der flache Lauf schreibt es NICHT.';

create index if not exists idx_tft_pro_players_last_history_enriched_at
  on public.tft_pro_players (last_history_enriched_at nulls first);
