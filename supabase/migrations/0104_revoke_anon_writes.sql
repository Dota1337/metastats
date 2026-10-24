-- 0104: Oeffentliche Rollen verlieren jedes Recht in public.
-- Nur Rechte — keine Tabelle, keine Spalte, keine Zeile wird angefasst.
--
-- Anlass: Sicherheitsdurchsicht 24.10.2026 (infra/security-baseline.json,
-- anon-grant-rest / anon-execute / standardrechte-neue-funktionen /
-- notfall-befehl-scheitert / nur-grant-blind). Live gemessen am selben Tag:
--   - anon + authenticated hatten auf 27 Tabellen und 9 Sequenzen Rechte, auf
--     23 davon INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN ohne
--     SELECT, auf market_value_history, players, ranked_stats und matches
--     alles. RLS blockte Lesen und Schreiben, TRUNCATE aber nicht — TRUNCATE
--     prueft keine Zeilen-Regeln. PostgREST bietet TRUNCATE nicht an, deshalb
--     kein offener Weg, aber ein Riegel weniger, als es sein sollte.
--   - get_tft_set_bucket_coverage(int,int) war fuer anon aufrufbar. Aufrufer
--     ist nur der Server (app/lib/tft-supabase-reader.ts, Service-Schluessel).
--   - Neue Funktionen in public bekamen automatisch EXECUTE fuer anon und
--     authenticated (pg_default_acl der Rolle postgres) und fuer PUBLIC
--     (eingebauter Standard, es gab keinen Eintrag ohne Schema).
--   - security_anon_leaks (0079) sah keine Sequenzen und kein REFERENCES/
--     TRIGGER/MAINTAIN, und der Vertrag schlug bei "nur-grant" nicht an.
--
-- Wer betroffen ist: niemand im Betrieb. Die Seite liest und schreibt mit dem
-- Service-Schluessel (app/lib/supabase.ts supabaseAdmin), die Box ueber eine
-- direkte Verbindung als postgres. Der Anon-Client in app/lib/supabase.ts wird
-- nirgends importiert, der Browser-Client nur fuer den Login (auth-Schema).
-- service_role hat auf allen Tabellen und Funktionen in public ein
-- ausdrueckliches Recht; die Entzuege treffen es nicht.
--
-- matches: authenticated behaelt SELECT/INSERT/UPDATE/DELETE fuer die
-- Owner-Policies (player_id = auth.uid()). anon verliert auch SELECT — die
-- Lebenszeichen-Probe des Vertrags erkennt einen lebenden Schluessel jetzt an
-- der Ablehnung 42501 (ein toter bekommt 401 "Invalid API key" ohne Code).
--
-- Eine Quelle fuer die Sperre: public.security_anon_lockdown() macht alles und
-- prueft am Ende selbst nach. Diese Migration ruft sie einmal auf, das
-- Notfall-Skript scripts/anon-lockout.mjs ruft dieselbe Funktion. Nachpruefen
-- ist Pflicht, weil REVOKE auf ein Objekt, das postgres nicht gehoert, nur
-- eine WARNING ausgibt und nichts entzieht.
--
-- Standardrechte fuer neue Funktionen: der Eintrag ohne Schema nimmt PUBLIC
-- das automatische EXECUTE, der Eintrag fuer public nimmt anon und
-- authenticated das ausdrueckliche. service_role behaelt sein ausdrueckliches
-- Recht aus dem Eintrag fuer public. Nebenwirkung: Funktionen, die postgres
-- kuenftig in ANDEREN Schemata anlegt (z. B. eine neue Erweiterung in
-- extensions), sind erst nach einem ausdruecklichen GRANT aufrufbar. Das
-- faellt beim ersten Aufruf laut auf (permission denied), Daten gehen dabei
-- nicht verloren. Was supabase_admin in public anlegt (Studio), bekommt
-- weiter automatisch Rechte — das kann postgres nicht aendern, dafuer schlaegt
-- der taegliche Vertrag sicherheit/anon-lockout jetzt bei jedem Recht an.
--
-- Auf einer Datenbank ohne anon (Hetzner-PG, falls die Datei dort je landet)
-- tut der Aufruf nichts — auch die Standardrechte bleiben dort unberuehrt.
--
-- Ausfuehren NUR mit node scripts/apply-migrations.mjs 0104 (eine
-- Transaktion). db-exec.mjs schickt Anweisungen einzeln, dann wirkt
-- `set local lock_timeout` nicht.
--
-- Zuruecknehmen: supabase/rollback/0104_revoke_anon_writes_rollback.sql.

set local lock_timeout = '5s';

-- Waechter, Stand 0079 plus: Sequenzen, REFERENCES/TRIGGER/MAINTAIN, und
-- TRUNCATE immer "offen" (umgeht RLS).
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
      when has_table_privilege(r.oid, c.oid, 'TRUNCATE') then 'offen'
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
      when has_table_privilege(r.oid, c.oid, 'TRUNCATE') then 'TRUNCATE umgeht RLS'
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
      has_table_privilege(r.oid, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      or (c.relkind in ('r', 'p') and not c.relrowsecurity)
    )

  union all

  select
    'sequence',
    c.relname::text,
    r.rolname::text,
    'nur-grant',
    'Sequenz-Recht (USAGE/SELECT/UPDATE)'
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join (select oid, rolname from pg_roles where rolname in ('anon', 'authenticated')) r
  where n.nspname = 'public'
    and c.relkind = 'S'
    and has_sequence_privilege(r.oid, c.oid, 'USAGE,SELECT,UPDATE')

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
    and has_function_privilege(r.oid, p.oid, 'EXECUTE')

  order by 4, 1, 2, 3;
$$;

revoke execute on function public.security_anon_leaks() from public, anon, authenticated;
grant execute on function public.security_anon_leaks() to service_role;

-- Die Sperre selbst. Fragt den Katalog, was heute da ist, statt Namen zu
-- nennen (0055 nannte zwoelf Funktionen, die es nicht mehr gibt, und scheiterte
-- daran). Laeuft beliebig oft. Rueckgabe: Zahl der Objekte, an denen etwas
-- entzogen wurde (0 = war schon gesperrt), oder -1, wenn es die Rollen nicht gibt.
create or replace function public.security_anon_lockdown()
returns integer
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  rel record;
  fn record;
  n integer := 0;
  rest text;
begin
  if not exists (select 1 from pg_roles where rolname = 'anon')
     or not exists (select 1 from pg_roles where rolname = 'authenticated') then
    return -1;
  end if;

  for rel in
    select c.relname, c.relkind
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
      and exists (
        select 1 from aclexplode(c.relacl) a
        join pg_roles r on r.oid = a.grantee
        where r.rolname = 'anon' or (r.rolname = 'authenticated' and c.relname <> 'matches')
      )
    order by c.relname
  loop
    n := n + 1;
    if rel.relkind = 'S' then
      execute format('revoke all on sequence public.%I from anon, authenticated', rel.relname);
    elsif rel.relname = 'matches' then
      execute 'revoke all on table public.matches from anon';
    else
      execute format('revoke all on table public.%I from anon, authenticated', rel.relname);
    end if;
  end loop;

  -- authenticated auf matches: nur, was die Owner-Policies brauchen.
  if to_regclass('public.matches') is not null
     and has_table_privilege('authenticated', 'public.matches', 'TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then
    n := n + 1;
    execute 'revoke truncate, references, trigger, maintain on public.matches from authenticated';
  end if;

  -- Funktionen: service_role erst ausdruecklich berechtigen, damit der Entzug
  -- von PUBLIC es nicht mittrifft.
  for fn in
    select p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  loop
    n := n + 1;
    execute format('grant execute on routine %s to service_role', fn.sig);
    execute format('revoke execute on routine %s from public, anon, authenticated', fn.sig);
  end loop;

  execute 'alter default privileges for role postgres revoke execute on functions from public';
  execute 'alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated';

  -- Nachpruefen: erlaubt bleibt nur authenticated auf matches.
  select string_agg(l.kind || ' ' || l.object_name || ' ' || l.role_name, ', ')
    into rest
  from public.security_anon_leaks() l
  where not (l.kind = 'table' and l.object_name = 'matches' and l.role_name = 'authenticated');
  if rest is not null then
    raise exception 'Sperre unvollstaendig, noch offen: %', rest;
  end if;

  return n;
end;
$$;

-- Ausfuehren darf sie nur der Eigentuemer (postgres).
revoke execute on function public.security_anon_lockdown() from public, anon, authenticated, service_role;

select public.security_anon_lockdown();

notify pgrst, 'reload schema';
