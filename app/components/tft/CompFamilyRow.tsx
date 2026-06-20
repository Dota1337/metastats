'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TftAssetsBundle } from '../../lib/tft-cdragon';
import { tftIconUrl, findItem, findChampion, tftChampionTileUrl } from '../../lib/tft-cdragon';
import { costColor as costColorOf } from '../../lib/tft-ui';
import { useI18n } from '../../lib/i18n';
import { parseClusterKey } from '../../lib/tft-cluster';
import { type TierCutoffs, tierLetterOfSync, TIER_COLORS } from '../../lib/tft-tier-letter';
import { descriptorTag } from '../../lib/tft-comp-descriptor';
import { compDefiningAugmentApiNameFromSlug } from '../../lib/tft-comp-defining-augments';
import CompRow from './CompRow';

// CompFamilyRow — Trait+Carry-Family-Card mit Drop-Down (MetaTFT-Style).
// Hauptcomp und Drop-Down-Toggle in EINER Zeile (via CompRow.expandToggle).
// Drop-Down öffnet die Sub-Variants drunter — Items + descriptorTag-Label.
// Singletons rendern direkt als reguläre CompRow ohne Toggle.

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

// Variant-Sub-Label via descriptorTag: „Slow Roll Lvl 7" / „Fast 8" / etc.
// Plus Augment-Suffix wenn comp-definierendes Augment im Cluster-Key.
function variantLabel(
  comp: FamilyComp,
  assets: TftAssetsBundle | null,
): { label: string; color: string } {
  const parts = parseClusterKey(comp.clusterKey);
  if (!parts) return { label: '—', color: '#7a8aa0' };
  const carryChamp = assets ? assets.champions[parts.carry] : null;
  const tag = descriptorTag({
    avgLevel: (comp.avgLevel as number | undefined) ?? null,
    top1Rate: comp.top1Rate,
    top4Rate: comp.top4Rate,
    carryCost: carryChamp?.cost,
    carryStar: parts.carryStar,
  });
  const bits: string[] = [];
  if (tag) bits.push(tag.label);
  else bits.push(`Lvl ${parts.level}`);
  if (parts.augmentSlug) {
    const augApiName = compDefiningAugmentApiNameFromSlug(parts.augmentSlug);
    const augMeta = augApiName && assets ? assets.items[augApiName] : null;
    bits.push(augMeta?.name || parts.augmentSlug);
  }
  if (parts.secondary) {
    const sec = assets ? assets.champions[parts.secondary] : null;
    bits.push(`+${sec?.name || parts.secondary.replace(/^TFT\d+_/, '')}`);
  }
  return { label: bits.join(' · '), color: tag?.color ?? '#7a8aa0' };
}

// Konsistente Champion-Reihenfolge für die Sub-Variant-Mini-Row: Carry first,
// Secondary danach, Rest nach Cost desc + characterId asc als Tie-Break.
// Mindestens 8 Tiles (Padding wird gerendert wenn weniger vorhanden).
function orderedUnits(
  comp: FamilyComp,
  assets: TftAssetsBundle | null,
): Array<{ characterId: string; topItems?: Array<{ apiName: string; count: number }> }> {
  const parts = parseClusterKey(comp.clusterKey);
  const primary = parts?.carry || null;
  const secondary = parts?.secondary || null;
  const costOf = (cid: string) => assets?.champions[cid]?.cost ?? 1;
  return [...(comp.typicalUnits || [])]
    .sort((a, b) => {
      const pa = a.characterId === primary ? 0 : a.characterId === secondary ? 1 : 2;
      const pb = b.characterId === primary ? 0 : b.characterId === secondary ? 1 : 2;
      if (pa !== pb) return pa - pb;
      const costDelta = costOf(b.characterId) - costOf(a.characterId);
      if (costDelta !== 0) return costDelta;
      return a.characterId.localeCompare(b.characterId);
    })
    .slice(0, 8);
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
  const { t } = useI18n();
  const router = useRouter();
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

  return (
    <div className="mb-1">
      {/* Hauptcomp als reguläre CompRow mit Toggle-Pfeil rechts neben den
          Action-Buttons. Click auf den Pfeil expandiert/collapsed — Click auf
          den Rest der Card navigiert zur Detail-Page wie gewohnt. */}
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

      {/* Drop-Down — Sub-Variants als kompakte Mini-Rows mit descriptorTag-
          Label, konsistenter Champion-Reihenfolge, Items unter Champions. */}
      {expanded && subVariants.length > 0 && (
        <div className="mt-1 ml-6 rounded border border-[#1e2a3a]/60 bg-[#0a1020]/60 divide-y divide-[#1e2a3a]/40 overflow-hidden">
          {subVariants.map(v => {
            const variantTier = tierCutoffs
              ? tierLetterOfSync({
                  avgPlacement: v.avgPlacement,
                  pickRate: v.pickRate,
                  games: v.games,
                }, 'comps', tierCutoffs)
              : null;
            const variantTierColor = variantTier ? TIER_COLORS[variantTier] : '#7a8aa0';
            const href = familyHref(v, region, bucket);
            const { label, color: labelColor } = variantLabel(v, assets);
            const units = orderedUnits(v, assets);
            const parts = parseClusterKey(v.clusterKey);
            return (
              <button
                key={v.clusterKey}
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  if (e.metaKey || e.ctrlKey) window.open(href, '_blank', 'noopener');
                  else router.push(href);
                }}
                className="w-full text-left px-2 sm:px-3 py-2 flex items-center gap-2 hover:bg-[#11192a] transition-colors"
              >
                <span
                  className="px-1 py-0.5 rounded text-[9px] font-bold tabular-nums w-5 text-center flex-shrink-0"
                  style={{ color: variantTierColor, backgroundColor: `${variantTierColor}1a`, border: `1px solid ${variantTierColor}40` }}
                >
                  {variantTier ?? '—'}
                </span>
                <span
                  className="text-[10px] font-medium flex-shrink-0 w-24 truncate"
                  style={{ color: labelColor }}
                  title={label}
                >
                  {label}
                </span>
                <span className="flex items-start gap-1 flex-1 overflow-hidden">
                  {units.map(u => {
                    const ch = findChampion(assets, u.characterId);
                    const tileUrl = tftChampionTileUrl(assets, ch);
                    const isCarryUnit = parts?.carry === u.characterId;
                    const items = Array.isArray(u.topItems) ? u.topItems.slice(0, 3) : [];
                    return (
                      <span key={u.characterId} className="flex flex-col items-center gap-0.5 flex-shrink-0">
                        <span
                          className="w-7 h-7 rounded-sm overflow-hidden border block"
                          style={{ borderColor: isCarryUnit ? '#c39bff' : (ch ? costColorOf(ch.cost) : '#1e2a3a') }}
                          title={ch?.name || u.characterId}
                        >
                          {tileUrl && <img src={tileUrl} alt={ch?.name || u.characterId} className="w-full h-full object-cover" />}
                        </span>
                        {items.length > 0 && (
                          <span className="flex items-center gap-[1px]">
                            {items.map(it => {
                              const meta = findItem(assets, it.apiName);
                              const iconUrl = tftIconUrl(assets, meta?.icon);
                              return (
                                <span
                                  key={it.apiName}
                                  className="w-[9px] h-[9px] rounded-sm bg-[#0a0e1a] border border-[#1e2a3a] overflow-hidden block"
                                  title={meta?.name || it.apiName}
                                >
                                  {iconUrl && <img src={iconUrl} alt={meta?.name || it.apiName} className="w-full h-full object-cover" />}
                                </span>
                              );
                            })}
                          </span>
                        )}
                      </span>
                    );
                  })}
                </span>
                <span className="hidden sm:flex items-center gap-3 tabular-nums text-[11px] flex-shrink-0">
                  <span className="w-12 text-right text-white">{v.avgPlacement?.toFixed(2) ?? '—'}</span>
                  <span className="w-10 text-right text-[#a0b0c5]">{v.top4Rate != null ? `${(v.top4Rate * 100).toFixed(0)}%` : '—'}</span>
                  <span className="w-10 text-right text-[#a0b0c5]">{v.top1Rate != null ? `${(v.top1Rate * 100).toFixed(0)}%` : '—'}</span>
                  <span className="w-12 text-right text-[#a0b0c5]">{v.pickRate != null ? `${(v.pickRate * 100).toFixed(2)}%` : '—'}</span>
                  <span className="w-12 text-right text-[#7a8aa0]">{v.games}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
