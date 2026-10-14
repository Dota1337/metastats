// Antworten der Unit- und Item-Detailansicht (/api/tft/units?id=…,
// /api/tft/items?id=…). Eine Stelle fuer Route und Server-Seite (SEO-Plan
// Schritt 5): die Startdaten der Detailseite muessen genau die Antwort sein,
// die der Browser von der API bekaeme, sonst springen die Zahlen.
//
// Kernwerte (Spiele, Schnitt, Top 4, Sieg) kommen aus derselben Quelle wie die
// Liste — gleiche Region, gleicher Zeitraum, gleicher Rang. Die Item-Bloecke
// gibt es nur in den Wochendateien (bei „alle Regionen" EUW, die groesste
// Stichprobe). Set-Rueckfall (2026-08-27): der Loader haelt JSONs aus einem
// alten Set zurueck (siehe tft-stats-loader.ts) — dann bleiben die Item-Bloecke
// leer statt erfunden.
import { loadTftStats, pickBucketEntry } from './tft-stats-loader';
import { isExcludedItem, setContainsExcludedItem } from './tft-excluded';

export interface DetailCore {
  games: number;
  avgPlacement: number | null;
  top4Rate: number | null;
  top1Rate: number | null;
}

interface CoreRow {
  games?: number;
  avgPlacement?: number | null;
  top4Rate?: number | null;
  top1Rate?: number | null;
}

/** Kernwerte aus einer Zeile des Listen-Stands (units- bzw. items-Snapshot). */
export function coreFromListRow(row: CoreRow | undefined): DetailCore | null {
  return row && (row.games ?? 0) > 0
    ? { games: row.games!, avgPlacement: row.avgPlacement ?? null, top4Rate: row.top4Rate ?? null, top1Rate: row.top1Rate ?? null }
    : null;
}

export interface DetailInput {
  id: string;
  /** Kleingeschrieben, `all` = alle Regionen. */
  region: string;
  /** Bereits normalisiert (normalizeBucket). */
  bucket: string;
  core: DetailCore | null;
  /** Kernwerte aus Snapshot/DB bekannt (auch „nicht gespielt"). */
  coreKnown: boolean;
  filterSet: number | null;
  filterPatch: string | null;
}

export interface DetailResult<Body> {
  body: Body;
  /** Mit Datensatz: die Route darf die Antwort lange zwischenspeichern. */
  cacheable: boolean;
  /** Wochendatei gelesen — ohne sie keine Startdaten (die Seite koennte sie in
   *  ihrer Funktion nicht finden, die API schon). */
  statsLoaded: boolean;
}

export function unitDetailBody(p: DetailInput): DetailResult<Record<string, unknown>> {
  const { id, region, bucket } = p;
  let core = p.core;
  const stats = loadTftStats(region === 'all' ? 'euw1' : region);
  const buckets = stats?.byUnit?.[id];
  // grandmaster_plus: Grandmaster- und Challenger-Eintrag zusammengezaehlt.
  const jsonEntry = buckets ? pickBucketEntry(buckets, bucket) : null;
  if (!p.coreKnown && jsonEntry && jsonEntry.games > 0) {
    core = {
      games: jsonEntry.games,
      avgPlacement: jsonEntry.sumPlacement / jsonEntry.games,
      top4Rate: jsonEntry.top4 / jsonEntry.games,
      top1Rate: jsonEntry.top1 / jsonEntry.games,
    };
  }
  if (!core) {
    return { body: { region, bucket, hasData: p.coreKnown ? false : !!stats, unit: null }, cacheable: false, statsLoaded: !!stats };
  }
  const data: any = jsonEntry ?? {};
  return {
    cacheable: true,
    statsLoaded: !!stats,
    body: {
      region, bucket,
      set: p.filterSet ?? stats?.set ?? null, patch: p.filterPatch ?? stats?.patch ?? null,
      hasData: true,
      unit: {
        characterId: id,
        games: core.games,
        avgPlacement: core.avgPlacement,
        top4Rate: core.top4Rate,
        top1Rate: core.top1Rate,
        // Thief's Gloves & Co. raus — singulär aus den Item-Listen, als
        // ganzes Set aus den Item-Set-Listen. "Top Item-Builds" sollen die
        // bewussten Carry-Builds zeigen, nicht Random-Pulls.
        topItems: (data.topItems || [])
          .filter((it: any) => !isExcludedItem(it.item))
          .map((it: any) => ({
            item: it.item,
            games: it.games,
            avgPlacement: it.games > 0 ? it.sumPlacement / it.games : null,
            top4Rate: it.games > 0 ? it.top4 / it.games : null,
          })),
        topItemSets: (data.topItemSets || [])
          .filter((s: any) => !setContainsExcludedItem(s.items))
          .map((s: any) => ({
            items: s.items,
            games: s.games,
            avgPlacement: s.games > 0 ? s.sumPlacement / s.games : null,
            top4Rate: s.games > 0 ? s.top4 / s.games : null,
          })),
        topItemsByTier: data.topItemsByTier
          ? Object.fromEntries(
              Object.entries(data.topItemsByTier).map(([tier, arr]: [string, any]) => [
                tier,
                (arr || [])
                  .filter((it: any) => !isExcludedItem(it.item))
                  .map((it: any) => ({
                    item: it.item,
                    games: it.games,
                    avgPlacement: it.games > 0 ? it.sumPlacement / it.games : null,
                    top4Rate: it.games > 0 ? it.top4 / it.games : null,
                  })),
              ])
            )
          : null,
        topItemSetsByTier: data.topItemSetsByTier
          ? Object.fromEntries(
              Object.entries(data.topItemSetsByTier).map(([tier, arr]: [string, any]) => [
                tier,
                (arr || [])
                  .filter((s: any) => !setContainsExcludedItem(s.items))
                  .map((s: any) => ({
                    items: s.items,
                    games: s.games,
                    avgPlacement: s.games > 0 ? s.sumPlacement / s.games : null,
                    top4Rate: s.games > 0 ? s.top4 / s.games : null,
                  })),
              ])
            )
          : null,
        // Damage-Atlas: { tier: { itemCount: { games, p50, p75, p95, p99, max } } }
        damageByTier: data.damageByTier || null,
        // Carry-Performance: { tier: { itemCount: { games, avgPlacement, top4Rate, top1Rate } } }
        // — avg placement + top4 when THIS unit was the carry (replaces the
        // player-HP damage atlas with a real carry-strength signal).
        carryPlacementByTier: data.carryPlacementByTier
          ? Object.fromEntries(
              Object.entries(data.carryPlacementByTier).map(([tier, m]: [string, any]) => [
                tier,
                Object.fromEntries(
                  Object.entries(m || {}).map(([ic, e]: [string, any]) => [
                    ic,
                    {
                      games: e.games,
                      avgPlacement: e.games > 0 ? e.sumPlacement / e.games : null,
                      top4Rate: e.games > 0 ? e.top4 / e.games : null,
                      top1Rate: e.games > 0 ? e.top1 / e.games : null,
                    },
                  ])
                ),
              ])
            )
          : null,
        // Item-Slot-Build-Order: { tier: { slotIdx: [{item, count}, ...] } }
        // Auch hier ThG raus — wenn ein Slot häufig Thief's Gloves zeigt, ist
        // das eine Augment-Wahl, kein Build-Pfad.
        itemSlotOrderByTier: data.itemSlotOrderByTier
          ? Object.fromEntries(
              Object.entries(data.itemSlotOrderByTier).map(([tier, slots]: [string, any]) => [
                tier,
                Object.fromEntries(
                  Object.entries(slots || {}).map(([slotIdx, entries]: [string, any]) => [
                    slotIdx,
                    (entries || []).filter((e: any) => !isExcludedItem(e.item)),
                  ])
                ),
              ])
            )
          : null,
      },
    },
  };
}

export function itemDetailBody(p: DetailInput): DetailResult<Record<string, unknown>> {
  const { id, region, bucket } = p;
  let core = p.core;
  const stats = loadTftStats(region === 'all' ? 'euw1' : region);
  const buckets = stats?.byItem?.[id];
  // grandmaster_plus: Grandmaster- und Challenger-Eintrag zusammengezaehlt.
  const jsonEntry = buckets ? pickBucketEntry(buckets, bucket) : null;
  if (!p.coreKnown && jsonEntry && jsonEntry.games > 0) {
    core = {
      games: jsonEntry.games,
      avgPlacement: jsonEntry.sumPlacement / jsonEntry.games,
      top4Rate: jsonEntry.top4 / jsonEntry.games,
      top1Rate: null,
    };
  }
  if (!core) {
    return { body: { region, bucket, hasData: p.coreKnown ? false : !!stats, item: null }, cacheable: false, statsLoaded: !!stats };
  }
  const data: any = jsonEntry ?? {};
  return {
    cacheable: true,
    statsLoaded: !!stats,
    body: {
      region, bucket,
      set: p.filterSet ?? stats?.set ?? null, patch: p.filterPatch ?? stats?.patch ?? null,
      hasData: true,
      item: {
        apiName: id,
        games: core.games,
        avgPlacement: core.avgPlacement,
        top4Rate: core.top4Rate,
        top1Rate: core.top1Rate,
        // Per-carrier top4Rate + top1Rate land in the snapshot from the
        // aggregator-patch (2026-06-19). Older JSON snapshots without
        // u.top4 / u.top1 surface as null so the UI shows "—" instead of
        // a fake zero — gets filled in on the next daily-crawl cycle.
        topUsers: (data.topUsers || []).map((u: any) => ({
          characterId: u.characterId,
          games: u.games,
          avgPlacement: u.games > 0 ? u.sumPlacement / u.games : null,
          top4Rate: u.games > 0 && u.top4 != null ? u.top4 / u.games : null,
          top1Rate: u.games > 0 && u.top1 != null ? u.top1 / u.games : null,
        })),
      },
    },
  };
}
