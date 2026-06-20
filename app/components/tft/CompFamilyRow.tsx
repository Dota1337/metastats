'use client';
import { useRouter } from 'next/navigation';
import type { TftAssetsBundle } from '../../lib/tft-cdragon';
import { tftIconUrl, tftIsEmblem, findItem, findChampion, tftChampionTileUrl, tftTraitDisplayName } from '../../lib/tft-cdragon';
import { costColor as costColorOf } from '../../lib/tft-ui';
import { useI18n } from '../../lib/i18n';
import { parseClusterKey } from '../../lib/tft-cluster';
import { type TierCutoffs, tierLetterOfSync, TIER_COLORS } from '../../lib/tft-tier-letter';
import CompRow from './CompRow';

// CompFamilyRow — rendert eine Trait+Level-Family-Card. Headline ist die nach
// aktueller Sort-Metrik beste Variante (oder die meistgespielte als Default).
// Drunter: kleinere Pills mit den anderen Carries derselben Family. Rechts:
// Most-Played Emblems (top 3, gewichtet über alle Family-Variants).
//
// Bei Single-Variant-Family wird stattdessen einfach <CompRow> direkt
// gerendert — der Drop-Down/Pill-Strip wäre leer und nur Lärm.

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
  familyKey: string;          // <trait>@<level>
  trait: string;
  level: number;
  variants: FamilyComp[];
  mainComp: FamilyComp;       // sort-besten oder meistgespielten
  totalGames: number;
  familyPickRate: number | null;
  weightedAvgPlacement: number | null;
  weightedTop4Rate: number | null;
  weightedTop1Rate: number | null;
  emblems: Array<{ apiName: string; count: number }>;
}

function familyHref(comp: FamilyComp, region: string, bucket: string): string {
  return `/tft/comps/${encodeURIComponent(comp.slug)}?bucket=${bucket}&region=${region}`;
}

function variantLabel(
  comp: FamilyComp,
  assets: TftAssetsBundle | null,
): { carryName: string; suffix: string } {
  const parts = parseClusterKey(comp.clusterKey);
  if (!parts) return { carryName: '?', suffix: '' };
  const ch = findChampion(assets, parts.carry);
  const carryName = ch?.name || parts.carry.replace(/^TFT\d+_/, '');
  let suffix = '';
  if (parts.carryStar === 3) suffix += ' 3★';
  if (parts.augmentSlug) suffix += ` · ${parts.augmentSlug}`;
  if (parts.secondary) {
    const sec = findChampion(assets, parts.secondary);
    suffix += ` · +${sec?.name || parts.secondary.replace(/^TFT\d+_/, '')}`;
  }
  return { carryName, suffix };
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

  // Single-Variant-Family: direkt als regular CompRow rendern — der Family-
  // Header + leere Pill-Strip wäre nur Lärm.
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

  // Multi-Variant: Family-Card mit Main-CompRow + Sub-Variant-Pills + Emblems
  const mainHref = familyHref(family.mainComp, region, bucket);
  const traitMeta = assets ? assets.traits[family.trait] : null;
  const traitDisplay = tftTraitDisplayName(assets, family.trait) || traitMeta?.name || family.trait;

  // Sub-Variants (alle ohne Main) — sortiert by games desc.
  const subVariants = family.variants
    .filter(v => v.clusterKey !== family.mainComp.clusterKey)
    .sort((a, b) => (b.games || 0) - (a.games || 0));

  // Family-Aggregat-Tier-Letter (sample-gewichtet).
  const familyTierLetter = tierCutoffs && family.weightedAvgPlacement != null
    ? tierLetterOfSync({
        avgPlacement: family.weightedAvgPlacement,
        pickRate: family.familyPickRate,
        games: family.totalGames,
      }, 'comps', tierCutoffs)
    : null;
  const familyTierColor = familyTierLetter ? TIER_COLORS[familyTierLetter] : '#7a8aa0';

  return (
    <div className="rounded border border-[#1e2a3a] bg-[#0d1526] overflow-hidden mb-1">
      {/* Family-Header: Trait-Display + Family-Aggregat-Stats + Emblems */}
      <div className="px-2 sm:px-3 pt-2 pb-1 flex items-center justify-between gap-3 border-b border-[#1e2a3a]/60">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[#7a8aa0] tabular-nums text-xs">#{rank}</span>
          <span
            className="px-1.5 py-0.5 rounded text-[10px] font-bold tabular-nums"
            style={{ color: familyTierColor, backgroundColor: `${familyTierColor}1a`, border: `1px solid ${familyTierColor}40` }}
          >
            {familyTierLetter ?? '—'}
          </span>
          <span className="text-white font-semibold text-sm truncate">{traitDisplay}</span>
          <span className="text-[#7a8aa0] text-[10px] uppercase tracking-wider hidden sm:inline">
            · {family.variants.length} {t('tft.comp.variants')}
          </span>
        </div>
        {family.emblems.length > 0 && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="text-[#7a8aa0] text-[10px] uppercase tracking-wider hidden sm:inline">{t('tft.comp.topEmblems')}</span>
            <div className="flex items-center gap-1">
              {family.emblems.slice(0, 3).map(em => {
                const meta = findItem(assets, em.apiName);
                const iconUrl = tftIconUrl(assets, meta?.icon);
                return (
                  <div
                    key={em.apiName}
                    className="w-5 h-5 rounded-sm bg-[#0a0e1a] border border-[#c39bff]/40 overflow-hidden"
                    title={`${meta?.name || em.apiName} · ${em.count}× gespielt`}
                  >
                    {iconUrl && <img src={iconUrl} alt={meta?.name || em.apiName} className="w-full h-full object-cover" />}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Main-Variante als regular CompRow */}
      <CompRow
        comp={family.mainComp as Parameters<typeof CompRow>[0]['comp']}
        rank={rank}
        assets={assets}
        href={mainHref}
        showVelocity={showVelocity}
        velocityShift={velocityShift}
        tierCutoffs={tierCutoffs}
      />

      {/* Sub-Variants als Pill-Strip darunter */}
      <div className="px-2 sm:px-3 py-1.5 flex items-center gap-1.5 flex-wrap bg-[#0a1020]/40 border-t border-[#1e2a3a]/60">
        <span className="text-[#7a8aa0] text-[10px] uppercase tracking-wider mr-1">{t('tft.comp.moreVariants')}</span>
        {subVariants.map(v => {
          const { carryName, suffix } = variantLabel(v, assets);
          const parts = parseClusterKey(v.clusterKey);
          const ch = parts?.carry ? findChampion(assets, parts.carry) : null;
          const tileUrl = tftChampionTileUrl(assets, ch);
          const carryCost = ch?.cost ?? 1;
          const href = familyHref(v, region, bucket);
          return (
            <button
              key={v.clusterKey}
              onClick={e => {
                e.stopPropagation();
                if (e.metaKey || e.ctrlKey) window.open(href, '_blank', 'noopener');
                else router.push(href);
              }}
              className="flex items-center gap-1.5 px-1.5 py-0.5 rounded-md bg-[#141c2e] hover:bg-[#1a2540] border border-[#1e2a3a] hover:border-[#7B61FF]/40 transition-colors text-[11px] text-white"
              title={`${carryName}${suffix} · ${v.games} ${t('tft.gamesShort')}`}
            >
              {tileUrl && (
                <span className="w-4 h-4 rounded-sm overflow-hidden block border" style={{ borderColor: costColorOf(carryCost) }}>
                  <img src={tileUrl} alt={carryName} className="w-full h-full object-cover" />
                </span>
              )}
              <span>{carryName}{suffix}</span>
              <span className="text-[#7a8aa0] tabular-nums text-[10px]">{v.avgPlacement?.toFixed(2) ?? '—'}</span>
              <span className="text-[#5a6a80] text-[10px]">·</span>
              <span className="text-[#5a6a80] tabular-nums text-[10px]">{v.games}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
