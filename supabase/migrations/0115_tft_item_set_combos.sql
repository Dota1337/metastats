-- Item-Detailseite (User 02.11.2026): „Top Item-Kombinationen" auch fuer Tank-Items. Bisher
-- rechnete die Seite sie aus carryItems (Build des Haupt-Carrys je Comp) — Protector's Vow stand
-- dort in 0 von 251 Comps. Jetzt aus den Item-Sets der Units (tft_daily_unit_builds.sets, nur
-- Units mit 3 fertigen Items): Sets mit dem Item, ueber die genannten Units und das Fenster
-- zusammengezaehlt, mit echter Platzierung.
-- Eigene schlanke Funktion statt get_tft_unit_builds: die liest alle Spalten und kappt bei 10
-- Sets je Unit (gemessen 02.11., plat+/7 Tage, PostgREST 9,0 s kalt, 15,5 s unter Last); diese
-- liest nur `sets` und nur Sets mit dem Item (1,06 s kalt, 3.136 statt ~28.000 Bloecke).
-- Auswahl und Mindestzahl macht die App (itemSetCombos in tft-detail-payload.ts).
-- Neue Funktion, keine Tabelle angefasst. Rueckbau: supabase/rollback/0115_tft_item_set_combos_rollback.sql
set lock_timeout = '5s';

begin;

create or replace function public.get_tft_item_set_combos(
  p_api_name text,
  p_character_ids text[],
  p_regions text[],
  p_buckets text[],
  p_days integer default 3,
  p_patch text default null,
  p_set integer default null,
  p_end_day date default null
)
returns table(set_key text, games bigint, top4 bigint, sum_placement bigint)
language sql
stable
as $$
  select e->>0 as set_key,
         sum((e->>1)::bigint) as games,
         sum((e->>2)::bigint) as top4,
         sum((e->>3)::bigint) as sum_placement
  from public.tft_daily_unit_builds b
  cross join lateral jsonb_array_elements(b.sets) e
  where b.character_id = any(p_character_ids)
    and b.region = any(p_regions)
    and b.bucket = any(p_buckets)
    and b.day >= coalesce(p_end_day + 1, current_date) - (p_days || ' days')::interval and b.day <= coalesce(p_end_day, current_date)
    and (p_patch is null or b.patch = p_patch)
    and (p_set is null or b.set_number = p_set)
    and p_api_name = any(string_to_array(e->>0, '|'))
  group by 1
  order by sum((e->>1)::bigint) desc, (e->>0) collate "C"
  limit 60
$$;
revoke all on function public.get_tft_item_set_combos(p_api_name text, p_character_ids text[], p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_end_day date) from public, anon, authenticated, service_role;
grant execute on function public.get_tft_item_set_combos(p_api_name text, p_character_ids text[], p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_end_day date) to service_role;

-- Selbstpruefung: genau eine Signatur, Rechte nur service_role.
do $$
declare
  w text := 'get_tft_item_set_combos(p_api_name text, p_character_ids text[], p_regions text[], p_buckets text[], p_days integer, p_patch text, p_set integer, p_end_day date)';
  n int;
  fid oid;
begin
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'get_tft_item_set_combos';
  if n <> 1 then raise exception '0115: get_tft_item_set_combos hat % Signaturen', n; end if;
  select p.oid into fid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = w;
  if fid is null then raise exception '0115: Signatur fehlt: %', w; end if;
  if has_function_privilege('anon', fid, 'execute')
     or has_function_privilege('authenticated', fid, 'execute')
     or not has_function_privilege('service_role', fid, 'execute') then
    raise exception '0115: Rechte falsch';
  end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
