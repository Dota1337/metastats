-- 0099: Comp-Katalog (User 19./20.10.2026: Comp-Liste mit dem Durchschnitt
-- ALLER Spieler einer Comp, „wie MetaTFT").
--
-- WARUM: Bisher war eine Comp der staerkste Trait am Spielende. Wer den hohen
-- Trait schaffte, hatte meist gewonnen; wer frueh rausflog, landete in einer
-- anderen Comp — daher Werte wie Ø 2,xx. Der Katalog legt je Patch fest,
-- welche Comps es gibt (Core-Units), und welche klassische Familie
-- (`<trait>__<carry>`) zu welcher Comp gehoert. Regeln und Eichung:
-- app/lib/tft-comp-catalog.mjs, .claude/plan-current.md (V1, 5.456 volle Lobbys).
--
-- Diese Migration ist nur die Lese-Seite (Phase 1): Kataloge fuer Patches mit
-- klassischen Tageszeilen; die Seite legt alte Zeilen beim Lesen um, an den
-- Tageszeilen aendert sich nichts. Sammler-Spalten (Perfekt-Zaehler,
-- catalog_id je Tag) folgen mit Phase 2 in einer eigenen Migration.
--
-- Tabellen: Kopf (eine Zeile je Katalog, eindeutig je Set x Art x Patch/Tag)
-- + Eintraege (eine Zeile je Comp). Kopf + Eintraege statt einer flachen Tabelle
-- mit Art-Spalte (architect 20.10.2026): Sammler und Tages-Marker brauchen EINE
-- Kennung samt Pruefsumme, und ON CONFLICT braucht keinen Teil-Index.
--   scope 'patch' = aus allen Tagen eines Patches gebaut, scope_key = Patch
--   scope 'day'   = Tageskatalog fuer den Sammler (Phase 2), scope_key = Tag
--
-- Lesen: get_tft_comp_catalogs (je Patch der neueste Tageskatalog, sonst der
-- Patch-Katalog) — nur service_role (callRpc in tft-comp-catalog-resolver.ts).
-- Bauen: get_tft_comp_classic_units (je cluster_key Spiele und Unit-Zaehler aus
-- den klassischen Tageszeilen; die Familien bildet scripts/build-comp-catalog.mjs
-- in JS, damit es keine dritte Schluessel-Zerlegung in SQL gibt).
-- Detailseite: get_tft_comp_stats bekommt p_cluster_traits text[] — eine Comp
-- hat Mitglieder mit verschiedenen Traits, und je Trait eine eigene Abfrage
-- laese dasselbe Fenster mehrfach (kein Index auf cluster_key).
--
-- Rueckweg: supabase/rollback/0099_tft_comp_catalog_rollback.sql

begin;
set local lock_timeout = '2s';

create table if not exists public.tft_comp_catalog (
  catalog_id bigint generated always as identity primary key,
  set_number int not null,
  scope text not null check (scope in ('patch', 'day')),
  scope_key text not null,
  patch text not null,
  day date,
  rules_version int not null,
  hash text not null,
  input_from date,
  input_to date,
  families int not null default 0,
  built_at timestamptz not null default now(),
  unique (set_number, scope, scope_key),
  check ((scope = 'patch' and day is null and scope_key = patch) or (scope = 'day' and day is not null))
);

create table if not exists public.tft_comp_catalog_entry (
  catalog_id bigint not null references public.tft_comp_catalog(catalog_id) on delete cascade,
  comp_key text not null,
  core text[] not null,
  reroll text[] not null default '{}',
  carries text[] not null default '{}',
  target_level int,
  members text[] not null default '{}',
  adopted text[] not null default '{}',
  games bigint not null default 0,
  primary key (catalog_id, comp_key)
);

alter table public.tft_comp_catalog enable row level security;
alter table public.tft_comp_catalog_entry enable row level security;
revoke all on public.tft_comp_catalog from anon, authenticated;
revoke all on public.tft_comp_catalog_entry from anon, authenticated;

-- Je Patch der neueste Tageskatalog, sonst der Patch-Katalog. Tageskataloge
-- wachsen innerhalb eines Patches nur (eingefroren, keine Comp faellt weg),
-- der neueste deckt also jedes Fenster des Patches ab.
create or replace function public.get_tft_comp_catalogs(p_set integer, p_patches text[])
returns table(catalog_id bigint, patch text, scope text, scope_key text, rules_version integer, hash text, built_at timestamptz, comps jsonb)
language sql
stable
as $$
  with pick as (
    select distinct on (c.patch) c.catalog_id, c.patch, c.scope, c.scope_key, c.rules_version, c.hash, c.built_at
    from public.tft_comp_catalog c
    where c.set_number = p_set and c.patch = any(p_patches)
    order by c.patch, (c.scope = 'day') desc, c.day desc nulls last, c.built_at desc
  )
  select p.catalog_id, p.patch, p.scope, p.scope_key, p.rules_version, p.hash, p.built_at,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'key', e.comp_key, 'core', e.core, 'reroll', e.reroll, 'carries', e.carries,
                    'targetLevel', e.target_level, 'members', e.members, 'adopted', e.adopted, 'games', e.games)
                  order by e.games desc, e.comp_key collate "C")
           from public.tft_comp_catalog_entry e where e.catalog_id = p.catalog_id
         ), '[]'::jsonb)
  from pick p
$$;
revoke all on function public.get_tft_comp_catalogs(p_set integer, p_patches text[]) from public, anon, authenticated, service_role;
grant execute on function public.get_tft_comp_catalogs(p_set integer, p_patches text[]) to service_role;

-- Eingabe fuer den Katalog-Bau aus klassischen Tageszeilen: je cluster_key die
-- Spiele und je Unit [Spiele mit der Unit, davon 3★]. Nur die neun Raenge —
-- pro_pool steckt zusaetzlich in ihnen und zaehlte sonst doppelt.
-- typical_units traegt je Zeile die haeufigsten Units (Core + Flex-Reserve);
-- eine Unit, die in einer Zeile nicht gelistet ist, zaehlt dort 0 — fuer
-- Core-Units (≥75 %) ohne Wirkung.
create or replace function public.get_tft_comp_classic_units(p_set integer, p_patch text, p_start date default null, p_end date default null)
returns table(cluster_key text, games bigint, sum_placement bigint, units jsonb)
language sql
stable
as $$
  with r as (
    select f.cluster_key, f.games, f.sum_placement, f.typical_units
    from public.tft_daily_comp_stats f
    where f.set_number = p_set
      and f.patch = p_patch
      and f.bucket = any(array['bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond', 'master', 'grandmaster', 'challenger'])
      and (p_start is null or f.day >= p_start)
      and (p_end is null or f.day <= p_end)
  ),
  tot as (
    select r.cluster_key, sum(r.games)::bigint as games, sum(r.sum_placement)::bigint as sum_placement
    from r group by 1
  ),
  u as (
    select r.cluster_key, e->>'characterId' as id,
           sum(coalesce((e->>'gamesWithUnit')::bigint, 0))::bigint as g,
           sum(coalesce((e->>'star3Games')::bigint, 0))::bigint as s3
    from r cross join lateral jsonb_array_elements(r.typical_units) e
    where e->>'characterId' is not null
    group by 1, 2
  ),
  uj as (
    select u.cluster_key, jsonb_object_agg(u.id, jsonb_build_array(u.g, u.s3)) as units
    from u group by 1
  )
  select t.cluster_key, t.games, t.sum_placement, coalesce(uj.units, '{}'::jsonb)
  from tot t left join uj on uj.cluster_key = t.cluster_key
$$;
revoke all on function public.get_tft_comp_classic_units(p_set integer, p_patch text, p_start date, p_end date) from public, anon, authenticated, service_role;
grant execute on function public.get_tft_comp_classic_units(p_set integer, p_patch text, p_start date, p_end date) to service_role;

-- get_tft_comp_stats ----------------------------------------------------
-- Wie 0095, dazu p_cluster_traits: Zeilen, deren Trait (Teil vor '@') in der
-- Liste steht. p_cluster_prefix bleibt fuer alte Aufrufer.
drop function public.get_tft_comp_stats(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_cluster_prefix text, p_end_day date);
CREATE FUNCTION public.get_tft_comp_stats(p_regions text[], p_buckets text[], p_days integer DEFAULT 3, p_patch text DEFAULT NULL::text, p_set integer DEFAULT NULL::integer, p_min_games integer DEFAULT 30, p_cluster_prefix text DEFAULT NULL::text, p_end_day date DEFAULT NULL::date, p_cluster_traits text[] DEFAULT NULL::text[])
 RETURNS TABLE(cluster_key text, games bigint, sum_placement bigint, top4 bigint, top1 bigint, sum_level bigint, sum_last_round bigint, sum_players_eliminated bigint, sum_gold_left bigint, participants bigint, typical_units_merged jsonb, typical_augments_merged jsonb, carry_items_merged jsonb, last_round_dist_merged jsonb, top4_by_round_merged jsonb, level_dist_merged jsonb, level_sum_last_round_merged jsonb, carry_star_dist_merged jsonb, contested_dist_merged jsonb, bucket_breakdown jsonb)
 LANGUAGE sql
 STABLE
AS $function$
  with parts as (
    select coalesce(sum(games), 0)::bigint as total
    from tft_daily_comp_stats
    where region = any(p_regions)
      and bucket = any(p_buckets)
      and day >= coalesce(p_end_day + 1, current_date) - (p_days || ' days')::interval and day <= coalesce(p_end_day, current_date)
      and (p_patch is null or patch = p_patch)
      and (p_set is null or set_number = p_set)
  ),
  agg as (
    select
      f.cluster_key,
      sum(f.games)::bigint as games,
      sum(f.sum_placement)::bigint as sum_placement,
      sum(f.top4)::bigint as top4,
      sum(f.top1)::bigint as top1,
      sum(coalesce(f.sum_level, 0))::bigint as sum_level,
      sum(coalesce(f.sum_last_round, 0))::bigint as sum_last_round,
      sum(coalesce(f.sum_players_eliminated, 0))::bigint as sum_players_eliminated,
      sum(coalesce(f.sum_gold_left, 0))::bigint as sum_gold_left,
      jsonb_agg(f.typical_units)    as typical_units_merged,
      jsonb_agg(f.typical_augments) as typical_augments_merged,
      jsonb_agg(f.carry_items)      as carry_items_merged,
      jsonb_agg(f.last_round_dist)  as last_round_dist_merged,
      jsonb_agg(f.top4_by_round)    as top4_by_round_merged,
      jsonb_agg(f.level_dist)       as level_dist_merged,
      jsonb_agg(f.level_sum_last_round) as level_sum_last_round_merged,
      jsonb_agg(coalesce(f.carry_star_dist, '{}'::jsonb)) as carry_star_dist_merged,
      jsonb_agg(coalesce(f.contested_dist,  '{}'::jsonb)) as contested_dist_merged
    from tft_daily_comp_stats f
    where f.region = any(p_regions)
      and f.bucket = any(p_buckets)
      and f.day >= coalesce(p_end_day + 1, current_date) - (p_days || ' days')::interval and f.day <= coalesce(p_end_day, current_date)
      and (p_patch is null or f.patch = p_patch)
      and (p_set is null or f.set_number = p_set)
      and (p_cluster_prefix is null or starts_with(f.cluster_key, p_cluster_prefix))
      and (p_cluster_traits is null or split_part(f.cluster_key, '@', 1) = any(p_cluster_traits))
    group by f.cluster_key
  ),
  bkt as (
    select
      f.cluster_key,
      f.bucket,
      sum(f.games)::bigint as games,
      sum(f.sum_placement)::bigint as sum_placement
    from tft_daily_comp_stats f
    where f.region = any(p_regions)
      and f.bucket = any(p_buckets)
      and f.day >= coalesce(p_end_day + 1, current_date) - (p_days || ' days')::interval and f.day <= coalesce(p_end_day, current_date)
      and (p_patch is null or f.patch = p_patch)
      and (p_set is null or f.set_number = p_set)
      and (p_cluster_prefix is null or starts_with(f.cluster_key, p_cluster_prefix))
      and (p_cluster_traits is null or split_part(f.cluster_key, '@', 1) = any(p_cluster_traits))
    group by f.cluster_key, f.bucket
  ),
  bkt_json as (
    select
      b.cluster_key,
      jsonb_object_agg(
        b.bucket,
        jsonb_build_object('games', b.games, 'sum_placement', b.sum_placement)
      ) as bucket_breakdown
    from bkt b
    group by b.cluster_key
  )
  select
    a.cluster_key,
    a.games,
    a.sum_placement,
    a.top4,
    a.top1,
    a.sum_level,
    a.sum_last_round,
    a.sum_players_eliminated,
    a.sum_gold_left,
    (select total from parts),
    a.typical_units_merged,
    a.typical_augments_merged,
    a.carry_items_merged,
    a.last_round_dist_merged,
    a.top4_by_round_merged,
    a.level_dist_merged,
    a.level_sum_last_round_merged,
    a.carry_star_dist_merged,
    a.contested_dist_merged,
    bj.bucket_breakdown
  from agg a
  left join bkt_json bj on bj.cluster_key = a.cluster_key
  where a.games >= p_min_games
$function$;
revoke all on function public.get_tft_comp_stats(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_cluster_prefix text, p_end_day date, p_cluster_traits text[]) from public, anon, authenticated, service_role;
grant execute on function public.get_tft_comp_stats(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_cluster_prefix text, p_end_day date, p_cluster_traits text[]) to service_role;

-- Selbstpruefung: je Funktion genau eine Signatur, Rechte nur service_role, RLS an.
do $$
declare
  want text[] := array['get_tft_comp_catalogs(p_set integer, p_patches text[])',
                       'get_tft_comp_classic_units(p_set integer, p_patch text, p_start date, p_end date)',
                       'get_tft_comp_stats(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_cluster_prefix text, p_end_day date, p_cluster_traits text[])'];
  w text;
  n int;
  fid oid;
begin
  foreach w in array want loop
    select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.proname = split_part(w, '(', 1);
    if n <> 1 then raise exception '0099: % hat % Signaturen', split_part(w, '(', 1), n; end if;
    select p.oid into fid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = w;
    if fid is null then raise exception '0099: Signatur fehlt: %', w; end if;
    if has_function_privilege('anon', fid, 'execute')
       or has_function_privilege('authenticated', fid, 'execute')
       or not has_function_privilege('service_role', fid, 'execute') then
      raise exception '0099: Rechte falsch fuer %', w;
    end if;
  end loop;
  if not (select relrowsecurity from pg_class where oid = 'public.tft_comp_catalog'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.tft_comp_catalog_entry'::regclass) then
    raise exception '0099: RLS aus';
  end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
