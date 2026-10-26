import 'server-only';
// Liest die Route-Spiegel (app/lib/route-mirror.mjs) — Antworten, die die Box
// vorab ueber die oeffentliche Route abgerufen und als Datei abgelegt hat.
// Jeder Fehler → null → die Route rechnet live wie bisher.
// Notschalter ROUTE_MIRRORS=0: alle Routen rechnen live.
import { fetchBlob } from './meta-pulse-diff-snapshot';
import { isSnapshotPublisher } from './snapshot-lookup';
import { CURRENT_SET } from './current-set';
import { ACTIVE_REGIONS } from './active-regions';
import {
  ROUTE_MIRRORS, isValidRouteMirror, routeMirrorKey, routeMirrorKeys, routeMirrorPath,
} from './route-mirror.mjs';

export type RouteMirrorName = keyof typeof ROUTE_MIRRORS;

// Nur abgelegte Ansichten anfragen: jede andere kostete einen vergeblichen
// Blob-Abruf (~0,1 s) vor der Live-Rechnung.
const KEYS = new Map<RouteMirrorName, Set<string>>();
function publishedKeys(name: RouteMirrorName): Set<string> {
  let keys = KEYS.get(name);
  if (!keys) {
    keys = routeMirrorKeys(name, ACTIVE_REGIONS) as Set<string>;
    KEYS.set(name, keys);
  }
  return keys;
}

type MirrorQuery = URLSearchParams | Record<string, string>;

async function readMirror<T>(name: RouteMirrorName, query: MirrorQuery): Promise<{ body: T; builtAt: string } | null> {
  if (process.env.ROUTE_MIRRORS === '0') return null;
  const key = routeMirrorKey(name, query) as string | null;
  if (!key || !publishedKeys(name).has(key)) return null;
  const snap = await fetchBlob(routeMirrorPath(name, key));
  if (!isValidRouteMirror(snap, name, key, { set: CURRENT_SET })) return null;
  const { body, builtAt } = snap as { body: T; builtAt: string };
  return { body, builtAt };
}

/** Die abgelegte Antwort fuer diese Anfrage, oder null. Der Publisher bekommt immer null. */
export async function readRouteMirror<T = any>(name: RouteMirrorName, request: Request): Promise<T | null> {
  if (isSnapshotPublisher(request)) return null;
  return (await readMirror<T>(name, new URL(request.url).searchParams))?.body ?? null;
}

/**
 * Nur fuer Server-Seiten (Startdaten, app/lib/seo/page-start-*.ts): Antwort
 * samt Stand fuer die Ansicht `query`. NIE in einer Route benutzen — dort
 * fehlte die Publisher-Pruefung, und die Box bekaeme ihre eigene alte Datei
 * zurueck und legte sie eingefroren wieder ab (route-mirror.test.mjs prueft das).
 */
export function readRouteMirrorForPage<T>(name: RouteMirrorName, query: Record<string, string>): Promise<{ body: T; builtAt: string } | null> {
  return readMirror<T>(name, query);
}

/** Kopfzeile fuer die Messung: kam die Antwort aus der Datei oder live? */
export function withSnapshotHeader<R extends Response>(res: R, name: string, fromBlob: boolean): R {
  res.headers.set('x-snapshot', `${name}=${fromBlob ? 'blob' : 'live'}`);
  return res;
}
