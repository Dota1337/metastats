import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../../lib/supabase';
import { randomUUID } from 'node:crypto';

// POST /api/tft/comps/community/[id]/upvote
// PK (comp_id, author_token) on tft_public_comp_upvotes ensures one vote
// per cookie. Insert returns conflict → already voted, decrement vs increment
// not supported (no toggle), keep flow simple.

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[a-f0-9-]{20,}$/.test(id)) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  }

  let authorToken = req.cookies.get('tft_author_token')?.value || '';
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(authorToken)) {
    authorToken = randomUUID().replace(/-/g, '');
  }

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
      res.cookies.set('tft_author_token', authorToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 365 * 86_400,
        path: '/',
      });
      return res;
    }
    return NextResponse.json({ error: voteErr.message }, { status: 500 });
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
  res.cookies.set('tft_author_token', authorToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 365 * 86_400,
    path: '/',
  });
  return res;
}
