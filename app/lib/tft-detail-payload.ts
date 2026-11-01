// Antworten der Unit- und Item-Detailansicht (/api/tft/units?id=…,
// /api/tft/items?id=…). Eine Stelle fuer Route und Server-Seite (SEO-Plan
// Schritt 5): die Startdaten der Detailseite muessen genau die Antwort sein,
// die der Browser von der API bekaeme, sonst springen die Zahlen.
//
// Kernwerte (Spiele, Schnitt, Top 4, Sieg) kommen aus derselben Quelle wie die
// Liste — gleiche Region, gleicher Zeitraum, gleicher Rang. Die Item-Bloecke
// (Builds, Items je Stern, Item-Plaetze, Traeger) kommen seit 0096 aus der
// Datenbank (app/lib/tft-detail-builds.ts) und werden hier nur umgeformt. Die
// Wochendatei liest nur noch der Notfall-Pfad: Kernwerte, wenn die Datenbank
// nicht erreichbar war.
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

// ---------- Item-Bloecke (0096) ----------

/** [item oder Set-Schluessel „a|b|c", Spiele, Top 4, Platz-Summe] */
export type BuildRow = [string, number, number, number];
/** [characterId, Spiele, Platz-Summe, Top 4, Siege] */
export type CarrierRow = [string, number, number, number, number];

/** Antwort von get_tft_unit_builds je Unit (Summen ueber das Fenster). */
export interface UnitBuildsRaw {
  stars: Record<string, number>;
  sets: BuildRow[];
  itemsByTier: Record<string, BuildRow[]>;
  setsByTier: Record<string, BuildRow[]>;
  /** Stern → Platz → [Summe aller Kopien, [[item, Anzahl], …]] */
  slotsByTier: Record<string, Record<string, [number, [string, number][]]>>;
  topItems: BuildRow[];
}

/**
 * Zustand der Item-Bloecke: Daten (null = keine), `pending` = noch nicht
 * geladen (Startdaten ohne Vorrat — der Browser laedt nach), `failed` =
 * Datenbank-Fehler (Abschnitte fehlen, Antwort nicht lange zwischenspeichern).
 */
export type Blocks<T> = T | null | 'pending' | 'failed';

/** Eintraege mit weniger Spielen zeigen wir nicht (Stichprobe zu klein). */
export const MIN_SHOWN_GAMES = 30;

const rate = (n: number, games: number) => (games > 0 ? n / games : null);

/** Ø-Platz einer Unit mit einem Item fuer die Items-Liste, auf 2 Stellen: die Werte
 *  stehen in jeder Listenantwort und im ersten HTML. null unter der Mindestzahl.
 *  Summe 0 heisst: Stand von vor Migration 0111 ohne Summe, nicht Platz 0. */
export function carrierAvgPlacement(games: number | undefined, sumPlacement: number | undefined): number | null {
  if (!games || games < MIN_SHOWN_GAMES || !sumPlacement) return null;
  return Math.round((sumPlacement / games) * 100) / 100;
}

/** Traeger im Fenster der Items-Seite: Unit, Ø-Platz, Delta (Migration 0112). Liste
 *  statt Objekt, die Zeilen stehen 10-mal je Item in jeder Listenantwort. */
export type ItemHolder = [characterId: string, avgPlacement: number | null, delta: number | null];

/** Erst die Units mit Delta, das beste zuerst (niedriger Platz = besser). Die freien
 *  Plaetze bis `max` bekommen die meistgespielten ohne Delta, diese stehen nach dem
 *  sichtbaren Ø (User 01.11.2026: von oben links nach unten rechts), nach Spielzahl
 *  saehe die Reihe zufaellig aus, die steht nicht auf der Kachel. Ohne Ø ans Ende. */
export function itemHolders(
  rows: readonly { characterId: string; games: number; sumPlacement?: number; delta?: number | null }[],
  max = 10,
): ItemHolder[] {
  const byId = (a: { characterId: string }, b: { characterId: string }) => (a.characterId < b.characterId ? -1 : a.characterId > b.characterId ? 1 : 0);
  const avgOf = (r: { games: number; sumPlacement?: number }) => carrierAvgPlacement(r.games, r.sumPlacement);
  const scored = rows.filter(r => r.delta != null).sort((a, b) => (a.delta as number) - (b.delta as number) || byId(a, b)).slice(0, max);
  const fill = rows
    .filter(r => r.delta == null)
    .sort((a, b) => b.games - a.games || byId(a, b))
    .slice(0, Math.max(0, max - scored.length))
    .sort((a, b) => {
      const av = avgOf(a);
      const bv = avgOf(b);
      if (av == null || bv == null) return av == null && bv == null ? b.games - a.games || byId(a, b) : av == null ? 1 : -1;
      return av - bv || b.games - a.games || byId(a, b);
    });
  return [...scored, ...fill].map(r => [
    r.characterId,
    avgOf(r),
    r.delta == null ? null : Math.round(r.delta * 100) / 100,
  ]);
}

const itemEntry = ([item, games, top4, sp]: BuildRow) =>
  ({ item, games, avgPlacement: rate(sp, games), top4Rate: rate(top4, games) });

const setEntry = ([key, games, top4, sp]: BuildRow) =>
  ({ items: key.split('|'), games, avgPlacement: rate(sp, games), top4Rate: rate(top4, games) });

function itemList(rows: BuildRow[] | undefined) {
  return (rows || []).filter(r => r[1] >= MIN_SHOWN_GAMES && !isExcludedItem(r[0])).map(itemEntry);
}

function setList(rows: BuildRow[] | undefined) {
  return (rows || []).filter(r => r[1] >= MIN_SHOWN_GAMES).map(setEntry).filter(s => !setContainsExcludedItem(s.items));
}

function byTier<T>(m: Record<string, BuildRow[]> | undefined, f: (rows: BuildRow[]) => T[]): Record<string, T[]> | null {
  const out: Record<string, T[]> = {};
  for (const [tier, rows] of Object.entries(m || {})) {
    const v = f(rows);
    if (v.length > 0) out[tier] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Item-Bloecke der Unit-Detailseite aus den Summen der Datenbank. */
export function unitItemBlocks(raw: UnitBuildsRaw | null) {
  // Item-Plaetze: Prozent = Anzahl / Summe ALLER Kopien auf dem Platz (User
  // 15.10.2026), deshalb geht die Summe mit. Thief's Gloves faellt aus den
  // Eintraegen, bleibt aber im Nenner.
  let itemSlotsByTier: Record<string, Record<string, { total: number; entries: { item: string; count: number }[] }>> | null = null;
  for (const [tier, slots] of Object.entries(raw?.slotsByTier || {})) {
    for (const [slot, [total, entries]] of Object.entries(slots || {})) {
      if (!(total >= MIN_SHOWN_GAMES)) continue;
      itemSlotsByTier ??= {};
      (itemSlotsByTier[tier] ??= {})[slot] = {
        total,
        entries: (entries || []).filter(([item]) => !isExcludedItem(item)).map(([item, count]) => ({ item, count })),
      };
    }
  }
  return {
    topItems: itemList(raw?.topItems),
    topItemSets: setList(raw?.sets),
    topItemsByTier: byTier(raw?.itemsByTier, itemList),
    topItemSetsByTier: byTier(raw?.setsByTier, setList),
    itemSlotsByTier,
    /** Kopien je Stern — Standard-Stern der Item-Plaetze = meiste Spiele. */
    starGames: raw && Object.keys(raw.stars || {}).length > 0 ? raw.stars : null,
  };
}

/** Traeger eines Items, meistgespielte zuerst, hoechstens 10. */
export function itemCarriers(rows: CarrierRow[] | null) {
  return (rows || [])
    .filter(r => r[1] >= MIN_SHOWN_GAMES)
    .slice(0, 10)
    .map(([characterId, games, sp, top4, top1]) => ({
      characterId,
      games,
      avgPlacement: rate(sp, games),
      top4Rate: rate(top4, games),
      top1Rate: rate(top1, games),
    }));
}

// ---------- Antworten ----------

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
  /** Mit Datensatz und geladenen Item-Bloecken: die Route darf die Antwort
   *  lange zwischenspeichern. */
  cacheable: boolean;
}

/** Notfall: Kernwerte aus der Wochendatei, wenn die Datenbank nicht antwortete. */
function fileCore(p: DetailInput, field: 'byUnit' | 'byItem', top1: boolean) {
  const stats = loadTftStats(p.region === 'all' ? 'euw1' : p.region);
  const buckets = stats?.[field]?.[p.id];
  // grandmaster_plus: Grandmaster- und Challenger-Eintrag zusammengezaehlt.
  const e = buckets ? pickBucketEntry(buckets, p.bucket) : null;
  const core: DetailCore | null = e && e.games > 0
    ? { games: e.games, avgPlacement: e.sumPlacement / e.games, top4Rate: e.top4 / e.games, top1Rate: top1 ? e.top1 / e.games : null }
    : null;
  return { core, stats };
}

export function unitDetailBody(p: DetailInput, builds: Blocks<UnitBuildsRaw>): DetailResult<Record<string, unknown>> {
  const { id, region, bucket } = p;
  let core = p.core;
  let stats: ReturnType<typeof loadTftStats> | null = null;
  if (!p.coreKnown) ({ core, stats } = fileCore(p, 'byUnit', true));
  if (!core) {
    return { body: { region, bucket, hasData: p.coreKnown ? false : !!stats, unit: null }, cacheable: false };
  }
  const raw = builds === 'pending' || builds === 'failed' ? null : builds;
  return {
    cacheable: builds !== 'failed' && builds !== 'pending',
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
        ...unitItemBlocks(raw),
        ...(builds === 'pending' ? { itemsPending: true } : {}),
      },
    },
  };
}

export function itemDetailBody(p: DetailInput, carriers: Blocks<CarrierRow[]>): DetailResult<Record<string, unknown>> {
  const { id, region, bucket } = p;
  let core = p.core;
  let stats: ReturnType<typeof loadTftStats> | null = null;
  if (!p.coreKnown) ({ core, stats } = fileCore(p, 'byItem', false));
  if (!core) {
    return { body: { region, bucket, hasData: p.coreKnown ? false : !!stats, item: null }, cacheable: false };
  }
  const rows = carriers === 'pending' || carriers === 'failed' ? null : carriers;
  return {
    cacheable: carriers !== 'failed' && carriers !== 'pending',
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
        topUsers: itemCarriers(rows),
        ...(carriers === 'pending' ? { itemsPending: true } : {}),
      },
    },
  };
}
