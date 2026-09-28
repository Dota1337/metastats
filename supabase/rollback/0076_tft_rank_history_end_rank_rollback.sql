-- Rollback zu 0076: Endrang-Felder entfernen, peak_* bleibt unberuehrt.
alter table tft_player_rank_history drop column if exists end_lp;
alter table tft_player_rank_history drop column if exists end_division;
alter table tft_player_rank_history drop column if exists end_tier;
notify pgrst, 'reload schema';
