-- Rueckbau 0081. Die Route faellt danach automatisch auf public/champion-builds-*.json
-- zurueck (source: 'json'). Vorher den Timer metastats-lol-builds.timer stoppen,
-- sonst schreibt der naechste Lauf ins Leere und meldet Fehler.
drop table if exists public.lol_champion_build_stats;
notify pgrst, 'reload schema';
