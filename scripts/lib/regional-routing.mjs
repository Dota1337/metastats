// Single source of truth for platform-region -> Riot regional-routing cluster
// (europe / americas / asia / sea). MUST stay in sync with the app-side mirror
// app/lib/regions.ts::REGIONAL_ROUTING (TS bundle can't import this .mjs cleanly,
// same split as active-regions.{mjs,ts}).
//
// Covers ALL 17 platform regions including the TFT-inactive ph2/th2 — the
// routing map is region-universal and independent of which regions the crawler
// currently iterates (that's active-regions.mjs). Consolidated 2026-06-28 from
// 8 verbatim-identical hardcoded copies (Audit drift-#5).

export const REGIONAL_ROUTING = Object.freeze({
  euw1: 'europe', eun1: 'europe', tr1: 'europe', ru: 'europe', me1: 'europe',
  na1: 'americas', br1: 'americas', la1: 'americas', la2: 'americas',
  kr: 'asia', jp1: 'asia',
  oc1: 'sea', ph2: 'sea', sg2: 'sea', th2: 'sea', tw2: 'sea', vn2: 'sea',
});

// Sicherheits-Riegel 2026-08-14, Spiegel von app/lib/regions.ts.
// Die Web-Seite validiert jede Region bevor sie in einen Riot-Host geht;
// die Crawler bauen dieselben URLs und brauchen denselben Riegel, sonst ist
// er ein Riegel mit Loch. Hier kommt die Region aus --region/CLI, ein Wurf
// beim Start ist also gewollt (fail fast statt 14h Crawl gegen europe).

export function normalizeRegion(raw) {
  return String(raw ?? '').trim().toLowerCase();
}

export function isValidRegion(raw) {
  return Object.prototype.hasOwnProperty.call(REGIONAL_ROUTING, normalizeRegion(raw));
}

export function getRegionalRouting(region) {
  const cluster = REGIONAL_ROUTING[normalizeRegion(region)];
  if (!cluster) throw new Error(`Unbekannte Region: ${region}`);
  return cluster;
}
