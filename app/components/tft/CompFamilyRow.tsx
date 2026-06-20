'use client';
import type { TftAssetsBundle } from '../../lib/tft-cdragon';
import { type TierCutoffs } from '../../lib/tft-tier-letter';
import CompRow from './CompRow';

// CompFamilyRow — Trait+Carry-Family-Card mit Drop-Down (MetaTFT-Style).
// Hauptcomp rendert als reguläre CompRow mit Toggle-Pfeil zwischen Trait+
// Carry-Header und Champion-Strip. Beim Aufklappen werden die Sub-Variants
// als reguläre CompRows drunter gerendert — identisches Layout, Stats-
// Spalten sauber untereinander. Singletons rendern direkt als CompRow ohne
// Toggle.

export interface FamilyComp {
  slug: string;
  clusterKey: string;
  games: number;
  avgPlacement: number | null;
  avgLevel?: number | null;
  top4Rate: number | null;
  top1Rate: number | null;
  pickRate: number | null;
  typicalUnits: Array<{ characterId: string; count: number; topItems?: Array<{ apiName: string; count: number }> }>;
  [key: string]: unknown;
}

export interface CompFamily {
  familyKey: string;           // <trait>__<carry>
  trait: string;
  carry: string;
  level: number;
  variants: FamilyComp[];
  mainComp: FamilyComp;
  totalGames: number;
  familyPickRate: number | null;
  weightedAvgPlacement: number | null;
  weightedTop4Rate: number | null;
  weightedTop1Rate: number | null;
  emblems: Array<{ apiName: string; count: number }>;
  augments: Array<{ apiName: string; count: number }>;
}

function familyHref(comp: FamilyComp, region: string, bucket: string): string {
  return `/tft/comps/${encodeURIComponent(comp.slug)}?bucket=${bucket}&region=${region}`;
}

export default function CompFamilyRow({
  family,
  rank,
  assets,
  region,
  bucket,
  showVelocity = false,
  velocityShift = 0,
  tierCutoffs,
}: {
  family: CompFamily;
  rank: number;
  assets: TftAssetsBundle | null;
  region: string;
  bucket: string;
  showVelocity?: boolean;
  velocityShift?: number;
  tierCutoffs?: TierCutoffs | null;
}) {
  // C-Konsolidierung 2026-06-21 (User-Wortlaut): „3x die gleiche Comp (gleiche
  // Units). Wir müssen den Durchschnitt der Comp abbilden und nicht wie sie
  // platziert, wenn alles gehittet wird oder gar nichts gehittet wird. Das
  // ist für Spieler irreführend."
  //
  // Konsequenz: kein Drop-Down mehr. Jede Family rendert EINE Row mit
  // weighted Family-Stats (Override passiert in page.tsx Family-Loop). Sub-
  // Cluster-Inspektion bleibt verfügbar via Detail-Page (VariantsSwitcher +
  // levelOutcome-Block). Single-Variant- und Multi-Variant-Family rendern
  // identisch → Listing-Optik einheitlich.
  return (
    <CompRow
      comp={family.mainComp as Parameters<typeof CompRow>[0]['comp']}
      rank={rank}
      assets={assets}
      href={familyHref(family.mainComp, region, bucket)}
      showVelocity={showVelocity}
      velocityShift={velocityShift}
      tierCutoffs={tierCutoffs}
    />
  );
}
