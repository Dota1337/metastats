import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { revalidatePath, revalidateTag } from 'next/cache';

// Push-Invalidation-Endpoint für den Hetzner-Crawler. Nach einem erfolgreichen
// Crawl ruft das Crawler-Script diesen POST mit der Liste der Edge-Cache-Pfade
// auf, die invalidiert werden sollen — sodass die nächsten User innerhalb von
// Sekunden frische Daten sehen statt 6h auf den nächsten Cache-Refresh zu warten.
//
// Auth-Modell: HMAC-SHA256 über `timestamp + raw body` mit einem geteilten
// Secret (REVALIDATE_SECRET). Plus ±5min Timestamp-Window gegen Replay. Das
// Secret lebt in .env.local + Vercel + Hetzner /etc/metastats-crawler/env.
//
// Request:
//   POST /api/internal/revalidate
//   Headers:
//     X-Revalidate-Timestamp: <ms-since-epoch>
//     X-Revalidate-Signature: <hmac-sha256(timestamp + body)-hex>
//     Content-Type: application/json
//   Body:
//     {
//       "paths": ["/api/tft/comps", "/api/tft/units", ...],
//       "tags":  ["tft-stats"]    // optional
//     }
//
// Response:
//   200 { ok: true, revalidated: { paths: [...], tags: [...] } }
//   401 / 400 bei Auth- oder Body-Fehlern (immer ohne Details, um Probing zu erschweren)

const SECRET = process.env.REVALIDATE_SECRET || '';
const TIMESTAMP_WINDOW_MS = 5 * 60 * 1000;
const MAX_BODY_BYTES = 8 * 1024;     // Wir invalidieren Path-Listen, keine Payloads.
const MAX_PATHS = 50;
const MAX_TAGS = 50;

function deny(status: number, msg = 'forbidden'): NextResponse {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

function verifySignature(timestamp: string, body: string, providedHex: string): boolean {
  if (!SECRET || !providedHex) return false;
  let expectedBuf: Buffer;
  let providedBuf: Buffer;
  try {
    expectedBuf = createHmac('sha256', SECRET).update(timestamp + body).digest();
    providedBuf = Buffer.from(providedHex, 'hex');
  } catch {
    return false;
  }
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

function isSafePath(p: unknown): p is string {
  // Nur interne API-Pfade, keine externen Redirects oder Pfade ohne führenden Slash.
  // Konzentriert sich auf /api/* — Frontend-Routen werden eh ISR-gesteuert.
  return typeof p === 'string'
    && p.length > 0
    && p.length < 256
    && p.startsWith('/')
    && !p.includes('://')
    && !p.includes('\0');
}

function isSafeTag(t: unknown): t is string {
  return typeof t === 'string' && t.length > 0 && t.length < 128 && /^[\w:-]+$/.test(t);
}

export async function POST(request: NextRequest) {
  if (!SECRET) {
    // Hard-fail wenn der Server nicht konfiguriert ist — sonst würde jede
    // Push-Invalidation in einen 401 laufen ohne dass jemand merkt, dass der
    // Secret-Sync fehlgeschlagen ist.
    return deny(500, 'server not configured');
  }

  const timestamp = request.headers.get('x-revalidate-timestamp') || '';
  const signature = request.headers.get('x-revalidate-signature') || '';
  if (!timestamp || !signature) return deny(401);

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return deny(401);
  if (Math.abs(Date.now() - ts) > TIMESTAMP_WINDOW_MS) return deny(401);

  // Body als Bytes prüfen — gegen die HMAC-Bytes signieren wir, also müssen wir
  // sicherstellen dass wir nicht über ein zu großes Payload verifizieren.
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return deny(413);

  if (!verifySignature(timestamp, raw, signature)) return deny(401);

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return deny(400, 'bad json');
  }
  if (!payload || typeof payload !== 'object') return deny(400, 'bad payload');

  const paths = Array.isArray((payload as any).paths) ? (payload as any).paths : [];
  const tags = Array.isArray((payload as any).tags) ? (payload as any).tags : [];

  if (paths.length > MAX_PATHS || tags.length > MAX_TAGS) return deny(400, 'too many entries');

  const revalidatedPaths: string[] = [];
  const revalidatedTags: string[] = [];
  const skipped: string[] = [];

  for (const p of paths) {
    if (!isSafePath(p)) { skipped.push(`path:${String(p).slice(0, 32)}`); continue; }
    try {
      revalidatePath(p);
      revalidatedPaths.push(p);
    } catch (e) {
      skipped.push(`path:${p}:err`);
    }
  }
  for (const t of tags) {
    if (!isSafeTag(t)) { skipped.push(`tag:${String(t).slice(0, 32)}`); continue; }
    try {
      // Next.js 16: zweites Argument ist required. 'max' = stale-while-
      // revalidate-Semantik (Tag-Eintrag wird stale markiert, frische Daten
      // werden im Hintergrund geladen — kein blocking cache miss).
      // Single-argument-Form ist deprecated.
      revalidateTag(t, 'max');
      revalidatedTags.push(t);
    } catch (e) {
      skipped.push(`tag:${t}:err`);
    }
  }

  return NextResponse.json({
    ok: true,
    revalidated: { paths: revalidatedPaths, tags: revalidatedTags },
    skipped: skipped.length > 0 ? skipped : undefined,
  });
}
