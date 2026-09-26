-- Exakte Namenssuche fuer /tft/search (Plan 27.09.2026, Teil A).
--
-- Warum eine eigene Funktion statt einer Ueberladung von
-- search_tft_player_names: PostgREST waehlt bei gleich benannten Funktionen
-- nach den uebergebenen Parametern und scheitert bei Mehrdeutigkeit
-- (architect-Befund). Die Praefix-Suche fuer das Nav-Dropdown bleibt
-- unveraendert.
--
-- Enter ohne Tag soll ALLE Konten mit genau diesem Namen zeigen, ueber alle
-- Server — ein Gleichheits-Vergleich auf name_norm trifft den Index aus 0072
-- (COLLATE "C") direkt. Reihenfolge wie bei der Praefix-Suche: hoechster Rang
-- zuerst, dann zuletzt gesehen. Rang nur, wenn hoechstens 14 Tage alt.

create or replace function public.search_tft_player_names_exact(
  p_name  text,
  p_limit integer default 50
)
returns table (
  puuid text, game_name text, tag_line text, region text,
  tier text, division text, lp integer
)
language sql stable as $$
  with q as (
    select public.tft_name_norm(p_name) collate "C" as k
  ),
  hits as (
    select n.puuid, n.game_name, n.tag_line, n.region, n.last_seen,
      case when n.rank_seen_at >= now() - interval '14 days' then n.tier end as tier,
      case when n.rank_seen_at >= now() - interval '14 days' then n.division end as division,
      case when n.rank_seen_at >= now() - interval '14 days' then n.lp end as lp
    from public.tft_player_names n, q
    where length(q.k) >= 1
      and n.name_norm = q.k
  )
  select h.puuid, h.game_name, h.tag_line, h.region, h.tier, h.division, h.lp
  from hits h
  order by
    case h.tier
      when 'CHALLENGER' then 10 when 'GRANDMASTER' then 9 when 'MASTER' then 8
      when 'DIAMOND' then 7 when 'EMERALD' then 6 when 'PLATINUM' then 5
      when 'GOLD' then 4 when 'SILVER' then 3 when 'BRONZE' then 2 when 'IRON' then 1
      else 0 end desc,
    case h.division when 'I' then 4 when 'II' then 3 when 'III' then 2 when 'IV' then 1 else 0 end desc,
    h.lp desc nulls last,
    h.last_seen desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;

revoke all on function public.search_tft_player_names_exact(text, integer) from public, anon, authenticated;
grant execute on function public.search_tft_player_names_exact(text, integer) to service_role;

notify pgrst, 'reload schema';
