import { NextRequest, NextResponse } from 'next/server';

// On-demand single-player marketvalue refresh. The actual crunch happens
// on the Hetzner crawler box — this route just authenticates the caller,
// forwards the request, and relays the result back to the browser.
//
// The Hetzner side already rate-limits per (puuid, region) to 1× / 60s
// and writes both the Hetzner Postgres and Supabase in one go, so by the
// time we return 200 here the new snapshot is already visible to
// /api/tft/marktwert.

export const runtime = 'nodejs';

const HETZNER_URL = process.env.HETZNER_REFRESH_URL;
const TOKEN = process.env.REFRESH_API_TOKEN;

export async function POST(req: NextRequest) {
  if (!HETZNER_URL || !TOKEN) {
    return NextResponse.json({ error: 'refresh_disabled' }, { status: 503 });
  }

  let body: { puuid?: string; region?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const puuid = (body.puuid || '').trim();
  const region = (body.region || '').trim().toLowerCase();
  if (!puuid || !region) {
    return NextResponse.json({ error: 'puuid_and_region_required' }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${HETZNER_URL}/refresh-player`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ puuid, region }),
      // Cap at 90s — the Hetzner work can take ~30s for first-time fill;
      // anything longer is almost certainly a hung Riot call.
      signal: AbortSignal.timeout(90_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'upstream_unreachable';
    return NextResponse.json({ error: 'upstream_error', message }, { status: 502 });
  }

  const data = await upstream.json().catch(() => ({}));
  const retryAfter = upstream.headers.get('retry-after');
  return NextResponse.json(data, {
    status: upstream.status,
    headers: retryAfter ? { 'Retry-After': retryAfter } : undefined,
  });
}
