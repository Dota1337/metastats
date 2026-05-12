'use client';
import type { TftAssetsBundle } from '../../lib/tft-cdragon';
import { tftIconUrl, tftChampionTileUrl } from '../../lib/tft-cdragon';

interface Comp {
  source?: 'data' | 'editorial';
  slug: string;
  clusterKey: string;
  games: number;
  avgPlacement: number | null;
  top4Rate: number | null;
  top1Rate: number | null;
  pickRate?: number | null;
  typicalUnits: { characterId: string; count: number | unknown }[];
  typicalAugments: { apiName: string; count: number | unknown; sumPlacement?: number | unknown }[];
  carryItems: { items: string[]; count: number | unknown }[];
  authorName?: string;
}

const safeCount = (v: unknown): number => (typeof v === 'number' ? v : 1);

function tierBadge(avgPlacement: number | null): { label: string; color: string; bg: string } {
  if (avgPlacement == null) return { label: '?', color: '#5a6a80', bg: '#1e2a3a' };
  if (avgPlacement < 3.8) return { label: 'S',  color: '#e0c75a', bg: 'rgba(224,199,90,0.15)' };
  if (avgPlacement < 4.2) return { label: 'A',  color: '#7B61FF', bg: 'rgba(123,97,255,0.15)' };
  if (avgPlacement < 4.5) return { label: 'B',  color: '#3a8ddc', bg: 'rgba(58,141,220,0.15)' };
  return                         { label: 'C',  color: '#5a6a80', bg: 'rgba(90,106,128,0.15)' };
}

export default function CompCard({
  comp, rank, assets, href,
}: {
  comp: Comp;
  rank?: number;
  assets: TftAssetsBundle | null;
  href?: string;
}) {
  const parts = parseClusterKey(comp.clusterKey);
  const traitMeta = parts && assets ? assets.traits[parts.trait] : null;
  const traitName = traitMeta?.name || (parts ? prettyTrait(parts.trait) : 'Unknown');
  const carry = parts && assets ? assets.champions[parts.carry] : null;
  const tier = tierBadge(comp.avgPlacement);

  const typicalUnits = [...(comp.typicalUnits || [])]
    .map(u => ({ ...u, _c: safeCount(u.count) }))
    .sort((a, b) => b._c - a._c)
    .slice(0, 9);

  const Wrapper: any = href ? 'a' : 'div';
  return (
    <Wrapper {...(href ? { href } : {})} className="block bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-3 hover:border-[#7B61FF]/40 transition-colors">
      {/* Mobile: stack the carry header → units row → stats column vertically.
          Desktop: original 3-column grid keeps it dense. */}
      <div className="flex flex-col sm:grid sm:grid-cols-[auto_1fr_auto] gap-3 sm:gap-4 sm:items-center">
        <div className="flex items-center gap-3">
          {rank != null && <div className="text-[#4a5a70] text-sm font-medium w-6 text-center">{rank}</div>}
          <div className="flex items-center justify-center w-10 h-10 rounded-lg font-bold text-base"
               style={{ color: tier.color, backgroundColor: tier.bg, border: `1px solid ${tier.color}40` }}>
            {tier.label}
          </div>
          {tftChampionTileUrl(assets, carry) ? (
            <img src={tftChampionTileUrl(assets, carry)!} alt={carry!.name} className="w-12 h-12 rounded border-2 border-[#c39bff] object-cover" />
          ) : (
            <div className="w-12 h-12 rounded bg-[#1e2a3a]" />
          )}
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-white text-sm font-medium truncate">
              {parts ? (
                <a
                  href={`/tft/traits/${encodeURIComponent(parts.trait)}`}
                  onClick={e => e.stopPropagation()}
                  className="hover:text-[#7B61FF] transition-colors"
                >
                  {traitName}
                </a>
              ) : traitName}
              {' '}{parts?.level ?? ''} · {parts ? (
                <a
                  href={`/tft/units/${encodeURIComponent(parts.carry)}`}
                  onClick={e => e.stopPropagation()}
                  className="hover:text-[#7B61FF] transition-colors"
                >
                  {carry?.name || prettyChar(parts.carry)}
                </a>
              ) : (carry?.name || '')}
            </span>
            {comp.source === 'editorial' && comp.authorName && (
              <span className="px-2 py-0.5 rounded-full bg-[#7B61FF]/15 text-[#7B61FF] text-[9px] uppercase tracking-widest">
                {comp.authorName}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1 mb-1.5">
            {typicalUnits.map(u => {
              const ch = assets?.champions[u.characterId];
              const isCarry = parts && u.characterId === parts.carry;
              // Square HUD tile (hud/<id>_square.<mutator>.png) — same source
              // metatft + ingame use; the wide splash art that CompCard used
              // to pull cropped to the chest under `object-cover` and looked
              // off-center. Fallback to splash via tftChampionTileUrl()
              // handles cross-set / special units that don't have the
              // square path.
              const url = tftChampionTileUrl(assets, ch);
              return (
                <a
                  key={u.characterId}
                  href={`/tft/units/${encodeURIComponent(u.characterId)}`}
                  onClick={e => e.stopPropagation()}
                  className="w-8 h-8 rounded border-2 hover:scale-110 transition overflow-hidden"
                  style={{ borderColor: isCarry ? '#c39bff' : (ch ? costColorOf(ch.cost) : '#1e2a3a') }}
                  title={ch?.name || u.characterId}
                >
                  {url && <img src={url} alt={ch?.name || u.characterId} className="w-full h-full object-cover rounded-sm" />}
                </a>
              );
            })}
          </div>

          {comp.typicalAugments && comp.typicalAugments.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 mt-2">
              <span className="text-[#4a5a70] text-[9px] uppercase tracking-widest mr-1">Augments</span>
              {comp.typicalAugments.slice(0, 4).map(a => {
                const m = assets?.augments[a.apiName];
                const tierColor = m?.tier === 3 ? '#c39bff' : m?.tier === 2 ? '#e0c75a' : '#9ab0bf';
                const url = tftIconUrl(assets, m?.icon);
                return url ? (
                  <img key={a.apiName} src={url} alt={m!.name} title={m!.name} className="w-5 h-5 rounded border" style={{ borderColor: tierColor }} />
                ) : (
                  <div key={a.apiName} className="w-5 h-5 rounded border bg-[#1e2a3a]" style={{ borderColor: tierColor }} title={a.apiName} />
                );
              })}
            </div>
          )}
        </div>

        {/* Stats: horizontal pills on mobile (wraps if needed),
            right-aligned column on desktop. */}
        <div className="flex items-stretch gap-2 sm:text-right flex-wrap sm:flex-nowrap">
          <Stat label="Avg" value={comp.avgPlacement?.toFixed(2) ?? '—'} accent={tier.color} />
          <Stat label="Top 4" value={comp.top4Rate != null ? `${(comp.top4Rate * 100).toFixed(0)}%` : '—'} />
          <Stat label="Sieg" value={comp.top1Rate != null ? `${(comp.top1Rate * 100).toFixed(0)}%` : '—'} />
          <Stat label="Pick" value={comp.pickRate != null ? `${(comp.pickRate * 100).toFixed(2)}%` : '—'} />
          <div className="flex flex-col items-end justify-center pl-2 border-l border-[#1e2a3a]">
            <div className="text-[#4a5a70] text-[9px] uppercase tracking-widest">Spiele</div>
            <div className="text-[#8a9bb0] text-sm">{comp.games}</div>
          </div>
        </div>
      </div>
    </Wrapper>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex flex-col items-end justify-center min-w-[3.5rem]">
      <div className="text-[#4a5a70] text-[9px] uppercase tracking-widest">{label}</div>
      <div className="text-base font-medium" style={{ color: accent || '#ffffff' }}>{value}</div>
    </div>
  );
}

function parseClusterKey(key: string): { trait: string; level: number; carry: string } | null {
  const m = /^(.+)@(\d+)_(.+)$/.exec(key);
  if (!m) return null;
  return { trait: m[1], level: Number(m[2]), carry: m[3] };
}
function costColorOf(cost: number) {
  return cost === 1 ? '#9aa6b2' : cost === 2 ? '#3a8' : cost === 3 ? '#3a8ddc' : cost === 4 ? '#c39bff' : '#e0c75a';
}
function prettyTrait(s: string) { return s.replace(/^TFT\d+_/, ''); }
function prettyChar(s: string) { return s.replace(/^TFT\d+_/, ''); }
