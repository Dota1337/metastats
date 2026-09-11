-- Rollback zu supabase/migrations/0067_lol_player_match_cache.sql
--
-- Nicht automatisch angewendet — bewusst ausserhalb von supabase/migrations,
-- damit `node scripts/apply-migrations.mjs` die Datei nicht mitzieht.
--
-- Anwenden:
--   node scripts/db-exec.mjs supabase/rollback/0067_lol_player_match_cache_rollback.sql
--
-- ACHTUNG: `drop table` wirft die gesammelten Matches weg, und Riot gibt sie
-- NICHT noch einmal her — ueber ~950 IDs pro Account hinaus ist die Historie
-- unwiederbringlich. Vor dem Ausfuehren sichern:
--   pg_dump --table=lol_player_match_cache "$SUPABASE_DB_URL" > lol-matches.sql
--
-- Wer nur den Sammel-Job stoppen will, braucht diese Datei nicht: dafuer
-- reicht `systemctl disable --now metastats-lol-matchfill.service` auf der Box.

drop table if exists public.lol_match_fill_queue;
drop table if exists public.lol_player_match_cache;

notify pgrst, 'reload schema';
