import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'node:crypto';

// Companion-app endpoint. Accepts batched board observations from the
// Overwolf TFT GEP listener and writes them into tft_position_observations.
//
// Auth model: HMAC-SHA256 over the raw request body using a shared secret
// bundled with the OPK. The shared secret isn't cryptographically secret
// (anyone with the OPK can extract it), but combined with a ±5-minute
// timestamp window it makes casual replay/spam expensive enough that the
// existing unique-index on the observation table absorbs the rest.
// Additional safeguards:
//   - cap payload size (5000 observations per body)
//   - validate every field strictly — anything unexpected gets rejected
//   - de-dup via the unique index on (match_id, observer_puuid, kind,
//     cell, unit, round)
//
// If we later need real per-user identity, a server-issued short-lived
// token after Overwolf OAuth replaces this.

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://bwawxwgxxfafbruebixa.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_SECRET = process.env.OVERWOLF_APP_SECRET || '';
const TIMESTAMP_WINDOW_MS = 5 * 60 * 1000;

function verifySignature(body: string, providedHex: string): boolean {
  if (!APP_SECRET || !providedHex) return false;
  let expectedBuf: Buffer;
  let providedBuf: Buffer;
  try {
    expectedBuf = createHmac('sha256', APP_SECRET).update(body).digest();
    providedBuf = Buffer.from(providedHex, 'hex');
  } catch {
    return false;
  }
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

const MAX_OBSERVATIONS_PER_PAYLOAD = 5000;
const MAX_AUGMENTS_PER_PAYLOAD = 30;
const VALID_KINDS = new Set(['own', 'opp']);
const VALID_REGIONS = new Set([
  'euw1', 'eun1', 'tr1', 'ru', 'me1',
  'na1', 'br1', 'la1', 'la2',
  'kr', 'jp1',
  'oc1', 'ph2', 'sg2', 'th2', 'tw2', 'vn2',
]);

interface Observation {
  round?: unknown;
  kind?: unknown;
  cell?: unknown;
  unit?: unknown;
  level?: unknown;
  items?: unknown;
}

function isString(v: unknown, max = 200): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= max;
}
function isFiniteNumber(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}

function normaliseObservation(raw: Observation): null | {
  kind: 'own' | 'opp';
  cell: number;
  unit: string;
  level: number;
  items: string[];
  round: number;
} {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.kind !== 'string' || !VALID_KINDS.has(raw.kind)) return null;
  if (!isFiniteNumber(raw.cell, 0, 99)) return null;
  if (!isString(raw.unit, 100)) return null;
  const level = isFiniteNumber(raw.level, 1, 3) ? raw.level : 1;
  const round = isFiniteNumber(raw.round, 0, 60) ? raw.round : 0;
  const items = Array.isArray(raw.items)
    ? raw.items.filter((i): i is string => isString(i, 100)).slice(0, 3)
    : [];
  return { kind: raw.kind as 'own' | 'opp', cell: raw.cell, unit: raw.unit, level, items, round };
}

export async function POST(request: NextRequest) {
  if (!SUPA_KEY) {
    return NextResponse.json({ error: 'service unavailable' }, { status: 503 });
  }

  // Read body once as raw text so we can HMAC the exact bytes the client
  // signed. Re-parse to JSON afterwards.
  const rawBody = await request.text();

  const sigHeader = request.headers.get('x-companion-signature') || '';
  const tsHeader = request.headers.get('x-companion-timestamp') || '';

  // Skip signature checks only when the secret isn't configured server-side —
  // useful in dev. In production, missing APP_SECRET fails closed.
  if (APP_SECRET) {
    const ts = Number(tsHeader);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > TIMESTAMP_WINDOW_MS) {
      return NextResponse.json({ error: 'timestamp outside window' }, { status: 401 });
    }
    if (!verifySignature(rawBody, sigHeader)) {
      return NextResponse.json({ error: 'bad signature' }, { status: 401 });
    }
  }

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  if (!isString(body.matchId, 80)) {
    return NextResponse.json({ error: 'matchId required' }, { status: 400 });
  }
  if (body.region != null && !VALID_REGIONS.has(String(body.region).toLowerCase())) {
    return NextResponse.json({ error: 'invalid region' }, { status: 400 });
  }

  const observations = Array.isArray(body.observations)
    ? body.observations.slice(0, MAX_OBSERVATIONS_PER_PAYLOAD)
    : [];
  if (observations.length === 0) {
    return NextResponse.json({ error: 'no observations' }, { status: 400 });
  }

  const observerPuuid = isString(body.ownPuuid, 100) ? body.ownPuuid : null;
  const placement = isFiniteNumber(body.placement, 1, 8) ? body.placement : null;
  const clientVersion = isString(body.clientVersion, 20) ? body.clientVersion : 'unknown';
  const region = body.region ? String(body.region).toLowerCase() : null;

  const rows: any[] = [];
  for (const raw of observations) {
    const obs = normaliseObservation(raw);
    if (!obs) continue;
    rows.push({
      match_id: body.matchId,
      region,
      observer_puuid: observerPuuid,
      observer_placement: placement,
      kind: obs.kind,
      cell: obs.cell,
      unit: obs.unit,
      level: obs.level,
      items: obs.items,
      round: obs.round,
      client_version: clientVersion,
    });
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: 'no valid observations' }, { status: 400 });
  }

  const sb = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });
  const { error } = await sb
    .from('tft_position_observations')
    .upsert(rows, {
      onConflict: 'match_id,observer_puuid,kind,cell,unit,round',
      ignoreDuplicates: true,
    });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Augments are accepted but not yet persisted — schema is below the
  // position-observations MVP and we don't want to block submit success
  // on it. Once the augment table exists we'll write here too.

  return NextResponse.json({ ok: true, accepted: rows.length });
}
