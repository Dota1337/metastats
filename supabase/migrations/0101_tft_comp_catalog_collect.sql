-- 0101: Comp-Katalog Phase 2 — der Sammler ordnet jedes Brett seiner Comp zu.
--
-- WARUM: Phase 1 (0099/0100) legt klassische Tageszeilen beim Lesen gruppenweise
-- auf die Katalog-Comps um (Abweichung zur Einzelspiel-Zuordnung 0,18 Plaetze).
-- Ab dem Stichtag schreibt der Sammler Comp-Zeilen je Brett, zaehlt „perfekt
-- getroffen“ mit und haelt die klassische Einteilung in einer Schattentabelle
-- fest — der Katalog wird nur aus ihr gebaut, nie aus zugeordneten Zeilen
-- (sonst Rueckkopplung). Plan und Verdicts: .claude/plan-current.md, Phase 2.
--
-- Alles additiv:
--  * tft_daily_crawl_meta.catalog_id — Tages-Marker je Region×Tag: welcher
--    Katalog die Comp-Zeilen dieses Tages zugeordnet hat (null = klassisch).
--    Fremdschluessel ON DELETE RESTRICT: Kataloge werden nie geloescht, solange
--    ein Tag auf sie zeigt.
--  * tft_daily_comp_stats.perfect_* — Perfekt-Zaehler (null = nicht bewertet).
--  * run_id in comp_stats/comp_outcome/comp_pairs + Schattentabelle — der
--    Writer schreibt per upsert und raeumt danach Zeilen eines frueheren Laufs
--    (andere run_id) weg. Kein Loeschen vorher → kein Loch fuer Leser.
--  * tft_daily_comp_classic — Schattentabelle (klassische Familie je Region×Tag,
--    Raenge zusammengelegt, ohne pro_pool und iron).
--  * get_tft_comp_classic_input — Eingabe fuer den Katalog-Bau: Schattenzeilen,
--    fuer Region×Tage ohne Schatten und ohne Marker die klassischen comp_stats.
--  * get_tft_comp_catalog_window — Kataloge fuer ein Fenster: Patches aus
--    crawl_meta, je Patch die neueste Version mit Tag <= Fensterende (genauer
--    Patch, sonst Basis 18.5b → 18.5, sonst neuester Katalog des Sets).
--
-- Rueckweg: supabase/rollback/0101_tft_comp_catalog_collect_rollback.sql

begin;
set local lock_timeout = '5s';

alter table public.tft_daily_crawl_meta
  add column if not exists catalog_id bigint references public.tft_comp_catalog(catalog_id) on delete restrict;

alter table public.tft_daily_comp_stats
  add column if not exists perfect_games integer,
  add column if not exists perfect_sum_placement integer,
  add column if not exists perfect_top4 integer,
  add column if not exists perfect_top1 integer,
  add column if not exists run_id text;
alter table public.tft_daily_comp_outcome add column if not exists run_id text;
alter table public.tft_daily_comp_pairs add column if not exists run_id text;

create table if not exists public.tft_daily_comp_classic (
  region text not null,
  patch text not null,
  set_number integer not null,
  day date not null,
  family_key text not null,
  games integer not null,
  sum_placement integer not null,
  top4 integer not null,
  units jsonb not null default '{}'::jsonb,         -- {characterId: [Spiele mit der Unit, davon 3★]}
  top4_by_level jsonb not null default '{}'::jsonb, -- {Spielerstufe: Top-4-Bretter}
  run_id text,
  primary key (region, set_number, day, family_key)
);
create index if not exists idx_tft_daily_comp_classic_set_patch_day
  on public.tft_daily_comp_classic (set_number, patch, day);
alter table public.tft_daily_comp_classic enable row level security;
revoke all on public.tft_daily_comp_classic from anon, authenticated;

-- Eingabe fuer den Katalog-Bau. Je Region×Tag des Patches (aus crawl_meta):
-- Schattenzeilen, wenn vorhanden; sonst — nur ohne Marker — die klassischen
-- comp_stats-Zeilen der neun Raenge (wie get_tft_comp_classic_units). Ein Tag
-- mit Marker und ohne Schatten faellt weg: seine Comp-Zeilen sind schon
-- zugeordnet und duerfen nie als klassische Familien zaehlen.
-- Ausgabe je Schluessel (Schatten: Familie, klassisch: cluster_key); die
-- Familien bildet der Aufrufer (familyOfCluster), wie bei 0099.
create or replace function public.get_tft_comp_classic_input(p_set integer, p_patch text, p_start date, p_end date)
returns table(key text, games bigint, sum_placement bigint, units jsonb, top4_by_level jsonb)
language sql
stable
as $$
  with days as (
    select m.region, m.day, bool_or(m.catalog_id is not null) as marked
    from public.tft_daily_crawl_meta m
    where m.set_number = p_set and m.patch = p_patch and m.day between p_start and p_end
    group by m.region, m.day
  ),
  sh_days as (
    select distinct s.region, s.day
    from public.tft_daily_comp_classic s
    where s.set_number = p_set and s.patch = p_patch and s.day between p_start and p_end
  ),
  missing as (
    select d.region, d.day from days d
    where not d.marked and not exists (select 1 from sh_days x where x.region = d.region and x.day = d.day)
  ),
  sh as (
    select s.family_key as key, s.games, s.sum_placement, s.units, s.top4_by_level
    from public.tft_daily_comp_classic s
    where s.set_number = p_set and s.patch = p_patch and s.day between p_start and p_end
  ),
  sh_tot as (select key, sum(games)::bigint as games, sum(sum_placement)::bigint as sum_placement from sh group by 1),
  sh_u as (
    select sh.key, u.key as id, sum((u.value->>0)::bigint)::bigint as g, sum((u.value->>1)::bigint)::bigint as s3
    from sh cross join lateral jsonb_each(sh.units) u
    group by 1, 2
  ),
  sh_uj as (select key, jsonb_object_agg(id, jsonb_build_array(g, s3)) as units from sh_u group by 1),
  sh_l as (
    select sh.key, l.key as lvl, sum(l.value::bigint)::bigint as n
    from sh cross join lateral jsonb_each_text(sh.top4_by_level) l
    group by 1, 2
  ),
  sh_lj as (select key, jsonb_object_agg(lvl, n) as top4_by_level from sh_l group by 1),
  cl as (
    select f.cluster_key, f.games, f.sum_placement, f.typical_units
    from missing x
    join public.tft_daily_comp_stats f
      on f.region = x.region and f.day = x.day and f.set_number = p_set
     and f.bucket = any(array['bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond', 'master', 'grandmaster', 'challenger'])
     and f.patch = p_patch
  ),
  cl_tot as (select cluster_key as key, sum(games)::bigint as games, sum(sum_placement)::bigint as sum_placement from cl group by 1),
  cl_u as (
    select cl.cluster_key as key, e->>'characterId' as id,
           sum(coalesce((e->>'gamesWithUnit')::bigint, 0))::bigint as g,
           sum(coalesce((e->>'star3Games')::bigint, 0))::bigint as s3
    from cl cross join lateral jsonb_array_elements(cl.typical_units) e
    where e->>'characterId' is not null
    group by 1, 2
  ),
  cl_uj as (select key, jsonb_object_agg(id, jsonb_build_array(g, s3)) as units from cl_u group by 1)
  select t.key, t.games, t.sum_placement, coalesce(u.units, '{}'::jsonb), coalesce(l.top4_by_level, '{}'::jsonb)
  from sh_tot t left join sh_uj u using (key) left join sh_lj l using (key)
  union all
  select t.key, t.games, t.sum_placement, coalesce(u.units, '{}'::jsonb), '{}'::jsonb
  from cl_tot t left join cl_uj u using (key)
$$;
revoke all on function public.get_tft_comp_classic_input(p_set integer, p_patch text, p_start date, p_end date) from public, anon, authenticated, service_role;
grant execute on function public.get_tft_comp_classic_input(p_set integer, p_patch text, p_start date, p_end date) to service_role;

-- Kataloge fuer ein Fenster [p_start, p_end]. Patches = p_patches oder alle
-- Patches mit crawl_meta-Tagen im Fenster. Je Patch: neueste Version mit Tag
-- <= p_end (Versionen „gueltig ab Tag“ — eine waehrend des Laufs fuer den
-- naechsten Tag geschriebene Version bleibt unsichtbar, bis das Fensterende sie
-- erreicht); genauer Patch vor Basis (B-Patch nach Umbenennung) vor dem
-- neuesten Katalog des Sets (neuer Patch, dessen erste Version noch fehlt).
-- p_end null = ohne Tagesgrenze (nur Notschalter FULL_DAY_WINDOW=0).
create or replace function public.get_tft_comp_catalog_window(p_set integer, p_start date, p_end date, p_patches text[] default null)
returns table(patch text, catalog_id bigint, catalog_patch text, scope text, scope_key text, rules_version integer, hash text, comps jsonb)
language sql
stable
as $$
  with lab as (
    select unnest(coalesce(p_patches, (
      select array_agg(distinct m.patch)
      from public.tft_daily_crawl_meta m
      where m.set_number = p_set and m.day between coalesce(p_start, p_end, current_date) and coalesce(p_end, current_date)
    ))) as patch
  ),
  pick as (
    select l.patch, c.catalog_id, c.patch as catalog_patch, c.scope, c.scope_key, c.rules_version, c.hash
    from lab l
    left join lateral (
      select c.*
      from public.tft_comp_catalog c
      where c.set_number = p_set and (c.scope = 'patch' or p_end is null or c.day <= p_end)
      order by (c.patch = l.patch) desc,
               (c.patch = regexp_replace(l.patch, '[a-z]$', '')) desc,
               (c.scope = 'day') desc, c.day desc nulls last, c.built_at desc, c.catalog_id desc
      limit 1
    ) c on true
  )
  select p.patch, p.catalog_id, p.catalog_patch, p.scope, p.scope_key, p.rules_version, p.hash,
         case when p.catalog_id is null then null else coalesce((
           select jsonb_agg(jsonb_build_object(
                    'key', e.comp_key, 'core', e.core, 'reroll', e.reroll, 'carries', e.carries,
                    'targetLevel', e.target_level, 'members', e.members, 'adopted', e.adopted, 'games', e.games)
                  order by e.games desc, e.comp_key collate "C")
           from public.tft_comp_catalog_entry e where e.catalog_id = p.catalog_id
         ), '[]'::jsonb) end
  from pick p
$$;
revoke all on function public.get_tft_comp_catalog_window(p_set integer, p_start date, p_end date, p_patches text[]) from public, anon, authenticated, service_role;
grant execute on function public.get_tft_comp_catalog_window(p_set integer, p_start date, p_end date, p_patches text[]) to service_role;

-- Selbstpruefung: Signaturen, Rechte, RLS, Spalten.
do $$
declare
  want text[] := array['get_tft_comp_classic_input(p_set integer, p_patch text, p_start date, p_end date)',
                       'get_tft_comp_catalog_window(p_set integer, p_start date, p_end date, p_patches text[])'];
  w text;
  n int;
  fid oid;
begin
  foreach w in array want loop
    select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.proname = split_part(w, '(', 1);
    if n <> 1 then raise exception '0101: % hat % Signaturen', split_part(w, '(', 1), n; end if;
    select p.oid into fid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = w;
    if fid is null then raise exception '0101: Signatur fehlt: %', w; end if;
    if has_function_privilege('anon', fid, 'execute')
       or has_function_privilege('authenticated', fid, 'execute')
       or not has_function_privilege('service_role', fid, 'execute') then
      raise exception '0101: Rechte falsch fuer %', w;
    end if;
  end loop;
  if not (select relrowsecurity from pg_class where oid = 'public.tft_daily_comp_classic'::regclass) then
    raise exception '0101: RLS aus auf tft_daily_comp_classic';
  end if;
  if has_table_privilege('anon', 'public.tft_daily_comp_classic', 'select') then
    raise exception '0101: anon liest tft_daily_comp_classic';
  end if;
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and ((table_name = 'tft_daily_crawl_meta' and column_name = 'catalog_id')
      or (table_name = 'tft_daily_comp_stats' and column_name in ('perfect_games', 'perfect_sum_placement', 'perfect_top4', 'perfect_top1', 'run_id'))
      or (table_name in ('tft_daily_comp_outcome', 'tft_daily_comp_pairs') and column_name = 'run_id'));
  if n <> 8 then raise exception '0101: % von 8 Spalten da', n; end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
