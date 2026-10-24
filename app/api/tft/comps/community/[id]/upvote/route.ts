import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../../lib/supabase';
import { checkRateLimit } from '../../../../../../lib/rate-limit';
import { resolveCommunityAuthor, setAuthorCookie } from '../../../../../../lib/community-author';

// POST /api/tft/comps/community/[id]/upvote
// PK (comp_id, author_token) on tft_public_comp_upvotes ensures one vote
// per Kennung (community-author.ts: unterschriebenes Cookie, sonst aus der IP
// abgeleitet). Insert returns conflict → already voted, decrement vs increment
// not supported (no toggle), keep flow simple.

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const limited = checkRateLimit(req, { key: 'tft-comps-upvote', max: 30, windowMs: 60_000 });
  if (limited) return limited;

  const { id } = await ctx.params;
  if (!/^[a-f0-9-]{20,}$/.test(id)) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  }

  const author = await resolveCommunityAuthor(req);
  if (!author) return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  const authorToken = author.id;

  // Insert into upvotes table — PK conflict means already voted.
  const { error: voteErr } = await supabaseAdmin
    .from('tft_public_comp_upvotes')
    .insert({ comp_id: id, author_token: authorToken });
  if (voteErr) {
    if (voteErr.code === '23505') {
      // duplicate vote — return current count, idempotent UX
      const { data } = await supabaseAdmin
        .from('tft_public_comps')
        .select('upvotes')
        .eq('id', id)
        .maybeSingle();
      const res = NextResponse.json({ ok: true, upvotes: data?.upvotes ?? 0, alreadyVoted: true });
      setAuthorCookie(res, author);
      return res;
    }
    console.error('[tft/comps/upvote] insert failed:', voteErr.message);
    return NextResponse.json({ error: 'vote_failed' }, { status: 500 });
  }

  // Increment denormalized counter — race-condition tolerant via the
  // upvotes table being the canonical source. A row scan recovery is
  // possible if counter drifts.
  const { data: row, error: incErr } = await supabaseAdmin
    .from('tft_public_comps')
    .select('upvotes')
    .eq('id', id)
    .maybeSingle();
  let newCount = (row?.upvotes ?? 0) + 1;
  if (!incErr && row) {
    await supabaseAdmin
      .from('tft_public_comps')
      .update({ upvotes: newCount, updated_at: new Date().toISOString() })
      .eq('id', id);
  }

  const res = NextResponse.json({ ok: true, upvotes: newCount });
  setAuthorCookie(res, author);
  return res;
}
