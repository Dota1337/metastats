'use client';
import type { TftChampion, TftItem, TftTrait, TftAugment } from '../../lib/tft-dd-assets';

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

// Defensive: roll-up data from older crawler versions wrote count as `{}`
// (mergeBuckets bug). We accept either a number or an object and bump the
// fallback to 1 so cards still render consistently.
const safeCount = (v: unknown): number => (typeof v === 'number' ? v : 1);

function tierBadge(avgPlacement: number | null): { label: string; color: string; bg: string } {
  if (avgPlacement == null) return { label: '?', color: '#5a6a80', bg: '#1e2a3a' };
  if (avgPlacement < 3.8) return { label: 'S',  color: '#e0c75a', bg: 'rgba(224,199,90,0.15)' };
  if (avgPlacement < 4.2) return { label: 'A',  color: '#7B61FF', bg: 'rgba(123,97,255,0.15)' };
  if (avgPlacement < 4.5) return { label: 'B',  color: '#3a8ddc', bg: 'rgba(58,141,220,0.15)' };
  return                         { label: 'C',  color: '#5a6a80', bg: 'rgba(90,106,128,0.15)' };
}

export default function CompCard({
  comp, rank, ddVersion, champs, items, traits, augs, href,
}: {
  comp: Comp;
  rank?: number;
  ddVersion: string;
  champs: Record<string, TftChampion>;
  items: Record<number, TftItem>;
  traits: Record<string, TftTrait>;
  augs: Record<string, TftAugment>;
  href?: string;
}) {
  const parts = parseClusterKey(comp.clusterKey);
  const traitMeta = parts ? traits[parts.trait] : null;
  const traitName = traitMeta?.name || (parts ? prettyTrait(parts.trait) : 'Unknown');
  const carry = parts ? champs[parts.carry] : null;
  const itemsByApi: Record<string, TftItem> = Object.fromEntries(
    Object.values(items).map(i => [(i as any).apiName || `_${i.id}`, i])
  );
  const tier = tierBadge(comp.avgPlacement);

  // Sort typical units by count desc (defensive — falls back to 1 each)
  const typicalUnits = [...(comp.typicalUnits || [])]
    .map(u => ({ ...u, _c: safeCount(u.count) }))
    .sort((a, b) => b._c - a._c)
    .slice(0, 9);

  const Wrapper: any = href ? 'a' : 'div';
  return (
    <Wrapper {...(href ? { href } : {})} className="block bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-3 hover:border-[#7B61FF]/40 transition-colors">
      <div className="grid grid-cols-[auto_1fr_auto] gap-4 items-center">
        {/* LEFT: rank + tier badge + carry portrait */}
        <div className="flex items-center gap-3">
          {rank != null && <div className="text-[#4a5a70] text-sm font-medium w-6 text-center">{rank}</div>}
          <div className="flex items-center justify-center w-10 h-10 rounded-lg font-bold text-base"
               style={{ color: tier.color, backgroundColor: tier.bg, border: `1px solid ${tier.color}40` }}>
            {tier.label}
          </div>
          {ddVersion && carry?.image?.full ? (
            <img src={`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/tft-champion/${carry.image.full}`}
                 alt={carry.name} className="w-12 h-12 rounded border-2 border-[#c39bff]" />
          ) : (
            <div className="w-12 h-12 rounded bg-[#1e2a3a]" />
          )}
        </div>

        {/* MIDDLE: name + units row + augments + carry items */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-white text-sm font-medium truncate">{traitName} {parts?.level ?? ''} · {carry?.name || (parts ? prettyChar(parts.carry) : '')}</span>
            {comp.source === 'editorial' && comp.authorName && (
              <span className="px-2 py-0.5 rounded-full bg-[#7B61FF]/15 text-[#7B61FF] text-[9px] uppercase tracking-widest">
                {comp.authorName}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1 mb-1.5">
            {typicalUnits.map(u => {
              const ch = champs[u.characterId];
              const isCarry = parts && u.characterId === parts.carry;
              return (
                <div key={u.characterId}
                     className="relative w-8 h-8 rounded border-2"
                     style={{ borderColor: isCarry ? '#c39bff' : (ch ? costColorOf(ch.cost) : '#1e2a3a') }}
                     title={ch?.name || u.characterId}>
                  {ddVersion && ch?.image?.full && (
                    <img src={`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/tft-champion/${ch.image.full}`}
                         alt={ch.name}
                         className="w-full h-full object-cover rounded-sm" />
                  )}
                  {isCarry && comp.carryItems?.[0]?.items?.length > 0 && (
                    <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex gap-px">
                      {comp.carryItems[0].items.slice(0, 3).map((it, i) => {
                        const m = itemsByApi[it];
                        return ddVersion && m?.image?.full ? (
                          <img key={i} src={`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/tft-item/${m.image.full}`}
                               alt={m.name} title={m.name} className="w-3 h-3 rounded-sm border border-[#0d1526]" />
                        ) : (
                          <div key={i} className="w-3 h-3 rounded-sm bg-[#1e2a3a] border border-[#0d1526]" title={it} />
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Augments below the units row */}
          {comp.typicalAugments && comp.typicalAugments.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 mt-2">
              <span className="text-[#4a5a70] text-[9px] uppercase tracking-widest mr-1">Augments</span>
              {comp.typicalAugments.slice(0, 4).map(a => {
                const m = augs[a.apiName];
                const tierColor = m?.tier === 3 ? '#c39bff' : m?.tier === 2 ? '#e0c75a' : '#9ab0bf';
                return ddVersion && m?.image?.full ? (
                  <img key={a.apiName}
                       src={`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/tft-augment/${m.image.full}`}
                       alt={m.name} title={m.name}
                       className="w-5 h-5 rounded border" style={{ borderColor: tierColor }} />
                ) : (
                  <div key={a.apiName}
                       className="w-5 h-5 rounded border bg-[#1e2a3a]"
                       style={{ borderColor: tierColor }}
                       title={a.apiName} />
                );
              })}
            </div>
          )}
        </div>

        {/* RIGHT: stats panel */}
        <div className="flex items-stretch gap-2 text-right">
          <Stat label="Avg" value={comp.avgPlacement?.toFixed(2) ?? '—'} accent={tier.color} />
          <Stat label="Top 4" value={comp.top4Rate != null ? `${(comp.top4Rate * 100).toFixed(0)}%` : '—'} />
          <Stat label="Top 1" value={comp.top1Rate != null ? `${(comp.top1Rate * 100).toFixed(0)}%` : '—'} />
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
