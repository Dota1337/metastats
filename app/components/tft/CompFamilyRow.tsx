'use client';
import { useState } from 'react';
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
  const [expanded, setExpanded] = useState(false);

  // Single-Variant-Family: regular CompRow ohne Toggle.
  if (family.variants.length === 1) {
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

  // Sub-Variants ohne Main — sortiert by games desc.
  const subVariants = [...family.variants]
    .filter(v => v.clusterKey !== family.mainComp.clusterKey)
    .sort((a, b) => (b.games || 0) - (a.games || 0));

  // Family-Wrapper grenzt Hauptcomp + Sub-Variants als visuelle Einheit von
  // der nachfolgenden Comp ab — linke orange Akzent-Border (matched Pfeil-
  // Farbe), leichter Background-Tint, mb-3 Abstand zur nächsten Family-Card.
  return (
    <div
      className="mb-3 pl-1.5 rounded overflow-hidden"
      style={{
        borderLeft: '3px solid rgba(249,115,22,0.4)',
        backgroundColor: 'rgba(249,115,22,0.04)',
      }}
    >
      <CompRow
        comp={family.mainComp as Parameters<typeof CompRow>[0]['comp']}
        rank={rank}
        assets={assets}
        href={familyHref(family.mainComp, region, bucket)}
        showVelocity={showVelocity}
        velocityShift={velocityShift}
        tierCutoffs={tierCutoffs}
        expandToggle={{ expanded, onToggle: () => setExpanded(e => !e) }}
      />

      {/* Drop-Down — Sub-Variants als reguläre CompRows rendern (identisches
          Layout zur Hauptcomp, Stats-Spalten sauber untereinander). rank=0
          → CompRow rendert die rank-Spalte leer als visueller Indent. */}
      {expanded && subVariants.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {subVariants.map(v => (
            <CompRow
              key={v.clusterKey}
              comp={v as Parameters<typeof CompRow>[0]['comp']}
              rank={0}
              assets={assets}
              href={familyHref(v, region, bucket)}
              showVelocity={showVelocity}
              velocityShift={velocityShift}
              tierCutoffs={tierCutoffs}
            />
          ))}
        </div>
      )}
    </div>
  );
}
