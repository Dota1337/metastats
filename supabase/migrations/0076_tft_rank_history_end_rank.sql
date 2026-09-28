-- Rang pro Set = Endrang + hoechste LP (User 2026-09-28).
-- peak_* bleibt der Hoechstrang (MetaTFT), end_* ist der Rang am Set-Ende
-- (MetaTFT rating_text, sonst dak.gg). Wiederholbar: if not exists + Backfill
-- nur fuer leere Felder.

alter table tft_player_rank_history add column if not exists end_tier text;
alter table tft_player_rank_history add column if not exists end_division text;
alter table tft_player_rank_history add column if not exists end_lp int;

-- dak.gg-Zeilen trugen den Endrang bisher in peak_*.
update tft_player_rank_history
   set end_tier = peak_tier, end_division = peak_division
 where source = 'dakgg' and end_tier is null;

notify pgrst, 'reload schema';
