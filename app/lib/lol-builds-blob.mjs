// Vorgerechnete Builds & Runen der LoL-Champion-Seite (Weg B, Nachtrag 8):
// die Standardansicht als Datei je Champion im Vercel Blob, damit die Seite
// sie gleich im ersten HTML zeigt und nie die Datenbank fragt.
//
// Eine Quelle fuer drei Stellen: Box (scripts/publish-lol-builds.mjs schreibt),
// Route (app/api/champions/[id]/builds liest zuerst die Datei) und Seite
// (app/lib/seo/lol-detail-data.ts). Als .mjs neben lol-counters.mjs, weil die
// Box keine TS-Dateien laedt — steht deshalb im Pfad-Filter von
// .github/workflows/deploy-hetzner.yml, sonst schriebe die Box nach einer
// Pfadaenderung still an die alte Stelle.

/** Was die Seite ohne Auswahl zeigt — und die einzige Ansicht, die als Datei liegt. */
export const LOL_BUILDS_DEFAULT = Object.freeze({ region: 'euw1', rank: 'EMERALD_PLUS' });

/** Aelter wird eine Datei nicht benutzt: Lauf alle 6 h, zwei Tage Ausfall der Box gehen. */
export const LOL_BUILDS_MAX_AGE_MS = 48 * 60 * 60 * 1000;

const DIR = `lol/champion-builds/${LOL_BUILDS_DEFAULT.region}/${LOL_BUILDS_DEFAULT.rank}`;

/** `{ builtAt, entries: { <key>: <Spiele> } }` — nur fuer den Frische-Vertrag. */
export const LOL_BUILDS_INDEX_PATH = `${DIR}/index.json`;

/** Data-Dragon-Zahl-Key ("103" = Ahri). Nur Ziffern — er landet in einem Pfad. */
export function isChampionKey(key) {
  return /^\d{1,6}$/.test(String(key));
}

export function lolBuildsPath(key) {
  if (!isChampionKey(key)) throw new Error(`kein Champion-Key: ${key}`);
  return `${DIR}/${key}.json`;
}

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const LISTS = ['topBuilds', 'topBoots', 'topItems', 'topRunes', 'topKeystones', 'topSummoners'];

function isValidRole(r) {
  return isObj(r)
    && Number.isFinite(r.games) && r.games > 0
    && Number.isFinite(r.wins)
    && LISTS.every(k => Array.isArray(r[k]))
    && isObj(r.counters) && Array.isArray(r.counters.strongAgainst) && Array.isArray(r.counters.weakAgainst);
}

/**
 * Gueltige Datei fuer genau diesen Champion? Sonst rechnet die Route live und
 * die Seite laedt wie bisher im Browser. Nur Antworten aus der Datenbank
 * (`source: 'db'`) — die Repo-Datei ueber alle Raenge ist keine Rang-Ansicht.
 * `now` nur fuer Tests.
 */
export function isValidLolBuildsSnapshot(snap, key, now = Date.now()) {
  if (!isObj(snap) || String(snap.championKey) !== String(key)) return false;
  if (snap.region !== LOL_BUILDS_DEFAULT.region || snap.rank !== LOL_BUILDS_DEFAULT.rank) return false;
  if (snap.source !== 'db' || snap.hasBuilds !== true) return false;
  if (typeof snap.ddragonVersion !== 'string' || !snap.ddragonVersion) return false;
  const built = Date.parse(snap.builtAt);
  if (!Number.isFinite(built) || now - built > LOL_BUILDS_MAX_AGE_MS || built - now > 5 * 60_000) return false;
  if (!isObj(snap.roles)) return false;
  const roles = Object.values(snap.roles);
  return roles.length > 0 && roles.every(isValidRole);
}
