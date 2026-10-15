// Filter und Antwortform der LoL-Champion-Liste (/api/champions). Ohne
// Server-Importe: die Liste im Browser (ChampionsClient.tsx) nutzt dieselben
// Standardwerte wie die Server-Huelle, die Route dieselbe Pruefung.

// Whitelist gegen Open-Redirect / SSRF: der region-Wert fliesst in Dateinamen
// (`champion-stats-${region.replace('1','')}.json`). Werte wie
// `../../etc/passwd` wuerden sonst durchrutschen. Riot-Region-IDs sind ein
// kleines geschlossenes Set.
export const LOL_CHAMPION_REGIONS: readonly string[] = [
  'euw1', 'na1', 'kr', 'eun1', 'br1', 'jp1', 'la1', 'la2', 'oc1', 'tr1', 'ru', 'me1', 'ph2', 'sg2', 'th2', 'tw2', 'vn2',
];

export interface ChampionListFilters {
  tier: string;
  role: string;
  region: string;
}

/** Ansicht ohne gewaehlte Filter — die Server-Huelle rendert genau diese. */
export const CHAMPION_LIST_DEFAULTS: ChampionListFilters = { tier: 'all', role: 'all', region: 'euw1' };

export function parseChampionListFilters(sp: URLSearchParams): ChampionListFilters {
  const rawRegion = sp.get('region') || CHAMPION_LIST_DEFAULTS.region;
  return {
    tier: sp.get('tier') || CHAMPION_LIST_DEFAULTS.tier,
    role: sp.get('role') || CHAMPION_LIST_DEFAULTS.role,
    region: LOL_CHAMPION_REGIONS.includes(rawRegion) ? rawRegion : CHAMPION_LIST_DEFAULTS.region,
  };
}

export function championListKey(f: ChampionListFilters): string {
  return `${f.tier}|${f.role}|${f.region}`;
}

export interface ChampionListRow {
  id: string;
  key: string;
  name: string;
  title: string;
  tags: string[];
  image: string;
  role: string;
  significantRoles: string[];
  winRate: number | null;
  pickRate: number | null;
  banRate: number | null;
  games: number;
  avgKDA: number | null;
}

export interface ChampionListPayload {
  version: string;
  champions: ChampionListRow[];
  tier: string;
  totalChampions: number;
  hasStats: boolean;
  region: string;
}
