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

/** Traeger fuer den Knopf „Häufigste Träger" (User 02.11.2026): die meistgespielten, in
 *  dieser Reihenfolge (vom User so gewaehlt, obwohl die Spielzahl nicht auf der Kachel
 *  steht). Ø und Delta wie bei den anderen Traegern. */
export function itemHoldersCommon(
  rows: readonly { characterId: string; games: number; sumPlacement?: number; delta?: number | null }[],
  max = 10,
): ItemHolder[] {
  const byId = (a: { characterId: string }, b: { characterId: string }) => (a.characterId < b.characterId ? -1 : a.characterId > b.characterId ? 1 : 0);
  return [...rows]
    .sort((a, b) => b.games - a.games || byId(a, b))
    .slice(0, max)
    .map(r => [
      r.characterId,
      carrierAvgPlacement(r.games, r.sumPlacement),
      r.delta == null ? null : Math.round(r.delta * 100) / 100,
    ]);
}

/** Erst die Units mit Delta, das beste zuerst (niedriger Platz = besser). Die freien
 *  Plaetze bis `max` bekommen die meistgespielten ohne Delta, diese stehen nach dem
 *  sichtbaren Ø (User 01.11.2026: von oben links nach unten rechts). Ohne Ø ans Ende.
 *  Hat KEINE Unit ein Delta (Traenke), heisst die Liste „Häufigste Träger" und steht wie
 *  der gleichnamige Knopf nach Kopien (User 02.11.2026). */
export function itemHolders(
  rows: readonly { characterId: string; games: number; sumPlacement?: number; delta?: number | null }[],
  max = 10,
): ItemHolder[] {
  if (!rows.some(r => r.delta != null)) return itemHoldersCommon(rows, max);
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

/** Delta je Unit aus der Listenzeile eines Items (holders ∪ holdersCommon), fuer die
 *  Traeger-Tabelle der Item-Detailseite (User 02.11.2026): dieselbe Zahl wie im Fenster
 *  der Items-Seite, ohne eigene Abfrage. Units ohne Delta fehlen in der Map. */
export function holderDeltaMap(
  row: { holders?: readonly ItemHolder[] | null; holdersCommon?: readonly ItemHolder[] | null } | null | undefined,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const h of [...(row?.holders || []), ...(row?.holdersCommon || [])]) {
    if (Array.isArray(h) && typeof h[0] === 'string' && typeof h[2] === 'number' && Number.isFinite(h[2])) out.set(h[0], h[2]);
  }
  return out;
}

/** Units fuer die Kombinationen: die 10 meistgespielten der Listenzeile (holdersCommon, sonst
 *  holders — ohne Delta stehen die schon nach Kopien; Staende von vor 0112: topUsers). Aus der
 *  Listenzeile statt aus den Traegern, damit beide Abfragen parallel laufen. */
export function comboUnitIds(
  row: { holders?: readonly ItemHolder[] | null; holdersCommon?: readonly ItemHolder[] | null; topUsers?: readonly unknown[] | null } | null | undefined,
): string[] {
  const fromHolders = (row?.holdersCommon ?? row?.holders ?? []).map(h => h?.[0]).filter((id): id is string => typeof id === 'string');
  const ids = fromHolders.length > 0 ? fromHolders : (row?.topUsers ?? []).filter((id): id is string => typeof id === 'string');
  return ids.slice(0, 10);
}

/** Kombinationen der Item-Detailseite (User 02.11.2026): Sets mit dem Item aus
 *  get_tft_item_set_combos (Summe ueber die Units, nur Units mit 3 fertigen Items). Die
 *  8 meistgespielten ab 100 Spielen — nach Ø ausgewaehlt stuenden nur die Builds einer Unit
 *  oben (IE: 9 von 9 Elder Dragon) und 30 Spiele schwanken um ±0,4 —, gezeigt nach Ø.
 *  Sets mit Thief's Gloves fallen raus, doppelte Items bleiben (echte Builds, Vow×3). */
export const COMBO_MIN_GAMES = 100;
export const COMBO_LIMIT = 8;
export function itemSetCombos(rows: readonly BuildRow[] | null | undefined) {
  const byKey = (a: BuildRow, b: BuildRow) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return (rows || [])
    .filter(r => r[1] >= COMBO_MIN_GAMES && !setContainsExcludedItem(r[0].split('|')))
    .sort((a, b) => b[1] - a[1] || byKey(a, b))
    .slice(0, COMBO_LIMIT)
    .map(setEntry)
    .sort((a, b) => (a.avgPlacement as number) - (b.avgPlacement as number) || b.games - a.games);
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

/** `deltas` (holderDeltaMap): mit Map traegt jeder Traeger `delta` (null = kein Wert,
 *  die Seite zeigt „—"); ohne Map (Kernwerte aus der Wochendatei) fehlt das Feld. */
export function itemDetailBody(
  p: DetailInput,
  carriers: Blocks<CarrierRow[]>,
  deltas?: ReadonlyMap<string, number> | null,
  /** Sets aus get_tft_item_set_combos (itemCombosFor). undefined = nicht abgefragt (Companion):
   *  kein Feld. `failed` ebenfalls ohne Feld — der Browser zeigt dann keine Box. */
  combos?: Blocks<BuildRow[]>,
): DetailResult<Record<string, unknown>> {
  const { id, region, bucket } = p;
  let core = p.core;
  let stats: ReturnType<typeof loadTftStats> | null = null;
  if (!p.coreKnown) ({ core, stats } = fileCore(p, 'byItem', false));
  if (!core) {
    return { body: { region, bucket, hasData: p.coreKnown ? false : !!stats, item: null }, cacheable: false };
  }
  const rows = carriers === 'pending' || carriers === 'failed' ? null : carriers;
  const combosField = combos === 'pending' ? { combosPending: true }
    : combos === undefined || combos === 'failed' ? {}
    : { combos: itemSetCombos(combos) };
  return {
    cacheable: carriers !== 'failed' && carriers !== 'pending' && combos !== 'failed' && combos !== 'pending',
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
        topUsers: itemCarriers(rows).map(u => (deltas ? { ...u, delta: deltas.get(u.characterId) ?? null } : u)),
        ...(carriers === 'pending' ? { itemsPending: true } : {}),
        ...combosField,
      },
    },
  };
}
