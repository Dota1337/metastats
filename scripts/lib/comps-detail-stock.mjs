// Detail-Vorrat je Comp-Familie (SEO-Plan Schritt 5b, E2) — die Regeln, nach
// denen publish-snapshot-bundle.mjs die Manifest-Eintraege der Comp-Details
// bildet. Eigenes Modul ohne Seiteneffekte, damit sie getestet sind.
//
// Ein frischer Stand steht unter mehreren Schluesseln, alle mit derselben
// Blob-URL: der Anker-Familie (`comps-detail/<patch>/family/…`), jeder weiteren
// zusammengelegten Familie (Zwei-Carry-Merge) und dem abgefragten Slug (alter
// Schluessel — so finden auch Leser ohne Familien-Suche, etwa nach einem
// Rueckbau der Route, weiter ihren Stand). Gelesen wird ueber
// app/lib/comp-detail-snapshot.ts.
import { compFamilySnapshotKey, snapshotKey } from '../../app/lib/snapshot-matrix.generated.mjs';

export const DETAIL_PREFIX = 'comps-detail/';
// Ein vollstaendiger Stand des Vorlaufs schlaegt einen frischen lueckenhaften
// nur, solange er hoechstens so alt ist.
export const COMPLETE_BASE_MAX_AGE_MS = 48 * 60 * 60 * 1000;

/**
 * Lueckenhaft: eine Teilabfrage der Detail-Route riss ihr Zeitlimit — der
 * Ergebnis-Block fehlt (outcome) oder die Gegner kamen aus dem alten
 * Paar-Rueckfall statt aus den Familien-Duellen. Gemessen 15.10.2026: 27 von
 * 120 Staenden all/3d ohne outcome, alle mit ≥ 10.571 Spielen; live lieferte
 * dieselbe Comp ihn. Mit einem Stand je Familie saehen alle Varianten die Luecke.
 */
export function isPartialDetail(payload) {
  const comp = payload?.comp;
  if (!comp) return true;
  return comp.outcome == null || comp.counters?.source !== 'matchups';
}

/** Achsen eines Detail-Laufs (Permutation + aufgeloester Patch). */
function axesOf(perm, resolvedPatch) {
  return { patch: resolvedPatch, region: perm.region, days: perm.days, bucket: perm.bucket };
}

/** Schluessel des abgefragten Slugs (Form vor den Familien-Staenden). */
export function slugDetailKey(perm, resolvedPatch) {
  return snapshotKey('comps-detail', { ...axesOf(perm, resolvedPatch), minGames: perm.minGames, slug: perm.slug });
}

/**
 * Wohin ein frischer Stand geht: `blobKey` = Pfad im Blob-Speicher (Anker-
 * Familie; lueckenhafte Staende unter eigenem Pfad, damit sie nie den Blob
 * eines vollstaendigen Vorlauf-Stands ueberschreiben, auf den das Manifest
 * noch zeigt), `keys` = alle Manifest-Schluessel mit dieser URL.
 */
export function detailTargetKeys(perm, resolvedPatch, payload) {
  const axes = axesOf(perm, resolvedPatch);
  const fams = Array.isArray(payload?.comp?.mergedFamilies)
    ? payload.comp.mergedFamilies.filter(f => typeof f === 'string' && f.length > 0)
    : [];
  const famKeys = fams.map(family => compFamilySnapshotKey({ ...axes, family }));
  const slugKey = slugDetailKey(perm, resolvedPatch);
  const primary = famKeys[0] ?? slugKey;
  const blobKey = isPartialDetail(payload) ? primary.replace(/\.json$/, '.partial.json') : primary;
  return { blobKey, keys: [...new Set([...famKeys, slugKey])] };
}

/** Basis-Schluessel, die bei einem Fehlschlag dieses Ziels weiterleben duerfen. */
export function carryKeysFor(perm, resolvedPatch) {
  const keys = [slugDetailKey(perm, resolvedPatch)];
  if (perm.family) keys.push(compFamilySnapshotKey({ ...axesOf(perm, resolvedPatch), family: perm.family }));
  return keys;
}

function completeBase(entry, now) {
  if (!entry || entry.partial !== false) return false;
  const built = Date.parse(entry.builtAt);
  return Number.isFinite(built) && now - built <= COMPLETE_BASE_MAX_AGE_MS;
}

/**
 * Manifest-Eintraege der Detail-Welle aus den Ergebnissen eines Laufs.
 *
 * results: je Permutation `{ uploaded: true, keys, entry: {url, bytes, builtAt, partial} }`
 *          oder `{ error: true, carryKeys }` oder etwas anderes (gemessen leer → nichts).
 * Je Schluessel gilt: frisch vollstaendig > Vorlauf vollstaendig (≤ 48 h) >
 * frisch lueckenhaft > Vorlauf sonst. Bei gleichem Rang bleibt der erste.
 * Vorlauf-Eintraege eines fehlgeschlagenen Ziels (sein Slug- und Familien-
 * Schluessel plus alle Eintraege mit derselben URL, also seine Zusatz-
 * Eintraege) fuellen nur Schluessel, die der Lauf nicht selbst beschrieben hat.
 */
export function assembleDetailEntries(results, baseEntries, now = Date.now()) {
  const entries = {};
  const rank = {};
  let carried = 0;
  const offer = (key, entry, r) => {
    if (key in rank && rank[key] >= r) return false;
    entries[key] = { ...entry, key };
    rank[key] = r;
    return true;
  };

  for (const res of results) {
    if (!res?.uploaded) continue;
    for (const key of res.keys) offer(key, res.entry, res.entry.partial ? 1 : 3);
  }
  // Vollstaendiger Vorlauf-Stand schlaegt frische Luecke (gleicher Schluessel).
  for (const key of Object.keys(entries)) {
    if (rank[key] === 1 && completeBase(baseEntries[key], now)) offer(key, baseEntries[key], 2);
  }

  const byUrl = new Map();
  for (const [key, e] of Object.entries(baseEntries)) {
    if (!key.startsWith(DETAIL_PREFIX) || !e?.url) continue;
    if (!byUrl.has(e.url)) byUrl.set(e.url, []);
    byUrl.get(e.url).push(key);
  }
  for (const res of results) {
    if (!res?.error) continue;
    const keys = new Set();
    for (const k of res.carryKeys || []) {
      const e = baseEntries[k];
      if (!e) continue;
      keys.add(k);
      for (const same of byUrl.get(e.url) || []) keys.add(same);
    }
    for (const k of keys) {
      if (k in entries) continue;
      if (offer(k, baseEntries[k], completeBase(baseEntries[k], now) ? 2 : 0)) carried++;
    }
  }
  return { entries, carried };
}

/** Alle Detail-Eintraege des Vorlaufs (Lauf ohne Ziele, Publisher-Falle). */
export function carryAllDetailEntries(baseEntries) {
  const entries = {};
  for (const [key, e] of Object.entries(baseEntries)) if (key.startsWith(DETAIL_PREFIX)) entries[key] = e;
  return entries;
}
