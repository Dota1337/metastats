/** All League of Legends regions with display labels and regional routing */

export interface Region {
  value: string;
  label: string;
}

export const REGIONS: Region[] = [
  { value: 'euw1', label: 'EUW' },
  { value: 'eun1', label: 'EUNE' },
  { value: 'na1', label: 'NA' },
  { value: 'kr', label: 'KR' },
  { value: 'br1', label: 'BR' },
  { value: 'la1', label: 'LAN' },
  { value: 'la2', label: 'LAS' },
  { value: 'oc1', label: 'OCE' },
  { value: 'tr1', label: 'TR' },
  { value: 'ru', label: 'RU' },
  { value: 'jp1', label: 'JP' },
  { value: 'ph2', label: 'PH' },
  { value: 'sg2', label: 'SG' },
  { value: 'th2', label: 'TH' },
  { value: 'tw2', label: 'TW' },
  { value: 'vn2', label: 'VN' },
  { value: 'me1', label: 'ME' },
];

/** Maps platform region to Riot regional routing value */
export const REGIONAL_ROUTING: Record<string, string> = {
  euw1: 'europe', eun1: 'europe', tr1: 'europe', ru: 'europe', me1: 'europe',
  na1: 'americas', br1: 'americas', la1: 'americas', la2: 'americas',
  kr: 'asia', jp1: 'asia',
  oc1: 'sea', ph2: 'sea', sg2: 'sea', th2: 'sea', tw2: 'sea', vn2: 'sea',
};

/**
 * Sicherheits-Riegel gegen SSRF (2026-08-14).
 *
 * Mehrere Routen haben die Region roh in den Riot-Host interpoliert
 * (`https://${region}.api.riotgames.com/...?api_key=...`). Ein beliebiger
 * Hostname im Query-Param liess damit den Request samt API-Key an einen
 * fremden Server gehen. Deshalb: JEDE Region, die in einen Host oder an
 * einen Riot-Call geht, muss vorher durch parseRegion().
 *
 * Validiert wird gegen REGIONAL_ROUTING (17 Plattformen), NICHT gegen
 * ACTIVE_REGIONS (15) — ph2/th2 sind nur aus dem Crawl raus, Profile und
 * Pro-Tags mit diesen Regionen existieren weiter.
 *
 * Nicht abgedeckt und bewusst so: 'cn'. In tft_pro_players stehen 248
 * chinesische Pros mit region='cn'. Das ist keine Riot-Plattform und hat
 * keinen API-Host — solche Aufrufe schlugen auch vorher fehl, jetzt eben
 * sauber mit 400 statt mit einem DNS-Fehler.
 */

export const REGION_ALL = 'all';

/** Trim + lowercase. Ohne das wuerde ?region=EUW1 kuenftig 400 geben —
 *  die LoL-Routen lasen bisher ohne toLowerCase(), die TFT-Routen mit. */
export function normalizeRegion(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase();
}

export function isValidRegion(raw: string | null | undefined): boolean {
  return Object.prototype.hasOwnProperty.call(REGIONAL_ROUTING, normalizeRegion(raw));
}

/**
 * Liefert die normalisierte Region oder null, wenn sie ungueltig ist.
 * Aufrufer antworten bei null mit HTTP 400 — kein stiller Fallback auf
 * euw1, sonst verdeckt der Default den Angriffsversuch.
 *
 * @param opts.fallback  genutzt wenn raw leer/fehlend ist (nicht wenn ungueltig)
 * @param opts.allowAll  'all' durchlassen (Aggregat-Routen wie /api/leaderboard
 *                       und /api/marktwert kennen das als eigenen Modus)
 */
export function parseRegion(
  raw: string | null | undefined,
  opts: { fallback?: string; allowAll?: boolean } = {},
): string | null {
  const value = normalizeRegion(raw) || normalizeRegion(opts.fallback);
  if (!value) return null;
  if (opts.allowAll && value === REGION_ALL) return REGION_ALL;
  return isValidRegion(value) ? value : null;
}

/**
 * Wirft bei unbekannter Region statt still 'europe' zu liefern. Der frueher
 * hier sitzende `|| 'europe'`-Fallback hat falsche Regionen nicht abgelehnt,
 * sondern auf den europaeischen Cluster geschickt — das ergibt stille
 * Falschdaten. Alle Aufrufer validieren vorher mit parseRegion().
 */
export function getRegionalRouting(region: string): string {
  const cluster = REGIONAL_ROUTING[normalizeRegion(region)];
  if (!cluster) throw new Error(`Unbekannte Region: ${region}`);
  return cluster;
}
