-- Rollback zu 0087: Detail-RPC auf den 0077-Stand (ohne awards), Tabelle weg.
-- Zuerst den Code zuruecksetzen, der awards liest/schreibt — sonst schlagen
-- Crawler und Seite auf die fehlende Tabelle.

drop function if exists public.get_tft_tournament_detail(text);
create function public.get_tft_tournament_detail(p_id text)
returns table (
  id text, liquipedia_page text, name text, tier text, region text, set_number int,
  start_date date, end_date date, status text, prize_pool_usd integer, prize_pool_native numeric,
  prize_pool_currency text, twitch_channel text, format text, num_participants int, logo_url text,
  source text, results jsonb, live_standings jsonb
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
      from tft_tournament_live_standings s where s.tournament_id = t.id), '[]'::jsonb) as live_standings
  from tft_tournaments t where t.id = p_id
$$;

revoke execute on function public.get_tft_tournament_detail(text) from public, anon, authenticated;

drop table if exists public.tft_tournament_awards;

notify pgrst, 'reload schema';
