// Builds a /tft/explorer URL pre-filtered by entity. Used by the
// "Open in Explorer" cross-drill button on Unit/Item/Trait detail pages:
// click the button, land in the Explorer with this entity preselected,
// then layer additional filters (multiple units, items, traits).
//
// Explorer reads ?units=X,Y&items=A&traits=T from search params on mount
// (see app/tft/explorer/page.tsx); the comma-separated lists round-trip
// through the picker selection.

export interface ExplorerFilter {
  units?: string[];
  items?: string[];
  traits?: string[];
  bucket?: string;
  region?: string;
}

export function buildExplorerUrl(filter: ExplorerFilter): string {
  const sp = new URLSearchParams();
  if (filter.units?.length) sp.set('units', filter.units.join(','));
  if (filter.items?.length) sp.set('items', filter.items.join(','));
  if (filter.traits?.length) sp.set('traits', filter.traits.join(','));
  if (filter.bucket) sp.set('bucket', filter.bucket);
  if (filter.region) sp.set('region', filter.region);
  const qs = sp.toString();
  return qs ? `/tft/explorer?${qs}` : '/tft/explorer';
}
