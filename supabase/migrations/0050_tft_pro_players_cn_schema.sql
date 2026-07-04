-- 0050: CN-pro support — pros without a Riot PUUID (2026-07-04, user decision).
--
-- Riot's public API does not cover the Chinese server, so CN pros can never
-- resolve to a PUUID — but they dominate the tournament data (221 CN Liquipedia
-- pages match 1,423 previously puuid-less tft_tournament_results rows).
-- Schema variant B2 (architect + data-skeptic reviewed):
--   * surrogate identity PK (technical key ONLY — business keys stay
--     puuid/source_page — nothing may ever JOIN on id across tables)
--   * puuid nullable + UNIQUE (CN rows carry NULL — honest, no synthetic keys —
--     feedback_no_fake_values)
--   * riot_id nullable (CN pros have none)
--   * source_page UNIQUE, FULL index (PostgREST on_conflict cannot use partial
--     indexes — NULLs are distinct so the 2 manual streamer rows don't collide).
--     Precheck 2026-07-04: 0 duplicate source_pages, 0 liquipedia rows with
--     NULL source_page.
-- Upsert contract after this migration: liquipedia rows upsert on
-- on_conflict=source_page (puuid-upgrade = normal UPDATE), manual rows stay on
-- on_conflict=puuid. Deploy order is STRICT: this migration (incl. pgrst
-- reload) BEFORE the script changes — on_conflict=source_page 400s without the
-- unique constraint.

alter table tft_pro_players drop constraint tft_pro_players_pkey;

-- The implicit NOT NULL from the old PK survives the constraint drop — lift it
-- explicitly.
alter table tft_pro_players alter column puuid drop not null;

alter table tft_pro_players
  add column id bigint generated always as identity primary key;

alter table tft_pro_players
  add constraint tft_pro_players_puuid_key unique (puuid);

alter table tft_pro_players alter column riot_id drop not null;

alter table tft_pro_players
  add constraint tft_pro_players_source_page_key unique (source_page);

comment on column tft_pro_players.id is
  'Technical PK only (surrogate). Business keys remain puuid (Riot-resolvable pros) and source_page (Liquipedia rows). Never join other tables on id.';
comment on column tft_pro_players.region is
  'Riot platform routing (na1, euw1, kr, …) OR the non-Riot marker ''cn'' for Chinese-server pros. Invariant: region=''cn'' implies puuid IS NULL — every Riot-API consumer is guarded by its puuid check.';

notify pgrst, 'reload schema';
