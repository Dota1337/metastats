-- Set-Bucket-Coverage + Begleit-Index fuer den Set-Pin (2026-08-27).
--
-- Hintergrund: seit dem Set-18-Start pinnen die Stats-Routen `p_set` auf das
-- laufende Set. Zum Set-Start ist die Ladder aber zurueckgesetzt — Set 18 hat
-- (gemessen 2026-08-27) NULL Rows in master/grandmaster/challenger und in der
-- Comp-Tabelle zusaetzlich null Rows in `diamond`. Der UI-Default `diamond_plus`
-- wuerde damit leere Seiten liefern statt korrigierter. Diese Funktion liefert
-- die Games-Verteilung des laufenden Sets ueber die Buckets, damit der Server
-- den Default-Bucket datenbasiert auf `all` stellen und automatisch
-- zurueckkippen kann, sobald Diamond+ traegt.
--
-- Gemessen auf tft_daily_comp_stats (nicht unit): die Comp-Tabelle ist die
-- strengste der vier — wenn sie traegt, tragen units/items/traits erst recht.
create or replace function get_tft_set_bucket_coverage(
  p_set  int,
  p_days int default 7
)
returns table (bucket text, games bigint)
language sql
stable
as $$
  select c.bucket, sum(c.games)::bigint as games
  from tft_daily_comp_stats c
  where c.set_number = p_set
    and c.day > current_date - p_days
  group by c.bucket;
$$;

grant execute on function get_tft_set_bucket_coverage(int, int)
  to anon, authenticated, service_role;

-- Begleit-Index (perf-critic 2026-08-27): mit `p_set` wechselt der Planner auf
-- idx_tft_daily_comp_day_patch und degradiert region/bucket zum Post-Filter
-- (gemessen: 12.562 "Rows Removed by Filter"). Heute harmlos, waechst aber
-- linear mit der Set-18-Ladder mit. Prefix-Match-Index mit set_number VOR dem
-- Range-Praedikat day.
create index if not exists idx_tft_daily_comp_lookup_set
  on tft_daily_comp_stats(region, bucket, set_number, day);
create index if not exists idx_tft_daily_unit_lookup_set
  on tft_daily_unit_stats(region, bucket, set_number, day);
create index if not exists idx_tft_daily_item_lookup_set
  on tft_daily_item_stats(region, bucket, set_number, day);
create index if not exists idx_tft_daily_trait_lookup_set
  on tft_daily_trait_stats(region, bucket, set_number, day);

notify pgrst, 'reload schema';
