-- 0100: get_tft_comp_stats mit Familien-Filter (Comp-Katalog, Phase 1).
--
-- WARUM: Eine Katalog-Comp hat Mitglieds-Familien mit verschiedenen Traits.
-- Mit dem Trait-Filter aus 0099 laedt die Detailseite ALLE Zeilen dieser
-- Traits — gemessen 20.10.2026 (alle Regionen, Diamant+, 7 Tage, 18.4):
-- Adaptor·Aphelios 1 Trait 9,4 MB → 10 Traits 107 MB, Inferno·Draven 17 → 128 MB.
-- Das war die Groessenordnung, die vor 0060 92 von 240 Detail-Staenden auf 502
-- laufen liess. p_cluster_families filtert auf die Mitglieder selbst;
-- p_cluster_traits bleibt als billiger Vorfilter (Aufrufer schicken beides).
--
-- Rueckweg: supabase/rollback/0100_tft_comp_stats_families_rollback.sql

begin;
set local lock_timeout = '2s';

-- get_tft_comp_stats ----------------------------------------------------
-- Wie 0099, dazu p_cluster_families: nur Zeilen dieser Familien
-- (`<trait>__<carry>`, dieselbe Zerlegung wie compTraitFamilyKey in
-- tft-cluster.ts und familyOfCluster in tft-comp-catalog.mjs; die
-- Selbstpruefung unten vergleicht sie an Beispielen).
drop function public.get_tft_comp_stats(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_cluster_prefix text, p_end_day date, p_cluster_traits text[]);
CREATE FUNCTION public.get_tft_comp_stats(p_regions text[], p_buckets text[], p_days integer DEFAULT 3, p_patch text DEFAULT NULL::text, p_set integer DEFAULT NULL::integer, p_min_games integer DEFAULT 30, p_cluster_prefix text DEFAULT NULL::text, p_end_day date DEFAULT NULL::date, p_cluster_traits text[] DEFAULT NULL::text[], p_cluster_families text[] DEFAULT NULL::text[])
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
      and (p_cluster_families is null or regexp_replace(f.cluster_key, '^(.+)@[0-9]+_([^#*~]+).*$', '\1__\2') = any(p_cluster_families))
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
      and (p_cluster_families is null or regexp_replace(f.cluster_key, '^(.+)@[0-9]+_([^#*~]+).*$', '\1__\2') = any(p_cluster_families))
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
revoke all on function public.get_tft_comp_stats(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_cluster_prefix text, p_end_day date, p_cluster_traits text[], p_cluster_families text[]) from public, anon, authenticated, service_role;
grant execute on function public.get_tft_comp_stats(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_cluster_prefix text, p_end_day date, p_cluster_traits text[], p_cluster_families text[]) to service_role;

-- Selbstpruefung: eine Signatur, Rechte nur service_role, Familien-Zerlegung
-- wie compTraitFamilyKey (Beispiele aus tft-cluster.ts).
do $$
declare
  w text := 'get_tft_comp_stats(p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_min_games integer, p_cluster_prefix text, p_end_day date, p_cluster_traits text[], p_cluster_families text[])';
  n int;
  fid oid;
  r record;
begin
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'get_tft_comp_stats';
  if n <> 1 then raise exception '0100: get_tft_comp_stats hat % Signaturen', n; end if;
  select p.oid into fid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = w;
  if fid is null then raise exception '0100: Signatur fehlt: %', w; end if;
  if has_function_privilege('anon', fid, 'execute')
     or has_function_privilege('authenticated', fid, 'execute')
     or not has_function_privilege('service_role', fid, 'execute') then
    raise exception '0100: Rechte falsch';
  end if;
  for r in select * from (values
      ('TFT17_Stargazer_Mountain@8_TFT17_Lulu*3#TFT17_Milio', 'TFT17_Stargazer_Mountain__TFT17_Lulu'),
      ('TFT17_SpaceGroove@3_TFT17_Samira~TwoTanky', 'TFT17_SpaceGroove__TFT17_Samira'),
      ('DA_18_Spellweaver@7_DA_18_Veigar', 'DA_18_Spellweaver__DA_18_Veigar'),
      ('DA_FloraFatalis18@2_DA_18_Azir#DA_18_Yorick', 'DA_FloraFatalis18__DA_18_Azir')) v(k, want) loop
    if regexp_replace(r.k, '^(.+)@[0-9]+_([^#*~]+).*$', '\1__\2') <> r.want then
      raise exception '0100: Familien-Zerlegung weicht ab: % → %', r.k, regexp_replace(r.k, '^(.+)@[0-9]+_([^#*~]+).*$', '\1__\2');
    end if;
  end loop;
end;
$$;

commit;

notify pgrst, 'reload schema';
