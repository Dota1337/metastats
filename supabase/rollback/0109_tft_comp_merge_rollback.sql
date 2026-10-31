-- Rollback 0109: Zusammenlegung der Comps entfernen. Die Seite faellt ohne RPC von
-- selbst auf getrennte Comps zurueck (Fehler wird geloggt); sauberer vorher
-- COMP_MERGE_READ=0 setzen. Tageszeilen und Katalog bleiben unberuehrt.

begin;

set local lock_timeout = '2s';

drop function if exists public.get_tft_comp_merges(p_set integer);
drop table if exists public.tft_comp_merge;

commit;
