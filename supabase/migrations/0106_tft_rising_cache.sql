-- Vorgerechnete Aufsteiger-Liste fuer „alle Regionen" (/tft/rising).
--
-- Lebt NUR auf der Hetzner-Datenbank, wie tft_ladder_daily (0074).
--
-- Warum: der Box-Endpunkt /rising braucht fuer region=all 18-26 s (gemessen
-- 29.10.2026, davon 16,7 s die Kandidaten-Abfrage ueber 5,8 Mio Ranglisten-
-- Zeilen), die Vercel-Route wartet 15 s. Der Route-Spiegel speicherte die
-- Ansicht deshalb an 4 von 10 Tagen nicht.
--
-- Geschrieben wird NUR vom Ranglisten-Sammler am Laufende (POST /rising mit
-- warm:true), nie von einer normalen Anfrage — sonst koennte ein Teilstand
-- mitten im Sammeln als gueltig liegen bleiben. Eine Zeile je Zeitraum.

create table if not exists public.tft_rising_cache (
  days        integer     primary key,
  set_number  integer     not null,
  payload     jsonb       not null,
  built_at    timestamptz not null default now()
);

-- Falls die Datei doch einmal auf Supabase landet: dort nie oeffentlich lesbar.
alter table public.tft_rising_cache enable row level security;
revoke all on public.tft_rising_cache from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.tft_rising_cache from anon, authenticated';
  end if;
end $$;
