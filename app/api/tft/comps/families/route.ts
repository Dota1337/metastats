// GET /api/tft/comps/families — die Comp-Familien der Standardliste mit dem
// Slug, auf den die Liste verlinkt (SEO-Plan Schritt 5b, E2). Der
// Snapshot-Publisher legt fuer genau diese Familien den Detail-Vorrat an:
// dieselbe Regel wie Liste und Sitemap (listFamilyTargets), kein MJS-Nachbau.
//
// Mit Publisher-Kopfzeile rechnet die Route die Liste frisch im selben Prozess
// (Vorbild board/route.ts) und reicht die Kopfzeile weiter — der neue
// Listen-Stand steht erst am Ende des Publisher-Laufs im Manifest, sonst kaemen
// die Familien des Vortags. Ohne Kopfzeile nur aus dem Vorrat, nie live: sonst
// koennte jeder Aufruf die schwere Listen-Abfrage ausloesen.
import { NextRequest, NextResponse } from 'next/server';
import { GET as compsGET } from '../route';
import { isSnapshotPublisher, lookupSnapshot } from '../../../../lib/snapshot-lookup';
import { PUBLISHER_TOKEN_ENV, publisherHeaders } from '../../../../lib/snapshot-publisher.mjs';
import { cachedJson, STATS_CACHE_CONTROL } from '../../../../lib/api-cache';
import { CURRENT_SET } from '../../../../lib/current-set';
import { tftAssets } from '../../../../lib/og/data';
import { resolveDefaultBucket } from '../../../../lib/tft-supabase-reader';
import { listFamilyTargets, type CompApiRow } from '../../../../lib/tft-comp-families';
import { listPayloadWithCatalog } from '../../../../lib/tft-comp-catalog-resolver';

export const maxDuration = 60;

// Standardansicht der Liste — wie die Seite ohne Filter und sitemap.ts. Ohne
// `bucket`: den Rang waehlt der Server wie fuer die Liste (resolveDefaultBucket,
// Diamond+ erst ab genug Spielen im Set, sonst alle Raenge).
const LIST_QUERY = { patch: 'current', region: 'all', days: '3', source: 'data' };

interface ListBody { comps?: unknown; filters?: { patch?: unknown } }

async function listBody(request: NextRequest, publisher: boolean): Promise<ListBody | null> {
  if (publisher) {
    const inner = new URL('/api/tft/comps', request.nextUrl.origin);
    inner.search = new URLSearchParams(LIST_QUERY).toString();
    // Vorrecht weiterreichen: der aeussere Aufruf hat es schon bestanden, also ist das Geheimnis gesetzt.
    const res = await compsGET(new NextRequest(inner, { headers: publisherHeaders(process.env[PUBLISHER_TOKEN_ENV]) }));
    return res.ok ? ((await res.json()) as ListBody) : null;
  }
  const hit = await lookupSnapshot('comps', {
    patch: null, region: 'all', days: 3, bucket: await resolveDefaultBucket(), minGames: 0, setNumber: CURRENT_SET,
  });
  // Comp-Katalog wie die Route (Staende von vor dem Katalog tragen kein compKey).
  return hit?.payload ? listPayloadWithCatalog(hit.payload as ListBody) : null;
}

export async function GET(request: NextRequest) {
  const publisher = isSnapshotPublisher(request);
  let body: ListBody | null = null;
  try {
    body = await listBody(request, publisher);
  } catch (e) {
    console.error('[tft/comps/families] list failed:', (e as Error).message);
  }
  const rows = Array.isArray(body?.comps) ? (body!.comps as CompApiRow[]) : [];
  const assets = tftAssets();
  const targets = rows.length > 0 && assets ? listFamilyTargets(rows, assets) : [];
  const out = {
    patch: typeof body?.filters?.patch === 'string' ? body.filters.patch : null,
    source: publisher ? 'live' : 'snapshot',
    targets,
  };
  // Leer heisst „gerade nicht bestimmbar" — der Publisher nimmt dann seine alte
  // Auswahl. Nicht lange zwischenspeichern.
  if (targets.length === 0) return cachedJson(out, { degraded: true });
  if (publisher) return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } });
  return cachedJson(out, { cache: STATS_CACHE_CONTROL });
}
