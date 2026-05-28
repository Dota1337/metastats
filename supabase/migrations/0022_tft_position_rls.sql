-- Enable Row-Level Security on the TFT position tables (2026-05-28).
-- These were created in migrations 0013/0014 without an RLS block, so the
-- public anon key could read/write/delete them directly via PostgREST
-- (flagged by the Supabase security advisor: rls_disabled_in_public).
--
-- Access patterns (writes all go through service_role, which bypasses RLS):
--   tft_position_observations    — written by the companion submit API;
--                                  read ONLY via the security-definer view
--                                  tft_position_unit_cell, so no anon policy
--                                  is needed and the raw observer_puuid stays
--                                  unreadable through the anon key.
--   tft_position_comp_cell       — written by the aggregator; read directly by
--                                  the anon-key client (by-units API) → needs a
--                                  public SELECT policy.
--   tft_position_aggregator_state — service_role only (incremental high-water
--                                  mark) → no anon policy.

alter table tft_position_observations    enable row level security;
alter table tft_position_comp_cell        enable row level security;
alter table tft_position_aggregator_state enable row level security;

drop policy if exists "anon read" on tft_position_comp_cell;
create policy "anon read" on tft_position_comp_cell for select using (true);
