// „Erweitert"-Filter der Comp-Liste (/tft/comps, auch der Uebersicht mit ?adv=):
// Kriterien, Adress-Format und die Filterung selbst. Reine Funktionen ohne JSX,
// damit Tests sie laden koennen; die Bedienung steht in
// components/tft/AdvancedCompFilters.tsx.
//
// Gefiltert werden fertige Comps an ihren Familienwerten — dieselben Zahlen,
// die die Liste zeigt (User 22.10.2026). Vorher wurden die einzelnen Tageszeilen
// gefiltert, bevor sie zu Comps zusammengefasst wurden: eine Comp mit 574
// Spielen fehlte bei „Spiele ≥ 200", weil keine einzelne Zeile 200 hatte, und
// „Hidden Gems" zeigte die guten Teilstuecke einer Comp (Ø 2,98 statt 4,54).
import type { CompFamily } from '../components/tft/CompFamilyRow';
import type { TftAssetsBundle } from './tft-cdragon';
import { familyCost } from './tft-comp-families';

// Kosten-Gruppen: 1-2 = „Reroll", 3 = „Mid", 4-5 = „Fast 8/9". Die Kosten der
// Comp kommen aus familyCost (wie die Uebersicht nach Kosten).
export type CostGroup = 'all' | 'reroll' | 'mid' | 'fast8';

export interface AdvancedFilters {
  avgPlaceMax: number | null;     // Ø-Platzierung höchstens X (kleiner = besser)
  top4MinPct: number | null;      // Top-4-Rate mindestens X%
  top1MinPct: number | null;      // Top-1-Rate mindestens X%
  pickMaxPct: number | null;      // Pickrate höchstens X% (für versteckte Comps)
  gamesMin: number | null;        // Mindest-Samplegröße
  costGroup: CostGroup;           // Reroll / Mid / Fast8 / Alle
}

export const ADV_DEFAULT: AdvancedFilters = {
  avgPlaceMax: null,
  top4MinPct: null,
  top1MinPct: null,
  pickMaxPct: null,
  gamesMin: null,
  costGroup: 'all',
};

// Active when at least one constraint is set.
export function isAdvActive(f: AdvancedFilters): boolean {
  return f.avgPlaceMax != null || f.top4MinPct != null || f.top1MinPct != null
    || f.pickMaxPct != null || f.gamesMin != null || f.costGroup !== 'all';
}

function matchesCostGroup(group: CostGroup, cost: number | null): boolean {
  if (group === 'all') return true;
  if (cost == null) return false;
  if (group === 'reroll') return cost <= 2;
  if (group === 'mid') return cost === 3;
  if (group === 'fast8') return cost >= 4;
  return true;
}

// Verglichen wird am angezeigten Wert (CompRow: Ø mit 2 Stellen, Top 4 / Sieg
// als ganze Prozent, Pick mit 2 Stellen) — wie die Tier-Buchstaben. Sonst faellt
// eine Comp, die „4,25" zeigt, bei „Ø ≤ 4,25" heraus.
const shown = (v: number, digits: number) => Number(v.toFixed(digits));

// Fehlt ein Wert, besteht die Comp jedes Kriterium, das ihn braucht, nicht —
// Teildaten sollen nicht als Treffer durchgehen. Ausnahme Pick: fehlt er, zaehlt
// das Kriterium nicht (wie bisher).
export function applyAdvancedFilters(
  families: CompFamily[],
  f: AdvancedFilters,
  assets: TftAssetsBundle | null,
): CompFamily[] {
  if (!isAdvActive(f)) return families;
  return families.filter(c => {
    const avg = c.weightedAvgPlacement;
    const top4 = c.weightedTop4Rate;
    const top1 = c.weightedTop1Rate;
    const pick = c.familyPickRate;
    if (f.avgPlaceMax != null && (avg == null || shown(avg, 2) > f.avgPlaceMax)) return false;
    if (f.top4MinPct != null && (top4 == null || shown(top4 * 100, 0) < f.top4MinPct)) return false;
    if (f.top1MinPct != null && (top1 == null || shown(top1 * 100, 0) < f.top1MinPct)) return false;
    if (f.pickMaxPct != null && pick != null && shown(pick * 100, 2) > f.pickMaxPct) return false;
    if (f.gamesMin != null && (c.totalGames ?? 0) < f.gamesMin) return false;
    if (f.costGroup !== 'all' && !matchesCostGroup(f.costGroup, assets ? familyCost(c, assets) : null)) return false;
    return true;
  });
}

// URL helpers: pack into a single "adv" param so URLs stay compact and
// shareable. Format: avgMax=4.4_top4Min=50_gamesMin=500_pickMax=8.
export function advToUrlParam(f: AdvancedFilters): string | null {
  const parts: string[] = [];
  if (f.avgPlaceMax != null) parts.push(`avgMax=${f.avgPlaceMax}`);
  if (f.top4MinPct != null) parts.push(`top4Min=${f.top4MinPct}`);
  if (f.top1MinPct != null) parts.push(`top1Min=${f.top1MinPct}`);
  if (f.pickMaxPct != null) parts.push(`pickMax=${f.pickMaxPct}`);
  if (f.gamesMin != null) parts.push(`gamesMin=${f.gamesMin}`);
  if (f.costGroup !== 'all') parts.push(`cost=${f.costGroup}`);
  return parts.length > 0 ? parts.join('_') : null;
}

export function advFromUrlParam(raw: string | null): AdvancedFilters {
  if (!raw) return ADV_DEFAULT;
  const out: AdvancedFilters = { ...ADV_DEFAULT };
  for (const p of raw.split('_')) {
    const [k, v] = p.split('=');
    if (k === 'cost') {
      if (v === 'reroll' || v === 'mid' || v === 'fast8') out.costGroup = v;
      continue;
    }
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    if (k === 'avgMax') out.avgPlaceMax = n;
    else if (k === 'top4Min') out.top4MinPct = n;
    else if (k === 'top1Min') out.top1MinPct = n;
    else if (k === 'pickMax') out.pickMaxPct = n;
    else if (k === 'gamesMin') out.gamesMin = n;
  }
  return out;
}
