-- 0087: Sonderpreise eines Turniers (Liquipedia AwardPrizePool) getrennt vom Platz-Preisgeld.
--
-- Beispiel: EMEA Elderwood Cup — Loescher bekam 700 $ fuer Platz 15 und
-- zusaetzlich 100 $ als "1 Win Bounty". Bis 0a781f4 landeten solche Sonderpreise
-- als erfundene Plaetze hinter den echten (Platz 33, 34, ...) in
-- tft_tournament_results; der neue Parser laesst sie dort weg und schreibt sie
-- hierher. Gezeigt wird "700 $ + 100 $ Bonus" (User "Go 3", 2026-10-06).
--
-- Eine Zeile je (Turnier, Sonderpreis, Spieler). place_name ist der Name, unter
-- dem derselbe Spieler in tft_tournament_results steht (null, wenn er dort
-- nicht vorkommt) — darueber haengt die Seite den Bonus an die richtige Zeile.
-- Preis-Spalten wie bei tft_tournament_results (0049/0077).
--
-- Geschrieben von scripts/crawl-tft-tournaments.mjs, Kurs-Nachzug und
-- Konto-Zuordnung in scripts/lib/tft-tournament-postpass.mjs, gelesen von
-- app/lib/tft-tournament-history.ts und get_tft_tournament_detail.
--
-- Rueckweg: supabase/rollback/0087_tft_tournament_awards_rollback.sql

create table if not exists public.tft_tournament_awards (
  tournament_id  text not null references public.tft_tournaments(id) on delete cascade,
  award          text not null,
  pro_name       text not null,
  link           text,
  team           text,
  country        text,
  pro_puuid      text,
  place_name     text,
  prize_usd      integer,
  prize_native   numeric,
  prize_currency text,
  fx_rate        numeric,
  fx_date        date,
  fx_source      text,
  updated_at     timestamptz not null default now(),
  primary key (tournament_id, award, pro_name)
);

create index if not exists idx_tft_tournament_awards_puuid
  on public.tft_tournament_awards(pro_puuid) where pro_puuid is not null;

alter table public.tft_tournament_awards enable row level security;
revoke all on public.tft_tournament_awards from anon, authenticated;

-- Detail-RPC wie in 0077, zusaetzlich mit awards.
drop function if exists public.get_tft_tournament_detail(text);
create function public.get_tft_tournament_detail(p_id text)
returns table (
  id text, liquipedia_page text, name text, tier text, region text, set_number int,
  start_date date, end_date date, status text, prize_pool_usd integer, prize_pool_native numeric,
  prize_pool_currency text, twitch_channel text, format text, num_participants int, logo_url text,
  source text, results jsonb, live_standings jsonb, awards jsonb
) language sql stable as $$
  select t.id, t.liquipedia_page, t.name, t.tier, t.region, t.set_number,
    t.start_date, t.end_date, t.status, t.prize_pool_usd, t.prize_pool_native,
    t.prize_pool_currency, t.twitch_channel, t.format, t.num_participants, t.logo_url, t.source,
    coalesce((select jsonb_agg(jsonb_build_object(
        'placement', r.placement,
        'proName', r.pro_name,
        'proPuuid', coalesce(r.pro_puuid, l.puuid),
        'team', r.team,
        'country', r.country,
        'prizeUsd', r.prize_usd,
        'prizeNative', r.prize_native,
        'prizeCurrency', r.prize_currency) order by r.placement asc)
      from tft_tournament_results r
      left join tft_tournament_player_links l
        on l.tournament_id = r.tournament_id and l.raw_name = r.pro_name
      where r.tournament_id = t.id), '[]'::jsonb) as results,
    coalesce((select jsonb_agg(jsonb_build_object(
        'source', s.source,
        'stage', s.stage,
        'stageOrder', s.stage_order,
        'placement', s.placement,
        'name', s.name,
        'team', s.team_prefix,
        'region', s.region,
        'points', s.points,
        'games', s.games,
        'fetchedAt', s.fetched_at) order by s.stage_order desc, s.placement asc nulls last)
      from tft_tournament_live_standings s where s.tournament_id = t.id), '[]'::jsonb) as live_standings,
    coalesce((select jsonb_agg(jsonb_build_object(
        'award', a.award,
        'proName', a.pro_name,
        'placeName', a.place_name,
        'proPuuid', coalesce(a.pro_puuid, l.puuid),
        'team', a.team,
        'country', a.country,
        'prizeUsd', a.prize_usd,
        'prizeNative', a.prize_native,
        'prizeCurrency', a.prize_currency) order by a.prize_usd desc nulls last, a.award, a.pro_name)
      from tft_tournament_awards a
      left join tft_tournament_player_links l
        on l.tournament_id = a.tournament_id and l.raw_name = a.pro_name
      where a.tournament_id = t.id), '[]'::jsonb) as awards
  from tft_tournaments t where t.id = p_id
$$;

revoke execute on function public.get_tft_tournament_detail(text) from public, anon, authenticated;

notify pgrst, 'reload schema';
