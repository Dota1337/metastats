// Single source of truth für die TFT-aktiven Regionen. ph2/th2 sind seit
// 2026-06-19 raus (0 D2+ Spieler, 0 Crawl-Meta-Rows letzte 14 Tage). Die
// Routings selbst bleiben in app/lib/regions.ts als gültige Whitelist (für
// direkte API-Calls / Pro-Profile mit ph2/th2-Tag).
//
// MUSS synchron bleiben mit scripts/lib/active-regions.mjs (Crawler-Driver).

export const ACTIVE_REGIONS: readonly string[] = [
  'euw1', 'eun1', 'tr1', 'ru', 'me1',
  'na1', 'br1', 'la1', 'la2',
  'kr', 'jp1',
  'oc1', 'sg2', 'tw2', 'vn2',
];

export const ACTIVE_REGIONS_WEST: readonly string[] = [
  'euw1', 'eun1', 'na1', 'br1', 'la1', 'la2', 'tr1', 'ru', 'me1',
];

export const ACTIVE_REGIONS_ASIA: readonly string[] = [
  'kr', 'jp1', 'oc1', 'sg2', 'tw2', 'vn2',
];

export const ACTIVE_REGION_SET: ReadonlySet<string> = new Set(ACTIVE_REGIONS);

export function isActiveRegion(r: string): boolean {
  return ACTIVE_REGION_SET.has(r);
}
