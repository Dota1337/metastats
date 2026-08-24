// Bild-Proxy fuer CommunityDragon-Assets (Plan B3).
//
// Warum: die Strecke Browser → raw.communitydragon.org hat beim Endnutzer
// Durchsatz-Ausreisser (gemessen: ein Icon mit 236 B/s, 30,6 s), waehrend
// dieselbe Quelle von unseren Servern aus in 0,1-0,2 s da ist. Diese Route
// ersetzt den Ursprungs-PoP: der Browser fragt uns, wir holen einmal, Vercels
// CDN haelt das Ergebnis.
//
// Was sie ausdruecklich NICHT kann: die letzte Meile heilen. Bricht der
// Durchsatz zwischen Nutzer und Vercel ein, ist das Bild genauso langsam.
//
// Kein `export const runtime`: die Edge-Runtime ist ab Next 16 deprecated
// (node_modules/next/dist/docs/.../route-segment-config/runtime.md), Node ist
// der Default und der richtige Ort fuer einen Streaming-Passthrough.

import { NextRequest, NextResponse } from 'next/server';
import { safeCdragonUrl, imageContentType, CDRAGON_GAME_BASE } from '../../../lib/cdragon-base';
import { IMG_CACHE_CONTROL, IMG_CDN_CACHE_CONTROL } from '../../../lib/api-cache';

// Der gemessene Defekt sind 30-s-Ausreisser. Ohne Deckel wird daraus eine
// 30-s-Function, die den Nutzer genauso lange warten laesst und dabei Geld
// kostet. Nach 5 s geben wir auf.
const UPSTREAM_TIMEOUT_MS = 5000;

// Groesste im Bundle gemessene Datei: 43.845 B. 4 MB ist reichlich Luft und
// zugleich eine harte Schranke gegen einen Pfad, der wider Erwarten doch auf
// etwas Grosses zeigt.
const MAX_BYTES = 4 * 1024 * 1024;

// Faellt der Proxy aus, soll der Browser genau das tun, was er ohne ihn taete:
// direkt bei CommunityDragon fragen. Ein 302 ist hier ehrlicher als ein 502 —
// der Nutzer sieht sein Bild, nur ohne den Umweg. Kurze TTL, damit ein
// voruebergehender Ausfall nicht tagelang festgeschrieben wird.
function passthrough(url: string) {
  const res = NextResponse.redirect(url, 302);
  res.headers.set('Cache-Control', 'public, max-age=60');
  return res;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ p: string[] }> }) {
  const { p } = await params;
  const target = safeCdragonUrl(p ?? []);
  if (!target) {
    return new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': 'public, max-age=300' } });
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      // Keine Client-Header nach oben: weder Cookie noch Authorization haben
      // bei einer oeffentlichen Bildquelle etwas zu suchen, und beide wuerden
      // die Antwort vom CDN-Cache disqualifizieren.
      headers: { accept: 'image/*' },
      cache: 'no-store',
    });
  } catch {
    return passthrough(target);
  }

  if (!upstream.ok || !upstream.body) return passthrough(target);

  const declared = Number(upstream.headers.get('content-length') ?? '0');
  if (declared > MAX_BYTES) return passthrough(target);

  const contentType = imageContentType(target);
  if (!contentType) return passthrough(target);

  // Der Body wird durchgereicht, nicht gepuffert. Bei fehlendem
  // `content-length` (chunked) ist die Laengenpruefung oben wirkungslos —
  // der 4-MB-Deckel greift dann ueber den Zaehler im Stream.
  const limited = declared > 0 ? upstream.body : limitStream(upstream.body);

  const res = new NextResponse(limited, { status: 200 });
  res.headers.set('Content-Type', contentType);
  res.headers.set('Cache-Control', IMG_CACHE_CONTROL);
  res.headers.set('Vercel-CDN-Cache-Control', IMG_CDN_CACHE_CONTROL);
  // Purge-Knopf. Ohne ihn gibt es bei einem Patch nur zwei Hebel: warten oder
  // neu deployen. Kostet nichts, wenn er nie benutzt wird.
  res.headers.set('Vercel-Cache-Tag', 'tft-img');
  if (declared > 0) res.headers.set('Content-Length', String(declared));
  return res;
}

function limitStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  let seen = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > MAX_BYTES) {
          controller.error(new Error(`upstream image exceeds ${MAX_BYTES} bytes: ${CDRAGON_GAME_BASE}`));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}
