-- Einmaliges Nachfuellen von tft_daily_unit_extras (0097) fuer Set 18 aus den
-- Traeger-Listen der Item-Statistik (tft_daily_item_stats.top_users).
--
-- Gleiche Zaehl-Einheit wie der Sammler (je Kopie, aggregator: byItem.users und
-- byUnit.items zaehlen beide je Kopie). Aber nur Untergrenze: top_users haelt
-- je Item und Tag die Top 10 (ab Branch-Stand 25) Traeger, und Item-Zeilen gibt
-- es erst ab 5 Kopien. Deshalb source = 'carriers'.
--
-- Wiederholbar: ueberspringt Region x Tag, fuer die der Sammler schon Zeilen
-- geschrieben hat (source = 'collector'), und laesst bestehende Zeilen stehen.
-- Der Sammler loescht seinerseits Region x Tag, bevor er schreibt (Block 8c).
--
-- Ausfuehren: node scripts/db-exec.mjs scripts/oneoff/backfill-unit-extras.sql
-- Eine Anweisung je Woche, jede fuer sich gespeichert.

set statement_timeout = '300s';

insert into public.tft_daily_unit_extras (region, bucket, patch, set_number, day, character_id, items, source)
select f.region, f.bucket, f.patch, f.set_number, f.day, u->>'characterId',
       jsonb_agg(jsonb_build_array(f.api_name, (u->>'games')::int, coalesce((u->>'top4')::int, 0), coalesce((u->>'sumPlacement')::int, 0))
                 order by (u->>'games')::int desc, f.api_name collate "C"),
       'carriers'
from public.tft_daily_item_stats f
cross join lateral jsonb_array_elements(f.top_users) u
where f.set_number = 18 and f.day between '2026-08-26' and '2026-09-01'
  and (f.api_name ~* '_Artifact_' or (f.api_name ~* 'Emblem' and f.api_name !~* '(Augment|Phantom)'))
  and u->>'characterId' is not null
  and not exists (select 1 from public.tft_daily_unit_extras x where x.region = f.region and x.day = f.day and x.source = 'collector')
group by f.region, f.bucket, f.patch, f.set_number, f.day, u->>'characterId'
on conflict (region, bucket, patch, set_number, day, character_id) do nothing;

insert into public.tft_daily_unit_extras (region, bucket, patch, set_number, day, character_id, items, source)
select f.region, f.bucket, f.patch, f.set_number, f.day, u->>'characterId',
       jsonb_agg(jsonb_build_array(f.api_name, (u->>'games')::int, coalesce((u->>'top4')::int, 0), coalesce((u->>'sumPlacement')::int, 0))
                 order by (u->>'games')::int desc, f.api_name collate "C"),
       'carriers'
from public.tft_daily_item_stats f
cross join lateral jsonb_array_elements(f.top_users) u
where f.set_number = 18 and f.day between '2026-09-02' and '2026-09-08'
  and (f.api_name ~* '_Artifact_' or (f.api_name ~* 'Emblem' and f.api_name !~* '(Augment|Phantom)'))
  and u->>'characterId' is not null
  and not exists (select 1 from public.tft_daily_unit_extras x where x.region = f.region and x.day = f.day and x.source = 'collector')
group by f.region, f.bucket, f.patch, f.set_number, f.day, u->>'characterId'
on conflict (region, bucket, patch, set_number, day, character_id) do nothing;

insert into public.tft_daily_unit_extras (region, bucket, patch, set_number, day, character_id, items, source)
select f.region, f.bucket, f.patch, f.set_number, f.day, u->>'characterId',
       jsonb_agg(jsonb_build_array(f.api_name, (u->>'games')::int, coalesce((u->>'top4')::int, 0), coalesce((u->>'sumPlacement')::int, 0))
                 order by (u->>'games')::int desc, f.api_name collate "C"),
       'carriers'
from public.tft_daily_item_stats f
cross join lateral jsonb_array_elements(f.top_users) u
where f.set_number = 18 and f.day between '2026-09-09' and '2026-09-15'
  and (f.api_name ~* '_Artifact_' or (f.api_name ~* 'Emblem' and f.api_name !~* '(Augment|Phantom)'))
  and u->>'characterId' is not null
  and not exists (select 1 from public.tft_daily_unit_extras x where x.region = f.region and x.day = f.day and x.source = 'collector')
group by f.region, f.bucket, f.patch, f.set_number, f.day, u->>'characterId'
on conflict (region, bucket, patch, set_number, day, character_id) do nothing;

insert into public.tft_daily_unit_extras (region, bucket, patch, set_number, day, character_id, items, source)
select f.region, f.bucket, f.patch, f.set_number, f.day, u->>'characterId',
       jsonb_agg(jsonb_build_array(f.api_name, (u->>'games')::int, coalesce((u->>'top4')::int, 0), coalesce((u->>'sumPlacement')::int, 0))
                 order by (u->>'games')::int desc, f.api_name collate "C"),
       'carriers'
from public.tft_daily_item_stats f
cross join lateral jsonb_array_elements(f.top_users) u
where f.set_number = 18 and f.day between '2026-09-16' and '2026-09-22'
  and (f.api_name ~* '_Artifact_' or (f.api_name ~* 'Emblem' and f.api_name !~* '(Augment|Phantom)'))
  and u->>'characterId' is not null
  and not exists (select 1 from public.tft_daily_unit_extras x where x.region = f.region and x.day = f.day and x.source = 'collector')
group by f.region, f.bucket, f.patch, f.set_number, f.day, u->>'characterId'
on conflict (region, bucket, patch, set_number, day, character_id) do nothing;

insert into public.tft_daily_unit_extras (region, bucket, patch, set_number, day, character_id, items, source)
select f.region, f.bucket, f.patch, f.set_number, f.day, u->>'characterId',
       jsonb_agg(jsonb_build_array(f.api_name, (u->>'games')::int, coalesce((u->>'top4')::int, 0), coalesce((u->>'sumPlacement')::int, 0))
                 order by (u->>'games')::int desc, f.api_name collate "C"),
       'carriers'
from public.tft_daily_item_stats f
cross join lateral jsonb_array_elements(f.top_users) u
where f.set_number = 18 and f.day between '2026-09-23' and '2026-09-29'
  and (f.api_name ~* '_Artifact_' or (f.api_name ~* 'Emblem' and f.api_name !~* '(Augment|Phantom)'))
  and u->>'characterId' is not null
  and not exists (select 1 from public.tft_daily_unit_extras x where x.region = f.region and x.day = f.day and x.source = 'collector')
group by f.region, f.bucket, f.patch, f.set_number, f.day, u->>'characterId'
on conflict (region, bucket, patch, set_number, day, character_id) do nothing;

insert into public.tft_daily_unit_extras (region, bucket, patch, set_number, day, character_id, items, source)
select f.region, f.bucket, f.patch, f.set_number, f.day, u->>'characterId',
       jsonb_agg(jsonb_build_array(f.api_name, (u->>'games')::int, coalesce((u->>'top4')::int, 0), coalesce((u->>'sumPlacement')::int, 0))
                 order by (u->>'games')::int desc, f.api_name collate "C"),
       'carriers'
from public.tft_daily_item_stats f
cross join lateral jsonb_array_elements(f.top_users) u
where f.set_number = 18 and f.day between '2026-09-30' and '2026-10-06'
  and (f.api_name ~* '_Artifact_' or (f.api_name ~* 'Emblem' and f.api_name !~* '(Augment|Phantom)'))
  and u->>'characterId' is not null
  and not exists (select 1 from public.tft_daily_unit_extras x where x.region = f.region and x.day = f.day and x.source = 'collector')
group by f.region, f.bucket, f.patch, f.set_number, f.day, u->>'characterId'
on conflict (region, bucket, patch, set_number, day, character_id) do nothing;

insert into public.tft_daily_unit_extras (region, bucket, patch, set_number, day, character_id, items, source)
select f.region, f.bucket, f.patch, f.set_number, f.day, u->>'characterId',
       jsonb_agg(jsonb_build_array(f.api_name, (u->>'games')::int, coalesce((u->>'top4')::int, 0), coalesce((u->>'sumPlacement')::int, 0))
                 order by (u->>'games')::int desc, f.api_name collate "C"),
       'carriers'
from public.tft_daily_item_stats f
cross join lateral jsonb_array_elements(f.top_users) u
where f.set_number = 18 and f.day >= '2026-10-07'
  and (f.api_name ~* '_Artifact_' or (f.api_name ~* 'Emblem' and f.api_name !~* '(Augment|Phantom)'))
  and u->>'characterId' is not null
  and not exists (select 1 from public.tft_daily_unit_extras x where x.region = f.region and x.day = f.day and x.source = 'collector')
group by f.region, f.bucket, f.patch, f.set_number, f.day, u->>'characterId'
on conflict (region, bucket, patch, set_number, day, character_id) do nothing;

select source, count(*) as rows, min(day) as first_day, max(day) as last_day
from public.tft_daily_unit_extras group by source order by source;
