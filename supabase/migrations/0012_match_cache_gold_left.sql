-- Add gold_left to the Supabase mirror of the match cache, so any code path
-- that still reads from Supabase (app/api/tft/player-stats) gets the same
-- shape as Hetzner. Hetzner migration was applied separately.
alter table tft_player_match_cache
  add column if not exists gold_left int;
