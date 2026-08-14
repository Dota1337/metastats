-- Rollback zu supabase/migrations/0055_revoke_anon_read.sql
--
-- Nicht automatisch angewendet — bewusst ausserhalb von supabase/migrations,
-- damit `node scripts/apply-migrations.mjs 0055` die Datei nicht mitzieht.
-- Stellt den Stand vor der Sicherheitswelle C5 wieder her:
--   * 22 Policies `anon read` (Original: for select to public using (true))
--   * SELECT-Grant fuer anon + authenticated
--   * EXECUTE-Grant fuer PUBLIC auf allen public-Funktionen
--   * tft_position_unit_cell ist eine View — dort gibt es nur den Grant
--
-- Anwenden:
--   node scripts/db-exec.mjs supabase/rollback/0055_revoke_anon_read_rollback.sql

-- ---------------------------------------------------------------- 1. Grants
grant select on public.site_config to anon, authenticated;
grant select on public.tft_daily_augment_stats to anon, authenticated;
grant select on public.tft_daily_comp_pairs to anon, authenticated;
grant select on public.tft_daily_comp_stats to anon, authenticated;
grant select on public.tft_daily_crawl_meta to anon, authenticated;
grant select on public.tft_daily_item_stats to anon, authenticated;
grant select on public.tft_daily_trait_stats to anon, authenticated;
grant select on public.tft_daily_trait_unitcount_stats to anon, authenticated;
grant select on public.tft_daily_unit_stats to anon, authenticated;
grant select on public.tft_mv_population_stats to anon, authenticated;
grant select on public.tft_player_fetch_state to anon, authenticated;
grant select on public.tft_player_marketvalue_snapshots to anon, authenticated;
grant select on public.tft_player_match_cache to anon, authenticated;
grant select on public.tft_player_rank_backfill_state to anon, authenticated;
grant select on public.tft_player_rank_history to anon, authenticated;
grant select on public.tft_player_season_stats to anon, authenticated;
grant select on public.tft_position_comp_cell to anon, authenticated;
grant select on public.tft_position_unit_cell to anon, authenticated;
grant select on public.tft_pro_players to anon, authenticated;
grant select on public.tft_public_comp_upvotes to anon, authenticated;
grant select on public.tft_public_comps to anon, authenticated;
grant select on public.tft_tournament_results to anon, authenticated;
grant select on public.tft_tournaments to anon, authenticated;

-- ------------------------------------------------------------------- 2. RLS
alter table public.tft_position_unit_cell disable row level security;

-- ---------------------------------------------------------------- 3. Policies
create policy "site_config anon read" on public.site_config for select to public using (true);
create policy "anon read" on public.tft_daily_augment_stats for select to public using (true);
create policy "anon read" on public.tft_daily_comp_pairs for select to public using (true);
create policy "anon read" on public.tft_daily_comp_stats for select to public using (true);
create policy "anon read" on public.tft_daily_crawl_meta for select to public using (true);
create policy "anon read" on public.tft_daily_item_stats for select to public using (true);
create policy "anon read" on public.tft_daily_trait_stats for select to public using (true);
create policy "anon read" on public.tft_daily_trait_unitcount_stats for select to public using (true);
create policy "anon read" on public.tft_daily_unit_stats for select to public using (true);
create policy "anon read" on public.tft_mv_population_stats for select to public using (true);
create policy "anon read" on public.tft_player_fetch_state for select to public using (true);
create policy "anon read" on public.tft_player_marketvalue_snapshots for select to public using (true);
create policy "anon read" on public.tft_player_match_cache for select to public using (true);
create policy "anon read" on public.tft_player_rank_backfill_state for select to public using (true);
create policy "anon read" on public.tft_player_rank_history for select to public using (true);
create policy "anon read" on public.tft_player_season_stats for select to public using (true);
create policy "anon read" on public.tft_position_comp_cell for select to public using (true);
create policy "anon read" on public.tft_pro_players for select to public using (true);
create policy "anon read" on public.tft_public_comp_upvotes for select to public using (true);
create policy "anon read" on public.tft_public_comps for select to public using (true);
create policy "anon read" on public.tft_tournament_results for select to public using (true);
create policy "anon read" on public.tft_tournaments for select to public using (true);

-- ------------------------------------------------------------- 4. Funktionen
-- Original-ACL war `=X/postgres` (PUBLIC) plus die abgeleiteten Eintraege fuer
-- anon/authenticated/service_role. `grant ... to public` stellt genau das her.
grant execute on function public.bump_tft_public_comp_views(uuid) to public;
grant execute on function public.get_tft_augment_stats(text[],text[],integer,text,integer,integer) to public;
grant execute on function public.get_tft_available_patches(integer) to public;
grant execute on function public.get_tft_comp_daily_trend(text,text[],text[],integer,text[],integer) to public;
grant execute on function public.get_tft_comp_daily_trend(text,text[],text[],integer) to public;
grant execute on function public.get_tft_comp_pairs(text[],integer,text,integer,integer) to public;
grant execute on function public.get_tft_comp_stats(text[],text[],integer,text,integer,integer) to public;
grant execute on function public.get_tft_comp_stats_for_diff(text[],text[],integer,text,integer,integer) to public;
grant execute on function public.get_tft_comp_stats_list(text[],text[],integer,text,integer,integer) to public;
grant execute on function public.get_tft_comp_velocity(text[],text[],integer,text,integer,integer,integer,integer) to public;
grant execute on function public.get_tft_comp_velocity(text[],text[],integer,text,integer,integer,integer) to public;
grant execute on function public.get_tft_distinct_patches_for_set(integer) to public;
grant execute on function public.get_tft_item_stats(text[],text[],integer,text,integer) to public;
grant execute on function public.get_tft_item_stats_list(text[],text[],integer,text,integer) to public;
grant execute on function public.get_tft_item_velocity(text[],text[],integer,text,integer,integer,integer,integer) to public;
grant execute on function public.get_tft_item_velocity(text[],text[],integer,text,integer,integer,integer) to public;
grant execute on function public.get_tft_latest_marketvalues(text,integer) to public;
grant execute on function public.get_tft_marketvalue_history(text,text,integer) to public;
grant execute on function public.get_tft_marketvalue_movers(text,integer,text,integer) to public;
grant execute on function public.get_tft_marketvalue_sparklines(text,integer,integer) to public;
grant execute on function public.get_tft_pro_aggregates() to public;
grant execute on function public.get_tft_pro_players(text,text,text,integer) to public;
grant execute on function public.get_tft_pro_validation_summary() to public;
grant execute on function public.get_tft_pros_classified(text[],text,text,integer,integer) to public;
grant execute on function public.get_tft_public_comps(text,text,integer,integer) to public;
grant execute on function public.get_tft_region_divergence(text[],integer,text,integer,integer) to public;
grant execute on function public.get_tft_team_marketvalues(text,integer) to public;
grant execute on function public.get_tft_tournament_detail(text) to public;
grant execute on function public.get_tft_tournaments(text,text,text,integer,integer) to public;
grant execute on function public.get_tft_trait_stats(text[],text[],integer,text,integer) to public;
grant execute on function public.get_tft_trait_unitcount_stats(text[],text[],integer,text,integer,text) to public;
grant execute on function public.get_tft_trait_velocity(text[],text[],integer,text,integer,integer,integer,integer) to public;
grant execute on function public.get_tft_unit_stats(text[],text[],integer,text,integer) to public;
grant execute on function public.get_tft_unit_velocity(text[],text[],integer,text,integer,integer,integer,integer) to public;
grant execute on function public.tft_position_unit_cell_data() to public;

notify pgrst, 'reload schema';
