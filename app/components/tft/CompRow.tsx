'use client';
import { useRouter } from 'next/navigation';
import type { TftAssetsBundle } from '../../lib/tft-cdragon';
import { tftChampionTileUrl, findChampion, tftTraitDisplayName, tftTraitDescription } from '../../lib/tft-cdragon';
import { costColor as costColorOf } from '../../lib/tft-ui';
import { useI18n } from '../../lib/i18n';
import BookmarkButton from '../BookmarkButton';
import PlanAheadButton from './PlanAheadButton';
import { compDefiningAugmentApiNameFromSlug } from '../../lib/tft-comp-defining-augments';

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
  avgLevel?: number | null;
  avgLastRound?: number | null;
  typicalUnits: { characterId: string; count: number | unknown; carryItemGames?: number | unknown }[];
  velocity?: CompVelocity | null;
}

const safeCount = (v: unknown): number => (typeof v === 'number' ? v : 1);

function tierBadge(avg: number | null) {
  if (avg == null) return { label: '?', color: '#5a6a80' };
  if (avg < 3.8) return { label: 'S', color: '#e0c75a' };
  if (avg < 4.2) return { label: 'A', color: '#7B61FF' };
  if (avg < 4.5) return { label: 'B', color: '#3a8ddc' };
  return { label: 'C', color: '#5a6a80' };
}

function parseClusterKey(key: string) {
  // Cluster-Key Format: <trait>@<level>_<carryUnit>[*N][~<augSlug>][#<unitId>]
  //   *N = Carry-Star · ~<slug> = Comp-Augment · #ID = Secondary-Carry
  const m = /^(.+)@(\d+)_([^#*~]+)(?:\*(\d))?(?:~([A-Za-z]+))?(?:#(.+))?$/.exec(key);
  if (!m) return null;
  return {
    trait: m[1],
    level: Number(m[2]),
    carry: m[3],
    carryStar: m[4] ? Number(m[4]) : 2,
    augmentSlug: m[5] || null,
    secondary: m[6] || null,
  };
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

// Single primary descriptor per comp, like tactics.tools' "Items Dep / Fast 8
// / Consistent / High WR". Priority order matters: tempo wins over difficulty,
// win-rate wins over consistency. Pros want one quick label to recognise the
// archetype, not a stack of competing tags.
function descriptorTag(opts: {
  avgLevel?: number | null;
  top1Rate?: number | null;
  top4Rate?: number | null;
  carryCost?: number;
  carryItemRate?: number;
}): { label: string; color: string } | null {
  const { avgLevel, top1Rate, top4Rate, carryCost, carryItemRate } = opts;
  if (avgLevel != null) {
    if (avgLevel >= 8.5) return { label: 'Fast 8', color: '#e0c75a' };
    if (avgLevel <= 7.0) return { label: 'Reroll', color: '#3a8ddc' };
  }
  if (carryCost != null && carryCost >= 4 && (carryItemRate ?? 0) > 0.55) {
    return { label: 'Items Dep', color: '#c39bff' };
  }
  if ((top1Rate ?? 0) > 0.18) return { label: 'High WR', color: '#3ecf8e' };
  if ((top4Rate ?? 0) > 0.65) return { label: 'Consistent', color: '#3a8ddc' };
  return null;
}

export default function CompRow({
  comp, rank, assets, href, showVelocity = false, velocityShift = 0,
}: {
  comp: Comp;
  rank: number;
  assets: TftAssetsBundle | null;
  href: string;
  // When true the row reserves an extra column for the Δ-place delta. Must
  // match the header grid in the parent page — the comps page only enables
  // velocity if the API was queried with ?velocity=N.
  showVelocity?: boolean;
  // Comparison window in days (1/2/3/7/14). Used in the Δ cell's tooltip so
  // a glance at the value also shows what window it's against, instead of
  // relying on the user remembering which filter they set.
  velocityShift?: number;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const parts = parseClusterKey(comp.clusterKey);
  const traitMeta = parts && assets ? assets.traits[parts.trait] : null;
  const traitName = traitMeta?.name || (parts ? prettyTrait(parts.trait) : 'Unknown');
  const traitVariant = parts ? extractTraitVariant(parts.trait, traitName) : null;
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

  const tier = tierBadge(comp.avgPlacement);
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
      className="block px-2 sm:px-3 py-2 rounded border border-[#1e2a3a] bg-[#0d1526] hover:bg-[#101a30] hover:border-[#7B61FF]/40 transition-colors text-xs sm:text-[13px] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7B61FF]/60"
    >
      {/* Mobile: stacked. Desktop: tight horizontal row.
          Großes Carry-Portrait raus — der Carry erscheint sowieso in der
          typicalUnits-Strip mit lila Border + seinen Items. Doppelt =
          Augen-Lärm + verwirrend (Identifikation einmal über Portrait,
          einmal über Tile in Reihe). Grid-Spalte (vormals 2.5rem)
          entsprechend entfernt. */}
      <div className={`grid grid-cols-[1.25rem_1.5rem_minmax(7rem,1fr)_minmax(0,auto)_auto] ${
        showVelocity
          ? 'sm:grid-cols-[1.25rem_1.5rem_minmax(11rem,1fr)_minmax(0,auto)_3rem_3rem_3rem_3rem_3rem_3.5rem_3rem]'
          : 'sm:grid-cols-[1.25rem_1.5rem_minmax(11rem,1fr)_minmax(0,auto)_3rem_3rem_3rem_3rem_3rem_3rem]'
      } items-center gap-2 sm:gap-3`}>
        <div className="text-[#7a8aa0] tabular-nums text-right">{rank}</div>
        <div
          className="w-6 h-6 rounded flex items-center justify-center font-bold text-[11px]"
          style={{ color: tier.color, backgroundColor: `${tier.color}25`, border: `1px solid ${tier.color}40` }}
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
        <div className="flex items-center gap-[2px]">
          {typicalUnits.slice(0, 9).map(u => {
            const ch = findChampion(assets, u.characterId);
            const isCarry = u.characterId === carryCid;
            const url = tftChampionTileUrl(assets, ch);
            return (
              <a
                key={u.characterId}
                href={`/tft/units/${encodeURIComponent(u.characterId)}`}
                onClick={e => e.stopPropagation()}
                className="w-6 h-6 rounded border overflow-hidden flex-shrink-0 block hover:scale-110 transition-transform"
                style={{ borderColor: isCarry ? '#c39bff' : (ch ? costColorOf(ch.cost) : '#1e2a3a') }}
                title={ch?.name || u.characterId}
              >
                {url && <img src={url} alt={ch?.name || ''} className="w-full h-full object-cover" />}
              </a>
            );
          })}
        </div>

        {/* Stats: mobile = single column on the right; desktop = 4-5 columns */}
        <div className="hidden sm:block text-right tabular-nums font-medium text-base" style={{ color: tier.color }}>
          {comp.avgPlacement != null ? comp.avgPlacement.toFixed(2) : '—'}
        </div>
        <div className="hidden sm:block text-right tabular-nums text-[#a0b0c5]">
          {comp.top4Rate != null ? `${(comp.top4Rate * 100).toFixed(0)}%` : '—'}
        </div>
        <div className="hidden sm:block text-right tabular-nums text-[#a0b0c5]">
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
