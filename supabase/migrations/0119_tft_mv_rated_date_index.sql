-- 0119: Index fuer den Vertrag marketvalue/supabase-mirror (2026-11-08)
--
-- NUR SUPABASE. Ueber db-exec (Anweisung fuer Anweisung, ohne Transaktion),
-- NICHT ueber apply-migrations.mjs: das packt die Datei in begin/commit, und
-- create index concurrently scheitert dort.
--   node scripts/db-exec.mjs supabase/migrations/0119_tft_mv_rated_date_index.sql
--
-- WARUM: Der Vertrag fragt ueber die Datenschnittstelle
-- `order=snapshot_date.desc.nullslast&limit=1` mit rated=eq.true und zaehlt die
-- bewerteten Zeilen des letzten Tages (scripts/lib/contracts.mjs supaMaxDate,
-- supaMaxDateBefore, supaCount). Gemessen 08.11.: Tabelle 6666 MB, 3,56 Mio
-- Zeilen, kein Index beginnt mit snapshot_date. Beide Abfragen liefen ueber die
-- ganze Tabelle und brachen nach 20 s mit 57014 ab — der Vertrag stand rot,
-- obwohl der Abgleich lief.
--
-- `desc nulls last`, weil PG 17 eine Sortierung DESC NULLS LAST nicht aus einem
-- DESC-Index (= nulls first) bedient, auch wenn die Spalte NOT NULL ist
-- (EXPLAIN 08.11.: sonst Sortierung ueber 385k Zeilen). Kein Teil-Index: rated
-- ist bei 99 % der Zeilen true (pg_stats), und die Datenschnittstelle reicht
-- den Wert als Parameter durch — ein Teil-Index waere dann nicht sicher nutzbar.
-- rated steht im include, damit die Tageszaehlung nur den Index liest.
--
-- Ein abgebrochener Lauf hinterlaesst einen ungueltigen Index; der DO-Block
-- vorne raeumt ihn beim naechsten Lauf weg (Muster 0089).
--
-- Rollback: drop index concurrently if exists idx_tft_mv_snapshot_date_rated;

set statement_timeout = 0;
set lock_timeout = '5s';

do $$
begin
  if exists (
    select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
    where c.relname = 'idx_tft_mv_snapshot_date_rated' and not i.indisvalid
  ) then
    drop index idx_tft_mv_snapshot_date_rated;
  end if;
end
$$;

set lock_timeout = 0;

create index concurrently if not exists idx_tft_mv_snapshot_date_rated
  on tft_player_marketvalue_snapshots (snapshot_date desc nulls last)
  include (rated);
