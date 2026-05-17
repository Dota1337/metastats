'use client';
import type { TftAssetsBundle } from '../../lib/tft-cdragon';
import { tftChampionTileUrl } from '../../lib/tft-cdragon';
import BookmarkButton from '../BookmarkButton';

// Dense, scannable row layout for /tft/comps. Replaces the narrative
// CompCard so pros can survey 20+ comps at a glance — avg-placement is
// the prominent column, everything else is auxiliary. CompCard is still
// used on the TFT landing page where the bigger format makes sense.

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
  const m = /^(.+)@(\d+)_(.+)$/.exec(key);
  if (!m) return null;
  return { trait: m[1], level: Number(m[2]), carry: m[3] };
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

function costColorOf(cost: number) {
  return cost === 1 ? '#9aa6b2' : cost === 2 ? '#3a8' : cost === 3 ? '#3a8ddc' : cost === 4 ? '#c39bff' : '#e0c75a';
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
  comp, rank, assets, href,
}: {
  comp: Comp;
  rank: number;
  assets: TftAssetsBundle | null;
  href: string;
}) {
  const parts = parseClusterKey(comp.clusterKey);
  const traitMeta = parts && assets ? assets.traits[parts.trait] : null;
  const traitName = traitMeta?.name || (parts ? prettyTrait(parts.trait) : 'Unknown');
  const traitVariant = parts ? extractTraitVariant(parts.trait, traitName) : null;

  const typicalUnits = [...(comp.typicalUnits || [])]
    .map(u => ({
      ...u,
      _c: safeCount(u.count),
      _carry: typeof (u as any).carryItemGames === 'number' ? (u as any).carryItemGames : 0,
    }))
    .sort((a, b) => b._c - a._c)
    .slice(0, 9);

  const carryByItems = typicalUnits
    .filter(u => u._c >= 5 && u._carry > 0)
    .map(u => ({ cid: u.characterId, rate: u._carry / u._c, _carry: u._carry }))
    .sort((a, b) => (b.rate - a.rate) || (b._carry - a._carry))[0];
  const carryCid = carryByItems?.cid || parts?.carry;
  const carry = carryCid && assets ? assets.champions[carryCid] : null;
  const carryUrl = tftChampionTileUrl(assets, carry);

  const tier = tierBadge(comp.avgPlacement);
  const carryItemRate = carryByItems ? carryByItems.rate : 0;
  const descriptor = descriptorTag({
    avgLevel: comp.avgLevel,
    top1Rate: comp.top1Rate,
    top4Rate: comp.top4Rate,
    carryCost: carry?.cost,
    carryItemRate,
  });

  return (
    <a
      href={href}
      className="grid items-center gap-2 sm:gap-3 px-2 sm:px-3 py-2 rounded border border-[#1e2a3a] bg-[#0d1526] hover:bg-[#101a30] hover:border-[#7B61FF]/40 transition-colors text-xs sm:text-[13px]"
      style={{ gridTemplateColumns: 'minmax(0,1fr)' }}
    >
      {/* Mobile: stacked. Desktop: tight horizontal row. */}
      <div className="grid grid-cols-[1.25rem_1.5rem_2.5rem_minmax(7rem,1fr)_minmax(0,auto)_auto] sm:grid-cols-[1.25rem_1.5rem_2.5rem_minmax(11rem,1fr)_minmax(0,auto)_3rem_3rem_3rem_3rem_3rem_1.25rem] items-center gap-2 sm:gap-3">
        <div className="text-[#7a8aa0] tabular-nums text-right">{rank}</div>
        <div
          className="w-6 h-6 rounded flex items-center justify-center font-bold text-[11px]"
          style={{ color: tier.color, backgroundColor: `${tier.color}25`, border: `1px solid ${tier.color}40` }}
        >
          {tier.label}
        </div>
        <div className="w-10 h-10 rounded border-2 overflow-hidden" style={{ borderColor: '#c39bff' }}>
          {carryUrl && <img src={carryUrl} alt={carry?.name || ''} className="w-full h-full object-cover" />}
        </div>
        <div className="min-w-0 leading-tight">
          <div className="text-white font-medium truncate">
            {traitName}
            {traitVariant && <span className="text-[#a892ff]"> · {traitVariant}</span>}
            {' '}{parts?.level ?? ''} · {carry?.name || (carryCid ? prettyChar(carryCid) : '')}
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
            const ch = assets?.champions[u.characterId];
            const isCarry = u.characterId === carryCid;
            const url = tftChampionTileUrl(assets, ch);
            return (
              <div
                key={u.characterId}
                className="w-6 h-6 rounded border overflow-hidden flex-shrink-0"
                style={{ borderColor: isCarry ? '#c39bff' : (ch ? costColorOf(ch.cost) : '#1e2a3a') }}
                title={ch?.name || u.characterId}
              >
                {url && <img src={url} alt={ch?.name || ''} className="w-full h-full object-cover" />}
              </div>
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
        <div className="hidden sm:flex items-center justify-end">
          <BookmarkButton
            type="comp"
            bookmarkKey={comp.slug}
            label={`${traitName}${traitVariant ? ` · ${traitVariant}` : ''}${parts?.level ? ` ${parts.level}` : ''}${carry?.name ? ` · ${carry.name}` : ''}`}
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
    </a>
  );
}
