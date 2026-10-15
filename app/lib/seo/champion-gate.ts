// Erfundene LoL-Champion-Adressen (/champions/<id>) → echte 404, falsche
// Gross/Klein-Schreibung → 308 (307) auf die richtige (SEO-Plan Schritt 6). Laeuft
// in der Edge-Middleware vor der Seite, aus demselben Grund wie
// not-found-gate.ts: ein notFound() in der Seite kaeme erst nach dem
// Antwortbeginn und endete als 200.
//
// Zwei Quellen:
//   1. Liste aus dem Build (scripts/build-known-ids.mjs, Data Dragon) — fuer
//      bekannte Champions kein Abruf.
//   2. Abgleich zur Laufzeit nur fuer Unbekannte: Data Dragon direkt, je
//      Isolat gemerkt. Ein neuer Champion steht am Patch-Tag nicht in der
//      Build-Liste, die Seite zeigt ihn aber schon (sie liest Data Dragon
//      ebenfalls live).
// Hart abgelehnt wird nur, was die Laufzeit-Liste sicher nicht kennt oder was
// keine Kennungs-Form hat. Ist Data Dragon nicht erreichbar (oder
// zu langsam), geht die Adresse durch — die Seite zeigt dann wie bisher
// „nicht gefunden“, das Layout setzt noindex.
//
// Kein node:-Import, kein server-only: Edge.
import known from './known-ids.generated.json';

export interface ChampionIds {
  ids: Set<string>;
  /** Kleinschreibung → richtige Schreibweise (`ahri` → `Ahri`). */
  lower: Map<string, string>;
  /** Feste Unterseiten neben [id] (app/champions/<name>/), aus build-known-ids. */
  statics?: Set<string>;
}

/** `permanent`: 308 nur, wenn eine frische Laufzeit-Liste das Ziel bestaetigt, sonst 307. */
export type ChampionDecision = { kind: 'pass' } | { kind: 'missing' } | { kind: 'redirect'; id: string; permanent: boolean };

// Data-Dragon-Kennungen sind heute reine Buchstaben (173/173); Ziffern und
// Unterstrich gehen trotzdem an den Abgleich, damit ein kuenftiger Champion
// mit Ziffer nicht dauerhaft 404 bekommt. Alles andere (Bindestrich, Leer-,
// Satzzeichen) gibt es dort nicht.
const ID_SHAPE = /^[A-Za-z0-9_]+$/;
const PASS: ChampionDecision = { kind: 'pass' };
const MISSING: ChampionDecision = { kind: 'missing' };

export function championIds(list: readonly string[], statics: readonly string[] = []): ChampionIds {
  return { ids: new Set(list), lower: new Map(list.map(id => [id.toLowerCase(), id])), statics: new Set(statics) };
}

let buildIds: ChampionIds | null = null;
function defaultBuildIds(): ChampionIds {
  const k = known as { lolChampions?: string[]; staticSegments?: Record<string, string[]> };
  return (buildIds ??= championIds(k.lolChampions || [], k.staticSegments?.champions || []));
}

/**
 * Kennung aus `/champions/<segment>`: undefined = keine Champion-Detailadresse
 * (Liste, tiefere Pfade), null = Segment nicht dekodierbar.
 */
export function championIdFromPath(pathname: string): string | null | undefined {
  const parts = pathname.split('/');
  if (parts.length !== 3 || parts[1] !== 'champions' || !parts[2]) return undefined;
  try {
    return decodeURIComponent(parts[2]);
  } catch {
    return null;
  }
}

function matchLive(id: string, live: ChampionIds): ChampionDecision | null {
  if (live.ids.has(id)) return PASS;
  const fromLive = live.lower.get(id.toLowerCase());
  return fromLive ? { kind: 'redirect', id: fromLive, permanent: true } : null;
}

/**
 * Reihenfolge: feste Unterseite oder Build-Liste exakt → durch; falsche Form →
 * 404; sonst Laufzeit-Liste (exakt → durch, ohne Gross/Klein → 308, sonst
 * 404). Steht Data Dragon nicht zur Verfuegung (`loadLive` → null): Treffer
 * ohne Gross/Klein in der Build-Liste → 307, sonst durch.
 *
 * Die 308 braucht die Bestaetigung der Laufzeit-Liste, weil Browser sie
 * dauerhaft speichern: aenderte Riot je die Schreibweise einer Kennung, wiese
 * eine 308 allein aus der Build-Liste bis zum naechsten Build auf die tote
 * Adresse — und danach in eine Schleife.
 *
 * Die 404 braucht eine nachgepruefte Liste (`loadLive(true)`, hoechstens 60 s
 * alt): am Patch-Tag kennt die gemerkte Liste den neuen Champion womoeglich
 * noch nicht, die Seite verlinkt ihn aber schon.
 */
export async function decideChampion(
  id: string,
  loadLive: (confirm: boolean) => Promise<ChampionIds | null>,
  build: ChampionIds = defaultBuildIds(),
): Promise<ChampionDecision> {
  if (build.statics?.has(id) || build.ids.has(id)) return PASS;
  if (!ID_SHAPE.test(id)) return MISSING;
  const live = await loadLive(false);
  if (!live) {
    const fromBuild = build.lower.get(id.toLowerCase());
    return fromBuild ? { kind: 'redirect', id: fromBuild, permanent: false } : PASS;
  }
  const hit = matchLive(id, live);
  if (hit) return hit;
  const confirmed = await loadLive(true);
  if (!confirmed) return PASS;
  return matchLive(id, confirmed) ?? MISSING;
}

// ---------- Laufzeit-Liste ----------

const DDRAGON = 'https://ddragon.leagueoflegends.com';
// Eine Liste gilt 10 min fuer Treffer (wie der Versions-Speicher der Seite,
// ddragon-version-server.ts). Vor einer 404 muss sie juenger als 60 s sein,
// sonst prueft der Fehltreffer erst, ob es eine neue Version gibt (5 KB);
// champion.json kommt nur bei neuer Version. Faelschungs-Serien loesen so
// hoechstens einen kleinen Abruf je Minute und Instanz aus.
const FRESH_MS = 10 * 60 * 1000;
const CONFIRM_MS = 60 * 1000;
const RETRY_MS = 60 * 1000; // Pause nach einem Fehlschlag
const FETCH_MS = 5000; // beide Abrufe zusammen
const WAIT_MS = 1500; // so lange wartet eine Anfrage hoechstens

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export function createLiveChampionIds(opts: { fetch?: FetchLike; now?: () => number; waitMs?: number } = {}) {
  const doFetch: FetchLike = opts.fetch ?? ((url, init) => fetch(url, init));
  const now = opts.now ?? Date.now;
  const waitMs = opts.waitMs ?? WAIT_MS;
  let state: { list: ChampionIds; version: string; checkedAt: number } | null = null;
  let inflight: Promise<void> | null = null;
  let failedAt = -Infinity;

  // Nur eine frische Liste zaehlt. Ist sie zu alt und der Abgleich scheitert,
  // geht die Adresse durch.
  const fresh = (maxAgeMs: number) => (state && now() - state.checkedAt < maxAgeMs ? state.list : null);

  async function refresh(): Promise<void> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_MS);
    const signal = ctl.signal;
    try {
      const vres = await doFetch(`${DDRAGON}/api/versions.json`, { signal });
      if (!vres.ok) throw new Error(`versions.json HTTP ${vres.status}`);
      const version = ((await vres.json()) as unknown[])?.[0];
      if (typeof version !== 'string') throw new Error('keine Version');
      if (state && state.version === version) {
        state = { ...state, checkedAt: now() };
        return;
      }
      const res = await doFetch(`${DDRAGON}/cdn/${version}/data/en_US/champion.json`, { signal });
      if (!res.ok) throw new Error(`champion.json HTTP ${res.status}`);
      const ids = Object.keys(((await res.json()) as { data?: Record<string, unknown> })?.data || {});
      if (ids.length < 100) throw new Error(`nur ${ids.length} Champions`);
      state = { list: championIds(ids), version, checkedAt: now() };
    } catch {
      failedAt = now();
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * `waitUntil`: haelt einen Abruf, der laenger als die Wartezeit braucht, nach
   * der Antwort am Leben. `confirm`: Liste fuer eine 404, hoechstens 60 s alt.
   */
  return function load(waitUntil?: (p: Promise<unknown>) => void, confirm = false): Promise<ChampionIds | null> {
    const maxAgeMs = confirm ? CONFIRM_MS : FRESH_MS;
    const list = fresh(maxAgeMs);
    if (list) return Promise.resolve(list);
    if (!inflight && now() - failedAt >= RETRY_MS) {
      inflight = refresh().finally(() => { inflight = null; });
      waitUntil?.(inflight);
    }
    if (!inflight) return Promise.resolve(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      inflight.then(() => fresh(maxAgeMs)),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), waitMs); }),
    ]).finally(() => clearTimeout(timer));
  };
}

const liveChampionIds = createLiveChampionIds();

/** Entscheidung fuer die Middleware mit Build-Liste und Laufzeit-Abgleich. */
export function championGate(id: string, waitUntil?: (p: Promise<unknown>) => void): Promise<ChampionDecision> {
  return decideChampion(id, confirm => liveChampionIds(waitUntil, confirm));
}
