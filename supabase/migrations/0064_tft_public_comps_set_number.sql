-- Set-Achse fuer die Community-Comp-Galerie (2026-08-27)
--
-- Vorher hatte tft_public_comps keine Set-Spalte: eine im Set 17 geteilte Comp
-- war in Set 18 nicht von einer aktuellen zu unterscheiden und wurde weiter in
-- der Galerie ausgespielt. Grenze fuer den Backfill ist setStartDate aus
-- public/tft-set.json (2026-08-26) — dieselbe Grenze wie in 0063.
--
-- Der Primaerschluessel bleibt id; set_number ist eine reine Filter-Achse.

alter table public.tft_public_comps
  add column if not exists set_number smallint;

update public.tft_public_comps
   set set_number = 17
 where set_number is null and created_at < timestamptz '2026-08-26 00:00:00+00';

update public.tft_public_comps
   set set_number = 18
 where set_number is null;

create index if not exists idx_tft_public_comps_set_top
  on public.tft_public_comps (set_number, upvotes desc, created_at desc);

-- RPC bekommt p_set. Neuer Parameter => drop + create, danach Grants neu.
drop function if exists public.get_tft_public_comps(text, text, integer, integer);

create function public.get_tft_public_comps(
  p_sort  text default 'top',
  p_carry text default null,
  p_limit int default 30,
  p_offset int default 0,
  p_set   int default null
) returns table (
  id uuid,
  slug text,
  name text,
  board_config jsonb,
  trait_label text,
  carry_unit text,
  author_handle text,
  upvotes int,
  views int,
  created_at timestamptz
) language sql stable as $$
  select id, slug, name, board_config, trait_label, carry_unit,
         author_handle, upvotes, views, created_at
  from public.tft_public_comps
  where (p_carry is null or carry_unit = p_carry)
    and (p_set is null or set_number = p_set)
  order by
    case when p_sort = 'top' then upvotes end desc nulls last,
    created_at desc
  limit p_limit offset p_offset
$$;

revoke execute on function public.get_tft_public_comps(text, text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_tft_public_comps(text, text, integer, integer, integer)
  to service_role;

notify pgrst, 'reload schema';
