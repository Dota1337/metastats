-- Enrich-Staleness-Marker fuer tft_pro_players.
--
-- enrich-tft-pro-history.mjs hat bisher keinen eigenen Zeitstempel geschrieben
-- und deshalb bei JEDEM Lauf alle ~627 Liquipedia-Rows neu geholt: 2 Seiten pro
-- Pro bei 2100ms Pflicht-Delay = 45-90 Minuten. Ohne Marker gibt es kein
-- "schon aktuell", also auch keinen Weg, den Lauf zu verkleinern.
--
-- Bewusst eine EIGENE Spalte statt last_validated_at: das Feld wird vom
-- Validator/Rank-Pfad geschrieben. Wuerden wir es mitbenutzen, wuerde ein
-- Rank-Check den Enrich als "frisch" markieren, obwohl die Turnier-Historie
-- Monate alt ist. Siehe den enrichment-owned-Fields-Vertrag: Enrich-Felder
-- gehoeren nie in fremde Upsert-Payloads.
--
-- NULL heisst "nie angereichert" und wird deshalb immer zuerst gezogen.

alter table public.tft_pro_players
  add column if not exists last_enriched_at timestamptz;

comment on column public.tft_pro_players.last_enriched_at is
  'Letzter erfolgreicher Lauf von enrich-tft-pro-history.mjs fuer diese Zeile. NULL = nie angereichert (hoechste Prioritaet). Steuert die Staleness-Auswahl; NICHT von anderen Crawler-Schritten schreiben.';

-- Deckt die Auswahl-Query ab: NULLS FIRST, dann aelteste zuerst.
create index if not exists idx_tft_pro_players_last_enriched_at
  on public.tft_pro_players (last_enriched_at nulls first);
