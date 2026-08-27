import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';
import { CURRENT_SET } from '../../../../lib/current-set';
import { randomUUID } from 'node:crypto';

// POST /api/tft/comps/share
// Body: { name, placements, oppPlacements?, traitLabel?, carryUnit?, authorHandle? }
// Anonymous-friendly: no auth, but a cookie-stored authorToken identifies
// the submitter for (a) "delete your own" and (b) rate-limiting.
//
// Rate limit: max 5 comps per author_token per 24h, enforced by counting
// existing rows. Cheap because (author_token, created_at) is indexed.

const MAX_NAME_LENGTH = 60;
const MAX_HANDLE_LENGTH = 24;
const MAX_PLACEMENTS = 12;       // 10 board cells + a couple for opp viewport
const MAX_ITEMS_PER_UNIT = 3;
const DAILY_SUBMIT_CAP = 5;

interface Placement { cell: number; characterId: string; items?: string[] }

function sanitizeStr(s: unknown, max: number): string | null {
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  // Strip control chars + html/script-y characters
  const safe = trimmed.replace(/[<>{}]/g, '').slice(0, max);
  return safe || null;
}

function sanitizePlacements(arr: unknown): Placement[] {
  if (!Array.isArray(arr)) return [];
  const out: Placement[] = [];
  for (const p of arr) {
    if (!p || typeof p !== 'object') continue;
    const cell = Number((p as any).cell);
    const cid = sanitizeStr((p as any).characterId, 80);
    if (!Number.isInteger(cell) || cell < 0 || cell > 27 || !cid) continue;
    const items = Array.isArray((p as any).items)
      ? (p as any).items
          .filter((x: unknown) => typeof x === 'string')
          .slice(0, MAX_ITEMS_PER_UNIT)
          .map((x: string) => x.slice(0, 80))
      : [];
    out.push({ cell, characterId: cid, items });
    if (out.length >= MAX_PLACEMENTS) break;
  }
  return out;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const name = sanitizeStr(body.name, MAX_NAME_LENGTH);
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 });

  const placements = sanitizePlacements(body.placements);
  if (placements.length === 0) {
    return NextResponse.json({ error: 'placements_required' }, { status: 400 });
  }
  const oppPlacements = sanitizePlacements(body.oppPlacements);
  const traitLabel = sanitizeStr(body.traitLabel, 60);
  const carryUnit = sanitizeStr(body.carryUnit, 80);
  const authorHandle = sanitizeStr(body.authorHandle, MAX_HANDLE_LENGTH);

  // Author token from cookie or freshly minted. Cookie is set in response
  // so subsequent submissions and upvotes pick it up automatically.
  let authorToken = req.cookies.get('tft_author_token')?.value || '';
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(authorToken)) {
    authorToken = randomUUID().replace(/-/g, '');
  }

  // Rate limit per author_token (24h rolling window)
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count, error: countErr } = await supabaseAdmin
    .from('tft_public_comps')
    .select('id', { count: 'exact', head: true })
    .eq('author_token', authorToken)
    .gte('created_at', since);
  if (countErr) {
    return NextResponse.json({ error: 'count_failed', detail: countErr.message }, { status: 500 });
  }
  if ((count ?? 0) >= DAILY_SUBMIT_CAP) {
    return NextResponse.json({ error: 'rate_limited', cap: DAILY_SUBMIT_CAP }, { status: 429 });
  }

  const slug = slugify(name) || randomUUID().slice(0, 8);
  const { data, error } = await supabaseAdmin
    .from('tft_public_comps')
    .insert({
      slug,
      name,
      board_config: { placements, oppPlacements },
      trait_label: traitLabel,
      carry_unit: carryUnit,
      author_token: authorToken,
      author_handle: authorHandle,
      set_number: CURRENT_SET,
    })
    .select('id, slug')
    .single();
  if (error) {
    return NextResponse.json({ error: 'insert_failed', detail: error.message }, { status: 500 });
  }

  const res = NextResponse.json({ id: data.id, slug: data.slug });
  // 1-year cookie, HttpOnly so JS can't read but the browser still includes it
  res.cookies.set('tft_author_token', authorToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 365 * 86_400,
    path: '/',
  });
  return res;
}
