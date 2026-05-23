import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

// GET /api/tft/comps/community?sort=top|recent&carry=X&limit=30&offset=0
//
// Reads tft_public_comps via the get_tft_public_comps RPC. Each row
// includes the full board_config so the gallery card can render the
// units without a second round-trip.

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sort = (searchParams.get('sort') || 'top').toLowerCase();
  const carry = searchParams.get('carry') || null;
  const limit = Math.max(1, Math.min(60, parseInt(searchParams.get('limit') || '30', 10)));
  const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10));

  const { data, error } = await supabase.rpc('get_tft_public_comps', {
    p_sort: sort === 'recent' ? 'recent' : 'top',
    p_carry: carry,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    comps: (data || []).map((r: any) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      boardConfig: r.board_config,
      traitLabel: r.trait_label,
      carryUnit: r.carry_unit,
      authorHandle: r.author_handle,
      upvotes: r.upvotes,
      views: r.views,
      createdAt: r.created_at,
    })),
    sort, carry, limit, offset,
  });
}
