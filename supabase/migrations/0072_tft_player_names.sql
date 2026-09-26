-- Namensverzeichnis fuer die TFT-Spielersuche (Plan 26.09.2026).
--
-- Warum: Die Suche soll beim Tippen alle Konten mit dem Namen ueber alle
-- Server zeigen (wie lolchess). Heute gibt es nur die Marktwert-Snapshots
-- (Diamant+, 29.240 Namen in 7 Tagen) ohne Namens-Index — eine Namensabfrage
-- dauerte 13,3 s. Der Daily-Crawl sieht dagegen ~525k Teilnehmer am Tag, und
-- Match-V1 liefert riotIdGameName/riotIdTagline fuer jeden davon.
--
-- Schreibweg: collect-tft-allranks.mjs ruft upsert_tft_player_names() in
-- Stapeln. Die Funktion schreibt eine Zeile nur, wenn sich Name, Tag, Region
-- oder Rang geaendert haben oder last_seen aelter als 7 Tage ist — ein naives
-- Upsert haette jeden Tag ~500k tote Zeilen erzeugt (perf-critic).
--
-- Rang: nur fuer Spieler, deren Rang der Crawl wirklich kennt (Saat-Spieler
-- aus der Liga-Liste) oder der Snapshot. Nie aus dem Lobby-Rang abgeleitet.
--
-- name_norm ist COLLATE "C": dann ist die Praefix-Suche ein Bereichs-Scan
-- (>= p, < p || U+10FFFF), der den Index auch im generischen Plan der
-- PostgREST-Aufrufe trifft. LIKE mit Parameter tut das nicht (Lehre aus 0071).

set statement_timeout = 0;

create or replace function public.tft_name_norm(p text)
returns text
language sql immutable parallel safe as $$
  select lower(regexp_replace(normalize(coalesce(p, ''), NFKC), '\s', '', 'g'))
$$;

create table if not exists public.tft_player_names (
  puuid        text        primary key,
  game_name    text        not null,
  tag_line     text        not null,
  name_norm    text        collate "C" not null,
  region       text        not null,
  tier         text,
  division     text,
  lp           integer,
  rank_seen_at timestamptz,
  last_seen    timestamptz not null
);

create index if not exists idx_tft_player_names_norm
  on public.tft_player_names (name_norm)
  include (game_name, tag_line, region, tier, division, lp, rank_seen_at, last_seen);

alter table public.tft_player_names enable row level security;
revoke all on public.tft_player_names from anon, authenticated;

-- Taegliche Aenderungen sind klein gegen den Bestand; frueher aufraeumen,
-- damit die Sichtbarkeits-Karte fuer den Index-Only-Scan frisch bleibt.
alter table public.tft_player_names set (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02
);

-- p_rows: [{puuid, game_name, tag_line, region, tier?, division?, lp?, last_seen}]
-- Rueckgabe: Anzahl tatsaechlich geschriebener Zeilen.
create or replace function public.upsert_tft_player_names(p_rows jsonb)
returns integer
language plpgsql as $$
declare
  n integer;
begin
  with src as (
    select distinct on (r.puuid)
      r.puuid, r.game_name, r.tag_line, lower(r.region) as region,
      upper(nullif(r.tier, '')) as tier, nullif(r.division, '') as division, r.lp, r.last_seen
    from jsonb_to_recordset(p_rows) as r(
      puuid text, game_name text, tag_line text, region text,
      tier text, division text, lp integer, last_seen timestamptz
    )
    where r.puuid is not null and r.puuid <> ''
      and nullif(trim(r.game_name), '') is not null
      and nullif(trim(r.tag_line), '') is not null
      and r.region is not null and r.last_seen is not null
    order by r.puuid, r.last_seen desc
  )
  insert into public.tft_player_names as t
    (puuid, game_name, tag_line, name_norm, region, tier, division, lp, rank_seen_at, last_seen)
  select s.puuid, s.game_name, s.tag_line, public.tft_name_norm(s.game_name), s.region,
         s.tier, s.division, s.lp,
         case when s.tier is not null then s.last_seen end,
         s.last_seen
  from src s
  on conflict (puuid) do update set
    game_name    = excluded.game_name,
    tag_line     = excluded.tag_line,
    name_norm    = excluded.name_norm,
    region       = excluded.region,
    tier         = coalesce(excluded.tier, t.tier),
    division     = case when excluded.tier is not null then excluded.division else t.division end,
    lp           = case when excluded.tier is not null then excluded.lp else t.lp end,
    rank_seen_at = coalesce(excluded.rank_seen_at, t.rank_seen_at),
    last_seen    = greatest(excluded.last_seen, t.last_seen)
  where excluded.last_seen >= t.last_seen
    and (
         t.game_name is distinct from excluded.game_name
      or t.tag_line  is distinct from excluded.tag_line
      or t.region    is distinct from excluded.region
      or (excluded.tier is not null and (
            t.tier     is distinct from excluded.tier
         or t.division is distinct from excluded.division
         or t.lp       is distinct from excluded.lp))
      or excluded.last_seen > t.last_seen + interval '7 days'
    );
  get diagnostics n = row_count;
  return n;
end
$$;

-- Praefix-Suche. Rang nur, wenn er hoechstens 14 Tage alt ist — ein Rang
-- aus dem Vorset waere eine falsche Angabe. Hoechster Rang zuerst, dann
-- zuletzt gesehen.
create or replace function public.search_tft_player_names(
  p_prefix text,
  p_tag    text default null,
  p_limit  integer default 10
)
returns table (
  puuid text, game_name text, tag_line text, region text,
  tier text, division text, lp integer
)
language sql stable as $$
  with q as (
    select public.tft_name_norm(p_prefix) collate "C" as lo
  ),
  hits as (
    select n.puuid, n.game_name, n.tag_line, n.region, n.last_seen,
      case when n.rank_seen_at >= now() - interval '14 days' then n.tier end as tier,
      case when n.rank_seen_at >= now() - interval '14 days' then n.division end as division,
      case when n.rank_seen_at >= now() - interval '14 days' then n.lp end as lp
    from public.tft_player_names n, q
    where length(q.lo) >= 3
      and n.name_norm >= q.lo
      and n.name_norm < q.lo || chr(1114111)
      and (p_tag is null or p_tag = '' or starts_with(lower(n.tag_line), lower(p_tag)))
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
  limit least(greatest(coalesce(p_limit, 10), 1), 25)
$$;

revoke all on function public.tft_name_norm(text) from public, anon, authenticated;
revoke all on function public.upsert_tft_player_names(jsonb) from public, anon, authenticated;
revoke all on function public.search_tft_player_names(text, text, integer) from public, anon, authenticated;
grant execute on function public.tft_name_norm(text) to service_role;
grant execute on function public.upsert_tft_player_names(jsonb) to service_role;
grant execute on function public.search_tft_player_names(text, text, integer) to service_role;

-- Einmal-Befuellung aus den Marktwert-Snapshots: neuester Name je Spieler,
-- Rang aus dem Snapshot. Laeuft ueber die Funktion, damit dieselben Regeln
-- gelten wie beim Crawl.
select public.upsert_tft_player_names(coalesce(jsonb_agg(jsonb_build_object(
  'puuid', s.puuid, 'game_name', s.game_name, 'tag_line', s.tag_line,
  'region', s.region, 'tier', s.tier, 'division', s.rank, 'lp', s.lp,
  'last_seen', s.snapshot_date::timestamptz
)), '[]'::jsonb)) as backfilled
from (
  select distinct on (puuid) puuid, game_name, tag_line, region, tier, rank, lp, snapshot_date
  from tft_player_marketvalue_snapshots
  where game_name is not null and tag_line is not null
  order by puuid, snapshot_date desc
) s;

analyze public.tft_player_names;

notify pgrst, 'reload schema';
