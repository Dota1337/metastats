import 'server-only';
// Startdaten der Comp-Detailseite (SEO-Plan Schritt 5b): Name, Zahlen und
// Links stehen gleich im ersten HTML. Gleiche Regeln wie detail-data.ts: nur
// vorgerechnete Staende, nie die Datenbank; Filter ueber resolveFilters wie die
// Route; hoechstens 1,5 s; Notschalter SEO_START_DATA=0.
//
// Der Stand ist genau die Antwort von /api/tft/comps?slug=… — dieselbe
// Lese-Funktion wie Route und OG-Bild (comp-detail-snapshot.ts). Nur die
// Familien-Ansicht (Standard); ?variant=exact und der Pro-Vergleich
// (bucket=pro_pool) sind nie vorgerechnet und kommen weiter aus dem Browser.
import { lookupCompDetailSnapshot } from '../comp-detail-snapshot';
import { DETAIL_MIN_GAMES } from '../snapshot-matrix';
import { compDetailKey, detailFiltersFrom } from '../tft-detail-filters';
import { parseClusterKey } from '../tft-cluster';
import { compDetailTarget } from '../tft-comp-path';
import { compDefiningAugmentApiNameFromSlug } from '../tft-comp-defining-augments';
import type { TftAssetsBundle } from '../tft-cdragon';
import { tftAssets } from '../og/data';
import { withTimeout } from '../og/frame';
import { subsetBundle } from './initial-data';
import { deadline, resolveFor } from './detail-data';

// Groessere Staende nicht ins HTML: gemessen 15.10.2026 78–112 KB je Stand,
// das HTML traegt ihn zweimal (Seite + Daten fuer React).
const MAX_BLOB_BYTES = 250 * 1024;

export interface CompDetailInitial {
  key: string;
  /** Antwort von /api/tft/comps?slug=…&minGames=30 (Familien-Ansicht). */
  detail: { hasData?: boolean; comp?: unknown; filters?: { dataEnd?: string | null } };
  assets: TftAssetsBundle;
}

/**
 * Alle Item-Kennungen, die irgendwo in der Antwort stehen (als Wert oder als
 * Schluessel), dazu die Augments aus Comp-Schluesseln (`~TwoTanky`, Gegner-
 * Liste). Breiter als noetig ist billig, eine fehlende Kennung waere ein
 * Symbol, das erst mit dem vollen Bundle erscheint.
 */
function collectItemIds(value: unknown, items: TftAssetsBundle['items'], out: Set<string>, depth = 0): void {
  if (value == null || depth > 16) return;
  if (typeof value === 'string') {
    if (items[value]) out.add(value);
    else if (value.includes('@')) {
      const slug = parseClusterKey(value)?.augmentSlug;
      const api = slug ? compDefiningAugmentApiNameFromSlug(slug) : null;
      if (api) out.add(api);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectItemIds(v, items, out, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (items[k]) out.add(k);
      collectItemIds(v, items, out, depth + 1);
    }
  }
}

/**
 * Ausschnitt des Bundles: alle Champions (ohne Faehigkeit — Varianten,
 * Gegner, Brett), alle Traits, die Items der Antwort samt Bauteilen, alle
 * Bauteile (Rollen-Erkennung, Bauteil-Box, Carousel) und die Codes des
 * Team-Planers (Knopf in der Kopfzeile).
 */
function compAssets(bundle: TftAssetsBundle, payload: unknown): TftAssetsBundle {
  const all = bundle.items || {};
  const items = new Set<string>();
  collectItemIds(payload, all, items);
  for (const id of [...items]) for (const c of all[id]?.composition || []) items.add(c);
  for (const [id, it] of Object.entries(all)) if (it.tags?.includes('component')) items.add(id);
  return {
    ...subsetBundle(bundle, {
      champions: Object.keys(bundle.champions || {}),
      traitIds: Object.keys(bundle.traits || {}),
      items,
      withAbility: false,
      activeItems: true,
    }),
    ...(bundle.plannerCodes ? { plannerCodes: bundle.plannerCodes } : {}),
  };
}

// `routeKey`: interne Kennung der Adresse (tft-comp-path.ts compRouteKey). Die
// Auslese von ?variant teilt sich der Server mit der Seite (compDetailTarget),
// sonst passt der Schluessel der Startdaten nie.
export async function compDetailStart(routeKey: string, sp: URLSearchParams): Promise<CompDetailInitial | null> {
  const bundle = tftAssets();
  const target = compDetailTarget(routeKey, sp.get('variant'));
  const slug = target.apiSlug;
  if (!bundle || !slug || target.mode === 'exact') return null;
  const f = detailFiltersFrom(sp);
  const left = deadline();
  const r = await resolveFor({ region: f.region, bucket: f.bucket, days: String(f.days) }, left);
  if (!r) return null;
  const hit = await withTimeout(lookupCompDetailSnapshot({
    patch: r.patch, region: r.regionLabel, days: r.requestedDays, bucket: r.bucketLabel,
    minGames: DETAIL_MIN_GAMES, setNumber: r.setNumber, endDay: r.endDay, slug,
  }), left());
  if (!hit || !(hit.blobBytes <= MAX_BLOB_BYTES)) return null;
  const detail = hit.payload as CompDetailInitial['detail'] | null;
  if (!detail?.hasData || !detail.comp) return null;
  return { key: compDetailKey(slug, f, 'family'), detail, assets: compAssets(bundle, detail) };
}
