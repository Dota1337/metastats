'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TftAssetsBundle } from '../../lib/tft-cdragon';
import { tftIconUrl, tftChampionTileUrl, findChampion, findItem, tftTraitDisplayName, tftTraitDescription } from '../../lib/tft-cdragon';
import { costColor as costColorOf } from '../../lib/tft-ui';
import { useI18n } from '../../lib/i18n';
import BookmarkButton from '../BookmarkButton';
import PlanAheadButton from './PlanAheadButton';
import { compDefiningAugmentApiNameFromSlug } from '../../lib/tft-comp-defining-augments';
import { parseClusterKey } from '../../lib/tft-cluster';
import { loadCompGuidesBundle, findCompGuide, difficultyColor } from '../../lib/tft-comp-guides';
import { tierLetterOfSync, TIER_COLORS, type TierLetter, type TierCutoffs } from '../../lib/tft-tier-letter';
import { descriptorTag } from '../../lib/tft-comp-descriptor';

// Dense, scannable row layout for /tft/comps. Replaces the narrative
// CompCard so pros can survey 20+ comps at a glance — avg-placement is
// the prominent column, everything else is auxiliary. CompCard is still
// used on the TFT landing page where the bigger format makes sense.

interface CompVelocity {
  deltaAvgPlace: number | null;
  deltaPickRate: number | null;
  avgPlaceNow: number | null;
  avgPlacePrev: number | null;
  isNew: boolean;
  gamesNow: number;
  gamesPrev: number;
}

interface Comp {
  source?: 'data' | 'editorial';
  slug: string;
  clusterKey: string;
  games: number;
  avgPlacement: number | null;
  top4Rate: number | null;
  top1Rate: number | null;
  pickRate?: number | null;
  winShare?: number | null;
  top4Share?: number | null;
  avgLevel?: number | null;
  avgLastRound?: number | null;
  typicalUnits: {
    characterId: string;
    count: number | unknown;
    carryItemGames?: number | unknown;
    topItems?: { apiName: string; count: number | unknown }[];
  }[];
  velocity?: CompVelocity | null;
}

const safeCount = (v: unknown): number => (typeof v === 'number' ? v : 1);

// Legacy avg-only badge kept ONLY as a tier-color fallback for the placement
// cell rendering (the cell color tracks the tier). The actual letter+gating
// now comes from the central tierLetterOfSync helper with sample-gate +
// pickrate-penalty. See app/lib/tft-tier-letter.ts.
function tierColorByAvg(avg: number | null) {
  if (avg == null) return '#5a6a80';
  if (avg < 3.8) return TIER_COLORS.S;
  if (avg < 4.2) return TIER_COLORS.A;
  if (avg < 4.5) return TIER_COLORS.B;
  return TIER_COLORS.C;
}


function prettyTrait(s: string) { return s.replace(/^TFT\d+_/, ''); }
function prettyChar(s: string) { return s.replace(/^TFT\d+_/, ''); }

function extractTraitVariant(traitApiName: string, traitDisplayName: string): string | null {
  const stripped = traitApiName.replace(/^TFT\d+_/, '');
  if (!stripped.includes('_')) return null;
  const variant = stripped.split('_').slice(1).join(' ');
  if (!variant) return null;
  if (variant.toLowerCase() === traitDisplayName.toLowerCase()) return null;
  return variant;
}

// descriptorTag + rerollLevelForCost ausgelagert nach app/lib/tft-comp-descriptor.ts

export default function CompRow({
  comp, rank, assets, href, showVelocity = false, velocityShift = 0, tierCutoffs = null,
}: {
  comp: Comp;
  rank: number;
  assets: TftAssetsBundle | null;
  href: string;
  showVelocity?: boolean;
  velocityShift?: number;
  // Loaded once in the parent page (CompsPage / CompList) and passed down
  // to all rows. Earlier this hooked a useEffect per row which fired one
  // fetch + setState per CompRow on mount — 100 rows = 100 effects. The
  // parent-load pattern keeps it O(1) regardless of row count.
  tierCutoffs?: TierCutoffs | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const parts = parseClusterKey(comp.clusterKey);
  const traitMeta = parts && assets ? assets.traits[parts.trait] : null;
  const traitName = traitMeta?.name || (parts ? prettyTrait(parts.trait) : 'Unknown');
  const traitVariant = parts ? extractTraitVariant(parts.trait, traitName) : null;

  // Curated guide indicator: tiny difficulty badge in the header when this
  // comp has an editorial slug-map entry pointing at a tftacademy guide.
  // Cached bundle load — runs once per page session despite N rows.
  const [guideBundle, setGuideBundle] = useState<Awaited<ReturnType<typeof loadCompGuidesBundle>> | null>(null);
  useEffect(() => { loadCompGuidesBundle().then(setGuideBundle); }, []);
  const guideMatch = parts ? findCompGuide(guideBundle, { trait: parts.trait, carry: parts.carry }) : null;
  // Display-Name aus dem zentralen Helper (matched In-Game-Variant aus desc).
  // Plus tooltip-Text damit Mouse-over über den Comp-Header die Trait-
  // Beschreibung dieser Constellation zeigt.
  const traitDisplay = parts ? tftTraitDisplayName(assets, parts.trait) : traitName;
  const traitTooltip = parts ? tftTraitDescription(assets, parts.trait) : '';

  const typicalUnits = (() => {
    const all = [...(comp.typicalUnits || [])].map(u => ({
      ...u,
      _c: safeCount(u.count),
      _carry: typeof (u as any).carryItemGames === 'number' ? (u as any).carryItemGames : 0,
    }));
    // Sub-Cluster-Variants: Primary carry zuerst, secondary carry zweiter, dann
    // restliche Units nach count desc — Reihenfolge matched das Comp-Naming.
    const primary = parts?.carry || null;
    const secondary = parts?.secondary || null;
    return all
      .sort((a, b) => {
        const pa = a.characterId === primary ? 0 : a.characterId === secondary ? 1 : 2;
        const pb = b.characterId === primary ? 0 : b.characterId === secondary ? 1 : 2;
        if (pa !== pb) return pa - pb;
        return b._c - a._c;
      })
      .slice(0, 9);
  })();
  const secondaryCid = parts?.secondary || null;
  const secondaryChamp = secondaryCid && assets ? assets.champions[secondaryCid] : null;
  const secondaryName = secondaryChamp?.name || (secondaryCid ? prettyChar(secondaryCid) : null);

  const carryCid = parts?.carry || null;
  const carry = carryCid && assets ? assets.champions[carryCid] : null;
  const carryUrl = tftChampionTileUrl(assets, carry);

  // Tier-letter from central helper with sample-gate + pickrate-penalty.
  // tierCutoffs comes from the parent page (single load for the whole list).
  const tierLetter: TierLetter | null = tierCutoffs
    ? tierLetterOfSync({ avgPlacement: comp.avgPlacement, pickRate: comp.pickRate, games: comp.games }, 'comps', tierCutoffs)
    : null;
  const tierColor = tierLetter ? TIER_COLORS[tierLetter] : tierColorByAvg(comp.avgPlacement);
  const tier = { label: tierLetter ?? '—', color: tierColor };
  const winShareTip = comp.winShare != null
    ? t('tft.shares.winShareTooltip.comp').replace('{share}', (comp.winShare * 100).toFixed(1))
    : undefined;
  const top4ShareTip = comp.top4Share != null
    ? t('tft.shares.top4ShareTooltip.comp').replace('{share}', (comp.top4Share * 100).toFixed(1))
    : undefined;
  // Rate des Primary-Carry (aus cluster_key) für „Items Dep"-Descriptor.
  // 0 wenn die Primary-Unit < 5 Spiele hat (zu sparse für eine verlässliche Rate).
  const primaryUnit = typicalUnits.find(u => u.characterId === carryCid);
  const carryItemRate = primaryUnit && primaryUnit._c >= 5
    ? primaryUnit._carry / primaryUnit._c
    : 0;
  const descriptor = descriptorTag({
    avgLevel: comp.avgLevel,
    top1Rate: comp.top1Rate,
    top4Rate: comp.top4Rate,
    carryCost: carry?.cost,
    carryItemRate,
    carryStar: parts?.carryStar,
  });

  // Outer wrapper used to be an <a href={href}>, which produced invalid HTML
  // (nested <a> for the carry + 9 unit tiles inside). Replaced with a div that
  // mimics native anchor behavior: Cmd/Ctrl/Mid-click opens in a new tab,
  // Enter/Space activates, focus ring stays visible for keyboard nav.
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={(e) => {
        if (e.defaultPrevented) return;
        if (e.metaKey || e.ctrlKey) {
          window.open(href, '_blank', 'noopener');
          return;
        }
        router.push(href);
      }}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          window.open(href, '_blank', 'noopener');
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          router.push(href);
        }
      }}
      className="block px-2 sm:px-3 py-2 rounded border border-[#1e2a3a] bg-[#0d1526] hover:bg-[#101a30] hover:border-[#7B61FF]/40 transition-colors text-xs sm:text-sm cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7B61FF]/60"
    >
      {/* Mobile: stacked. Desktop: tight horizontal row.
          Großes Carry-Portrait raus — der Carry erscheint sowieso in der
          typicalUnits-Strip mit lila Border + seinen Items. Doppelt =
          Augen-Lärm + verwirrend (Identifikation einmal über Portrait,
          einmal über Tile in Reihe). Grid-Spalte (vormals 2.5rem)
          entsprechend entfernt. */}
      <div className={`grid grid-cols-[1.25rem_1.5rem_minmax(7rem,1fr)_minmax(0,auto)_auto] ${
        showVelocity
          ? 'sm:grid-cols-[1.25rem_1.5rem_minmax(13rem,1fr)_minmax(0,auto)_3rem_3rem_3rem_3rem_3rem_3.5rem_3rem]'
          : 'sm:grid-cols-[1.25rem_1.5rem_minmax(13rem,1fr)_minmax(0,auto)_3rem_3rem_3rem_3rem_3rem_3rem]'
      } items-center gap-2 sm:gap-3`}>
        <div className="text-[#7a8aa0] tabular-nums text-right">{rank}</div>
        <div
          className="w-6 h-6 rounded flex items-center justify-center font-bold text-[11px]"
          style={{ color: tier.color, backgroundColor: `${tier.color}25`, border: `1px solid ${tier.color}40` }}
          title={tierLetter ? t(`tft.tier.tooltip.${tierLetter}` as any) : t('tft.tier.tooltip.empty')}
        >
          {tier.label}
        </div>
        <div className="min-w-0 leading-tight">
          <div className="text-white font-medium truncate" title={traitTooltip || undefined}>
            {traitDisplay}
            {' · '}{carry?.name || (carryCid ? prettyChar(carryCid) : '')}
            {parts?.carryStar === 3 && (
              <span
                className="ml-1 inline-flex items-center px-1 py-[1px] rounded text-[9px] font-semibold tabular-nums align-middle"
                style={{ color: '#e0c75a', backgroundColor: 'rgba(224,199,90,0.15)', border: '1px solid rgba(224,199,90,0.4)' }}
                title="3-Star Reroll-Variante"
              >
                3★
              </span>
            )}
            {parts?.augmentSlug && (() => {
              const apiName = compDefiningAugmentApiNameFromSlug(parts.augmentSlug);
              const augMeta = apiName && assets ? assets.items[apiName] : null;
              const augName = augMeta?.name || parts.augmentSlug;
              return (
                <span
                  className="ml-1 inline-flex items-center px-1.5 py-[1px] rounded text-[9px] font-medium align-middle"
                  style={{ color: '#c39bff', backgroundColor: 'rgba(123,97,255,0.12)', border: '1px solid rgba(123,97,255,0.4)' }}
                  title={augMeta?.desc?.replace(/<[^>]+>/g, '')}
                >
                  {augName}
                </span>
              );
            })()}
            {secondaryName && (
              <span className="text-[#a0b0c5] text-[11px] ml-1">
                {(t('tft.comp.withSecondary') as string).replace('{name}', secondaryName)}
              </span>
            )}
            {guideMatch?.guide?.difficulty && (
              <span
                className="ml-1 inline-flex items-center px-1.5 py-[1px] rounded text-[9px] font-medium align-middle"
                style={{
                  color: difficultyColor(guideMatch.guide.difficulty),
                  backgroundColor: `${difficultyColor(guideMatch.guide.difficulty)}1f`,
                  border: `1px solid ${difficultyColor(guideMatch.guide.difficulty)}40`,
                }}
              >
                {t(`tft.comp.difficulty.${guideMatch.guide.difficulty}` as any) || guideMatch.guide.difficulty}
              </span>
            )}
          </div>
          {(descriptor || comp.avgLevel != null) && (
            <div className="flex items-center gap-1.5 mt-0.5 text-[10px] tabular-nums">
              {descriptor && (
                <span
                  className="px-1.5 py-[1px] rounded text-[10px] font-medium"
                  style={{ color: descriptor.color, backgroundColor: `${descriptor.color}1f`, border: `1px solid ${descriptor.color}40` }}
                >
                  {descriptor.label}
                </span>
              )}
              {comp.avgLevel != null && (
                <span className="text-[#7a8aa0]">Lvl Ø {comp.avgLevel.toFixed(1)}</span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-start gap-1 flex-wrap sm:flex-nowrap">
          {typicalUnits.slice(0, 9).map(u => {
            const ch = findChampion(assets, u.characterId);
            const isCarry = u.characterId === carryCid;
            const url = tftChampionTileUrl(assets, ch);
            const items = Array.isArray(u.topItems) ? u.topItems.slice(0, 3) : [];
            const showDouble = (((u as unknown) as { multiplicity?: number }).multiplicity ?? 1) >= 1.5;
            return (
              <div
                key={u.characterId}
                className="flex flex-col items-center gap-0.5 flex-shrink-0"
              >
                <a
                  href={`/tft/units/${encodeURIComponent(u.characterId)}`}
                  onClick={e => e.stopPropagation()}
                  className="w-9 h-9 rounded border-2 overflow-hidden block hover:scale-110 transition-transform relative"
                  style={{ borderColor: isCarry ? '#c39bff' : (ch ? costColorOf(ch.cost) : '#1e2a3a') }}
                  title={ch?.name || u.characterId}
                >
                  {url && <img src={url} alt={ch?.name || ''} className="w-full h-full object-cover" />}
                  {showDouble && (
                    <div className="absolute -top-1 -right-1 bg-[#7B61FF] text-white text-[7px] font-bold rounded-full w-3.5 h-3.5 flex items-center justify-center shadow leading-none">
                      ×2
                    </div>
                  )}
                </a>
                {items.length > 0 && (
                  <div className="flex items-center gap-[1px]">
                    {items.map(it => {
                      const meta = findItem(assets, it.apiName);
                      const iconUrl = tftIconUrl(assets, meta?.icon);
                      return (
                        <a
                          key={it.apiName}
                          href={`/tft/items/${encodeURIComponent(it.apiName)}`}
                          onClick={e => e.stopPropagation()}
                          className="w-[11px] h-[11px] rounded-sm bg-[#0a0e1a] border border-[#1e2a3a] overflow-hidden block hover:border-[#c39bff]/60"
                          title={meta?.name || it.apiName}
                        >
                          {iconUrl && <img src={iconUrl} alt={meta?.name || it.apiName} className="w-full h-full object-cover" />}
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Stats: mobile = single column on the right; desktop = 4-5 columns */}
        <div className="hidden sm:block text-right tabular-nums font-medium text-base" style={{ color: tier.color }}>
          {comp.avgPlacement != null ? comp.avgPlacement.toFixed(2) : '—'}
        </div>
        <div className="hidden sm:block text-right tabular-nums text-[#a0b0c5]" title={top4ShareTip}>
          {comp.top4Rate != null ? `${(comp.top4Rate * 100).toFixed(0)}%` : '—'}
        </div>
        <div className="hidden sm:block text-right tabular-nums text-[#a0b0c5]" title={winShareTip}>
          {comp.top1Rate != null ? `${(comp.top1Rate * 100).toFixed(0)}%` : '—'}
        </div>
        <div className="hidden sm:block text-right tabular-nums text-[#a0b0c5]">
          {comp.pickRate != null ? `${(comp.pickRate * 100).toFixed(2)}%` : '—'}
        </div>
        <div className="hidden sm:block text-right tabular-nums text-[#7a8aa0]">
          {comp.games}
        </div>
        {showVelocity && (
          <div className="hidden sm:block text-right tabular-nums">
            {(() => {
              const v = comp.velocity;
              if (!v) {
                return (
                  <span
                    className="text-[#5a6a80]"
                    title={t('tft.velocity.notEnough')}
                  >—</span>
                );
              }
              if (v.isNew) {
                return (
                  <span
                    className="inline-block px-1 rounded text-[10px] font-semibold"
                    style={{ color: '#c39bff', backgroundColor: '#c39bff1f', border: '1px solid #c39bff40' }}
                    title={t('tft.velocity.newComp')}
                  >
                    {t('tft.velocity.newComp')}
                  </span>
                );
              }
              if (v.deltaAvgPlace == null) {
                return (
                  <span
                    className="text-[#5a6a80]"
                    title={t('tft.velocity.notEnough')}
                  >—</span>
                );
              }
              // Lower placement = improvement → green ▲; higher = regression → red ▼.
              const better = v.deltaAvgPlace < 0;
              const color = better ? '#3ecf8e' : '#e44040';
              const arrow = better ? '▲' : '▼';
              const label = better ? t('tft.velocity.better') : t('tft.velocity.worse');
              const nowStr = v.avgPlaceNow != null ? v.avgPlaceNow.toFixed(2) : '—';
              const prevStr = v.avgPlacePrev != null ? v.avgPlacePrev.toFixed(2) : '—';
              const detail = t('tft.velocity.tooltipDetail')
                .replace('{now}', nowStr)
                .replace('{prev}', prevStr);
              const tooltip = `${label} — ${detail}`;
              return (
                <span style={{ color }} className="font-medium" title={tooltip}>
                  {arrow} {Math.abs(v.deltaAvgPlace).toFixed(2)}
                </span>
              );
            })()}
          </div>
        )}
        <div className="hidden sm:flex items-center justify-end gap-1">
          <PlanAheadButton
            characterIds={typicalUnits.slice(0, 10).map(u => u.characterId)}
            setNumber={assets?.set ?? 17}
            assets={assets}
            size="sm"
          />
          <BookmarkButton
            type="comp"
            bookmarkKey={comp.slug}
            label={`${traitDisplay}${carry?.name ? ` · ${carry.name}` : ''}`}
            size="sm"
          />
        </div>

        {/* Mobile-only inline stats */}
        <div className="sm:hidden flex items-center gap-2 col-span-full justify-end tabular-nums">
          <span className="font-medium text-base" style={{ color: tier.color }}>
            {comp.avgPlacement != null ? comp.avgPlacement.toFixed(2) : '—'}
          </span>
          <span className="text-[#a0b0c5]">
            {comp.top4Rate != null ? `${(comp.top4Rate * 100).toFixed(0)}%` : '—'}
          </span>
          <span className="text-[#a0b0c5]">
            {comp.pickRate != null ? `${(comp.pickRate * 100).toFixed(1)}%` : '—'}
          </span>
          <span className="text-[#7a8aa0]">{comp.games}</span>
        </div>
      </div>
    </div>
  );
}
