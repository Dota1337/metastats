// Erfundene LoL-Champion-Adressen (/champions/<id>) → echte 404, falsche
// Gross/Klein-Schreibung → 308 auf die richtige (SEO-Plan Schritt 6). Laeuft
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
// keine reine Buchstaben-Kennung ist. Ist Data Dragon nicht erreichbar (oder
// zu langsam), geht die Adresse durch — die Seite zeigt dann wie bisher
// „nicht gefunden“, das Layout setzt noindex.
//
// Kein node:-Import, kein server-only: Edge.
import known from './known-ids.generated.json';

export interface ChampionIds {
  ids: Set<string>;
  /** Kleinschreibung → richtige Schreibweise (`ahri` → `Ahri`). */
  lower: Map<string, string>;
}

export type ChampionDecision = { kind: 'pass' } | { kind: 'missing' } | { kind: 'redirect'; id: string };

const LETTERS = /^[A-Za-z]+$/;
const PASS: ChampionDecision = { kind: 'pass' };
const MISSING: ChampionDecision = { kind: 'missing' };

export function championIds(list: readonly string[]): ChampionIds {
  return { ids: new Set(list), lower: new Map(list.map(id => [id.toLowerCase(), id])) };
}

let buildIds: ChampionIds | null = null;
function defaultBuildIds(): ChampionIds {
  return (buildIds ??= championIds((known as { lolChampions?: string[] }).lolChampions || []));
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

/**
 * Reihenfolge: Build-Liste exakt → Build-Liste ohne Gross/Klein → Form →
 * Laufzeit-Liste (exakt, dann ohne Gross/Klein). `loadLive` liefert null,
 * wenn Data Dragon gerade nicht zur Verfuegung steht.
 */
export async function decideChampion(
  id: string,
  loadLive: () => Promise<ChampionIds | null>,
  build: ChampionIds = defaultBuildIds(),
): Promise<ChampionDecision> {
  if (build.ids.has(id)) return PASS;
  const fromBuild = build.lower.get(id.toLowerCase());
  if (fromBuild) return { kind: 'redirect', id: fromBuild };
  if (!LETTERS.test(id)) return MISSING;
  const live = await loadLive();
  if (!live) return PASS;
  if (live.ids.has(id)) return PASS;
  const fromLive = live.lower.get(id.toLowerCase());
  return fromLive ? { kind: 'redirect', id: fromLive } : MISSING;
}

// ---------- Laufzeit-Liste ----------

const DDRAGON = 'https://ddragon.leagueoflegends.com';
// Eine Liste gilt 10 min (wie der Versions-Speicher der Seite,
// ddragon-version-server.ts). Danach prueft der naechste Fehltreffer, ob es
// eine neue Version gibt (5 KB); champion.json kommt nur bei neuer Version.
// Faelschungs-Serien loesen so hoechstens einen kleinen Abruf je 10 min aus.
const FRESH_MS = 10 * 60 * 1000;
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

  // Nur eine frische Liste darf zu einer 404 fuehren. Ist sie alt und der
  // Abgleich scheitert, geht die Adresse durch.
  const fresh = () => (state && now() - state.checkedAt < FRESH_MS ? state.list : null);

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

  /** `waitUntil`: haelt einen Abruf, der laenger als die Wartezeit braucht, nach der Antwort am Leben. */
  return function load(waitUntil?: (p: Promise<unknown>) => void): Promise<ChampionIds | null> {
    const list = fresh();
    if (list) return Promise.resolve(list);
    if (!inflight && now() - failedAt >= RETRY_MS) {
      inflight = refresh().finally(() => { inflight = null; });
      waitUntil?.(inflight);
    }
    if (!inflight) return Promise.resolve(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      inflight.then(fresh),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), waitMs); }),
    ]).finally(() => clearTimeout(timer));
  };
}

const liveChampionIds = createLiveChampionIds();

/** Entscheidung fuer die Middleware mit Build-Liste und Laufzeit-Abgleich. */
export function championGate(id: string, waitUntil?: (p: Promise<unknown>) => void): Promise<ChampionDecision> {
  return decideChampion(id, () => liveChampionIds(waitUntil));
}
