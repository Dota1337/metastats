-- 0055: Anon-Leserechte entziehen (Sicherheitswelle C5)
--
-- Ausgangslage: der Anon-Key steht im Browser-Bundle und ist damit oeffentlich.
-- Bisher durfte die Rolle `anon` 22 Tabellen per Policy komplett lesen — darunter
-- `tft_player_match_cache` mit ~51 GB Rohmatches. Jeder mit dem Key konnte den
-- Bestand ueber PostgREST seitenweise abziehen; nichts davon braucht die Website,
-- seit alle Routen ueber den Service-Role-Client laufen (siehe app/lib/supabase.ts).
--
-- Drei Riegel, jeder allein waere unvollstaendig:
--   1. Policies loeschen  — RLS an + keine Policy = 0 Zeilen fuer die Rolle.
--   2. `tft_position_unit_cell` ist eine VIEW, keine Tabelle — RLS laesst sich
--      dort nicht anschalten, und sie laeuft mit den Rechten ihres Eigentuemers,
--      umgeht die RLS der Basistabellen also ohnehin. Fuer sie ist der
--      Grant-Entzug der einzige Riegel.
--   3. SELECT-Grant entziehen — ohne Grant kommt PostgREST gar nicht erst zur
--      Zeilenpruefung; das spart auch die Last der Abfrage.
--
-- `authenticated` faellt mit, weil sich jeder selbst ein Konto anlegen kann und
-- damit in diese Rolle rutscht. Angemeldete Nutzer lesen ihre eigenen Daten
-- ueber `matches` (eigene Owner-Policies, hier nicht angefasst).
--
-- Zusaetzlich: EXECUTE auf allen public-Funktionen von PUBLIC/anon/authenticated
-- entziehen. Die meisten laufen als SECURITY INVOKER und lieferten nach Schritt 1-3
-- ohnehin nichts mehr — der Entzug verhindert, dass die Abfrage ueberhaupt startet
-- (billige Last-Achse). Zwei Funktionen sind SECURITY DEFINER und umgehen RLS
-- vollstaendig: `get_tft_pro_validation_summary()` und `tft_position_unit_cell_data()`.
-- Fuer die beiden ist der Entzug der einzige Riegel.
--
-- service_role und postgres behalten alles (eigene, explizite Grants in der ACL).
-- Rollback: supabase/rollback/0055_revoke_anon_read_rollback.sql

-- ---------------------------------------------------------------- 1. Policies
drop policy if exists "anon read" on public.site_config;
drop policy if exists "site_config anon read" on public.site_config;
drop policy if exists "anon read" on public.tft_daily_augment_stats;
drop policy if exists "anon read" on public.tft_daily_comp_pairs;
drop policy if exists "anon read" on public.tft_daily_comp_stats;
drop policy if exists "anon read" on public.tft_daily_crawl_meta;
drop policy if exists "anon read" on public.tft_daily_item_stats;
drop policy if exists "anon read" on public.tft_daily_trait_stats;
drop policy if exists "anon read" on public.tft_daily_trait_unitcount_stats;
drop policy if exists "anon read" on public.tft_daily_unit_stats;
drop policy if exists "anon read" on public.tft_mv_population_stats;
drop policy if exists "anon read" on public.tft_player_fetch_state;
drop policy if exists "anon read" on public.tft_player_marketvalue_snapshots;
drop policy if exists "anon read" on public.tft_player_match_cache;
drop policy if exists "anon read" on public.tft_player_rank_backfill_state;
drop policy if exists "anon read" on public.tft_player_rank_history;
drop policy if exists "anon read" on public.tft_player_season_stats;
drop policy if exists "anon read" on public.tft_position_comp_cell;
drop policy if exists "anon read" on public.tft_pro_players;
drop policy if exists "anon read" on public.tft_public_comp_upvotes;
drop policy if exists "anon read" on public.tft_public_comps;
drop policy if exists "anon read" on public.tft_tournament_results;
drop policy if exists "anon read" on public.tft_tournaments;

-- ---------------------------------------------------------------- 3. Grants
revoke select on public.site_config from anon, authenticated;
revoke select on public.tft_daily_augment_stats from anon, authenticated;
revoke select on public.tft_daily_comp_pairs from anon, authenticated;
revoke select on public.tft_daily_comp_stats from anon, authenticated;
revoke select on public.tft_daily_crawl_meta from anon, authenticated;
revoke select on public.tft_daily_item_stats from anon, authenticated;
revoke select on public.tft_daily_trait_stats from anon, authenticated;
revoke select on public.tft_daily_trait_unitcount_stats from anon, authenticated;
revoke select on public.tft_daily_unit_stats from anon, authenticated;
revoke select on public.tft_mv_population_stats from anon, authenticated;
revoke select on public.tft_player_fetch_state from anon, authenticated;
revoke select on public.tft_player_marketvalue_snapshots from anon, authenticated;
revoke select on public.tft_player_match_cache from anon, authenticated;
revoke select on public.tft_player_rank_backfill_state from anon, authenticated;
revoke select on public.tft_player_rank_history from anon, authenticated;
revoke select on public.tft_player_season_stats from anon, authenticated;
revoke select on public.tft_position_comp_cell from anon, authenticated;
revoke select on public.tft_position_unit_cell from anon, authenticated;
revoke select on public.tft_pro_players from anon, authenticated;
revoke select on public.tft_public_comp_upvotes from anon, authenticated;
revoke select on public.tft_public_comps from anon, authenticated;
revoke select on public.tft_tournament_results from anon, authenticated;
revoke select on public.tft_tournaments from anon, authenticated;

-- ------------------------------------------------------------- 4. Funktionen
-- Ueberladungen brauchen je eine eigene Zeile (comp_daily_trend, comp_velocity,
-- item_velocity je zweimal). get_metatft_family_coverage fehlt bewusst — die
-- Funktion ist bereits auf postgres + service_role beschraenkt.
revoke execute on function public.bump_tft_public_comp_views(uuid) from public, anon, authenticated;
revoke execute on function public.get_tft_augment_stats(text[],text[],integer,text,integer,integer) from public, anon, authenticated;
revoke execute on function public.get_tft_available_patches(integer) from public, anon, authenticated;
revoke execute on function public.get_tft_comp_daily_trend(text,text[],text[],integer,text[],integer) from public, anon, authenticated;
revoke execute on function public.get_tft_comp_daily_trend(text,text[],text[],integer) from public, anon, authenticated;
revoke execute on function public.get_tft_comp_pairs(text[],integer,text,integer,integer) from public, anon, authenticated;
revoke execute on function public.get_tft_comp_stats(text[],text[],integer,text,integer,integer) from public, anon, authenticated;
revoke execute on function public.get_tft_comp_stats_for_diff(text[],text[],integer,text,integer,integer) from public, anon, authenticated;
revoke execute on function public.get_tft_comp_stats_list(text[],text[],integer,text,integer,integer) from public, anon, authenticated;
revoke execute on function public.get_tft_comp_velocity(text[],text[],integer,text,integer,integer,integer,integer) from public, anon, authenticated;
revoke execute on function public.get_tft_comp_velocity(text[],text[],integer,text,integer,integer,integer) from public, anon, authenticated;
revoke execute on function public.get_tft_distinct_patches_for_set(integer) from public, anon, authenticated;
revoke execute on function public.get_tft_item_stats(text[],text[],integer,text,integer) from public, anon, authenticated;
revoke execute on function public.get_tft_item_stats_list(text[],text[],integer,text,integer) from public, anon, authenticated;
revoke execute on function public.get_tft_item_velocity(text[],text[],integer,text,integer,integer,integer,integer) from public, anon, authenticated;
revoke execute on function public.get_tft_item_velocity(text[],text[],integer,text,integer,integer,integer) from public, anon, authenticated;
revoke execute on function public.get_tft_latest_marketvalues(text,integer) from public, anon, authenticated;
revoke execute on function public.get_tft_marketvalue_history(text,text,integer) from public, anon, authenticated;
revoke execute on function public.get_tft_marketvalue_movers(text,integer,text,integer) from public, anon, authenticated;
revoke execute on function public.get_tft_marketvalue_sparklines(text,integer,integer) from public, anon, authenticated;
revoke execute on function public.get_tft_pro_aggregates() from public, anon, authenticated;
revoke execute on function public.get_tft_pro_players(text,text,text,integer) from public, anon, authenticated;
revoke execute on function public.get_tft_pro_validation_summary() from public, anon, authenticated;
revoke execute on function public.get_tft_pros_classified(text[],text,text,integer,integer) from public, anon, authenticated;
revoke execute on function public.get_tft_public_comps(text,text,integer,integer) from public, anon, authenticated;
revoke execute on function public.get_tft_region_divergence(text[],integer,text,integer,integer) from public, anon, authenticated;
revoke execute on function public.get_tft_team_marketvalues(text,integer) from public, anon, authenticated;
revoke execute on function public.get_tft_tournament_detail(text) from public, anon, authenticated;
revoke execute on function public.get_tft_tournaments(text,text,text,integer,integer) from public, anon, authenticated;
revoke execute on function public.get_tft_trait_stats(text[],text[],integer,text,integer) from public, anon, authenticated;
revoke execute on function public.get_tft_trait_unitcount_stats(text[],text[],integer,text,integer,text) from public, anon, authenticated;
revoke execute on function public.get_tft_trait_velocity(text[],text[],integer,text,integer,integer,integer,integer) from public, anon, authenticated;
revoke execute on function public.get_tft_unit_stats(text[],text[],integer,text,integer) from public, anon, authenticated;
revoke execute on function public.get_tft_unit_velocity(text[],text[],integer,text,integer,integer,integer,integer) from public, anon, authenticated;
revoke execute on function public.tft_position_unit_cell_data() from public, anon, authenticated;

-- PostgREST cached das Schema samt Rechten; ohne Reload greift der Entzug
-- erst beim naechsten Neustart des Dienstes.
notify pgrst, 'reload schema';
