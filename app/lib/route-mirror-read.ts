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
  isValidRouteMirror, routeMirrorKey, routeMirrorKeys, routeMirrorPath,
} from './route-mirror.mjs';

export type RouteMirrorName = 'rising' | 'leaderboard' | 'regions' | 'tournaments' | 'standings';

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

/** Die abgelegte Antwort fuer diese Anfrage, oder null. Der Publisher bekommt immer null. */
export async function readRouteMirror<T = any>(name: RouteMirrorName, request: Request): Promise<T | null> {
  if (process.env.ROUTE_MIRRORS === '0' || isSnapshotPublisher(request)) return null;
  const key = routeMirrorKey(name, new URL(request.url).searchParams) as string | null;
  if (!key || !publishedKeys(name).has(key)) return null;
  const snap = await fetchBlob(routeMirrorPath(name, key));
  return isValidRouteMirror(snap, name, key, { set: CURRENT_SET }) ? ((snap as { body: T }).body) : null;
}

/** Kopfzeile fuer die Messung: kam die Antwort aus der Datei oder live? */
export function withSnapshotHeader<R extends Response>(res: R, name: string, fromBlob: boolean): R {
  res.headers.set('x-snapshot', `${name}=${fromBlob ? 'blob' : 'live'}`);
  return res;
}
