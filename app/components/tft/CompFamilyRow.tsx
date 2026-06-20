'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TftAssetsBundle } from '../../lib/tft-cdragon';
import { tftIconUrl, findItem, findChampion, tftChampionTileUrl, tftTraitDisplayName } from '../../lib/tft-cdragon';
import { costColor as costColorOf } from '../../lib/tft-ui';
import { useI18n } from '../../lib/i18n';
import { parseClusterKey } from '../../lib/tft-cluster';
import { type TierCutoffs, tierLetterOfSync, TIER_COLORS, type TierLetter } from '../../lib/tft-tier-letter';
import CompRow from './CompRow';

// CompFamilyRow — Trait+Carry-Family-Card mit Drop-Down (MetaTFT-Style).
// Default: collapsed. Header zeigt Trait+Carry-Name + Family-Aggregat-Stats
// + Most-Played Emblems + Most-Played Augments + Toggle-Pfeil. Beim Klick
// öffnet sich der Drop-Down mit allen Sub-Variants als kompakte Mini-Rows
// (Champion-Strip + Avg-Place + Games, Klick → Detail-Page der Variante).
//
// Bei Single-Variant-Family wird direkt die reguläre CompRow gerendert —
// 89% aller Families sind laut data-skeptic-Probe Singletons, ein leerer
// Drop-Down wäre nur Lärm.

export interface FamilyComp {
  slug: string;
  clusterKey: string;
  games: number;
  avgPlacement: number | null;
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
  level: number;               // primary level der ersten Variante (Display-only)
  variants: FamilyComp[];
  mainComp: FamilyComp;        // sort-besten oder meistgespielten
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

function variantSubLabel(comp: FamilyComp): string {
  const parts = parseClusterKey(comp.clusterKey);
  if (!parts) return '';
  const bits: string[] = [];
  bits.push(`Lvl ${parts.level}`);
  if (parts.carryStar === 3) bits.push('3★');
  if (parts.augmentSlug) bits.push(parts.augmentSlug);
  if (parts.secondary) bits.push(`+${parts.secondary.replace(/^TFT\d+_/, '')}`);
  return bits.join(' · ');
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

  // Single-Variant-Family: regular CompRow ohne Toggle-Lärm.
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

  // Multi-Variant: Family-Card mit collapsed Header + optionaler Drop-Down
  const traitMeta = assets ? assets.traits[family.trait] : null;
  const traitDisplay = tftTraitDisplayName(assets, family.trait) || traitMeta?.name || family.trait;
  const carryChamp = assets ? assets.champions[family.carry] : null;
  const carryName = carryChamp?.name || family.carry.replace(/^TFT\d+_/, '');

  // Family-Aggregat-Tier-Letter (sample-gewichtet).
  const familyTierLetter: TierLetter | null = tierCutoffs && family.weightedAvgPlacement != null
    ? tierLetterOfSync({
        avgPlacement: family.weightedAvgPlacement,
        pickRate: family.familyPickRate,
        games: family.totalGames,
      }, 'comps', tierCutoffs)
    : null;
  const familyTierColor = familyTierLetter ? TIER_COLORS[familyTierLetter] : '#7a8aa0';

  // Sub-Variants — sortiert by games desc für die Drop-Down-Reihenfolge.
  const subVariants = [...family.variants].sort((a, b) => (b.games || 0) - (a.games || 0));

  return (
    <div className="rounded border border-[#1e2a3a] bg-[#0d1526] overflow-hidden mb-1">
      {/* Collapsed Header — clickable to expand. Trait+Carry + Aggregat-Stats
          + Emblems + Augments + Toggle-Pfeil. */}
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full text-left px-2 sm:px-3 py-2 flex items-center gap-2 sm:gap-3 hover:bg-[#11192a] transition-colors"
        aria-expanded={expanded}
      >
        <span className="text-[#7a8aa0] tabular-nums text-xs w-5 text-right">{rank}</span>
        <span
          className="w-6 h-6 rounded flex items-center justify-center font-bold text-[11px] flex-shrink-0"
          style={{ color: familyTierColor, backgroundColor: `${familyTierColor}25`, border: `1px solid ${familyTierColor}40` }}
        >
          {familyTierLetter ?? '—'}
        </span>
        {carryChamp && (() => {
          const tileUrl = tftChampionTileUrl(assets, carryChamp);
          return tileUrl ? (
            <span
              className="w-7 h-7 rounded overflow-hidden border-2 flex-shrink-0"
              style={{ borderColor: '#c39bff' }}
            >
              <img src={tileUrl} alt={carryName} className="w-full h-full object-cover" />
            </span>
          ) : null;
        })()}
        <span className="flex flex-col min-w-0 flex-1">
          <span className="text-white text-sm font-medium truncate">
            {traitDisplay} <span className="text-[#a0b0c5]">· {carryName}</span>
          </span>
          <span className="text-[#7a8aa0] text-[10px] uppercase tracking-wider">
            {family.variants.length} {t('tft.comp.variants')}
          </span>
        </span>

        {/* Augments — most-played in der Family. User-Vorgabe: bleiben im Header. */}
        {family.augments.length > 0 && (
          <span className="hidden sm:flex items-center gap-0.5 flex-shrink-0">
            {family.augments.slice(0, 3).map(a => {
              const meta = findItem(assets, a.apiName);
              const iconUrl = tftIconUrl(assets, meta?.icon);
              return (
                <span
                  key={a.apiName}
                  className="w-5 h-5 rounded-sm bg-[#0a0e1a] border border-[#7B61FF]/40 overflow-hidden"
                  title={`${meta?.name || a.apiName} · ${a.count}×`}
                >
                  {iconUrl && <img src={iconUrl} alt={meta?.name || a.apiName} className="w-full h-full object-cover" />}
                </span>
              );
            })}
          </span>
        )}

        {/* Emblems — most-played in der Family. */}
        {family.emblems.length > 0 && (
          <span className="hidden sm:flex items-center gap-0.5 flex-shrink-0">
            {family.emblems.slice(0, 3).map(em => {
              const meta = findItem(assets, em.apiName);
              const iconUrl = tftIconUrl(assets, meta?.icon);
              return (
                <span
                  key={em.apiName}
                  className="w-5 h-5 rounded-sm bg-[#0a0e1a] border border-[#c39bff]/40 overflow-hidden"
                  title={`${meta?.name || em.apiName} · ${em.count}×`}
                >
                  {iconUrl && <img src={iconUrl} alt={meta?.name || em.apiName} className="w-full h-full object-cover" />}
                </span>
              );
            })}
          </span>
        )}

        {/* Family-Aggregat-Stats — gleiches Spalten-Layout wie reguläre CompRow */}
        <span className="hidden sm:flex items-center gap-3 tabular-nums text-xs flex-shrink-0">
          <span className="w-12 text-right text-base font-medium" style={{ color: familyTierColor }}>
            {family.weightedAvgPlacement != null ? family.weightedAvgPlacement.toFixed(2) : '—'}
          </span>
          <span className="w-10 text-right text-[#a0b0c5]">
            {family.weightedTop4Rate != null ? `${(family.weightedTop4Rate * 100).toFixed(0)}%` : '—'}
          </span>
          <span className="w-10 text-right text-[#a0b0c5]">
            {family.weightedTop1Rate != null ? `${(family.weightedTop1Rate * 100).toFixed(0)}%` : '—'}
          </span>
          <span className="w-12 text-right text-[#a0b0c5]">
            {family.familyPickRate != null ? `${(family.familyPickRate * 100).toFixed(2)}%` : '—'}
          </span>
          <span className="w-12 text-right text-[#7a8aa0]">{family.totalGames}</span>
        </span>

        {/* Toggle-Pfeil */}
        <span
          className="text-[#7a8aa0] text-base transition-transform flex-shrink-0"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0)' }}
        >
          ▾
        </span>
      </button>

      {/* Drop-Down — Sub-Variants als kompakte Mini-Rows */}
      {expanded && (
        <div className="border-t border-[#1e2a3a]/60 divide-y divide-[#1e2a3a]/40">
          {subVariants.map(v => {
            const parts = parseClusterKey(v.clusterKey);
            const isMain = v.clusterKey === family.mainComp.clusterKey;
            const variantTier = tierCutoffs
              ? tierLetterOfSync({
                  avgPlacement: v.avgPlacement,
                  pickRate: v.pickRate,
                  games: v.games,
                }, 'comps', tierCutoffs)
              : null;
            const variantTierColor = variantTier ? TIER_COLORS[variantTier] : '#7a8aa0';
            const href = familyHref(v, region, bucket);
            const subLabel = variantSubLabel(v);
            const units = (v.typicalUnits || []).slice(0, 8);
            return (
              <button
                key={v.clusterKey}
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  if (e.metaKey || e.ctrlKey) window.open(href, '_blank', 'noopener');
                  else router.push(href);
                }}
                className="w-full text-left px-2 sm:px-3 py-1.5 flex items-center gap-2 hover:bg-[#11192a] transition-colors"
              >
                <span className="w-5 text-center text-[10px]" title={isMain ? t('tft.comp.mainVariant') : undefined}>
                  {isMain ? <span className="text-[#c39bff]">●</span> : <span className="text-[#3a4a60]">○</span>}
                </span>
                <span
                  className="px-1 py-0.5 rounded text-[9px] font-bold tabular-nums w-5 text-center flex-shrink-0"
                  style={{ color: variantTierColor, backgroundColor: `${variantTierColor}1a`, border: `1px solid ${variantTierColor}40` }}
                >
                  {variantTier ?? '—'}
                </span>
                <span className="text-[10px] text-[#7a8aa0] flex-shrink-0 w-20 truncate" title={subLabel}>
                  {subLabel}
                </span>
                <span className="flex items-center gap-0.5 flex-1 overflow-hidden">
                  {units.map(u => {
                    const ch = findChampion(assets, u.characterId);
                    const tileUrl = tftChampionTileUrl(assets, ch);
                    const isCarryUnit = parts?.carry === u.characterId;
                    return (
                      <span
                        key={u.characterId}
                        className="w-6 h-6 rounded-sm overflow-hidden border flex-shrink-0"
                        style={{ borderColor: isCarryUnit ? '#c39bff' : (ch ? costColorOf(ch.cost) : '#1e2a3a') }}
                        title={ch?.name || u.characterId}
                      >
                        {tileUrl && <img src={tileUrl} alt={ch?.name || u.characterId} className="w-full h-full object-cover" />}
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
