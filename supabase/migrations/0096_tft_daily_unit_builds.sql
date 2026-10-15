-- 0096: Item-Bloecke der Unit- und Item-Detailseite aus der Datenbank (F2-D, 15.10.2026).
--
-- WARUM: Top-Builds, Items je Stern und die Item-Plaetze kamen bisher nur aus der
-- EUW-Datei (bei „alle Regionen" EUW, bei 14 Regionen gar nichts), die
-- Prozentwerte der Plaetze nur ueber die Top 3, der Standard-Stern per
-- Gleichstand 1★. Jetzt taeglich je Region in einer Nebentabelle wie 0069, eine
-- Zeile je Region x Rang x Tag x Unit.
--
-- Spalten (kompakte Arrays statt Objekte, ~20 % kleiner; Werte ganzzahlig):
--   stars         {"1": n, "2": n, "3": n}                 Kopien je Stern
--   sets          [[key, games, top4, sumPlacement], …]     key = sortierte Items mit "|"
--   items_by_tier {"<stern>": [[item, games, top4, sumPlacement], …]}   nur fertige Items
--   sets_by_tier  {"<stern>": [[key, games, top4, sumPlacement], …]}
--   slots_by_tier {"<stern>": {"<platz 0-2>": [summe, [[item, anzahl], …]]}}
--                 summe = ALLE Kopien mit einem Item auf diesem Platz (Prozent-Nenner),
--                 Kopien mit Thief's Gloves zaehlen nicht (Items dort zufaellig).
-- Auswahl und Kappen im Aggregator (scripts/lib/tft-build-aggregator.mjs,
-- persistBuilds). Aufbewahrung 9 Tage, geloescht vom Writer
-- (scripts/lib/tft-supabase-writer.mjs, Block 8b) — die App fragt hoechstens 7
-- volle Tage (0095).
--
-- Lesen: get_tft_unit_builds (je Unit ein jsonb, Summen ueber das Fenster, die
-- haeufigsten Items aus tft_daily_unit_top_items, deren Verlauf schon da ist) und
-- get_tft_item_carriers (Traeger je Item aus tft_daily_item_stats.top_users).
-- Beide nur fuer service_role (Aufrufer: callRpc in app/lib/tft-detail-builds.ts).
--
-- Rueckweg: supabase/rollback/0096_tft_daily_unit_builds_rollback.sql

begin;
set local lock_timeout = '2s';

create table if not exists public.tft_daily_unit_builds (
  region text not null,
  bucket text not null,
  patch text not null,
  set_number int not null,
  day date not null,
  character_id text not null,
  stars jsonb not null default '{}'::jsonb,
  sets jsonb not null default '[]'::jsonb,
  items_by_tier jsonb not null default '{}'::jsonb,
  sets_by_tier jsonb not null default '{}'::jsonb,
  slots_by_tier jsonb not null default '{}'::jsonb,
  primary key (region, bucket, patch, set_number, day, character_id)
);
-- Detailseite fragt EINE Unit ueber alle Regionen/Raenge/Tage.
create index if not exists idx_tft_daily_unit_builds_char
  on public.tft_daily_unit_builds(character_id, day);

alter table public.tft_daily_unit_builds enable row level security;
revoke all on public.tft_daily_unit_builds from anon, authenticated;

-- Autovacuum wie 0069 — taeglicher Bulk-Upsert + Loeschen, sonst kalte Visibility-Map.
alter table public.tft_daily_unit_builds set (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_vacuum_cost_limit = 2000);

-- Fenster wie 0095: mit p_end_day genau p_days volle Tage, ohne das alte Fenster.
-- Gleichstand ueberall: games desc, dann Schluessel in Byte-Reihenfolge — die
-- Anzeige springt nicht zwischen zwei Aufrufen.
create or replace function public.get_tft_unit_builds(
  p_character_ids text[],
  p_regions text[],
  p_buckets text[],
  p_days integer default 3,
  p_patch text default null,
  p_set integer default null,
  p_end_day date default null
)
returns table(character_id text, builds jsonb)
language sql
stable
as $$
  with r as (
    select b.character_id, b.stars, b.sets, b.items_by_tier, b.sets_by_tier, b.slots_by_tier
    from public.tft_daily_unit_builds b
    where (p_character_ids is null or b.character_id = any(p_character_ids))
      and b.region = any(p_regions)
      and b.bucket = any(p_buckets)
      and b.day >= coalesce(p_end_day + 1, current_date) - (p_days || ' days')::interval and b.day <= coalesce(p_end_day, current_date)
      and (p_patch is null or b.patch = p_patch)
      and (p_set is null or b.set_number = p_set)
  ),
  stars as (
    select character_id, jsonb_object_agg(tier, g) as j
    from (
      select r.character_id, e.key as tier, sum(e.value::bigint) as g
      from r cross join lateral jsonb_each_text(r.stars) e
      group by 1, 2
    ) s
    group by 1
  ),
  sets_sum as (
    select r.character_id, e->>0 as k, sum((e->>1)::bigint) as g, sum((e->>2)::bigint) as t4, sum((e->>3)::bigint) as sp
    from r cross join lateral jsonb_array_elements(r.sets) e
    group by 1, 2
  ),
  sets_j as (
    select character_id, jsonb_agg(jsonb_build_array(k, g, t4, sp) order by g desc, k collate "C") as j
    from (select s.*, row_number() over (partition by s.character_id order by s.g desc, s.k collate "C") as rn from sets_sum s) x
    where rn <= 10
    group by 1
  ),
  tier_items_sum as (
    select r.character_id, t.key as tier, e->>0 as k, sum((e->>1)::bigint) as g, sum((e->>2)::bigint) as t4, sum((e->>3)::bigint) as sp
    from r cross join lateral jsonb_each(r.items_by_tier) t
    cross join lateral jsonb_array_elements(t.value) e
    group by 1, 2, 3
  ),
  tier_items_j as (
    select character_id, jsonb_object_agg(tier, arr) as j
    from (
      select character_id, tier, jsonb_agg(jsonb_build_array(k, g, t4, sp) order by g desc, k collate "C") as arr
      from (select s.*, row_number() over (partition by s.character_id, s.tier order by s.g desc, s.k collate "C") as rn from tier_items_sum s) x
      where rn <= 12
      group by 1, 2
    ) y
    group by 1
  ),
  tier_sets_sum as (
    select r.character_id, t.key as tier, e->>0 as k, sum((e->>1)::bigint) as g, sum((e->>2)::bigint) as t4, sum((e->>3)::bigint) as sp
    from r cross join lateral jsonb_each(r.sets_by_tier) t
    cross join lateral jsonb_array_elements(t.value) e
    group by 1, 2, 3
  ),
  tier_sets_j as (
    select character_id, jsonb_object_agg(tier, arr) as j
    from (
      select character_id, tier, jsonb_agg(jsonb_build_array(k, g, t4, sp) order by g desc, k collate "C") as arr
      from (select s.*, row_number() over (partition by s.character_id, s.tier order by s.g desc, s.k collate "C") as rn from tier_sets_sum s) x
      where rn <= 5
      group by 1, 2
    ) y
    group by 1
  ),
  slot_rows as (
    select r.character_id, t.key as tier, s.key as slot, (s.value->>0)::bigint as total, s.value->1 as entries
    from r cross join lateral jsonb_each(r.slots_by_tier) t
    cross join lateral jsonb_each(t.value) s
  ),
  slot_totals as (
    select character_id, tier, slot, sum(total) as total from slot_rows group by 1, 2, 3
  ),
  slot_items as (
    select s.character_id, s.tier, s.slot, e->>0 as k, sum((e->>1)::bigint) as c
    from slot_rows s cross join lateral jsonb_array_elements(s.entries) e
    group by 1, 2, 3, 4
  ),
  slot_j as (
    select t.character_id, t.tier, t.slot,
           jsonb_build_array(t.total, coalesce(i.arr, '[]'::jsonb)) as j
    from slot_totals t
    left join (
      select character_id, tier, slot, jsonb_agg(jsonb_build_array(k, c) order by c desc, k collate "C") as arr
      from (select s.*, row_number() over (partition by s.character_id, s.tier, s.slot order by s.c desc, s.k collate "C") as rn from slot_items s) x
      where rn <= 6
      group by 1, 2, 3
    ) i using (character_id, tier, slot)
  ),
  slots_by_tier_j as (
    select character_id, jsonb_object_agg(tier, slots) as j
    from (select character_id, tier, jsonb_object_agg(slot, j) as slots from slot_j group by 1, 2) y
    group by 1
  ),
  top_items_sum as (
    select t.character_id, e.item as k, sum(e.games)::bigint as g, sum(e.top4)::bigint as t4, sum(e."sumPlacement")::bigint as sp
    from public.tft_daily_unit_top_items t
    cross join lateral jsonb_to_recordset(t.items) as e(item text, games int, top4 int, "sumPlacement" int)
    where (p_character_ids is null or t.character_id = any(p_character_ids))
      and t.region = any(p_regions)
      and t.bucket = any(p_buckets)
      and t.day >= coalesce(p_end_day + 1, current_date) - (p_days || ' days')::interval and t.day <= coalesce(p_end_day, current_date)
      and (p_patch is null or t.patch = p_patch)
      and (p_set is null or t.set_number = p_set)
      and e.item is not null
    group by 1, 2
  ),
  top_items_j as (
    select character_id, jsonb_agg(jsonb_build_array(k, g, t4, sp) order by g desc, k collate "C") as j
    from (select s.*, row_number() over (partition by s.character_id order by s.g desc, s.k collate "C") as rn from top_items_sum s) x
    where rn <= 12
    group by 1
  ),
  ids as (
    select distinct character_id from r
    union
    select character_id from top_items_j
  )
  select ids.character_id,
         jsonb_build_object(
           'stars', coalesce(stars.j, '{}'::jsonb),
           'sets', coalesce(sets_j.j, '[]'::jsonb),
           'itemsByTier', coalesce(tier_items_j.j, '{}'::jsonb),
           'setsByTier', coalesce(tier_sets_j.j, '{}'::jsonb),
           'slotsByTier', coalesce(slots_by_tier_j.j, '{}'::jsonb),
           'topItems', coalesce(top_items_j.j, '[]'::jsonb)
         )
  from ids
  left join stars using (character_id)
  left join sets_j using (character_id)
  left join tier_items_j using (character_id)
  left join tier_sets_j using (character_id)
  left join slots_by_tier_j using (character_id)
  left join top_items_j using (character_id)
$$;
revoke all on function public.get_tft_unit_builds(p_character_ids text[], p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_end_day date) from public, anon, authenticated, service_role;
grant execute on function public.get_tft_unit_builds(p_character_ids text[], p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_end_day date) to service_role;

-- Traeger je Item: Summen ueber das Fenster aus den taeglichen Top-Listen
-- (Kappe im Aggregator 25 je Zeile). [characterId, games, sumPlacement, top4, top1],
-- die 15 meistgespielten.
create or replace function public.get_tft_item_carriers(
  p_api_names text[],
  p_regions text[],
  p_buckets text[],
  p_days integer default 3,
  p_patch text default null,
  p_set integer default null,
  p_end_day date default null
)
returns table(api_name text, carriers jsonb)
language sql
stable
as $$
  with users as (
    select f.api_name, u->>'characterId' as k,
           sum((u->>'games')::bigint) as g,
           sum(coalesce((u->>'sumPlacement')::bigint, 0)) as sp,
           sum(coalesce((u->>'top4')::bigint, 0)) as t4,
           sum(coalesce((u->>'top1')::bigint, 0)) as t1
    from public.tft_daily_item_stats f
    cross join lateral jsonb_array_elements(f.top_users) u
    where (p_api_names is null or f.api_name = any(p_api_names))
      and f.region = any(p_regions)
      and f.bucket = any(p_buckets)
      and f.day >= coalesce(p_end_day + 1, current_date) - (p_days || ' days')::interval and f.day <= coalesce(p_end_day, current_date)
      and (p_patch is null or f.patch = p_patch)
      and (p_set is null or f.set_number = p_set)
      and u->>'characterId' is not null
    group by 1, 2
  )
  select api_name, jsonb_agg(jsonb_build_array(k, g, sp, t4, t1) order by g desc, k collate "C")
  from (select u.*, row_number() over (partition by u.api_name order by u.g desc, u.k collate "C") as rn from users u) x
  where rn <= 15
  group by api_name
$$;
revoke all on function public.get_tft_item_carriers(p_api_names text[], p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_end_day date) from public, anon, authenticated, service_role;
grant execute on function public.get_tft_item_carriers(p_api_names text[], p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_end_day date) to service_role;

-- Selbstpruefung: je Funktion genau eine Signatur, Rechte nur service_role, RLS an.
do $$
declare
  want text[] := array['get_tft_unit_builds(p_character_ids text[], p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_end_day date)',
                       'get_tft_item_carriers(p_api_names text[], p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_end_day date)'];
  w text;
  n int;
  fid oid;
begin
  foreach w in array want loop
    select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.proname = split_part(w, '(', 1);
    if n <> 1 then raise exception '0096: % hat % Signaturen', split_part(w, '(', 1), n; end if;
    select p.oid into fid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = w;
    if fid is null then raise exception '0096: Signatur fehlt: %', w; end if;
    if has_function_privilege('anon', fid, 'execute')
       or has_function_privilege('authenticated', fid, 'execute')
       or not has_function_privilege('service_role', fid, 'execute') then
      raise exception '0096: Rechte falsch fuer %', w;
    end if;
  end loop;
  if not (select relrowsecurity from pg_class where oid = 'public.tft_daily_unit_builds'::regclass) then
    raise exception '0096: RLS aus';
  end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
