-- 0086: Platz-Bereich fuer Turnier-Ergebnisse.
--
-- Liquipedia vergibt geteilte Plaetze als Bereich ("9th - 12th", im Wikitext
-- place=9-12). placement bleibt der untere Wert und damit Teil des
-- Primaerschluessels (tournament_id, placement, pro_name); placement_max
-- traegt den oberen Wert und ist null, wenn der Platz kein Bereich ist.
-- Ein Sieg zaehlt nur bei placement = 1 und placement_max null oder 1, damit
-- "1st - 2nd" kein Sieg wird. Geschrieben von scripts/crawl-tft-tournaments.mjs,
-- gelesen von app/lib/tft-tournament-history.ts.
--
-- Nur hinzufuegend. Rueckweg:
--   alter table public.tft_tournament_results drop column if exists placement_max;

alter table public.tft_tournament_results
  add column if not exists placement_max integer;

notify pgrst, 'reload schema';
