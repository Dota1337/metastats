import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '../../../lib/rate-limit';
import { parseRegion } from '../../../lib/regions';
import { publicError } from '../../../lib/public-error';
import { TFT_PLAYER_SCORING_ENABLED } from '../../../lib/feature-flags';
import { fetchHetznerPlayerScoring } from '../../../lib/tft-hetzner-matches';

// POST /api/tft/player-scoring {puuid, region}
// Spieler-Bewertung fuer den Spielervergleich. Gerechnet wird auf der Box
// (scripts/lib/tft-player-scoring-endpoint.mjs); diese Route prueft Eingaben,
// begrenzt die Aufrufe und reicht die Antwort durch. Abschalten:
// TFT_PLAYER_SCORING_ENABLED in app/lib/feature-flags.ts.

export const runtime = 'nodejs';
// Box wartet hoechstens 10 s auf Riot und rechnet dann; Puffer fuer den Anlauf.
export const maxDuration = 30;

const PUUID_RE = /^[A-Za-z0-9_-]{20,100}$/;
// Feste Codes der Box — alles andere geht nur als upstream_error weiter.
const BOX_ERROR_CODES = new Set(['unknown_player', 'riot_unavailable', 'unauthorized', 'invalid_json']);

export async function POST(req: NextRequest) {
  if (!TFT_PLAYER_SCORING_ENABLED) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  // Bis zu 4 Spieler je Vergleich plus ein Nachladen je Spieler. Jeder Aufruf
  // kann auf der Box Riot-Abrufe ausloesen.
  const limited = checkRateLimit(req, { key: 'tft-player-scoring', max: 20, windowMs: 60_000 });
  if (limited) return limited;

  let body: { puuid?: string; region?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const puuid = (body?.puuid || '').trim();
  const region = parseRegion((body?.region || '').trim().toLowerCase());
  if (!PUUID_RE.test(puuid) || !region) {
    return NextResponse.json({ error: 'invalid_puuid_or_region' }, { status: 400 });
  }

  let upstream: { status: number; data: unknown };
  try {
    upstream = await fetchHetznerPlayerScoring({ puuid, region });
  } catch (err) {
    console.error('[tft/player-scoring] box failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'upstream_error' }, { status: 502 });
  }
  const noStore = { 'Cache-Control': 'no-store' };
  if (upstream.status !== 200) {
    const raw = (upstream.data as { error?: unknown } | null)?.error;
    const code = typeof raw === 'string' && BOX_ERROR_CODES.has(raw)
      ? raw
      : publicError('tft/player-scoring', raw, 'upstream_error');
    return NextResponse.json({ error: code }, { status: upstream.status, headers: noStore });
  }
  return NextResponse.json(upstream.data, { headers: noStore });
}
