-- 0122: Namensverzeichnis fuer die LoL-Spielersuche (Plan Runde 12, 09.11.2026).
--
-- Warum: Die LoL-Suche (Kopfleiste, /search, Startseite, Vergleich) las bisher
-- nur tft_player_names (0072). Das fuellt der TFT-Crawl — wer nur LoL spielt,
-- fehlte. Anlass: „SQ Heimer Banga#EUW“ stand in players (Profil aufgerufen),
-- aber nicht im TFT-Verzeichnis, die Suche fand ihn nicht.
--
-- Eigene Tabelle statt tft_player_names: die puuid haengt am Riot-Schluessel.
-- Hier steht die puuid des LoL-Schluessels, dort die des TFT-Schluessels — in
-- einer Spalte waeren das zwei verschiedene Welten. Die Suchfunktionen geben
-- die puuid deshalb gar nicht erst heraus; LoL-Profile laufen ueber Name#Tag.
--
-- Schreibweg: /api/summoner (app/lib/lol-player-search-server.ts) nach jedem
-- Profilabruf, bei dem Riot Name und Server bestaetigt hat; bei „Konto nicht
-- gefunden“ wird die Zeile mit diesem Namen geloescht. Treffer der Riot-Probe
-- (TFT-Schluessel) werden NIE hier geschrieben.
--
-- Normalisierung wie 0072 ueber tft_name_norm (dieselbe Funktion, nicht
-- kopiert). Rollback 0072 darf sie deshalb erst nach Rollback 0122 entfernen.

set statement_timeout = 0;

create table if not exists public.lol_player_names (
  puuid      text        primary key,
  game_name  text        not null,
  tag_line   text        not null,
  name_norm  text        collate "C" not null,
  region     text        not null,
  last_seen  timestamptz not null
);

-- puuid steckt nicht im Index: die Suchfunktionen geben sie nicht zurueck,
-- der Index-Only-Scan braucht sie also nicht.
create index if not exists idx_lol_player_names_norm
  on public.lol_player_names (name_norm)
  include (game_name, tag_line, region, last_seen);

alter table public.lol_player_names enable row level security;
revoke all on public.lol_player_names from anon, authenticated;

-- p_rows: [{puuid, game_name, tag_line, region, last_seen}]
-- Rueckgabe: Anzahl geschriebener Zeilen.
--
-- Riot-IDs sind eindeutig: hat ein anderes Konto (andere puuid) denselben
-- Namen samt Tag mit aelterem last_seen, ist das ein umbenanntes Konto — die
-- Zeile faellt weg. Zwei puuids mit derselben Riot-ID im selben Stapel: nur
-- die neueste zaehlt. Verglichen wird Name und Tag klein geschrieben;
-- Leerzeichen im Tag bleiben stehen („KR 1“ und „KR1“ sind zwei Konten).
-- Geschrieben wird nur bei Aenderung oder wenn last_seen aelter als 7 Tage ist.
create or replace function public.upsert_lol_player_names(p_rows jsonb)
returns integer
language plpgsql as $$
declare
  n integer;
begin
  with src as (
    select distinct on (r.puuid)
      r.puuid, r.game_name, r.tag_line, lower(r.region) as region, r.last_seen
    from jsonb_to_recordset(p_rows) as r(
      puuid text, game_name text, tag_line text, region text, last_seen timestamptz
    )
    where r.puuid is not null and r.puuid <> ''
      and nullif(trim(r.game_name), '') is not null
      and nullif(trim(r.tag_line), '') is not null
      and nullif(trim(r.region), '') is not null
      and r.last_seen is not null
    order by r.puuid, r.last_seen desc
  ),
  uniq as (
    select distinct on (lower(s.game_name), lower(s.tag_line))
      s.puuid, s.game_name, s.tag_line, s.region, s.last_seen,
      public.tft_name_norm(s.game_name) collate "C" as name_norm
    from src s
    order by lower(s.game_name), lower(s.tag_line), s.last_seen desc
  ),
  gone as (
    delete from public.lol_player_names t
    using uniq u
    where t.name_norm = u.name_norm
      and t.puuid <> u.puuid
      and lower(t.game_name) = lower(u.game_name)
      and lower(t.tag_line) = lower(u.tag_line)
      and t.last_seen <= u.last_seen
    returning 1
  )
  insert into public.lol_player_names as t
    (puuid, game_name, tag_line, name_norm, region, last_seen)
  select u.puuid, u.game_name, u.tag_line, u.name_norm, u.region, u.last_seen
  from uniq u
  -- Ein anderes Konto hat diese Riot-ID juenger bestaetigt: diese Zeile ist alt.
  where not exists (
    select 1 from public.lol_player_names o
    where o.name_norm = u.name_norm
      and o.puuid <> u.puuid
      and lower(o.game_name) = lower(u.game_name)
      and lower(o.tag_line) = lower(u.tag_line)
      and o.last_seen > u.last_seen
  )
  on conflict (puuid) do update set
    game_name = excluded.game_name,
    tag_line  = excluded.tag_line,
    name_norm = excluded.name_norm,
    region    = excluded.region,
    last_seen = greatest(excluded.last_seen, t.last_seen)
  where excluded.last_seen >= t.last_seen
    and (
         t.game_name is distinct from excluded.game_name
      or t.tag_line  is distinct from excluded.tag_line
      or t.region    is distinct from excluded.region
      or excluded.last_seen > t.last_seen + interval '7 days'
    );
  get diagnostics n = row_count;
  return n;
end
$$;

-- Riot kennt Name#Tag nicht (Konto umbenannt oder geloescht): Zeile weg.
-- Name klein und ohne Leerzeichen, Tag klein — so loest Riot Namen auf.
-- Bewusst ohne NFKC: sonst koennte ein 404 auf eine Vollbreiten-Schreibweise
-- die Zeile eines echten ASCII-Kontos treffen.
create or replace function public.delete_lol_player_name(p_game_name text, p_tag_line text)
returns integer
language plpgsql as $$
declare
  n integer;
  k text := lower(regexp_replace(coalesce(p_game_name, ''), '\s', '', 'g'));
  tg text := lower(coalesce(p_tag_line, ''));
begin
  if k = '' or tg = '' then return 0; end if;
  delete from public.lol_player_names t
  where lower(regexp_replace(t.game_name, '\s', '', 'g')) = k
    and lower(t.tag_line) = tg;
  get diagnostics n = row_count;
  return n;
end
$$;

-- Praefix-Suche wie search_tft_player_names (0072), ohne puuid und ohne Rang.
-- Reihenfolge: zuletzt von Riot bestaetigt zuerst.
create or replace function public.search_lol_player_names(
  p_prefix text,
  p_tag    text default null,
  p_limit  integer default 10
)
returns table (game_name text, tag_line text, region text)
language sql stable as $$
  with q as (
    select public.tft_name_norm(p_prefix) collate "C" as lo
  )
  select n.game_name, n.tag_line, n.region
  from public.lol_player_names n, q
  where length(q.lo) >= 3
    and n.name_norm >= q.lo
    and n.name_norm < q.lo || chr(1114111)
    and (p_tag is null or p_tag = '' or starts_with(lower(n.tag_line), lower(p_tag)))
  order by n.last_seen desc
  limit least(greatest(coalesce(p_limit, 10), 1), 25)
$$;

-- Exakter Name wie search_tft_player_names_exact (0073), ohne puuid und Rang.
create or replace function public.search_lol_player_names_exact(
  p_name  text,
  p_limit integer default 50
)
returns table (game_name text, tag_line text, region text)
language sql stable as $$
  with q as (
    select public.tft_name_norm(p_name) collate "C" as k
  )
  select n.game_name, n.tag_line, n.region
  from public.lol_player_names n, q
  where length(q.k) >= 1
    and n.name_norm = q.k
  order by n.last_seen desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;

revoke all on function public.upsert_lol_player_names(jsonb) from public, anon, authenticated;
revoke all on function public.delete_lol_player_name(text, text) from public, anon, authenticated;
revoke all on function public.search_lol_player_names(text, text, integer) from public, anon, authenticated;
revoke all on function public.search_lol_player_names_exact(text, integer) from public, anon, authenticated;
grant execute on function public.upsert_lol_player_names(jsonb) to service_role;
grant execute on function public.delete_lol_player_name(text, text) to service_role;
grant execute on function public.search_lol_player_names(text, text, integer) to service_role;
grant execute on function public.search_lol_player_names_exact(text, integer) to service_role;

-- Einmal-Befuellung aus players: jede Zeile dort hat Riot beim Profilabruf
-- bestaetigt (einziger Schreiber ist /api/summoner), updated_at = Zeitpunkt.
-- Nur die letzten 180 Tage — aeltere Namen sind zu oft weitergegeben
-- (data-skeptic: 6,2 % Namenswechsel in ~95 Tagen bei TFT-Spielern).
-- Name und Tag am LETZTEN '#' getrennt. players.updated_at ist ohne Zeitzone
-- und wird in UTC geschrieben.
select public.upsert_lol_player_names(coalesce(jsonb_agg(jsonb_build_object(
  'puuid', p.puuid,
  'game_name', left(p.summoner_name, length(p.summoner_name) - strpos(reverse(p.summoner_name), '#')),
  'tag_line', right(p.summoner_name, strpos(reverse(p.summoner_name), '#') - 1),
  'region', p.region,
  'last_seen', p.updated_at at time zone 'UTC'
)), '[]'::jsonb)) as backfilled
from public.players p
where p.summoner_name like '%#%'
  and p.puuid is not null and p.puuid <> ''
  and p.region is not null
  and p.updated_at >= (now() at time zone 'UTC') - interval '180 days';

analyze public.lol_player_names;

notify pgrst, 'reload schema';
