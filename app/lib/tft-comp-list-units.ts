// Das gezeigte Brett einer Comp-Zeile (nur Server): Liste, Knoepfe und genaue
// Ansicht rechnen damit, damit sie dieselben Bretter sehen (tft-comp-build-group.ts).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { mergeJsonbCountArrays } from './tft-supabase-reader';
import { isExcludedItem, isExcludedUnit } from './tft-excluded';
import { parseClusterKey } from './tft-cluster';
import { componentCheckFromItems, type IsComponent } from './tft-comp-roles';
import { boardJoinRule, type BoardGroupOptions, type RestUnit } from './tft-comp-build-group';

// Items je Unit: 8 statt 3 (User 2026-09-27). Die Seite zeigt weiter hoechstens
// drei, filtert aber vorher Komponenten und Items unter 15 % heraus
// (tft-comp-roles.shownItems) — mit nur drei gespeicherten blieb danach oft
// zu wenig uebrig, und die Carry-Erkennung sah nur einen Ausschnitt.
export const UNIT_TOP_ITEMS = 8;

// Lazy + memoized champion-cost lookup pro Set. Wird vom Tempo-Klassifikator
// gebraucht, der Carry-Cost mit Peak-Level + 3-Star-Anteil in Beziehung setzt:
// 1-Cost-Reroll lebt auf Lvl 5, 2-Cost auf Lvl 6, 3-Cost auf Lvl 7. Ohne den
// Cost-Lookup würde jede Comp mit niedrigem Peak-Level fälschlich als Reroll
// klassifiziert (z.B. eine Lulu-Push-Comp auf Lvl 7 ist KEIN Reroll).
const costLookupCache = new Map<number, Map<string, number>>();
export function loadChampionCostLookup(setNumber: number): Map<string, number> {
  const cached = costLookupCache.get(setNumber);
  if (cached) return cached;
  const fresh = new Map<string, number>();
  try {
    const file = path.join(process.cwd(), 'public', `tft-assets-${setNumber}.json`);
    const bundle = JSON.parse(readFileSync(file, 'utf8')) as { champions?: Record<string, { cost?: number }> };
    for (const [cid, c] of Object.entries(bundle.champions || {})) {
      if (typeof c?.cost === 'number') fresh.set(cid, c.cost);
    }
  } catch {
    // Bundle nicht vorhanden — Tempo-Klassifikator fällt auf reine
    // Peak-Level-Heuristik zurück.
  }
  costLookupCache.set(setNumber, fresh);
  return fresh;
}

// Komponenten-Pruefung fuer die Carry-Erkennung beim Familien-Zusammenlegen —
// dieselbe Quelle (Asset-Bundle, tags 'component') wie die Listen-Seite.
const componentCheckCache = new Map<number, IsComponent>();
export function loadComponentCheck(setNumber: number): IsComponent {
  const cached = componentCheckCache.get(setNumber);
  if (cached) return cached;
  let check: IsComponent = () => false;
  try {
    const file = path.join(process.cwd(), 'public', `tft-assets-${setNumber}.json`);
    const bundle = JSON.parse(readFileSync(file, 'utf8')) as { items?: Record<string, { tags?: string[] }> };
    check = componentCheckFromItems(bundle.items);
  } catch {
    // Bundle fehlt — Komponenten zaehlen dann mit ins Item-Volumen.
  }
  componentCheckCache.set(setNumber, check);
  return check;
}

export function applyCooccurrenceFilter(
  units: Array<{ characterId: string; count: number } & Record<string, unknown>>,
  totalGames: number,
  carry: string | null,
  secondary: string | null = null,
) {
  // 30% (was 40%) — niche-clusters like TFT17_SpaceGroove@1_TFT17_Blitzcrank
  // have 221 games spread across many sub-variants, where legitimate support
  // units sit at 30-38% co-occurrence. 40% stripped all but the carry and
  // gave a useless "solo carry" comp row.
  const minCo = Math.max(1, Math.floor(totalGames * 0.30));
  const filtered = units.filter(
    u => (u.count || 0) >= minCo || u.characterId === carry || u.characterId === secondary,
  );
  // Floor 8 (von 5 erhöht 2026-06-20): wenn der Cooccurrence-Filter weniger
  // als 8 Units übrig lässt, zeigen wir die top-8 by count. Begründung:
  // User-Befund Meeple-Gnar vs Meeple-Corki — identische Comps sahen wegen
  // 6 vs 7 angezeigter Units unterschiedlich aus. Mit konsistenten 8 Slots
  // ist die Spielweise sofort erkennbar; Cooccurrence-Marker (s. baseComp)
  // sagt dem User welche davon Core (≥75%), Flex (≥50%) oder Tech (<50%) sind.
  if (filtered.length < 8) return units.slice(0, Math.min(8, units.length));
  return filtered;
}

// Units einer Zeile in der Form der Listen-API plus die uebrigen als Zaehlwerte.
// Das Familien-Zusammenlegen der Detail-Route (selectMergedFamilyMembers) und die
// Knoepfe entscheiden auf exakt denselben Zahlen wie die Listen-Seite.
export function listBoard(unitDays: unknown[] | null | undefined, games: number, clusterKey: string) {
  const parts = parseClusterKey(clusterKey);
  // Bis 18 Slots: Core 9 plus Flex-Tail (Aggregator). Das Brett nimmt die ersten 9.
  const merged = mergeJsonbCountArrays((unitDays || []) as unknown[], 'characterId', 18, [
    { field: 'topItems', innerKey: 'apiName', topN: UNIT_TOP_ITEMS },
  ]);
  const units = applyCooccurrenceFilter(
    merged.slice(0, 9)
      .filter(u => !isExcludedUnit((u as { characterId: string }).characterId))
      .map(u => {
        const raw = u as unknown as { topItems?: Array<{ apiName?: string }>; count?: number };
        // Filter Thief's Gloves & Co. aus dem per-Unit Top-Items-Array.
        const topItems = Array.isArray(raw.topItems)
          ? raw.topItems.filter(it => !isExcludedItem(it?.apiName))
          : raw.topItems;
        // Cooccurrence-Rate für Liste-View. Frontend rendert daraus den
        // Core/Flex/Tech-Marker (≥75% / ≥50% / <50%) — Detail-Page hatte
        // das schon in enrichComp.boardComposition, jetzt auch in der Liste
        // damit identische Comps sofort als solche erkennbar sind.
        const cooccurrence = games > 0 ? (raw.count || 0) / games : 0;
        return { ...u, topItems, cooccurrence };
      }) as Array<{ characterId: string; count: number } & Record<string, unknown>>,
    games,
    parts?.carry ?? null,
    parts?.secondary ?? null,
  );
  const shown = new Set(units.map(u => u.characterId));
  const rest: RestUnit[] = [];
  for (const u of merged) {
    const id = (u as { characterId: string }).characterId;
    if (shown.has(id) || isExcludedUnit(id)) continue;
    const g = Number((u as { gamesWithUnit?: unknown }).gamesWithUnit) || Number(u.count) || 0;
    if (g > 0) rest.push([id, g]);
  }
  return { units, rest };
}

// Optionen fuer boardGroups auf dem Server. `partOf`: Teil-Comp der Zeile.
export function serverBoardOptions<T>(o: {
  keyOf: (r: T) => string;
  gamesOf: (r: T) => number;
  unitDaysOf: (r: T) => unknown[] | null | undefined;
  set: number;
  partOf?: (r: T) => string | null | undefined;
}): BoardGroupOptions<T> {
  const memo = new Map<T, ReturnType<typeof listBoard>['units']>();
  const unitsOf = (r: T) => {
    let u = memo.get(r);
    if (!u) { u = listBoard(o.unitDaysOf(r), o.gamesOf(r), o.keyOf(r)).units; memo.set(r, u); }
    return u;
  };
  const cost = loadChampionCostLookup(o.set);
  return {
    keyOf: o.keyOf,
    gamesOf: o.gamesOf,
    boardOf: r => unitsOf(r).map(u => u.characterId),
    canJoin: boardJoinRule<T>({
      gamesOf: o.gamesOf,
      unitsOf,
      costOf: id => cost.get(id),
      isComponent: loadComponentCheck(o.set),
      partOf: o.partOf,
    }),
  };
}
