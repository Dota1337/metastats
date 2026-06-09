-- 0039: Velocity-RPCs für Units + Traits + Item-Anchor
--
-- Drei Funktionen analog zur Comp-Velocity (0038):
--   • get_tft_unit_velocity   — Δ pro character_id
--   • get_tft_trait_velocity  — Δ pro (name × activation), bucket-summed
--   • get_tft_item_velocity   — Anchor-Offset nachgereicht (war bisher current_date-only)
--
-- Alle drei tragen p_anchor_offset_days, damit "Letzter Tag vs vor 3T" auch
-- während Erstfill-Phasen sauber arbeitet (Anker = letzter verfügbarer
-- Stats-Tag statt current_date — siehe 0038 für Hintergrund).

-- ---------------------------------------------------------------------------
-- 1) UNITS — Δ auf Champion-Ebene
-- ---------------------------------------------------------------------------
create or replace function get_tft_unit_velocity(
  p_regions text[],
  p_buckets text[],
  p_set int default null,
  p_patch text default null,
  p_days int default 3,
  p_shift_days int default 3,
  p_min_games int default 30,
  p_anchor_offset_days int default 0
)
returns table (
  character_id text,
  games_now bigint,
  games_prev bigint,
  sum_placement_now bigint,
  sum_placement_prev bigint,
  top4_now bigint,
  top4_prev bigint,
  top1_now bigint,
  top1_prev bigint,
  participants_now bigint,
  participants_prev bigint
)
language sql
stable
as $$
  with totals as (
    select
      coalesce(sum(games) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - (p_days || ' days')::interval
          and day <= current_date - (p_anchor_offset_days || ' days')::interval
      ), 0)::bigint as parts_now,
      coalesce(sum(games) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - ((p_days + p_shift_days) || ' days')::interval
          and day <= (current_date - (p_anchor_offset_days || ' days')::interval) - (p_shift_days || ' days')::interval
      ), 0)::bigint as parts_prev
    from tft_daily_unit_stats
    where region = any(p_regions)
      and bucket = any(p_buckets)
      and day > (current_date - (p_anchor_offset_days || ' days')::interval) - ((p_days + p_shift_days) || ' days')::interval
      and day <= current_date - (p_anchor_offset_days || ' days')::interval
      and (p_patch is null or patch = p_patch)
      and (p_set is null or set_number = p_set)
  ),
  agg as (
    select
      character_id,
      sum(games) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - (p_days || ' days')::interval
          and day <= current_date - (p_anchor_offset_days || ' days')::interval
      )::bigint as games_now,
      sum(games) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - ((p_days + p_shift_days) || ' days')::interval
          and day <= (current_date - (p_anchor_offset_days || ' days')::interval) - (p_shift_days || ' days')::interval
      )::bigint as games_prev,
      sum(sum_placement) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - (p_days || ' days')::interval
          and day <= current_date - (p_anchor_offset_days || ' days')::interval
      )::bigint as sum_placement_now,
      sum(sum_placement) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - ((p_days + p_shift_days) || ' days')::interval
          and day <= (current_date - (p_anchor_offset_days || ' days')::interval) - (p_shift_days || ' days')::interval
      )::bigint as sum_placement_prev,
      sum(top4) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - (p_days || ' days')::interval
          and day <= current_date - (p_anchor_offset_days || ' days')::interval
      )::bigint as top4_now,
      sum(top4) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - ((p_days + p_shift_days) || ' days')::interval
          and day <= (current_date - (p_anchor_offset_days || ' days')::interval) - (p_shift_days || ' days')::interval
      )::bigint as top4_prev,
      sum(top1) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - (p_days || ' days')::interval
          and day <= current_date - (p_anchor_offset_days || ' days')::interval
      )::bigint as top1_now,
      sum(top1) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - ((p_days + p_shift_days) || ' days')::interval
          and day <= (current_date - (p_anchor_offset_days || ' days')::interval) - (p_shift_days || ' days')::interval
      )::bigint as top1_prev
    from tft_daily_unit_stats
    where region = any(p_regions)
      and bucket = any(p_buckets)
      and day > (current_date - (p_anchor_offset_days || ' days')::interval) - ((p_days + p_shift_days) || ' days')::interval
      and day <= current_date - (p_anchor_offset_days || ' days')::interval
      and (p_patch is null or patch = p_patch)
      and (p_set is null or set_number = p_set)
    group by character_id
  )
  select
    a.character_id,
    coalesce(a.games_now, 0),
    coalesce(a.games_prev, 0),
    coalesce(a.sum_placement_now, 0),
    coalesce(a.sum_placement_prev, 0),
    coalesce(a.top4_now, 0),
    coalesce(a.top4_prev, 0),
    coalesce(a.top1_now, 0),
    coalesce(a.top1_prev, 0),
    (select parts_now from totals),
    (select parts_prev from totals)
  from agg a
  where coalesce(a.games_now, 0) + coalesce(a.games_prev, 0) >= p_min_games
$$;

grant execute on function get_tft_unit_velocity(text[], text[], int, text, int, int, int, int)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) TRAITS — Δ pro Trait (über Aktivierungslevel hinweg gerollt)
-- ---------------------------------------------------------------------------
-- tft_daily_trait_stats hat eine Zeile pro (name, activation). Wir summieren
-- über Activation-Stufen, damit der Vergleich auf Trait-Identität läuft
-- (analog zur grouped-Traits-View im UI, das die Aktivierungen ohnehin auf
-- die best-performende Stufe pinnt).
create or replace function get_tft_trait_velocity(
  p_regions text[],
  p_buckets text[],
  p_set int default null,
  p_patch text default null,
  p_days int default 3,
  p_shift_days int default 3,
  p_min_games int default 30,
  p_anchor_offset_days int default 0
)
returns table (
  name text,
  games_now bigint,
  games_prev bigint,
  sum_placement_now bigint,
  sum_placement_prev bigint,
  top4_now bigint,
  top4_prev bigint,
  participants_now bigint,
  participants_prev bigint
)
language sql
stable
as $$
  with totals as (
    select
      coalesce(sum(games) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - (p_days || ' days')::interval
          and day <= current_date - (p_anchor_offset_days || ' days')::interval
      ), 0)::bigint as parts_now,
      coalesce(sum(games) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - ((p_days + p_shift_days) || ' days')::interval
          and day <= (current_date - (p_anchor_offset_days || ' days')::interval) - (p_shift_days || ' days')::interval
      ), 0)::bigint as parts_prev
    from tft_daily_trait_stats
    where region = any(p_regions)
      and bucket = any(p_buckets)
      and day > (current_date - (p_anchor_offset_days || ' days')::interval) - ((p_days + p_shift_days) || ' days')::interval
      and day <= current_date - (p_anchor_offset_days || ' days')::interval
      and (p_patch is null or patch = p_patch)
      and (p_set is null or set_number = p_set)
  ),
  agg as (
    select
      name,
      sum(games) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - (p_days || ' days')::interval
          and day <= current_date - (p_anchor_offset_days || ' days')::interval
      )::bigint as games_now,
      sum(games) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - ((p_days + p_shift_days) || ' days')::interval
          and day <= (current_date - (p_anchor_offset_days || ' days')::interval) - (p_shift_days || ' days')::interval
      )::bigint as games_prev,
      sum(sum_placement) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - (p_days || ' days')::interval
          and day <= current_date - (p_anchor_offset_days || ' days')::interval
      )::bigint as sum_placement_now,
      sum(sum_placement) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - ((p_days + p_shift_days) || ' days')::interval
          and day <= (current_date - (p_anchor_offset_days || ' days')::interval) - (p_shift_days || ' days')::interval
      )::bigint as sum_placement_prev,
      sum(top4) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - (p_days || ' days')::interval
          and day <= current_date - (p_anchor_offset_days || ' days')::interval
      )::bigint as top4_now,
      sum(top4) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - ((p_days + p_shift_days) || ' days')::interval
          and day <= (current_date - (p_anchor_offset_days || ' days')::interval) - (p_shift_days || ' days')::interval
      )::bigint as top4_prev
    from tft_daily_trait_stats
    where region = any(p_regions)
      and bucket = any(p_buckets)
      and day > (current_date - (p_anchor_offset_days || ' days')::interval) - ((p_days + p_shift_days) || ' days')::interval
      and day <= current_date - (p_anchor_offset_days || ' days')::interval
      and (p_patch is null or patch = p_patch)
      and (p_set is null or set_number = p_set)
    group by name
  )
  select
    a.name,
    coalesce(a.games_now, 0),
    coalesce(a.games_prev, 0),
    coalesce(a.sum_placement_now, 0),
    coalesce(a.sum_placement_prev, 0),
    coalesce(a.top4_now, 0),
    coalesce(a.top4_prev, 0),
    (select parts_now from totals),
    (select parts_prev from totals)
  from agg a
  where coalesce(a.games_now, 0) + coalesce(a.games_prev, 0) >= p_min_games
$$;

grant execute on function get_tft_trait_velocity(text[], text[], int, text, int, int, int, int)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) ITEMS — Anchor-Offset zur bestehenden RPC nachreichen
-- ---------------------------------------------------------------------------
create or replace function get_tft_item_velocity(
  p_regions text[],
  p_buckets text[],
  p_set int default null,
  p_patch text default null,
  p_days int default 3,
  p_shift_days int default 3,
  p_min_games int default 30,
  p_anchor_offset_days int default 0
)
returns table (
  api_name text,
  games_now bigint,
  games_prev bigint,
  sum_placement_now bigint,
  sum_placement_prev bigint,
  top4_now bigint,
  top4_prev bigint,
  total_slots_now bigint,
  total_slots_prev bigint
)
language sql
stable
as $$
  with totals as (
    select
      coalesce(sum(games) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - (p_days || ' days')::interval
          and day <= current_date - (p_anchor_offset_days || ' days')::interval
      ), 0)::bigint as slots_now,
      coalesce(sum(games) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - ((p_days + p_shift_days) || ' days')::interval
          and day <= (current_date - (p_anchor_offset_days || ' days')::interval) - (p_shift_days || ' days')::interval
      ), 0)::bigint as slots_prev
    from tft_daily_item_stats
    where region = any(p_regions)
      and bucket = any(p_buckets)
      and day > (current_date - (p_anchor_offset_days || ' days')::interval) - ((p_days + p_shift_days) || ' days')::interval
      and day <= current_date - (p_anchor_offset_days || ' days')::interval
      and (p_patch is null or patch = p_patch)
      and (p_set is null or set_number = p_set)
  ),
  agg as (
    select
      api_name,
      sum(games) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - (p_days || ' days')::interval
          and day <= current_date - (p_anchor_offset_days || ' days')::interval
      )::bigint as games_now,
      sum(games) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - ((p_days + p_shift_days) || ' days')::interval
          and day <= (current_date - (p_anchor_offset_days || ' days')::interval) - (p_shift_days || ' days')::interval
      )::bigint as games_prev,
      sum(sum_placement) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - (p_days || ' days')::interval
          and day <= current_date - (p_anchor_offset_days || ' days')::interval
      )::bigint as sum_placement_now,
      sum(sum_placement) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - ((p_days + p_shift_days) || ' days')::interval
          and day <= (current_date - (p_anchor_offset_days || ' days')::interval) - (p_shift_days || ' days')::interval
      )::bigint as sum_placement_prev,
      sum(top4) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - (p_days || ' days')::interval
          and day <= current_date - (p_anchor_offset_days || ' days')::interval
      )::bigint as top4_now,
      sum(top4) filter (
        where day > (current_date - (p_anchor_offset_days || ' days')::interval) - ((p_days + p_shift_days) || ' days')::interval
          and day <= (current_date - (p_anchor_offset_days || ' days')::interval) - (p_shift_days || ' days')::interval
      )::bigint as top4_prev
    from tft_daily_item_stats
    where region = any(p_regions)
      and bucket = any(p_buckets)
      and day > (current_date - (p_anchor_offset_days || ' days')::interval) - ((p_days + p_shift_days) || ' days')::interval
      and day <= current_date - (p_anchor_offset_days || ' days')::interval
      and (p_patch is null or patch = p_patch)
      and (p_set is null or set_number = p_set)
    group by api_name
  )
  select
    a.api_name,
    coalesce(a.games_now, 0),
    coalesce(a.games_prev, 0),
    coalesce(a.sum_placement_now, 0),
    coalesce(a.sum_placement_prev, 0),
    coalesce(a.top4_now, 0),
    coalesce(a.top4_prev, 0),
    (select slots_now from totals),
    (select slots_prev from totals)
  from agg a
  where coalesce(a.games_now, 0) + coalesce(a.games_prev, 0) >= p_min_games
$$;

grant execute on function get_tft_item_velocity(text[], text[], int, text, int, int, int, int)
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
