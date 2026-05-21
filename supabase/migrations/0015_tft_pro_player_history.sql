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

-- Redefine list RPC to surface the new fields so the /tft/pros page and
-- detail view can render images, earnings, and tournament history without
-- a second query. Drop first because the return type changes (Postgres
-- forbids changing RETURNS columns via CREATE OR REPLACE).
drop function if exists get_tft_pro_players(text, text, text, int);
create or replace function get_tft_pro_players(
  p_region text default null,
  p_team   text default null,
  p_role   text default null,
  p_limit  int default 500
) returns table (
  puuid text,
  pro_name text,
  real_name text,
  region text,
  riot_id text,
  team text,
  role text,
  country text,
  source text,
  twitch_handle text,
  twitter_handle text,
  youtube_handle text,
  instagram_handle text,
  tournament_results jsonb,
  total_earnings_usd numeric,
  image_url text,
  last_validated_at timestamptz
) language sql stable as $$
  select
    puuid, pro_name, real_name, region, riot_id, team, role, country, source,
    twitch_handle, twitter_handle, youtube_handle, instagram_handle,
    tournament_results, total_earnings_usd, image_url, last_validated_at
  from tft_pro_players
  where (p_region is null or region = p_region)
    and (p_team   is null or team   = p_team)
    and (p_role   is null or role   = p_role)
  order by total_earnings_usd desc nulls last, lower(pro_name) asc
  limit p_limit
$$;
