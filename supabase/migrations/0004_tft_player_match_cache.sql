-- Per-player match cache so the season-stats endpoint doesn't have to walk
-- 1000 match-detail calls on every visit. After the first 50s warm-up, all
-- subsequent reads just diff the player's recent ids against the cache and
-- pull only the new ones — typically 1-2s wall time.
--
-- Also breaks Riot's 1000-id-per-puuid history cap: once we've seen and
-- stored a match it stays cached, so even if Riot evicts the id from
-- their list we keep the aggregate.

-- One row per (puuid, match_id). The participant-side fields are flattened
-- because they're the only ones the aggregator reads. units / augments /
-- traits stay as jsonb so we don't need a schema change if Riot adds more
-- per-unit fields.
create table if not exists tft_player_match_cache (
  puuid text not null,
  match_id text not null,
  region text not null,
  set_number int not null,
  queue_id int not null,
  game_datetime bigint not null,
  placement int not null,
  level int not null,
  gold_left int not null,
  players_eliminated int not null,
  total_damage int not null,
  last_round int not null,
  units jsonb not null default '[]'::jsonb,
  augments jsonb not null default '[]'::jsonb,
  traits jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now(),
  primary key (puuid, match_id)
);

-- Primary read path: list-all-matches-for-this-player-and-set, newest first.
create index if not exists idx_tft_player_match_cache_lookup
  on tft_player_match_cache(puuid, set_number, queue_id, game_datetime desc);

-- Per-player fetch metadata so the endpoint can decide whether to skip the
-- recent-ids check entirely (e.g. we fetched <10min ago). Also lets the
-- pre-warm crawler resume after partial failures without re-walking
-- everything.
create table if not exists tft_player_fetch_state (
  puuid text not null,
  region text not null,
  last_fetched_at timestamptz not null default now(),
  latest_match_id text,
  total_cached_matches int not null default 0,
  primary key (puuid, region)
);

create index if not exists idx_tft_player_fetch_state_stale
  on tft_player_fetch_state(last_fetched_at);

alter table tft_player_match_cache  enable row level security;
alter table tft_player_fetch_state  enable row level security;

create policy "anon read" on tft_player_match_cache for select using (true);
create policy "anon read" on tft_player_fetch_state for select using (true);
