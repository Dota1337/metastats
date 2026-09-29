-- 0079: Zeilenschutz (RLS) fuer alle Tabellen in public, Waechter schaerfen.
--
-- Anlass: Supabase-Warnung rls_disabled_in_public (2026-09-29). Vier Tabellen
-- hatten RLS aus. Ueber den Anon-Schluessel, der im Browser steht, konnte jeder
-- sie lesen und — ueber die Standardrechte — auch beschreiben und leeren.
--
-- Wer davon betroffen ist: niemand. Die Seite liest mit dem Service-Schluessel
-- (app/lib/supabase.ts), der Sammler ueber eine direkte DB-Verbindung als
-- postgres. Beide umgehen RLS. Kein FORCE RLS, damit der Eigentuemer
-- weiter durchkommt.
--
-- Ursache: pg_default_acl gibt anon/authenticated auf jede neue Tabelle volle
-- Rechte. Wer vergisst zu entziehen, hat eine offene Tabelle. Die Standardrechte
-- der Rolle postgres werden hier entzogen; die von supabase_admin kann postgres
-- nicht aendern — dafuer greift der geschaerfte Waechter und der Pre-push-Check.

set lock_timeout = '3s';
set statement_timeout = '60s';

alter table public.lol_player_match_cache enable row level security;
revoke all on public.lol_player_match_cache from anon, authenticated;

alter table public.lol_match_fill_queue enable row level security;
revoke all on public.lol_match_fill_queue from anon, authenticated;

alter table public.lol_player_season_stats enable row level security;
revoke all on public.lol_player_season_stats from anon, authenticated;

-- Handgemachte Sicherung vom Set-18-Nachtrag. Wird erst geloescht, wenn die
-- geschaetzten Marktwerte bestaetigt sind; bis dahin wenigstens zu.
do $$
begin
  if to_regclass('public.tft_mv_peaks_backup_20260927') is not null then
    execute 'alter table public.tft_mv_peaks_backup_20260927 enable row level security';
    execute 'revoke all on public.tft_mv_peaks_backup_20260927 from anon, authenticated';
  end if;
end $$;

-- 0057 und 0030 haben hier nur das Leserecht entzogen, Schreibrechte blieben.
-- Praktisch zu: die Policy verlangt auth.role() = 'service_role', die Ansicht
-- liest aus einer Funktion und ist nicht beschreibbar. Trotzdem weg damit —
-- der Waechter unten meldet sonst beide dauerhaft.
revoke all on public.tft_pro_validation_log from anon, authenticated;
revoke all on public.tft_position_unit_cell from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;

-- Waechter: bisher nur SELECT. Jetzt jedes Recht, und eine Tabelle mit RLS aus
-- ist immer offen — auch ohne Recht, denn das naechste GRANT macht sie auf.
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
          and (p.polroles = '{0}'::oid[] or r.oid = any (p.polroles))
      ) then 'Policy trifft die Rolle'
      else 'RLS blockt (keine passende Policy)'
    end
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join (select oid, rolname from pg_roles where rolname in ('anon', 'authenticated')) r
  where n.nspname = 'public'
    and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and (
      has_table_privilege(r.oid, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      or (c.relkind in ('r', 'p') and not c.relrowsecurity)
    )

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
