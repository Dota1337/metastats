-- Taegliche Rangliste ab Smaragd fuer die Aufsteiger-Seite (/tft/rising).
--
-- Lebt NUR auf der Hetzner-Datenbank. Supabase braucht sie nicht: die Seite
-- liest ueber den Box-Endpunkt /rising, und die Tabelle waere dort nur Last.
--
-- Warum eine eigene Tabelle statt der Marktwert-Snapshots: die decken Master+
-- nur teilweise ab (gemessen 2026-09-27: euw1 63 %, kr 29 %, vn2 11 %), und
-- Aufsteiger aus Smaragd/Diamant fehlen dort ganz. Die Liga-Listen liefern
-- dagegen jeden Spieler mit Rang, LP und Spielzaehler in wenigen Aufrufen.
--
-- Eine Zeile pro Spieler, Region und Tag. `fetched_at` ist der Zeitpunkt, zu
-- dem die Liste abgerufen wurde — der Box-Endpunkt nimmt ihn als Grenze fuer
-- die Partien im Zeitraum, nicht den Kalendertag.
--
-- Aufbewahrung: der Sammler loescht alles, was aelter als 10 Tage ist. Mehr
-- braucht die Seite nicht (laengster Zeitraum 5 Tage plus Luecken).

create table if not exists public.tft_ladder_daily (
  puuid       text        not null,
  region      text        not null,
  day         date        not null,
  set_number  integer     not null,
  tier        text        not null,
  rank        text,
  lp          integer     not null,
  wins        integer     not null,
  losses      integer     not null,
  fetched_at  timestamptz not null,
  primary key (puuid, region, day)
);

-- Der Endpunkt sucht zuerst "alle Master+ am letzten Tag einer Region".
create index if not exists idx_tft_ladder_daily_region_day
  on public.tft_ladder_daily (set_number, region, day);

-- Falls die Datei doch einmal auf Supabase landet (apply-supabase-migrations
-- spielt alle Dateien ein): dort nie oeffentlich lesbar.
alter table public.tft_ladder_daily enable row level security;
revoke all on public.tft_ladder_daily from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.tft_ladder_daily from anon, authenticated';
  end if;
end $$;
