-- 0080: LoL-Marktwert je Split + Hoechstwert je Split (wie TFT je Set).
--
-- Bisher rechnete /api/summoner den Marktwert aus den letzten 60 Ranked-Partien,
-- egal aus welchem Split. Ab jetzt zaehlen nur Partien des Splits der neuesten
-- gewerteten Partie; die Formel (app/lib/marketvalue.ts) bleibt unveraendert.
-- Jede Verlaufszeile traegt deshalb ihren Split und die Zahl der Partien, aus
-- denen sie gerechnet wurde.
--
-- Altzeilen: gerechnet aus gemischten Splits. Sie werden nach Datum dem Split
-- zugeordnet und als geschaetzt markiert. Die Grenzen sind gemessen, nicht aus
-- Patchnotes: erste Partie mit Patch 16.9 bzw. 16.15 in lol_player_match_cache
-- (2026-04-29 04:03 UTC bzw. 2026-07-29 04:43 UTC). Die aelteste Zeile ist vom
-- 2026-03-26, davor gibt es nichts zuzuordnen.
--
-- recorded_at ist "timestamp without time zone" und wird von der Route mit
-- toISOString() (UTC) geschrieben, deshalb die Grenzen hier ohne Zone.

set lock_timeout = '3s';
set statement_timeout = '60s';

alter table public.market_value_history
  add column if not exists split_id        text,
  add column if not exists games_analyzed  int,
  add column if not exists base_value      int,
  add column if not exists multiplier      numeric(6,3),
  add column if not exists split_estimated boolean not null default false;

update public.market_value_history
   set split_id = case
         when recorded_at >= '2026-07-29 04:43:00' then 's2026-split3'
         when recorded_at >= '2026-04-29 04:03:22' then 's2026-split2'
         else 's2026-split1'
       end,
       split_estimated = true
 where split_id is null;

-- Leser vergleichen nur noch innerhalb eines Splits (player_id + split_id),
-- der Peak-Lauf liest je Split ab einem Datum.
create index if not exists market_value_history_player_split_idx
  on public.market_value_history (player_id, split_id, recorded_at desc);
create index if not exists market_value_history_recorded_idx
  on public.market_value_history (recorded_at desc);

-- Hoechstwert je Spieler und Split. Befuellt von
-- scripts/freeze-marketvalue-peaks.mjs (LoL-Durchgang), nicht von der Suche:
-- ein Schreiber pro Tabelle, neu rechenbar mit --full.
create table if not exists public.lol_player_marketvalue_peaks (
  player_id      uuid        not null references public.players(id) on delete cascade,
  split_id       text        not null,
  peak_value     int         not null,
  base_value     int,
  multiplier     numeric(6,3),
  games_analyzed int         not null,
  peak_at        timestamptz not null,
  updated_at     timestamptz not null default now(),
  primary key (player_id, split_id)
);

create index if not exists lol_player_marketvalue_peaks_split_idx
  on public.lol_player_marketvalue_peaks (split_id, peak_value desc);

-- Rechte wie 0079: RLS an, anon/authenticated raus. Die Seite liest mit dem
-- Service-Schluessel, der Peak-Lauf als postgres — beide umgehen RLS.
alter table public.lol_player_marketvalue_peaks enable row level security;
revoke all on public.lol_player_marketvalue_peaks from anon, authenticated;
