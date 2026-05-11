import { NextRequest, NextResponse } from 'next/server';
import { getAvailablePatches } from '../../../lib/tft-supabase-reader';

// Returns the (patch, set) pairs that have rows in the Supabase tables in
// the last N days. Frontend uses this to populate the patch dropdown.
//   /api/tft/available-patches?days=30

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const days = Math.max(1, Math.min(180, parseInt(searchParams.get('days') || '30', 10)));
  try {
    const patches = await getAvailablePatches(days);
    return NextResponse.json({ hasData: patches.length > 0, patches });
  } catch (e: any) {
    return NextResponse.json({ hasData: false, patches: [], error: e.message }, { status: 502 });
  }
}
