-- 0032: Region-Divergence-RPC (Sprint W2-A)
--
-- Cross-Region-Vergleich pro cluster_key: KR vs EUW vs NA in einem Scan.
-- Liefert avg-place, pickrate und games pro Region + einen "KR-Ahead"-Score,
-- der hoch ist, wenn KR die Comp häufiger UND besser spielt als der Westen.
-- Genutzt für die Pro-Frage „was spielt KR vor uns?".
--
-- Implementation: FILTER-Aggregation in einem einzigen Scan, analog zum
-- velocity-RPC (Migration 0031) — eine Cross-Region-Query ohne 3× FROM.

create or replace function get_tft_region_divergence(
  p_buckets text[],
  p_set int default null,
  p_patch text default null,
  p_days int default 3,
  p_min_games int default 100
)
returns table (
  cluster_key text,
  games_kr bigint,
  games_eu bigint,
  games_na bigint,
  avg_place_kr double precision,
  avg_place_eu double precision,
  avg_place_na double precision,
  pickrate_kr double precision,
  pickrate_eu double precision,
  pickrate_na double precision
)
language sql
stable
as $$
  with parts as (
    select
      coalesce(sum(games) filter (where region = 'kr'),   0)::bigint as parts_kr,
      coalesce(sum(games) filter (where region = 'euw1'), 0)::bigint as parts_eu,
      coalesce(sum(games) filter (where region = 'na1'),  0)::bigint as parts_na
    from tft_daily_comp_stats
    where region in ('kr','euw1','na1')
      and bucket = any(p_buckets)
      and day > current_date - (p_days || ' days')::interval
      and (p_patch is null or patch = p_patch)
      and (p_set is null or set_number = p_set)
  ),
  agg as (
    select
      cluster_key,
      coalesce(sum(games) filter (where region = 'kr'),   0)::bigint as games_kr,
      coalesce(sum(games) filter (where region = 'euw1'), 0)::bigint as games_eu,
      coalesce(sum(games) filter (where region = 'na1'),  0)::bigint as games_na,
      coalesce(sum(sum_placement) filter (where region = 'kr'),   0)::bigint as sp_kr,
      coalesce(sum(sum_placement) filter (where region = 'euw1'), 0)::bigint as sp_eu,
      coalesce(sum(sum_placement) filter (where region = 'na1'),  0)::bigint as sp_na
    from tft_daily_comp_stats
    where region in ('kr','euw1','na1')
      and bucket = any(p_buckets)
      and day > current_date - (p_days || ' days')::interval
      and (p_patch is null or patch = p_patch)
      and (p_set is null or set_number = p_set)
    group by cluster_key
  )
  select
    a.cluster_key,
    a.games_kr,
    a.games_eu,
    a.games_na,
    case when a.games_kr > 0 then a.sp_kr::float8 / a.games_kr else null end,
    case when a.games_eu > 0 then a.sp_eu::float8 / a.games_eu else null end,
    case when a.games_na > 0 then a.sp_na::float8 / a.games_na else null end,
    case when (select parts_kr from parts) > 0
         then a.games_kr::float8 / (select parts_kr from parts) else null end,
    case when (select parts_eu from parts) > 0
         then a.games_eu::float8 / (select parts_eu from parts) else null end,
    case when (select parts_na from parts) > 0
         then a.games_na::float8 / (select parts_na from parts) else null end
  from agg a
  -- Mindestens EINE Region hat ausreichend Sample-Größe — sonst ist der
  -- Cluster aus Cross-Region-Sicht reines Rauschen.
  where greatest(a.games_kr, a.games_eu, a.games_na) >= p_min_games
$$;

notify pgrst, 'reload schema';
