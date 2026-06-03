-- 0030: silence Supabase advisor 0010_security_definer_view for
-- tft_position_unit_cell while preserving its original design intent.
--
-- The view (created in 0013) was implicitly SECURITY DEFINER so the anon
-- key could read aggregated counts (unit, cell, observations,
-- distinct_observers) WITHOUT being able to read observer_puuid out of
-- tft_position_observations directly (RLS on that table has no anon
-- policy — comment block in 0022 spells this out). Supabase's advisor
-- now flags definer views in public because they can bypass caller RLS.
--
-- The right fix is NOT a flat security_invoker=on rewrite — that would
-- block anon entirely (the underlying table has no anon SELECT policy)
-- and the alternative (granting anon SELECT on tft_position_observations)
-- would expose observer_puuid via column reads, defeating the original
-- privacy boundary.
--
-- Instead: move the aggregation into a SECURITY DEFINER function (which
-- the advisor does NOT flag — definer on functions is the documented
-- pattern for elevated reads) and rebuild the view as security_invoker
-- selecting from that function. App routes that do
-- `.from('tft_position_unit_cell').select(...).in('unit', [...])` keep
-- working unchanged; PostgREST filters the function's small result set
-- (~hundreds of unit-cell pairs) on the wire.

create or replace function tft_position_unit_cell_data()
returns table (
  unit text,
  cell int,
  observations bigint,
  distinct_observers bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    unit,
    cell,
    count(*)::bigint as observations,
    count(distinct observer_puuid)::bigint as distinct_observers
  from tft_position_observations
  group by unit, cell;
$$;

grant execute on function tft_position_unit_cell_data()
  to anon, authenticated, service_role;

drop view if exists tft_position_unit_cell;
create view tft_position_unit_cell
  with (security_invoker = on)
  as select * from tft_position_unit_cell_data();

grant select on tft_position_unit_cell
  to anon, authenticated, service_role;
