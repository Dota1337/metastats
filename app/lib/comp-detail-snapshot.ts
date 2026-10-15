// Vorgerechnete Comp-Detail-Antwort lesen (SEO-Plan Schritt 5b, E2). EINE
// Funktion fuer alle Leser — Detail-Route, OG-Bild, Startdaten der Seite —,
// sonst bekommt dieselbe Adresse je nach Leser verschiedene Zahlen.
//
// Der Publisher legt je Comp-Familie einen Stand ab (compFamilySnapshotKey),
// dazu Zusatz-Eintraege fuer zusammengelegte Familien und den Slug, den er
// abgefragt hat (alter Schluessel, gleiche Blob-URL). Die Detail-Route
// antwortet im Familien-Modus fuer jeden Mitglieds-Slug gleich, bis auf
// `aliasedFromFamily.anchorSlug` (= angefragter Slug, route.ts). Mitglied heisst:
// eine eigene Zeile ab 30 Spielen im Fenster — genau `mergedFrom` bzw. bei einer
// Ein-Zeilen-Familie `clusterKey`. Slugs ohne eigene Zeile beantwortet die Route
// ueber den Geschwister-Rueckgriff mit anderem anchorSlug; die gehen hier am
// Familien-Stand vorbei (Slug-Schluessel oder live).
//
// Lesbare Adressen (L2) fragen mit der Familien-Kennung `<trait>__<carry>`.
// Die ist Mitglied, wenn sie in `mergedFamilies` steht (Zwei-Carry-Familien
// tragen beide Haelften). Fehlt ihr Familien-Eintrag (Vorrat noch nicht
// geschrieben, Ziel im Lauf gescheitert), reicht der Slug-Eintrag eines
// Mitglieds derselben Achse — im Familien-Modus sind die Zahlen gleich.
//
// Nur bei minGames 30 (DETAIL_MIN_GAMES): mit anderer Schwelle bildet die Route
// andere Familien. Alle Aufrufer der App senden 30.
import { lookupSnapshot, lookupCompDetailMemberSlugs, type LookupHit, type LookupOptions } from './snapshot-lookup';
import { DETAIL_MIN_GAMES } from './snapshot-matrix';
import { familyKeyForMerge } from './tft-comp-family-merge';
import { parseFamilyKey } from './tft-cluster';

interface DetailComp {
  clusterKey?: unknown;
  mergedFamilies?: unknown;
  aliasedFromFamily?: { anchorSlug?: unknown; mergedFrom?: unknown } | null;
  [k: string]: unknown;
}

/** Familien-Stand fuer `slug` oder null, wenn der Slug kein Mitglied ist.
 *  Gibt eine Kopie zurueck — Staende werden zwischengespeichert und geteilt. */
export function familyPayloadFor(payload: unknown, slug: string): unknown | null {
  const p = payload as { comp?: DetailComp | null } | null;
  const comp = p?.comp;
  if (!comp) return null;
  if (parseFamilyKey(slug)) {
    const families = Array.isArray(comp.mergedFamilies)
      ? comp.mergedFamilies
      : typeof comp.clusterKey === 'string' ? [familyKeyForMerge(comp.clusterKey)] : [];
    return families.includes(slug) ? payload : null;
  }
  const alias = comp.aliasedFromFamily;
  const members = alias && Array.isArray(alias.mergedFrom) ? alias.mergedFrom : [comp.clusterKey];
  if (!members.includes(slug)) return null;
  if (!alias) return payload;
  return { ...p, comp: { ...comp, aliasedFromFamily: { ...alias, anchorSlug: slug } } };
}

export async function lookupCompDetailSnapshot(
  opts: Omit<LookupOptions, 'family'> & { slug: string },
  lookup: typeof lookupSnapshot = lookupSnapshot,
  memberLookup: typeof lookupCompDetailMemberSlugs = lookupCompDetailMemberSlugs,
): Promise<LookupHit | null> {
  if (opts.skip || opts.minGames !== DETAIL_MIN_GAMES) return null;
  const fam = await lookup('comps-detail', { ...opts, family: familyKeyForMerge(opts.slug) });
  const payload = fam ? familyPayloadFor(fam.payload, opts.slug) : null;
  if (fam && payload) return { ...fam, payload, tag: 'comps-detail-family' };
  const family = parseFamilyKey(opts.slug);
  if (family) {
    const hit = await memberLookup(opts, family, p => familyPayloadFor(p, opts.slug) != null);
    return hit ? { ...hit, tag: 'comps-detail-member' } : null;
  }
  // Slug-Schluessel: der abgefragte Slug selbst (Zusatz-Eintrag des Publishers)
  // oder ein Stand aus der Zeit vor den Familien-Staenden.
  return lookup('comps-detail', opts);
}
