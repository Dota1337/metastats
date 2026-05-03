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
  typicalUnits: { characterId: string; count: number }[];
  typicalAugments: { apiName: string; count: number; sumPlacement: number }[];
  carryItems: { items: string[]; count: number }[];
  authorName?: string;        // editorial only
}

export default function CompCard({
  comp, ddVersion, champs, items, traits, augs, href,
}: {
  comp: Comp;
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

  const Wrapper = href ? 'a' : 'div';
  return (
    <Wrapper {...(href ? { href } : {})} className="block bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-4 hover:border-[#7B61FF]/40 transition-colors">
      <div className="flex items-start gap-4">
        {/* Carry portrait */}
        {ddVersion && carry?.image?.full ? (
          <img src={`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/tft-champion/${carry.image.full}`} alt={carry.name} className="w-12 h-12 rounded border-2 border-[#c39bff]" />
        ) : (
          <div className="w-12 h-12 rounded bg-[#1e2a3a]" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-white text-base font-medium">{traitName} {parts?.level ?? ''}</span>
            <span className="text-[#4a5a70] text-xs">·</span>
            <span className="text-[#8a9bb0] text-sm">{carry?.name || (parts ? prettyChar(parts.carry) : '')}</span>
            {comp.source === 'editorial' && comp.authorName && (
              <span className="ml-auto px-2 py-0.5 rounded-full bg-[#7B61FF]/15 text-[#7B61FF] text-[10px] uppercase tracking-widest">
                {comp.authorName}
              </span>
            )}
          </div>

          {/* Typical units */}
          <div className="flex flex-wrap gap-1.5 mb-2">
            {comp.typicalUnits.slice(0, 9).map(u => {
              const ch = champs[u.characterId];
              return (
                <div key={u.characterId} className="w-7 h-7 rounded border" style={{ borderColor: ch ? costColorOf(ch.cost) : '#1e2a3a' }} title={ch?.name || u.characterId}>
                  {ddVersion && ch?.image?.full && (
                    <img src={`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/tft-champion/${ch.image.full}`} alt={ch.name} className="w-full h-full object-cover rounded-sm" />
                  )}
                </div>
              );
            })}
          </div>

          {/* Carry build */}
          {comp.carryItems.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {comp.carryItems[0].items.map((it, i) => {
                const m = itemsByApi[it];
                return ddVersion && m?.image?.full ? (
                  <img key={i} src={`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/tft-item/${m.image.full}`} alt={m.name} title={m.name} className="w-5 h-5 rounded" />
                ) : (
                  <div key={i} className="w-5 h-5 rounded bg-[#1e2a3a]" title={it} />
                );
              })}
              <span className="text-[10px] text-[#4a5a70] ml-1 self-center">{comp.carryItems[0].count}×</span>
            </div>
          )}

          {/* Augments */}
          {comp.typicalAugments.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {comp.typicalAugments.slice(0, 3).map(a => {
                const m = augs[a.apiName];
                const tierColor = m?.tier === 3 ? '#c39bff' : m?.tier === 2 ? '#e0c75a' : '#9ab0bf';
                return ddVersion && m?.image?.full ? (
                  <img key={a.apiName} src={`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/tft-augment/${m.image.full}`} alt={m.name} title={m.name} className="w-5 h-5 rounded border" style={{ borderColor: tierColor }} />
                ) : (
                  <div key={a.apiName} className="w-5 h-5 rounded border bg-[#1e2a3a]" style={{ borderColor: tierColor }} title={a.apiName} />
                );
              })}
            </div>
          )}
        </div>

        <div className="text-right flex-shrink-0">
          <div className="text-white text-sm">Ø {comp.avgPlacement?.toFixed(2) ?? '—'}</div>
          {comp.top4Rate != null && <div className="text-[#8a9bb0] text-xs">{(comp.top4Rate * 100).toFixed(0)}% T4</div>}
          <div className="text-[#4a5a70] text-[10px]">{comp.games}g</div>
        </div>
      </div>
    </Wrapper>
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
