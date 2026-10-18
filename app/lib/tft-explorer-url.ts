// Link in den Data Explorer mit vorbelegten Filtern ("Im Explorer öffnen" auf
// den Unit-, Item- und Trait-Seiten). Gebaut ueber serializeExplorerQuery, also
// in derselben kurzen, festen Form, die der Explorer selbst schreibt (u=, i=,
// t=, k=, r=, p=, tab=, f=) — sonst landet der Besucher auf einer Weiterleitung
// und einem anderen Cache-Eintrag. Alte Links (?units=&bucket=) liest der
// Explorer weiter (parseExplorerParams).

import {
  EMPTY_QUERY, LATEST_PATCH, legacyBucketToRanks, serializeExplorerQuery,
  type ExplorerQuery, type ExplorerTab, type UnitFilter,
} from './tft-explorer-query';

export interface ExplorerFilter {
  /** Kennung oder Unit-Filter (Sterne, Itemzahl, Items an der Kopie). */
  units?: Array<string | UnitFilter>;
  items?: string[];
  traits?: string[];
  /** Rang-Gruppe der Detailseiten (TierFilter), z. B. master_plus. */
  bucket?: string;
  region?: string;
  /** Patch, fehlt = neuester. */
  patch?: string;
  tab?: ExplorerTab;
  /** Traeger im Item- und Builds-Reiter. */
  focus?: string;
}

/** Die Anfrage, die der Link beschreibt (auch fuer Abrufe derselben Ansicht). */
export function explorerQueryFor(filter: ExplorerFilter): ExplorerQuery {
  const region = (filter.region || '').toLowerCase();
  return {
    ...EMPTY_QUERY,
    region: region && region !== 'all' ? region : 'all',
    ranks: legacyBucketToRanks(filter.bucket ?? null),
    patches: [filter.patch || LATEST_PATCH],
    units: (filter.units || []).map(u => (typeof u === 'string' ? { id: u } : u)),
    items: (filter.items || []).map(id => ({ id })),
    traits: (filter.traits || []).map(id => ({ id })),
    tab: filter.tab || 'units',
    focus: filter.focus || null,
  };
}

export function buildExplorerUrl(filter: ExplorerFilter): string {
  const qs = serializeExplorerQuery(explorerQueryFor(filter));
  return qs ? `/tft/explorer?${qs}` : '/tft/explorer';
}
