-- 0037: site_config Tabelle für Cron-Jobs (LoL-Esports + Patch-Notes).
--
-- Wird von `app/api/cron/update-esports` (alle 2h) und
-- `app/api/cron/check-patches` (täglich) als simpler Key-Value-Store für
-- gecrawlte Esports-Schedules, League-Standings und Patch-Note-Caches
-- verwendet. Die UI liest daraus über die Cron-Routen, nicht direkt.
--
-- Bisher referenzierte der Code die Tabelle, sie war aber nie als Migration
-- angelegt — alle Cron-Upserts liefen ins Leere (PGRST205). Fixed by this
-- migration.
create table if not exists site_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamp with time zone not null default now()
);

-- Anon-Read ist OK — die gespeicherten Werte sind öffentliche LoL-Esports-
-- Daten (Schedule, Standings) und Patch-Notes-URLs. Keine PII, keine
-- internen Tokens.
alter table site_config enable row level security;

drop policy if exists "site_config anon read" on site_config;
create policy "site_config anon read"
  on site_config for select
  using (true);

-- Schreibrechte gehen ausschließlich über service_role (RLS-Bypass via
-- Postgres-Rolle), kein anon-Insert/Update.

-- updated_at wird beim UPSERT vom App-Code mitgesetzt (alle Cron-Routes
-- machen das schon explizit). Kein Trigger nötig — würde mit dem
-- statement-splitter-pattern des db-exec.mjs-Skripts kollidieren.

notify pgrst, 'reload schema';
