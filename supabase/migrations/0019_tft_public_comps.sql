-- TFT Public Comp Gallery (2026-05-23)
-- Community-shared compositions from the /tft/builder. No auth required:
-- author_token is an anonymous cookie generated client-side, used for
-- (a) "delete your own comp" and (b) upvote uniqueness.

create table if not exists tft_public_comps (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null,                                -- url-friendly id derived from name
  name          text not null,
  board_config  jsonb not null,                               -- {placements: [], oppPlacements: []}
  trait_label   text,                                          -- e.g. "Stargazer · Mountain"
  carry_unit    text,                                          -- character_id of the carry
  author_token  text not null,                                  -- anonymous cookie
  author_handle text,                                          -- optional sanitized display name
  upvotes       int  not null default 0,
  views         int  not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_tft_public_comps_recent on tft_public_comps(created_at desc);
create index if not exists idx_tft_public_comps_top on tft_public_comps(upvotes desc, created_at desc);
create index if not exists idx_tft_public_comps_carry on tft_public_comps(carry_unit);
create index if not exists idx_tft_public_comps_author on tft_public_comps(author_token);

-- Per-token upvote uniqueness. PK (comp_id, author_token) ensures no
-- double-upvotes from the same cookie even on retry.
create table if not exists tft_public_comp_upvotes (
  comp_id      uuid not null references tft_public_comps(id) on delete cascade,
  author_token text not null,
  voted_at     timestamptz not null default now(),
  primary key (comp_id, author_token)
);

create index if not exists idx_tft_public_comp_upvotes_comp on tft_public_comp_upvotes(comp_id);

alter table tft_public_comps        enable row level security;
alter table tft_public_comp_upvotes enable row level security;

create policy "anon read" on tft_public_comps        for select using (true);
create policy "anon read" on tft_public_comp_upvotes for select using (true);

-- RPC: list comps with sort + pagination + carry filter.
create or replace function get_tft_public_comps(
  p_sort  text default 'top',       -- 'top' | 'recent'
  p_carry text default null,         -- character_id filter
  p_limit int default 30,
  p_offset int default 0
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
  from tft_public_comps
  where (p_carry is null or carry_unit = p_carry)
  order by
    case when p_sort = 'top' then upvotes end desc nulls last,
    created_at desc
  limit p_limit offset p_offset
$$;

-- RPC: bump views (cheap, no upvote logic). Called on detail-view open.
create or replace function bump_tft_public_comp_views(p_id uuid)
returns void language sql as $$
  update tft_public_comps set views = views + 1 where id = p_id
$$;
