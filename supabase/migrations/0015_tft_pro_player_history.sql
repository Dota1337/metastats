-- Adds tournament history, total earnings, and profile image URL to tft_pro_players.
-- Populated by scripts/enrich-tft-pro-history.mjs from Liquipedia wikitext.
--
-- tournament_results already exists as jsonb (default '[]') from migration 0009.
-- We now formalize its element shape via a JSON schema comment, and add the
-- two scalar aggregates so cards/lists can sort/filter without unpacking the
-- array.

alter table tft_pro_players
  add column if not exists total_earnings_usd numeric(12, 2) default 0,
  add column if not exists image_url text;

comment on column tft_pro_players.tournament_results is
  'jsonb array of { tournament: text, date: text (YYYY-MM-DD), place: text, prize_usd: numeric, tier: text, page: text }';
comment on column tft_pro_players.total_earnings_usd is
  'Sum of prize_usd across tournament_results, refreshed by enrich-tft-pro-history.mjs.';
comment on column tft_pro_players.image_url is
  'Profile image URL from Liquipedia (Special:Redirect/file/...). Null when no image is set on the wiki.';

create index if not exists tft_pro_players_total_earnings_idx
  on tft_pro_players (total_earnings_usd desc);
