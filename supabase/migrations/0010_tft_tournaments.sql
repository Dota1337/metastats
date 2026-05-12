-- TFT esports tournament registry (2026-05-12).
-- Sourced from Liquipedia (primary) via wikitext-parse for now; the schema
-- is REST-API-shaped so when we get a Liquipedia API key the crawler can
-- switch sources without a migration. Joins to tft_pro_players via puuid
-- so any pro who appears in a tournament gets their match-history /
-- marketvalue linked automatically from the standings.

create table if not exists tft_tournaments (
  id                text primary key,                     -- liquipedia-slug, e.g. 'esports-world-cup-2026'
  liquipedia_page   text not null,                        -- exact wiki page title for re-fetching
  name              text not null,
  tier              text,                                 -- 'S' | 'A' | 'B' | 'C' (Liquipedia tiering)
  region            text,                                 -- 'AMER' | 'EMEA' | 'APAC' | 'INT' | 'CN'
  set_number        int,
  start_date        date,
  end_date          date,
  status            text not null default 'upcoming',     -- 'upcoming' | 'live' | 'past'
  prize_pool_usd    integer,
  twitch_channel    text,
  format            text,                                 -- short freeform: 'Swiss + Top 8 Bracket'
  num_participants  int,
  logo_url          text,                                 -- normalized CD-style or absolute
  source            text not null default 'liquipedia',   -- 'liquipedia' | 'manual'
  last_validated_at timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

create index if not exists idx_tft_tournaments_status     on tft_tournaments(status, start_date desc);
create index if not exists idx_tft_tournaments_region     on tft_tournaments(region);
create index if not exists idx_tft_tournaments_set        on tft_tournaments(set_number);
create index if not exists idx_tft_tournaments_dates      on tft_tournaments(start_date desc);

-- One row per placement. pro_puuid is the join key against tft_pro_players —
-- nullable because not every tournament participant has a verified TFT-pro
-- record yet (we crawl liquipedia faster than the pro list grows).
create table if not exists tft_tournament_results (
  tournament_id  text not null references tft_tournaments(id) on delete cascade,
  placement      int not null,                           -- 1, 2, 3, …
  pro_name       text not null,                          -- whatever Liquipedia uses (display)
  pro_puuid      text,                                   -- joins to tft_pro_players.puuid
  team           text,
  country        text,
  prize_usd      integer,
  primary key (tournament_id, placement, pro_name)
);

create index if not exists idx_tft_tournament_results_tournament on tft_tournament_results(tournament_id);
create index if not exists idx_tft_tournament_results_puuid      on tft_tournament_results(pro_puuid) where pro_puuid is not null;

alter table tft_tournaments         enable row level security;
alter table tft_tournament_results  enable row level security;
create policy "anon read" on tft_tournaments        for select using (true);
create policy "anon read" on tft_tournament_results for select using (true);

-- RPC: list tournaments with optional filters. Status defaults to omit nothing
-- so the page can sort the unified list into its own status sections.
create or replace function get_tft_tournaments(
  p_status text default null,
  p_region text default null,
  p_tier   text default null,
  p_set    int  default null,
  p_limit  int  default 200
) returns table (
  id text,
  liquipedia_page text,
  name text,
  tier text,
  region text,
  set_number int,
  start_date date,
  end_date date,
  status text,
  prize_pool_usd integer,
  twitch_channel text,
  format text,
  num_participants int,
  logo_url text,
  source text
) language sql stable as $$
  select id, liquipedia_page, name, tier, region, set_number,
         start_date, end_date, status, prize_pool_usd, twitch_channel,
         format, num_participants, logo_url, source
  from tft_tournaments
  where (p_status is null or status = p_status)
    and (p_region is null or region = p_region)
    and (p_tier   is null or tier   = p_tier)
    and (p_set    is null or set_number = p_set)
  order by start_date desc nulls last
  limit p_limit
$$;

-- RPC: detail view — tournament + its full standings list. One round-trip
-- so the detail page doesn't need a second query for results.
create or replace function get_tft_tournament_detail(p_id text)
returns table (
  -- tournament fields
  id text,
  liquipedia_page text,
  name text,
  tier text,
  region text,
  set_number int,
  start_date date,
  end_date date,
  status text,
  prize_pool_usd integer,
  twitch_channel text,
  format text,
  num_participants int,
  logo_url text,
  source text,
  -- results jsonb so we don't fan out into N rows for one tournament
  results jsonb
) language sql stable as $$
  select
    t.id, t.liquipedia_page, t.name, t.tier, t.region, t.set_number,
    t.start_date, t.end_date, t.status, t.prize_pool_usd, t.twitch_channel,
    t.format, t.num_participants, t.logo_url, t.source,
    coalesce(
      (select jsonb_agg(jsonb_build_object(
        'placement', r.placement,
        'proName',   r.pro_name,
        'proPuuid',  r.pro_puuid,
        'team',      r.team,
        'country',   r.country,
        'prizeUsd',  r.prize_usd
      ) order by r.placement asc)
       from tft_tournament_results r
       where r.tournament_id = t.id),
      '[]'::jsonb
    ) as results
  from tft_tournaments t
  where t.id = p_id
$$;
