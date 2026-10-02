-- Beendete Patches nicht jede Nacht neu rechnen (Plan 2026-10-02, Teil A4).
--
-- Warum: Die Vorab-Listen fuer den Vorpatch kosteten jede Nacht dieselben
-- schweren Abfragen, obwohl sich an einem beendeten Patch nichts mehr aendert.
-- Zusammen mit dem Publisher hielt das die DB 1,5-2 h am Anschlag; Besucher
-- bekamen in der Zeit 502.
--
-- scripts/precompute-comp-windows.mjs rechnet einen beendeten Patch nur neu,
-- wenn sich seine Spielzahl geaendert hat (Nachzuegler) oder das Ergebnis
-- aelter als 6 Tage ist. Sonst bestaetigt es die Zeile nur: last_day und
-- computed_at ruecken auf heute, built_at bleibt.
--
--   patch_matches  Spielzahl des Patches zum Rechenzeitpunkt (nur bei festem
--                  Patch gesetzt). Abweichung = neue Daten = neu rechnen.
--   built_at       wann comp_rows wirklich gerechnet wurde. computed_at heisst
--                  ab jetzt "zuletzt als aktuell bestaetigt" — die Route prueft
--                  damit weiter, ob die Zeile verwaist ist.

alter table public.tft_comp_list_precomputed
  add column if not exists patch_matches bigint,
  add column if not exists built_at timestamptz;

update public.tft_comp_list_precomputed set built_at = computed_at where built_at is null;
