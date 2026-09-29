-- Rollback zu 0079: Zeilenschutz wieder aus, Waechter auf den 0056-Stand.
-- Die entzogenen Rechte kommen bewusst NICHT zurueck — ein Rollback soll keine
-- Tabelle wieder fuer den Anon-Schluessel oeffnen. Seite und Sammler brauchen
-- sie nicht (Service-Schluessel bzw. direkte DB-Verbindung als postgres).
alter table public.lol_player_match_cache disable row level security;
alter table public.lol_match_fill_queue disable row level security;
alter table public.lol_player_season_stats disable row level security;

create or replace function public.security_anon_leaks()
returns table (kind text, object_name text, role_name text, severity text, detail text)
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
