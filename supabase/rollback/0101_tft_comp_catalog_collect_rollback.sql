-- Rollback 0101: Sammler-Spalten, Schattentabelle und Fenster-RPCs entfernen.
-- Vorher: Box-Code zurueck (oder COMP_CATALOG_COLLECT aus und ein Lauf ohne
-- Katalog), sonst schreibt der Writer in fehlende Spalten. Comp-Zeilen von
-- Katalog-Tagen bleiben stehen; die Seite legt sie ueber den Katalog um
-- (Comp-Name = Familie, aliasMap). Kataloge selbst bleiben (0099).

begin;

set local lock_timeout = '5s';

drop function if exists public.get_tft_comp_catalog_window(p_set integer, p_start date, p_end date, p_patches text[]);
drop function if exists public.get_tft_comp_classic_input(p_set integer, p_patch text, p_start date, p_end date);
drop table if exists public.tft_daily_comp_classic;
alter table public.tft_daily_comp_pairs drop column if exists run_id;
alter table public.tft_daily_comp_outcome drop column if exists run_id;
alter table public.tft_daily_comp_stats
  drop column if exists run_id,
  drop column if exists perfect_top1,
  drop column if exists perfect_top4,
  drop column if exists perfect_sum_placement,
  drop column if exists perfect_games;
alter table public.tft_daily_crawl_meta drop column if exists catalog_id;

commit;

notify pgrst, 'reload schema';
