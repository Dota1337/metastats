-- Rollback zu supabase/migrations/0066_revoke_anon_peaks.sql
--
-- Nicht automatisch angewendet — bewusst ausserhalb von supabase/migrations,
-- damit `node scripts/apply-migrations.mjs` die Datei nicht mitzieht.
-- Stellt den Stand aus 0061 wieder her: oeffentliches Leserecht auf
-- tft_player_marketvalue_peaks.
--
-- Anwenden:
--   node scripts/db-exec.mjs supabase/rollback/0066_revoke_anon_peaks_rollback.sql
--
-- Danach meldet der Vertrag sicherheit/anon-lockout wieder 2 Befunde — das ist
-- dann erwartet, nicht neu.

grant select on public.tft_player_marketvalue_peaks to anon, authenticated;

create policy "anon read" on public.tft_player_marketvalue_peaks
  for select using (true);

notify pgrst, 'reload schema';
