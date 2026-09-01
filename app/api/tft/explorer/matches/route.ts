import { NextRequest, NextResponse } from 'next/server';
import { STATS_CACHE_CONTROL, cacheHeaders } from '../../../../lib/api-cache';
import { checkRateLimit } from '../../../../lib/rate-limit';
import { isKnownUnitId } from '../../../../lib/tft-classify-comp';

// Match-level Data Explorer endpoint. Proxies to the Hetzner refresh-api
// `/explore-matches` route, which has the GIN index + 60 GB volume to serve
// this. We rate-limit at the cache header (6h s-maxage + 24h swr) — the
// underlying query takes ~5–25s depending on filter selectivity, so a fresh
// origin hit is rare after the morning warmup.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // input is a JSON body, not URL

const HETZNER_URL = process.env.HETZNER_REFRESH_URL;
const TOKEN = process.env.REFRESH_API_TOKEN;

const VALID_REGIONS = new Set(['all', 'euw1', 'na1', 'kr', 'eun1', 'tr1', 'br1', 'la1', 'la2', 'jp1', 'oc1', 'sg2', 'tw2', 'vn2', 'ru', 'me1', 'ph2', 'th2']);

export async function POST(req: NextRequest) {
  if (!HETZNER_URL || !TOKEN) {
    return NextResponse.json({ error: 'explorer_disabled' }, { status: 503 });
  }
  // 20 Explorer-Queries pro IP pro Minute — die Hetzner-DB-Last pro Query
  // ist 5-25s, ein Angreifer könnte sonst die Box sättigen.
  const limited = checkRateLimit(req, { key: 'explorer-matches', max: 20, windowMs: 60_000 });
  if (limited) return limited;

  let body: { units?: unknown; region?: unknown; days?: unknown; limit?: unknown; starLevels?: unknown; itemCounts?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const units = Array.isArray(body.units)
    ? body.units.filter((u): u is string => typeof u === 'string' && isKnownUnitId(u)).slice(0, 6)
    : [];
  if (units.length === 0) {
    return NextResponse.json({ error: 'units_required' }, { status: 400 });
  }
  const region = typeof body.region === 'string' && VALID_REGIONS.has(body.region) ? body.region : 'all';
  const days = Math.max(1, Math.min(30, Number(body.days) || 3));
  const limit = Math.max(50, Math.min(5000, Number(body.limit) || 5000));
  // Phase A2: optional Star-Level + Items-Count filters. Empty arrays mean
  // "no filter" — preserves backwards compatibility with the old caller.
  const starLevels = Array.isArray(body.starLevels)
    ? body.starLevels.map(n => Number(n)).filter(n => Number.isInteger(n) && n >= 1 && n <= 4)
    : [];
  const itemCounts = Array.isArray(body.itemCounts)
    ? body.itemCounts.map(n => Number(n)).filter(n => Number.isInteger(n) && n >= 0 && n <= 3)
    : [];

  let upstream: Response;
  try {
    upstream = await fetch(`${HETZNER_URL}/explore-matches`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ units, region, days, limit, starLevels, itemCounts }),
      // 60s cap — the Hetzner side hits ~25s worst-case with all-region
      // selective filters; padding for network jitter.
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'upstream_unreachable';
    return NextResponse.json({ error: 'upstream_error', message }, { status: 502 });
  }

  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    return NextResponse.json(data, { status: upstream.status });
  }
  return NextResponse.json(data, {
    status: 200,
    headers: cacheHeaders(STATS_CACHE_CONTROL),
  });
}
