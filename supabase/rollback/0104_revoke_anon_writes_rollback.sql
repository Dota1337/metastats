-- Rollback 0104: stellt die Rechte von anon/authenticated in public so her, wie sie
-- am 24.10.2026 vor 0104 live gemessen wurden (72 Eintraege je Relation und Rolle,
-- 1 Funktion(en)), setzt security_anon_leaks auf den Stand von 0079 zurueck und
-- loescht security_anon_lockdown. Oeffnet damit die Luecken wieder — nur bei einem echten
-- Ausfall verwenden, der nachweislich an diesen Rechten haengt. Daten werden nicht angefasst.
-- Danach zeigt der Vertrag sicherheit/anon-lockout rot, bis auch der Code zurueckgesetzt ist
-- (scripts/lib/contracts.mjs, infra/contracts.json).

begin;
set local lock_timeout = '5s';

grant delete, insert, maintain, references, select, trigger, truncate, update on table public."market_value_history" to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public."market_value_history" to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public."matches" to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public."matches" to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public."players" to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public."players" to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public."ranked_stats" to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public."ranked_stats" to authenticated;
grant delete, insert, maintain, references, trigger, truncate, update on table public."site_config" to anon;
grant delete, insert, maintain, references, trigger, truncate, update on table public."site_config" to authenticated;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_daily_augment_stats" to anon;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_daily_augment_stats" to authenticated;
grant select, update, usage on sequence public."tft_daily_augment_stats_id_seq" to anon;
grant select, update, usage on sequence public."tft_daily_augment_stats_id_seq" to authenticated;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_daily_comp_pairs" to anon;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_daily_comp_pairs" to authenticated;
grant select, update, usage on sequence public."tft_daily_comp_pairs_id_seq" to anon;
grant select, update, usage on sequence public."tft_daily_comp_pairs_id_seq" to authenticated;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_daily_comp_stats" to anon;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_daily_comp_stats" to authenticated;
grant select, update, usage on sequence public."tft_daily_comp_stats_id_seq" to anon;
grant select, update, usage on sequence public."tft_daily_comp_stats_id_seq" to authenticated;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_daily_crawl_meta" to anon;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_daily_crawl_meta" to authenticated;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_daily_item_stats" to anon;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_daily_item_stats" to authenticated;
grant select, update, usage on sequence public."tft_daily_item_stats_id_seq" to anon;
grant select, update, usage on sequence public."tft_daily_item_stats_id_seq" to authenticated;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_daily_trait_stats" to anon;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_daily_trait_stats" to authenticated;
grant select, update, usage on sequence public."tft_daily_trait_stats_id_seq" to anon;
grant select, update, usage on sequence public."tft_daily_trait_stats_id_seq" to authenticated;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_daily_trait_unitcount_stats" to anon;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_daily_trait_unitcount_stats" to authenticated;
grant select, update, usage on sequence public."tft_daily_trait_unitcount_stats_id_seq" to anon;
grant select, update, usage on sequence public."tft_daily_trait_unitcount_stats_id_seq" to authenticated;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_daily_unit_stats" to anon;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_daily_unit_stats" to authenticated;
grant select, update, usage on sequence public."tft_daily_unit_stats_id_seq" to anon;
grant select, update, usage on sequence public."tft_daily_unit_stats_id_seq" to authenticated;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_mv_population_stats" to anon;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_mv_population_stats" to authenticated;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_player_fetch_state" to anon;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_player_fetch_state" to authenticated;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_player_marketvalue_peaks" to anon;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_player_marketvalue_peaks" to authenticated;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_player_marketvalue_snapshots" to anon;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_player_marketvalue_snapshots" to authenticated;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_player_match_cache" to anon;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_player_match_cache" to authenticated;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_player_rank_backfill_state" to anon;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_player_rank_backfill_state" to authenticated;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_player_rank_history" to anon;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_player_rank_history" to authenticated;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_player_season_stats" to anon;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_player_season_stats" to authenticated;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_position_comp_cell" to anon;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_position_comp_cell" to authenticated;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_pro_players" to anon;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_pro_players" to authenticated;
grant select, update, usage on sequence public."tft_pro_players_id_seq" to anon;
grant select, update, usage on sequence public."tft_pro_players_id_seq" to authenticated;
grant select, update, usage on sequence public."tft_pro_validation_log_id_seq" to anon;
grant select, update, usage on sequence public."tft_pro_validation_log_id_seq" to authenticated;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_public_comp_upvotes" to anon;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_public_comp_upvotes" to authenticated;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_public_comps" to anon;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_public_comps" to authenticated;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_tournament_results" to anon;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_tournament_results" to authenticated;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_tournaments" to anon;
grant delete, insert, maintain, references, trigger, truncate, update on table public."tft_tournaments" to authenticated;

grant execute on function public.get_tft_set_bucket_coverage(integer,integer) to anon, authenticated, public;

alter default privileges for role postgres grant execute on functions to public;
alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated;

drop function if exists public.security_anon_lockdown();

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

commit;

notify pgrst, 'reload schema';
