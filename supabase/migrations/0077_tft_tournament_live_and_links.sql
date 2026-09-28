-- 0077: Turniere — Kurs-Herkunft, Live-Tabellen, Name→Konto-Zuordnung (2026-09-28).
--
-- fx_source      : woher der Kurs stammt ('ecb' | 'cbc' | 'cbr' | 'usd', mit
--                  ':provisional' fuer Turniere in der Zukunft → wird nach dem
--                  Turnier neu umgerechnet, scripts/crawl-tft-tournaments.mjs).
-- standings_sources: Aussenlinks der Liquipedia-Seite auf Google-Tabellen /
--                  riot.com / apactft.com — Eingang fuer den Live-Abruf.
-- tft_tournament_live_standings: Zwischenstand waehrend eines Turniers,
--                  geschrieben von scripts/fetch-tft-live-standings.mjs (Box-Timer).
-- tft_tournament_player_links: Ergebniszeile (Turnier + Name) → Riot-Konto.
--                  Geraten aus Name + Region + Master+, deshalb NICHT in
--                  pro_puuid (das bleibt die verifizierte Pro-Zuordnung).
--                  Rueckbau: truncate.

alter table tft_tournaments
  add column if not exists fx_source text,
  add column if not exists standings_sources jsonb;

alter table tft_tournament_results
  add column if not exists fx_source text;

create table if not exists tft_tournament_live_standings (
  tournament_id text not null references tft_tournaments(id) on delete cascade,
  source        text not null,           -- 'riot-sheet' | 'apactft' | 'gsheet'
  stage         text not null,           -- Tabellenblatt / Tag
  stage_order   int  not null default 0,
  placement     int,
  raw_name      text not null,
  name          text not null,
  team_prefix   text,
  region        text,
  points        numeric,
  games         int,
  fetched_at    timestamptz not null default now(),
  primary key (tournament_id, source, stage, raw_name)
);
create index if not exists idx_tft_live_standings_tournament on tft_tournament_live_standings(tournament_id);

create table if not exists tft_tournament_player_links (
  tournament_id text not null references tft_tournaments(id) on delete cascade,
  raw_name      text not null,           -- = tft_tournament_results.pro_name
  puuid         text not null,
  method        text not null,           -- 'name-unique-master'
  created_at    timestamptz not null default now(),
  primary key (tournament_id, raw_name)
);
create index if not exists idx_tft_player_links_puuid on tft_tournament_player_links(puuid);

alter table tft_tournament_live_standings enable row level security;
alter table tft_tournament_player_links   enable row level security;
revoke all on public.tft_tournament_live_standings from anon, authenticated;
revoke all on public.tft_tournament_player_links   from anon, authenticated;

-- Liste: + Landesbetrag/Waehrung (Rueckfall, wenn kein Dollarwert).
drop function if exists public.get_tft_tournaments(text,text,text,integer,integer);
create function public.get_tft_tournaments(
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
  prize_pool_native numeric,
  prize_pool_currency text,
  twitch_channel text,
  format text,
  num_participants int,
  logo_url text,
  source text
) language sql stable as $$
  select id, liquipedia_page, name, tier, region, set_number,
         start_date, end_date, status, prize_pool_usd, prize_pool_native,
         prize_pool_currency, twitch_channel,
         format, num_participants, logo_url, source
  from tft_tournaments
  where (p_status is null or status = p_status)
    and (p_region is null or region = p_region)
    and (p_tier   is null or tier   = p_tier)
    and (p_set    is null or set_number = p_set)
  order by start_date desc nulls last
  limit p_limit
$$;

-- Detail: + Landesbetrag/Waehrung, Konto aus Zuordnung, Live-Tabelle.
drop function if exists public.get_tft_tournament_detail(text);
create function public.get_tft_tournament_detail(p_id text)
returns table (
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
  prize_pool_native numeric,
  prize_pool_currency text,
  twitch_channel text,
  format text,
  num_participants int,
  logo_url text,
  source text,
  results jsonb,
  live_standings jsonb
) language sql stable as $$
  select
    t.id, t.liquipedia_page, t.name, t.tier, t.region, t.set_number,
    t.start_date, t.end_date, t.status, t.prize_pool_usd, t.prize_pool_native,
    t.prize_pool_currency, t.twitch_channel,
    t.format, t.num_participants, t.logo_url, t.source,
    coalesce(
      (select jsonb_agg(jsonb_build_object(
        'placement',     r.placement,
        'proName',       r.pro_name,
        'proPuuid',      coalesce(r.pro_puuid, l.puuid),
        'team',          r.team,
        'country',       r.country,
        'prizeUsd',      r.prize_usd,
        'prizeNative',   r.prize_native,
        'prizeCurrency', r.prize_currency
      ) order by r.placement asc)
       from tft_tournament_results r
       left join tft_tournament_player_links l
         on l.tournament_id = r.tournament_id and l.raw_name = r.pro_name
       where r.tournament_id = t.id),
      '[]'::jsonb
    ) as results,
    coalesce(
      (select jsonb_agg(jsonb_build_object(
        'source',    s.source,
        'stage',     s.stage,
        'stageOrder', s.stage_order,
        'placement', s.placement,
        'name',      s.name,
        'team',      s.team_prefix,
        'region',    s.region,
        'points',    s.points,
        'games',     s.games,
        'fetchedAt', s.fetched_at
      ) order by s.stage_order desc, s.placement asc nulls last)
       from tft_tournament_live_standings s
       where s.tournament_id = t.id),
      '[]'::jsonb
    ) as live_standings
  from tft_tournaments t
  where t.id = p_id
$$;

revoke execute on function public.get_tft_tournament_detail(text) from public, anon, authenticated;
revoke execute on function public.get_tft_tournaments(text,text,text,integer,integer) from public, anon, authenticated;
