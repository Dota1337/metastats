-- Schliesst die letzte offene Lesetuer, die nach der Sicherheitswelle C5
-- (0055_revoke_anon_read.sql) wieder aufgegangen ist.
--
-- tft_player_marketvalue_peaks entstand am 26.08.2026 mit 0061 — also NACH dem
-- Zusperren — und hat das alte offene Muster mitkopiert:
--
--   create policy "anon read" on tft_player_marketvalue_peaks
--     for select using (true);              -- 0061, Zeile 67
--
-- `using (true)` ohne `to`-Klausel heisst Rolle PUBLIC, und PUBLIC trifft jede
-- Rolle. Deshalb meldet security_anon_leaks() aus 0056 fuer diese EINE Policy
-- zwei Befunde (anon und authenticated) — siehe 0056, Zeilen 62 und 75:
--   and (p.polroles = '{0}'::oid[] or r.oid = any (p.polroles))
--
-- Kein Lesepfad haengt daran. Geprueft am 2026-09-01:
--   grep -rn "tft_player_marketvalue_peaks" app scripts supabase
-- findet nur die Migration und das schreibende Skript, und das schreibt ueber
-- eine direkte Postgres-Verbindung mit DATABASE_URL/SUPABASE_DB_URL, nicht
-- ueber PostgREST. Der oeffentliche Schluessel braucht die Tabelle also nicht.
--
-- Rueckweg: supabase/rollback/0066_revoke_anon_peaks_rollback.sql

drop policy if exists "anon read" on public.tft_player_marketvalue_peaks;

revoke select on public.tft_player_marketvalue_peaks from anon, authenticated;

-- PostgREST cached das Schema. Ohne dieses Signal antwortet der Endpoint noch
-- Minuten weiter mit Daten, und die Nachpruefung sieht faelschlich einen
-- Fehlschlag.
notify pgrst, 'reload schema';
