-- TFT pro player registry (2026-05-12).
-- Sourced from Liquipedia (primary) + manual streamer allowlist (fallback).
-- The PUUID is the join key against everything else in our schema
-- (match_cache, marketvalue_snapshots, etc.) so the rest of the site
-- can light up pro-only views by puuid lookup alone.

create table if not exists tft_pro_players (
  puuid              text primary key,
  pro_name           text not null,                 -- display ("Setsuko")
  real_name          text,                          -- when published on Liquipedia
  region             text not null,                 -- platform routing: 'na1','euw1','kr',…
  riot_id            text not null,                 -- 'setsuko1#NA1'
  team               text,                          -- nullable for free agents
  role               text,                          -- 'Player' | 'Coach' | 'Streamer' | …
  country            text,                          -- free-form ("United States", "Korea")
  source             text not null,                 -- 'liquipedia' | 'manual'
  source_page        text,                          -- e.g. 'Setsuko' (Liquipedia page title)
  twitch_handle      text,
  twitter_handle     text,
  youtube_handle     text,
  instagram_handle   text,
  tournament_results jsonb not null default '[]'::jsonb,
  last_validated_at  timestamptz not null default now(),
  created_at         timestamptz not null default now()
);

create index if not exists idx_tft_pro_region on tft_pro_players(region);
create index if not exists idx_tft_pro_team   on tft_pro_players(team);
create index if not exists idx_tft_pro_source on tft_pro_players(source);

alter table tft_pro_players enable row level security;
create policy "anon read" on tft_pro_players for select using (true);

-- RPC: list pros with optional region/team/role filters, ordered by pro_name.
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
  last_validated_at timestamptz
) language sql stable as $$
  select
    puuid, pro_name, real_name, region, riot_id, team, role, country, source,
    twitch_handle, twitter_handle, youtube_handle, instagram_handle,
    tournament_results, last_validated_at
  from tft_pro_players
  where (p_region is null or region = p_region)
    and (p_team   is null or team   = p_team)
    and (p_role   is null or role   = p_role)
  order by lower(pro_name) asc
  limit p_limit
$$;

-- RPC: count of pros per (region, team) so the listing page can power
-- its team-filter dropdown without a second query.
create or replace function get_tft_pro_aggregates()
returns table (
  region text,
  team   text,
  pro_count bigint
) language sql stable as $$
  select region, team, count(*)::bigint as pro_count
  from tft_pro_players
  group by region, team
$$;
