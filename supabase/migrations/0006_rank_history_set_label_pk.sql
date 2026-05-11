-- Mid-sets like "TFTSet9_2" (Horizonbound) and base sets like "TFTSet9"
-- (Runeterra Reforged) share the same set_number=9 in our schema, which
-- broke the (puuid, set_number, queue_id) primary key — metatft returns
-- both as distinct rating_history entries for active players. Switch the
-- primary key to use set_label (the raw "TFTSet9_2" string) so mid-sets
-- get their own row.

drop table if exists tft_player_rank_history;

create table tft_player_rank_history (
  puuid text not null,
  region text not null,
  set_number int not null,
  set_label text not null,                  -- 'TFTSet9' vs 'TFTSet9_2' is the differentiator
  queue_id int not null,
  peak_tier text,
  peak_division text,
  peak_lp int,
  peak_rating_label text,
  total_games int,
  source text not null,
  fetched_at timestamptz not null default now(),
  primary key (puuid, set_label, queue_id)
);
create index if not exists idx_tft_rank_history_puuid
  on tft_player_rank_history(puuid, set_number desc);

alter table tft_player_rank_history enable row level security;
create policy "anon read" on tft_player_rank_history for select using (true);

-- Clear backfill state so puuids that errored out earlier get re-tried on
-- their next stats request instead of waiting 24h.
delete from tft_player_rank_backfill_state where metatft_status = 'error';
