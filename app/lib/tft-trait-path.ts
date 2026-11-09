// Adresse der Trait-Detailseite (Blatt-Modul: Server, Browser, Sitemap).
//
// Die Seite nimmt Kennung (`DA_18_Elderwood`) und Anzeigenamen (`Elderwood`)
// an und zeigt beide gleich (E4, tft-detail-filters.ts traitIdsForParam), nennt
// Google aber nur die Adresse mit dem englischen Anzeigenamen als eigentliche
// (canonical). Jeder Link muss deshalb genau diese Adresse bauen — bis
// 09.11.2026 verlinkten Comp-Seiten die Kennung (21 Traits), und Google bekam
// zwei Adressen fuer eine Seite. Set 17 hatte Trait-Varianten mit gleichem Namen
// (Stargazer ×8): alle landen auf derselben Adresse, wie ihr canonical.
//
// ESLint (eslint.config.mjs, TRAIT_PATH) verbietet handgebaute Trait-Adressen.
import type { TftAssetsBundle } from './tft-cdragon';

/** Englischer Anzeigename einer Kennung; ein Anzeigename bleibt, wie er ist. */
export function traitDisplayParam(traits: TftAssetsBundle['traits'] | null | undefined, idOrName: string): string {
  return traits?.[idOrName]?.name || idOrName;
}

/** Adresse der Trait-Seite ohne Sprach-Vorsatz und ohne Abfrage. */
export function traitPath(traits: TftAssetsBundle['traits'] | null | undefined, idOrName: string): string {
  // eslint-disable-next-line no-restricted-syntax -- die eine Stelle, die Trait-Adressen baut
  return `/tft/traits/${encodeURIComponent(traitDisplayParam(traits, idOrName))}`;
}
