import { NextRequest, NextResponse } from 'next/server';
import { DEGRADED_CACHE_CONTROL, cacheHeaders } from '../../../lib/api-cache';
import { checkRateLimit } from '../../../lib/rate-limit';
import { parseExplorerParams, serializeExplorerQuery, toServiceBody } from '../../../lib/tft-explorer-query';

// Data Explorer. Die Rechnung laeuft auf der Hetzner-Box im Abfrage-Dienst
// (scripts/explorer-duckdb-server.mjs), erreichbar nur ueber refresh-api
// (/explore, Token). Die Anfrage steht komplett in der URL, damit Vercel sie
// cachen kann; die Seite baut die URL mit serializeExplorerQuery, also in
// fester Reihenfolge.
//
// Cache: die Daten aendern sich nur einmal am Tag (Build 01:35 UTC; Teil-Aufbau
// gemessen 258 s, Vollaufbau 3953 s am 08.10.2026, die Teilsummen-Frist im Bau
// haelt den Tausch vor 03:30). Deshalb bis 03:30 UTC des naechsten Tages cachen,
// danach hoechstens eine Stunde alt ausliefern, waehrend neu gerechnet wird.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Fristen-Kette (Paket 6): Dienst bis 30 s („alle Patches + Filter"),
// refresh-api 35 s, hier 40 s — die Funktion selbst darf etwas laenger leben.
export const maxDuration = 60;

const HETZNER_URL = process.env.HETZNER_REFRESH_URL;
const TOKEN = process.env.REFRESH_API_TOKEN;

function secondsUntilNextBuild(now = new Date()): number {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 3, 30));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return Math.max(300, Math.round((next.getTime() - now.getTime()) / 1000));
}

export async function GET(req: NextRequest) {
  if (!HETZNER_URL || !TOKEN) {
    return NextResponse.json({ error: 'explorer_unavailable' }, { status: 503, headers: cacheHeaders(DEGRADED_CACHE_CONTROL) });
  }

  const query = parseExplorerParams(req.nextUrl.searchParams);
  // Abweichende Schreibweise derselben Anfrage auf die feste Form umleiten,
  // damit sie denselben Cache-Eintrag trifft.
  const canonical = serializeExplorerQuery(query, { forApi: true });
  if (req.nextUrl.search.replace(/^\?/, '') !== canonical) {
    const url = req.nextUrl.clone();
    url.search = canonical;
    return NextResponse.redirect(url, 308);
  }

  // Ungecachte Anfragen rechnen auf einer Box mit 2 Kernen — pro IP deckeln.
  const limited = checkRateLimit(req, { key: 'explorer', max: 30, windowMs: 60_000 });
  if (limited) return limited;

  let upstream: Response;
  try {
    upstream = await fetch(`${HETZNER_URL}/explore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(toServiceBody(query)),
      signal: AbortSignal.timeout(40_000),
    });
  } catch (err) {
    // Eigene Frist abgelaufen = Rechnung zu lang (504, die Seite zeigt
    // „Zeitueberschreitung"); alles andere = Box nicht erreichbar (503).
    const timeout = (err as { name?: string } | null)?.name === 'TimeoutError';
    return NextResponse.json(
      { error: timeout ? 'timeout' : 'explorer_unavailable' },
      { status: timeout ? 504 : 503, headers: cacheHeaders(DEGRADED_CACHE_CONTROL) },
    );
  }

  const data = await upstream.json().catch(() => null);
  if (!upstream.ok || !data) {
    const status = upstream.ok ? 502 : upstream.status;
    const headers: Record<string, string> = cacheHeaders(DEGRADED_CACHE_CONTROL);
    const retry = upstream.headers.get('retry-after');
    if (retry) headers['Retry-After'] = retry;
    return NextResponse.json(data ?? { error: 'explorer_unavailable' }, { status, headers });
  }

  const cc = `public, s-maxage=${secondsUntilNextBuild()}, stale-while-revalidate=3600`;
  return NextResponse.json(data, { status: 200, headers: cacheHeaders(cc) });
}
