-- 0040: Multi-Source TFT-Pro-Tracking
--
-- Erweitert tft_pro_players um Klassifikations- + Validations-Felder, sodass
-- "Pro" nicht mehr nur "hat Liquipedia-Seite" heißt, sondern ein
-- mehrstufig validiertes Konstrukt aus:
--   • Riot offiziell (competetft.com TPC-Roster)
--   • Liquipedia (community-kuratiert)
--   • EsportsEarnings API (historische Earnings)
--   • escharts (moderne Earnings inkl. CN+KR)
--   • Aktivitäts-Validierung (lolchess/dakgg-Rank + Stream-Status)
--
-- Plus neue Tabelle tft_pro_validation_log für den Watchdog-Loop, der
-- Anomalien (divergente Earnings, fehlende Tournament-Results trotz
-- TPC-Verified, PUUID-Resolution-Fehler) tracked und GH-Issues auslöst.

-- ─── Extension auf tft_pro_players ────────────────────────────────────────
alter table tft_pro_players
  -- Riot offiziell: in competetft.com Standings vorhanden?
  add column if not exists tpc_verified boolean default false,
  add column if not exists tpc_pro_points int,
  add column if not exists tpc_region text,            -- amer|apac|emea|cn

  -- Klassifikation (tpc|tournament|streamer|historic|inactive)
  -- + Confidence-Score 0-100 aus aggregiertem Source-Match
  add column if not exists classification text,
  add column if not exists confidence_score int,

  -- Aktivitäts-Validierung (lolchess/dakgg + Riot League-V1 Lookup)
  add column if not exists active_rank_tier text,      -- challenger|grandmaster|master|diamond|sub_diamond
  add column if not exists active_rank_lp int,
  add column if not exists active_rank_checked_at timestamptz,

  -- Tournament-Aktivität (für historic-vs-tournament Klassifikation)
  add column if not exists last_tournament_at date,

  -- Multi-Source-Earnings (jsonb mit pro Source einem Schlüssel)
  -- z.B. { "liquipedia": 58045, "esportsearnings": 12000, "escharts": 60000 }
  add column if not exists earnings_sources jsonb default '{}'::jsonb,

  -- Stream-Platform-Status (twitch, chzzk, bilibili, douyu, afreeca)
  -- z.B. { "twitch": {"handle": "x", "live": false, "last_live": "..."} }
  add column if not exists stream_platforms jsonb default '{}'::jsonb,
  add column if not exists last_stream_at timestamptz,

  -- Validation-Anomalien (Watchdog tracked die per-pro-Auffälligkeiten)
  add column if not exists validation_anomalies jsonb default '[]'::jsonb,
  add column if not exists last_full_validation_at timestamptz;

-- Indices für die Filter-Queries auf der Pro-Page
create index if not exists idx_tft_pro_classification
  on tft_pro_players(classification, confidence_score desc);
create index if not exists idx_tft_pro_tpc
  on tft_pro_players(tpc_verified, tpc_region, tpc_pro_points desc)
  where tpc_verified = true;

-- ─── Validation-Log-Tabelle ───────────────────────────────────────────────
-- Eine Zeile pro Pro × Source × Run × Field. Der Watchdog schreibt hier rein,
-- das Admin-Dashboard liest hier raus. Run-ID gruppiert alle Events eines
-- Sample- oder Full-Sync-Laufs.

create table if not exists tft_pro_validation_log (
  id bigint generated always as identity primary key,
  validation_run_id uuid not null,
  puuid text,                                  -- nullable: Identity-Errors haben evtl. noch keinen PUUID
  pro_name text,                               -- always set for human-readable logs
  source text not null,                        -- liquipedia|competetft|esportsearnings|escharts|lolchess|dakgg|twitch|chzzk|bilibili
  status text not null,                        -- ok|warning|error|missing
  field text,                                  -- earnings|rank|tournament|stream|identity|classification
  expected jsonb,
  actual jsonb,
  severity int not null default 2,             -- 1=info, 2=warning, 3=error, 4=critical, 5=blocking
  detail text,                                 -- human description
  detected_at timestamptz default now(),
  resolved_at timestamptz,                     -- set when watchdog confirms auto-heal or manual fix
  resolution text                              -- 'auto_healed' | 'manual_review' | 'false_positive'
);

create index if not exists idx_tft_pro_val_run
  on tft_pro_validation_log(validation_run_id);
create index if not exists idx_tft_pro_val_severity_open
  on tft_pro_validation_log(severity desc, detected_at desc)
  where resolved_at is null;
create index if not exists idx_tft_pro_val_pro
  on tft_pro_validation_log(puuid, detected_at desc);

-- RLS: anon liest die Log-Tabelle NICHT (interne Diagnostik), nur service_role
alter table tft_pro_validation_log enable row level security;
create policy "service_role full" on tft_pro_validation_log
  for all using (auth.role() = 'service_role');

-- ─── Convenience-RPC: offene Anomalien pro Severity ───────────────────────
create or replace function get_tft_pro_validation_summary()
returns table (
  severity int,
  open_count bigint,
  last_event timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select severity, count(*) as open_count, max(detected_at) as last_event
  from tft_pro_validation_log
  where resolved_at is null
  group by severity
  order by severity desc;
$$;
grant execute on function get_tft_pro_validation_summary() to service_role;

-- ─── Convenience-RPC: Pros pro Klassifikation ─────────────────────────────
-- Replaces frontend-side counting in der Pros-Page. Default sortierung nach
-- (tpc_verified desc, confidence_score desc, total_earnings_usd desc).

create or replace function get_tft_pros_classified(
  p_classifications text[] default null,        -- null = alle anzeigen
  p_region text default null,
  p_team text default null,
  p_min_confidence int default 0,
  p_limit int default 500
)
returns table (
  puuid text,
  pro_name text,
  real_name text,
  region text,
  riot_id text,
  team text,
  role text,
  country text,
  source text,
  tpc_verified boolean,
  tpc_pro_points int,
  tpc_region text,
  classification text,
  confidence_score int,
  active_rank_tier text,
  active_rank_lp int,
  last_tournament_at date,
  twitch_handle text,
  twitter_handle text,
  image_url text,
  total_earnings_usd numeric,
  earnings_sources jsonb,
  stream_platforms jsonb,
  tournament_results jsonb,
  last_full_validation_at timestamptz
)
language sql
stable
as $$
  select
    p.puuid, p.pro_name, p.real_name, p.region, p.riot_id,
    p.team, p.role, p.country, p.source,
    coalesce(p.tpc_verified, false),
    p.tpc_pro_points, p.tpc_region,
    coalesce(p.classification, 'inactive'),
    coalesce(p.confidence_score, 0),
    p.active_rank_tier, p.active_rank_lp,
    p.last_tournament_at,
    p.twitch_handle, p.twitter_handle, p.image_url,
    coalesce(p.total_earnings_usd, 0),
    coalesce(p.earnings_sources, '{}'::jsonb),
    coalesce(p.stream_platforms, '{}'::jsonb),
    coalesce(p.tournament_results, '[]'::jsonb),
    p.last_full_validation_at
  from tft_pro_players p
  where (p_classifications is null
         or coalesce(p.classification, 'inactive') = any(p_classifications))
    and (p_region is null or p.region = p_region)
    and (p_team is null or p.team = p_team)
    and coalesce(p.confidence_score, 0) >= p_min_confidence
  order by
    coalesce(p.tpc_verified, false) desc,
    coalesce(p.confidence_score, 0) desc,
    coalesce(p.total_earnings_usd, 0) desc,
    p.pro_name asc
  limit p_limit;
$$;

grant execute on function get_tft_pros_classified(text[], text, text, int, int)
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
