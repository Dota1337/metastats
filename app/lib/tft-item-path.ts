// Eigentliche Adresse (canonical) einer Item-Seite (Blatt-Modul, testbar ohne Server).
//
// Riot fuehrt Items mit gleichem Anzeigenamen unter zwei Kennungen: die
// Variante aus einem Augment (`DA_18_EmblemFloraFatalisAugment` aus „Consuming
// Flora“) neben dem normalen Item (`DA_18_EmblemFloraFatalis`), dazu
// `…Upgrade`/`…_Prismatic`-Stufen. Beide Seiten trugen am 09.11.2026 denselben
// Titel und dieselbe Beschreibung (74 % gleiche Woerter) — fuer Google ein
// Duplikat. Die Variante nennt deshalb das Grund-Item als eigentliche Adresse
// und fehlt in der Sitemap; erreichbar bleibt sie unveraendert.
//
// Bewusst NUR Endungs-Varianten mit existierendem Grund-Item gleichen Namens:
// Radiant-Paare mit verschiedenem Praefix (TFT5_Item_…Radiant / DA_…_Radiant)
// koennen verschiedene Spieldaten haben — dort ein fremdes canonical zu setzen,
// koennte auf eine leere Seite zeigen.
import type { TftAssetsBundle } from './tft-cdragon';

const VARIANT = /^(.+?)(?:Augment|_?Upgrade|_Prismatic)$/;

export function itemCanonicalId(items: TftAssetsBundle['items'] | null | undefined, id: string): string {
  const base = VARIANT.exec(id)?.[1];
  const self = items?.[id];
  const root = base ? items?.[base] : undefined;
  return self && root && root.name === self.name ? base! : id;
}
