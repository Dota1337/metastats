import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '../../../../lib/rate-limit';
import { parseRegion } from '../../../../lib/regions';
import { publicError } from '../../../../lib/public-error';
import { boxFetch } from '../../../../lib/box-tls.mjs';

const PUUID_RE = /^[A-Za-z0-9_-]{20,100}$/;
// Feste Codes der Box (scripts/refresh-api-server.mjs handleRefresh/refreshOnePlayer).
const BOX_ERROR_CODES = new Set(['rate_limited', 'unknown_player', 'riot_unavailable', 'unauthorized', 'not_found', 'invalid_json']);

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
  // 10 Refreshes pro IP pro Minute — schützt vor Riot-Quota-DoS durch
  // PUUID-Rotation. Hetzner hat noch zusätzliches 60s-Lock pro (puuid,region).
  const limited = checkRateLimit(req, { key: 'marktwert-refresh', max: 10, windowMs: 60_000 });
  if (limited) return limited;

  let body: { puuid?: string; region?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const puuid = (body.puuid || '').trim();
  const rawRegion = (body.region || '').trim().toLowerCase();
  if (!puuid || !rawRegion) {
    return NextResponse.json({ error: 'puuid_and_region_required' }, { status: 400 });
  }
  // Nur echte Kennungen und Regionen an die Box: dort loest jeder Aufruf
  // Riot-Abrufe und Schreiben in zwei Datenbanken aus.
  const region = parseRegion(rawRegion);
  if (!PUUID_RE.test(puuid) || !region) {
    return NextResponse.json({ error: 'invalid_puuid_or_region' }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await boxFetch(`${HETZNER_URL}/refresh-player`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ puuid, region }),
      // Cap at 90s — the Hetzner work can take ~30s for first-time fill;
      // anything longer is almost certainly a hung Riot call.
      signal: AbortSignal.timeout(90_000),
      // Schreibt auf der Box: bei abgerissener Verbindung nicht still wiederholen.
      retry: false,
    });
  } catch (err) {
    console.error('[tft/marktwert/refresh] box failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'upstream_error' }, { status: 502 });
  }

  const data = await upstream.json().catch(() => ({}));
  const retryAfter = upstream.headers.get('retry-after');
  const headers = retryAfter ? { 'Retry-After': retryAfter } : undefined;
  if (!upstream.ok) {
    // Die Box schreibt bei unerwarteten Fehlern err.message in ihre Antwort —
    // nur ihre festen Codes gehen weiter (publicError).
    const code = typeof data?.error === 'string' && BOX_ERROR_CODES.has(data.error)
      ? data.error
      : publicError('tft/marktwert/refresh', data?.error, 'upstream_error');
    const body = typeof data?.retryAfter === 'number' ? { error: code, retryAfter: data.retryAfter } : { error: code };
    return NextResponse.json(body, { status: upstream.status, headers });
  }
  return NextResponse.json(data, { status: upstream.status, headers });
}
