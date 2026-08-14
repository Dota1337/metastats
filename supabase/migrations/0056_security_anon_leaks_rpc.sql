-- 0056: Katalog-Funktion fuer den taeglichen Anon-Lockout-Waechter
--
-- Migration 0055 hat 23 Relationen und 36 Funktionen zugesperrt. Ein Waechter,
-- der genau diese Namen abtastet, sieht den wahrscheinlichsten Rueckfall nicht:
-- eine NEUE Tabelle, die ueber Supabase Studio angelegt wird und dabei die
-- Default-Policy "enable read access for all users" bekommt. Kein Commit, kein
-- Diff, keine Probe schlaegt an.
--
-- Deshalb wird nicht die geschuetzte Liste abgefragt, sondern die Gegenrichtung:
-- gib mir ALLES in `public`, worauf `anon` oder `authenticated` noch
-- Leserechte haben. Erwartet wird eine leere Menge in der Stufe `offen`; jede
-- neue Tabelle taucht am Tag ihrer Entstehung darin auf.
--
-- Zwei Stufen, weil nicht jedes Recht ein Leck ist:
--   offen      — die Rolle kommt wirklich an Daten: View/Matview (laufen mit
--                Eigentuemerrechten), RLS aus, oder eine SELECT-Policy trifft
--                die Rolle. Auch SECURITY-DEFINER-Funktionen, die RLS umgehen.
--   nur-grant  — Recht vorhanden, aber RLS ohne passende Policy blockt jede
--                Zeile. Kein Abfluss, aber ein halb offener Riegel: kommt eine
--                Policy dazu, ist die Tabelle sofort offen. Wird gezaehlt,
--                bricht den Vertrag aber nicht.
--
-- SECURITY DEFINER, weil `has_table_privilege` fuer eine fremde Rolle und der
-- Blick in pg_policy Rechte brauchen, die der aufrufende Service-Role-Nutzer
-- nicht durchgaengig hat. Die Funktion selbst wird unten sofort gesperrt —
-- sonst waere ausgerechnet der Waechter das naechste Leck. Sie taucht in ihrer
-- eigenen Ausgabe auf, wenn das jemand rueckgaengig macht.
--
-- Gelesen vom Vertrag `sicherheit/anon-lockout` (infra/contracts.json).

create or replace function public.security_anon_leaks()
returns table (
  kind text,
  object_name text,
  role_name text,
  severity text,
  detail text
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    case c.relkind
      when 'v' then 'view'
      when 'm' then 'matview'
      when 'f' then 'foreign-table'
      else 'table'
    end,
    c.relname::text,
    r.rolname::text,
    case
      when c.relkind in ('v', 'm', 'f') then 'offen'
      when not c.relrowsecurity then 'offen'
      when exists (
        select 1
        from pg_policy p
        where p.polrelid = c.oid
          and p.polpermissive
          and p.polcmd in ('r', '*')
          and (p.polroles = '{0}'::oid[] or r.oid = any (p.polroles))
      ) then 'offen'
      else 'nur-grant'
    end,
    case
      when c.relkind in ('v', 'm', 'f') then 'laeuft mit Eigentuemerrechten, RLS der Basistabellen greift nicht'
      when not c.relrowsecurity then 'RLS ist ausgeschaltet'
      when exists (
        select 1
        from pg_policy p
        where p.polrelid = c.oid
          and p.polpermissive
          and p.polcmd in ('r', '*')
          and (p.polroles = '{0}'::oid[] or r.oid = any (p.polroles))
      ) then 'SELECT-Policy trifft die Rolle'
      else 'RLS blockt (keine passende Policy)'
    end
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join (select oid, rolname from pg_roles where rolname in ('anon', 'authenticated')) r
  where n.nspname = 'public'
    and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and has_table_privilege(r.oid, c.oid, 'SELECT')

  union all

  select
    'function',
    p.oid::regprocedure::text,
    r.rolname::text,
    case when p.prosecdef then 'offen' else 'nur-grant' end,
    case
      when p.prosecdef then 'SECURITY DEFINER — umgeht RLS vollstaendig'
      else 'laeuft mit den Rechten des Aufrufers'
    end
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join (select oid, rolname from pg_roles where rolname in ('anon', 'authenticated')) r
  where n.nspname = 'public'
    and p.prokind = 'f'
    and has_function_privilege(r.oid, p.oid, 'EXECUTE')

  order by 4, 1, 2, 3;
$$;

revoke execute on function public.security_anon_leaks() from public, anon, authenticated;
grant execute on function public.security_anon_leaks() to service_role;

notify pgrst, 'reload schema';
