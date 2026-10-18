// Route-Spiegel (2026-10-18): fertige Antworten oeffentlicher Routen als Datei
// im Vercel Blob, damit Rising, TFT-Rangliste, Regionen und Ligen auch direkt
// nach einem Deploy und an jedem Edge-Standort sofort laden (live 9-15 s).
//
// Die Box ruft die Route selbst ab — mit Publisher-Kopfzeile und `_pub`, sonst
// kaeme die eigene Datei bzw. die Edge-Kopie zurueck — und legt die Antwort ab
// (scripts/publish-route-mirrors.mjs, Muster publish-lol-builds.mjs). Damit gibt
// es keine zweite Rechenlogik, die auseinanderlaufen koennte. Die Route liest
// zuerst die Datei (app/lib/route-mirror-read.ts); fehlt sie, ist sie zu alt
// oder passt sie nicht, rechnet sie live wie bisher.
//
// Eine Quelle fuer Box und Leser. Als .mjs ohne Imports, weil die Box keine
// TS-Dateien laedt — steht deshalb im Pfad-Filter von
// .github/workflows/deploy-hetzner.yml, sonst schriebe die Box nach einer
// Pfadaenderung still an die alte Stelle.

const MIN = 60_000;
const HOUR = 60 * MIN;

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Je Spiegel: Route, Schluessel-Parameter mit dem Standardwert der Route (null =
 * Pflicht), Parameter, die fehlen bzw. einen festen Wert haben muessen, und das
 * Hoechstalter der Datei. `tftSet`: Datei gilt nur im Set, fuer das sie
 * geschrieben wurde. `fetchQuery`: Zusatz beim Abruf durch die Box.
 */
export const ROUTE_MIRRORS = Object.freeze({
  // Rangliste einmal am Tag (metastats-tft-ladder, 04:30 UTC) → 36 h reichen
  // auch ueber einen ausgefallenen Tag.
  rising: {
    group: 'rising', api: '/api/tft/rising', maxAgeMs: 36 * HOUR, tftSet: true,
    params: { days: '1', region: 'all' },
  },
  // Alle 10 min (User 18.10.2026: „10"). 25 min = zwei verpasste Laeufe, danach live.
  leaderboard: {
    group: 'leaderboard', api: '/api/tft/leaderboard', maxAgeMs: 25 * MIN, tftSet: false,
    params: { region: 'euw1', tier: 'CHALLENGER', page: '1' },
  },
  // Tagesdaten; die Box frischt alle 3 h auf. Nur die Ansichten der Seite
  // (patch any, min 80) und nur ohne festes Fenster-Ende.
  regions: {
    group: 'regions', api: '/api/tft/regions/divergence', maxAgeMs: 8 * HOUR, tftSet: true,
    params: { days: '7', bucket: null, min: '100' },
    fixed: { patch: 'any' },
    forbid: ['end'],
  },
  // LoL-Spielplan: ungefilterte Gesamtliste, die Route filtert beim Lesen
  // (bedient /ligen und die Seitenleiste). Box alle 30 min.
  tournaments: {
    group: 'ligen', api: '/api/tournaments', maxAgeMs: 90 * MIN, tftSet: false,
    params: {},
    fetchQuery: { window: 'full' },
  },
  // Ligen-Uebersicht ohne Liga.
  standings: {
    group: 'ligen', api: '/api/tournaments/standings', maxAgeMs: 90 * MIN, tftSet: false,
    params: {},
    forbid: ['league'],
  },
});

export const ROUTE_MIRROR_GROUPS = Object.freeze(['rising', 'leaderboard', 'regions', 'ligen']);

export function routeMirrorNames(group) {
  return Object.keys(ROUTE_MIRRORS).filter(n => ROUTE_MIRRORS[n].group === group);
}

const RISING_DAYS = ['1', '3', '5'];
const REGION_DAYS = ['3', '7', '14'];
const REGION_BUCKETS = ['master_plus', 'grandmaster_plus', 'challenger', 'diamond'];

/**
 * Was die Box ablegt — genau die Ansichten, die die Seiten ohne Auswahl bzw.
 * mit den Standard-Knoepfen laden. Alles andere rechnet live wie bisher.
 * `activeRegions` von aussen, damit diese Datei importfrei bleibt.
 */
export function routeMirrorVariants(name, activeRegions) {
  const regions = [...activeRegions];
  switch (name) {
    case 'rising':
      return RISING_DAYS.flatMap(days => ['all', ...regions].map(region => ({ days, region })));
    case 'leaderboard':
      return [
        { region: 'all', tier: 'ALL', page: '1' },
        { region: 'all', tier: 'CHALLENGER', page: '1' },
        { region: 'all', tier: 'GRANDMASTER_PLUS', page: '1' },
        ...regions.map(region => ({ region, tier: 'ALL', page: '1' })),
      ];
    case 'regions':
      return REGION_DAYS.flatMap(days => REGION_BUCKETS.map(bucket => ({ days, bucket, min: '80' })));
    case 'tournaments':
    case 'standings':
      return [{}];
    default:
      throw new Error(`unbekannter Spiegel: ${name}`);
  }
}

// Gleiche Normalisierung wie die Routen (Region klein, Rang gross, Seite als Zahl).
const NORMALIZE = {
  region: v => v.toLowerCase(),
  tier: v => v.toUpperCase(),
  page: v => String(parseInt(v, 10) || 1),
  days: v => String(parseInt(v, 10)),
  min: v => String(parseInt(v, 10)),
};

/**
 * Schluessel einer Anfrage, oder null, wenn sie nicht aus einer Datei bedient
 * werden darf. `query`: URLSearchParams oder ein Objekt. Fremde Parameter (z. B.
 * `_cb`) zaehlen nicht.
 */
export function routeMirrorKey(name, query) {
  const def = ROUTE_MIRRORS[name];
  if (!def) return null;
  const get = k => (typeof query?.get === 'function' ? query.get(k) : query?.[k]) ?? null;
  for (const k of def.forbid || []) if (get(k) != null) return null;
  for (const [k, v] of Object.entries(def.fixed || {})) if ((get(k) ?? v) !== v) return null;
  const parts = [];
  for (const [k, fallback] of Object.entries(def.params)) {
    const raw = get(k) ?? fallback;
    if (raw == null) return null;
    const v = (NORMALIZE[k] || (x => x))(String(raw));
    if (!/^[A-Za-z0-9_]{1,24}$/.test(v)) return null;
    parts.push(`${k}-${v}`);
  }
  return parts.length ? parts.join('__') : 'default';
}

export function routeMirrorPath(name, key) {
  if (!ROUTE_MIRRORS[name] || !/^[A-Za-z0-9_-]{1,120}$/.test(String(key))) {
    throw new Error(`kein Spiegel-Pfad: ${name}/${key}`);
  }
  return `mirror/${name}/${key}.json`;
}

/** `{ builtAt, entries: { <key>: true } }` — nur fuer den Frische-Vertrag. */
export function routeMirrorIndexPath(name) {
  if (!ROUTE_MIRRORS[name]) throw new Error(`unbekannter Spiegel: ${name}`);
  return `mirror/${name}/index.json`;
}

/** Schluessel aller abgelegten Ansichten — der Leser fragt nur diese an. */
export function routeMirrorKeys(name, activeRegions) {
  return new Set(routeMirrorVariants(name, activeRegions).map(v => routeMirrorKey(name, v)));
}

/** Abrufadresse der Box (ohne `_pub`). */
export function routeMirrorFetchPath(name, variant) {
  const def = ROUTE_MIRRORS[name];
  const qs = new URLSearchParams({ ...variant, ...(def.fetchQuery || {}) }).toString();
  return qs ? `${def.api}?${qs}` : def.api;
}

// Inhalt passt zur Anfrage und ist nicht leer. Leere oder halbe Antworten
// schreibt die Box nie, und eine Datei, die doch durchrutscht, nimmt niemand.
const BODY_OK = {
  rising: (b, q) => b.hasData === true && Array.isArray(b.players) && b.players.length > 0
    && String(b.days) === q.days && b.region === q.region,
  leaderboard: (b, q) => Array.isArray(b.players) && b.players.length > 0
    && b.region === q.region && b.tier === q.tier && String(b.page) === q.page,
  regions: (b, q) => b.hasData === true && Array.isArray(b.comps) && b.comps.length > 0
    && String(b.days) === q.days && b.bucket === q.bucket && String(b.minGames) === q.min && b.patch === null,
  tournaments: b => Array.isArray(b.tournaments) && b.tournaments.length > 0
    && isObj(b.byLeague) && Array.isArray(b.sortedLeagues),
  standings: b => Array.isArray(b.leagues) && b.leagues.length > 0,
};

function keyQuery(key) {
  const q = {};
  if (key === 'default') return q;
  for (const part of String(key).split('__')) {
    const i = part.indexOf('-');
    q[part.slice(0, i)] = part.slice(i + 1);
  }
  return q;
}

/**
 * Gueltige Datei fuer genau diesen Schluessel? `set`: aktuelles TFT-Set des
 * Lesers. `now` nur fuer Tests.
 * @param {unknown} snap
 * @param {string} name
 * @param {string} key
 * @param {{ set?: number | null, now?: number }} [opts]
 */
export function isValidRouteMirror(snap, name, key, opts = {}) {
  const { set, now = Date.now() } = opts;
  const def = ROUTE_MIRRORS[name];
  if (!def || !isObj(snap) || snap.v !== 1 || snap.name !== name || snap.key !== key) return false;
  const built = Date.parse(snap.builtAt);
  if (!Number.isFinite(built) || now - built > def.maxAgeMs || built - now > 5 * MIN) return false;
  if (def.tftSet && !(Number.isInteger(set) && Number(snap.set) === set)) return false;
  return isObj(snap.body) && BODY_OK[name](snap.body, keyQuery(key));
}
