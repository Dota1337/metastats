// Single source of truth für die TFT-aktiven Regionen (MJS-Pendant).
// MUSS synchron bleiben mit app/lib/active-regions.ts (Next.js-App).
// ph2/th2 sind seit 2026-06-19 raus (0 D2+ Spieler).

export const ACTIVE_REGIONS = [
  'euw1', 'eun1', 'tr1', 'ru', 'me1',
  'na1', 'br1', 'la1', 'la2',
  'kr', 'jp1',
  'oc1', 'sg2', 'tw2', 'vn2',
];

export const ACTIVE_REGIONS_WEST = [
  'euw1', 'eun1', 'na1', 'br1', 'la1', 'la2', 'tr1', 'ru', 'me1',
];

export const ACTIVE_REGIONS_ASIA = [
  'kr', 'jp1', 'oc1', 'sg2', 'tw2', 'vn2',
];

export const ACTIVE_REGION_SET = new Set(ACTIVE_REGIONS);

export function isActiveRegion(r) {
  return ACTIVE_REGION_SET.has(r);
}
