-- Per-player historical season ranks. Riot's API only exposes the current
-- season; older sets are backfilled once from metatft's public profile API
-- (https://api.metatft.com/public/profile/lookup_by_riotid/...). From Set 18
-- onwards we snapshot end-of-set ranks ourselves and stop relying on the
-- external source — `source` records which mechanism populated each row.

create table if not exists tft_player_rank_history (
  puuid text not null,
  region text not null,
  set_number int not null,           -- 16 for "TFTSet16", 9 for "TFTSet9", etc.
  set_label text,                    -- raw "TFTSet16" or "TFTSet9_2" identifier
  queue_id int not null,             -- 1100 = Ranked Solo (only one we surface)
  peak_tier text,                    -- 'CHALLENGER' | 'MASTER' | 'DIAMOND' | ...
  peak_division text,                -- 'I' | 'II' | 'III' | 'IV' (null for Master+)
  peak_lp int,
  peak_rating_label text,            -- raw source string ('CHALLENGER I 1566 LP')
  total_games int,
  source text not null,              -- 'metatft' | 'self_snapshot' | 'riot_live'
  fetched_at timestamptz not null default now(),
  primary key (puuid, set_number, queue_id)
);
create index if not exists idx_tft_rank_history_puuid
  on tft_player_rank_history(puuid, set_number desc);

-- Tracks whether we've already tried to backfill from metatft for a puuid,
-- and the outcome. Prevents re-hammering metatft for puuids that returned
-- no data (e.g. very new accounts) or errored.
create table if not exists tft_player_rank_backfill_state (
  puuid text primary key,
  region text not null,
  metatft_fetched_at timestamptz,
  metatft_status text,               -- 'success' | 'no_data' | 'error'
  metatft_error text,
  updated_at timestamptz not null default now()
);

alter table tft_player_rank_history          enable row level security;
alter table tft_player_rank_backfill_state   enable row level security;
create policy "anon read" on tft_player_rank_history        for select using (true);
create policy "anon read" on tft_player_rank_backfill_state for select using (true);
