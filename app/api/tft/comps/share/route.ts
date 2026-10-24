import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';
import { CURRENT_SET } from '../../../../lib/current-set';
import { randomUUID } from 'node:crypto';
import { sanitizePlacements } from '../../../../lib/tft-public-comps';
import { checkRateLimit } from '../../../../lib/rate-limit';
import { resolveCommunityAuthor, setAuthorCookie } from '../../../../lib/community-author';

// POST /api/tft/comps/share
// Body: { name, placements, oppPlacements?, traitLabel?, carryUnit?, authorHandle? }
// placements[i]: { cell, characterId, items?, star? } — Pruefung in
// tft-public-comps.ts (Felder 0–27 je einmal, 3 Items, Stern 2–4).
// Anonymous-friendly: no auth. Die Kennung kommt aus community-author.ts
// (unterschriebenes Cookie, sonst aus der IP abgeleitet) — ausgedachte oder
// weggeworfene Cookies ergeben keinen neuen Autor mehr.
//
// Rate limit: max 5 comps per author_token per 24h, enforced by counting
// existing rows. Cheap because (author_token, created_at) is indexed.
// Davor eine Bremse je IP gegen schnelle Folgen von Aufrufen.

const MAX_NAME_LENGTH = 60;
const MAX_HANDLE_LENGTH = 24;
const DAILY_SUBMIT_CAP = 5;

function sanitizeStr(s: unknown, max: number): string | null {
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  // Strip control chars + html/script-y characters
  const safe = trimmed.replace(/[<>{}]/g, '').slice(0, max);
  return safe || null;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req, { key: 'tft-comps-share', max: 10, windowMs: 10 * 60_000 });
  if (limited) return limited;

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

  const author = await resolveCommunityAuthor(req);
  if (!author) return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  const authorToken = author.id;

  // Rate limit per author_token (24h rolling window)
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count, error: countErr } = await supabaseAdmin
    .from('tft_public_comps')
    .select('id', { count: 'exact', head: true })
    .eq('author_token', authorToken)
    .gte('created_at', since);
  if (countErr) {
    console.error('[tft/comps/share] count failed:', countErr.message);
    return NextResponse.json({ error: 'count_failed' }, { status: 500 });
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
    console.error('[tft/comps/share] insert failed:', error.message);
    return NextResponse.json({ error: 'insert_failed' }, { status: 500 });
  }

  const res = NextResponse.json({ id: data.id, slug: data.slug });
  setAuthorCookie(res, author);
  return res;
}
