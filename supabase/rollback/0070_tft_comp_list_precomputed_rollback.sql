-- Rollback zu supabase/migrations/0070_tft_comp_list_precomputed.sql
--
-- Nicht automatisch angewendet — bewusst ausserhalb von supabase/migrations.
--
-- Anwenden:
--   node scripts/db-exec.mjs supabase/rollback/0070_tft_comp_list_precomputed_rollback.sql
--
-- Reihenfolge: ZUERST den Lesepfad abschalten (Vercel-Env
-- TFT_COMP_PRECOMPUTED_DISABLED=1 oder Code zurueck) und die ExecStartPre-Zeile
-- aus infra/hetzner/metastats-snapshot-publisher.service entfernen. Die Route
-- faellt bei fehlender Funktion zwar auf die Live-Abfrage zurueck, loggt aber
-- dann bei jeder schweren Anfrage einen Fehler.

drop function if exists public.get_tft_comp_list_precomputed(text, int, text, text, int);
drop table if exists public.tft_comp_list_precomputed;

notify pgrst, 'reload schema';
