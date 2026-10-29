-- 0108: Vorab berechnete Item-Listen fuer die schweren Kombinationen (Plan 2026-10-29).
--
-- WARUM: get_tft_item_stats_list braucht fuer Region "alle" x Rang "alle" x
-- 7 Tage 21,5 s (kalt gemessen 29.10.), der DB-Deckel der Rolle service_role
-- liegt bei 20 s, Besucher haben 8 s. Der Publisher speichert Items nur fuer
-- 1/3/7 Tage, die Seite bietet 1-7 an — 4-6 Tage liefen live in 502, und
-- items all/7d/{all,platinum_plus} fehlten seit 23.10. jede Nacht im Manifest.
-- scripts/precompute-comp-windows.mjs rechnet diese Listen vor dem Publisher
-- direkt an der DB (eigene 120-s-Grenze, eine nach der anderen) und legt die
-- unveraenderte RPC-Ausgabe hier ab. /api/tft/items liest zuerst hier.
--
-- Aufbau wie tft_comp_list_precomputed (0070 + 0084 + 0095), eigene Tabelle,
-- damit der laufende Comps-Pfad unberuehrt bleibt. item_rows = rohe Zeilen von
-- get_tft_item_stats_list; Ausschluesse, Traeger und Pickrate rechnet weiter
-- die Route. min_games ist immer 0 (die Item-RPC kennt keine Schwelle) und
-- steht nur da, damit precomputedEntryUsable unveraendert passt.
--
-- Schluessel: patch_key ('' = aktuell ungefiltert), set_number, regions_key und
-- buckets_key (sortiert, kommagetrennt), data_start, window_end — Bedeutung wie
-- in 0070/0095.
--
-- REIHENFOLGE: diese Migration ZUERST, dann der Code (Vercel + Box). Ohne
-- Tabelle loggt die Route bei jeder schweren Anfrage einen Fehler und rechnet
-- live. Rueckweg: supabase/rollback/0108_tft_item_list_precomputed_rollback.sql.

begin;
set local lock_timeout = '5s';

create table public.tft_item_list_precomputed (
  patch_key       text        not null,
  set_number      int         not null,
  regions_key     text        not null,
  buckets_key     text        not null,
  data_start      date        not null,
  window_end      date        not null,
  patch_first_day date,
  last_day        date        not null,
  min_games       int         not null default 0,
  item_rows       jsonb       not null,
  computed_at     timestamptz not null default now(),
  patch_matches   bigint,
  built_at        timestamptz,
  primary key (patch_key, set_number, regions_key, buckets_key, data_start, window_end)
);

alter table public.tft_item_list_precomputed enable row level security;
revoke all on public.tft_item_list_precomputed from anon, authenticated;

-- Jeder Lauf ersetzt die Zeilen; jsonb-Werte -> haeufiger aufraeumen (wie 0070).
alter table public.tft_item_list_precomputed set (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.05
);

CREATE FUNCTION public.get_tft_item_list_precomputed(p_patch_key text, p_set integer, p_regions_key text, p_buckets_key text, p_days integer, p_end_day date DEFAULT NULL::date)
 RETURNS TABLE(last_day date, window_end date, min_games integer, computed_at timestamp with time zone, item_rows jsonb)
 LANGUAGE sql
 STABLE
AS $function$
  -- Fenster-Logik wie get_tft_comp_list_precomputed (0095): mit p_end_day genau
  -- [p_end_day - p_days + 1, p_end_day], ohne nur Zeilen alter Art.
  select t.last_day, t.window_end, t.min_games, t.computed_at, t.item_rows
  from public.tft_item_list_precomputed t
  where t.patch_key = p_patch_key
    and t.set_number = p_set
    and t.regions_key = p_regions_key
    and t.buckets_key = p_buckets_key
    and (
      (p_end_day is not null and t.window_end = p_end_day and t.data_start = p_end_day - p_days + 1)
      or (p_end_day is null and t.window_end = t.last_day
          and t.data_start = greatest(current_date - p_days, coalesce(t.patch_first_day, current_date - p_days)))
    )
  limit 1;
$function$;
revoke all on function public.get_tft_item_list_precomputed(p_patch_key text, p_set integer, p_regions_key text, p_buckets_key text, p_days integer, p_end_day date) from public, anon, authenticated, service_role;
grant execute on function public.get_tft_item_list_precomputed(p_patch_key text, p_set integer, p_regions_key text, p_buckets_key text, p_days integer, p_end_day date) to service_role;

-- Selbstpruefung: genau eine Signatur, Rechte nur service_role, RLS an.
do $$
declare
  n int;
begin
  select count(*) into n
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'get_tft_item_list_precomputed';
  if n <> 1 then raise exception '0108: % Signaturen von get_tft_item_list_precomputed', n; end if;
  if has_function_privilege('anon', 'public.get_tft_item_list_precomputed(text, integer, text, text, integer, date)', 'execute')
     or has_function_privilege('authenticated', 'public.get_tft_item_list_precomputed(text, integer, text, text, integer, date)', 'execute')
     or not has_function_privilege('service_role', 'public.get_tft_item_list_precomputed(text, integer, text, text, integer, date)', 'execute') then
    raise exception '0108: Rechte falsch fuer get_tft_item_list_precomputed';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.tft_item_list_precomputed'::regclass) then
    raise exception '0108: RLS fehlt auf tft_item_list_precomputed';
  end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
