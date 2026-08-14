// Per-IP rate-limit für heavy Routes. In-memory pro Vercel-Function-Instance
// (Serverless = ephemer, aber das reicht für DoS-Schutz: ein Angreifer müsste
// von der GLEICHEN IP serielle Requests an die GLEICHE Instance schicken,
// und Vercel verteilt über mehrere Instances).
//
// Wenn wir mal echtes verteiltes Rate-Limit brauchen (Per-User-Quota o.ä.),
// switchen wir auf Upstash-Redis — die API hier bleibt gleich.
//
// Verwendung in einer Route:
//   const limited = checkRateLimit(req, { key: 'marktwert-refresh', max: 10, windowMs: 60_000 });
//   if (limited) return limited;  // 429-Response

import { NextRequest, NextResponse } from 'next/server';

interface Bucket {
  count: number;
  resetAt: number;
}

// Globaler State pro Instance. Map-Größe wächst mit unique IPs × Keys,
// aber alte Buckets werden bei jeder check-Operation gepruned wenn expired.
const BUCKETS = new Map<string, Bucket>();

// Pro Aufruf maximal ein Pruning-Sweep ausführen, damit eine einzelne
// Request nicht den Sweep über tausende Einträge zahlt.
let lastPruneAt = 0;

/**
 * Client-IP aus den Proxy-Headern.
 *
 * Reihenfolge ist hier Sicherheitslogik, keine Kosmetik: `x-vercel-forwarded-for`
 * setzt ausschliesslich Vercels Edge und ueberschreibt dabei einen vom Client
 * mitgeschickten Wert. `x-forwarded-for` ist die gewachsene Variante, an die
 * Zwischenstationen anhaengen duerfen — wer sie zuerst liest, laesst sich vom
 * Aufrufer sagen, in welchen Bucket er faellt, und haelt damit eine Bremse in
 * der Hand, die jeder selbst loesen kann.
 *
 * Exportiert, damit alle Bremsen (Rate-Limit, Login-Fehlversuche) dieselbe
 * Quelle benutzen.
 */
export function clientIpFromRequest(req: NextRequest): string {
  const vercel = req.headers.get('x-vercel-forwarded-for');
  if (vercel) return vercel.split(',')[0]!.trim();
  const xri = req.headers.get('x-real-ip');
  if (xri) return xri.trim();
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  // Fallback auf 'unknown' bündelt alle non-identifizierten Calls in einen
  // Bucket — sicherer als per-Request frei zu lassen.
  return 'unknown';
}

function ipFromRequest(req: NextRequest): string {
  return clientIpFromRequest(req);
}

export interface RateLimitOpts {
  /** Eindeutiger Endpoint-Bucket-Name (z.B. 'marktwert-refresh') */
  key: string;
  /** Max. Requests pro Fenster */
  max: number;
  /** Fenster-Länge in Millisekunden */
  windowMs: number;
}

/**
 * Prüft Per-IP Rate-Limit. Wenn überschritten, returnt einen 429-NextResponse,
 * den der Caller sofort durchreichen kann. Wenn ok, returnt null (= Request
 * darf weiterlaufen).
 */
export function checkRateLimit(req: NextRequest, opts: RateLimitOpts): NextResponse | null {
  const ip = ipFromRequest(req);
  const bucketKey = `${opts.key}|${ip}`;
  const now = Date.now();

  // Pro Minute mal die globalen Maps pruning, damit der Heap nicht wächst.
  if (now - lastPruneAt > 60_000) {
    lastPruneAt = now;
    for (const [k, b] of BUCKETS) {
      if (b.resetAt < now) BUCKETS.delete(k);
    }
  }

  const bucket = BUCKETS.get(bucketKey);
  if (!bucket || bucket.resetAt < now) {
    BUCKETS.set(bucketKey, { count: 1, resetAt: now + opts.windowMs });
    return null;
  }
  if (bucket.count >= opts.max) {
    const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    return NextResponse.json(
      { error: 'rate_limited', message: `Too many requests; try again in ${retryAfterSec}s` },
      { status: 429, headers: { 'Retry-After': String(retryAfterSec) } },
    );
  }
  bucket.count++;
  return null;
}
