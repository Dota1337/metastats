'use client';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import TierFilter, { type TierBucket } from '../../../components/tft/TierFilter';
import EmptyData from '../../../components/tft/EmptyData';
import { useI18n } from '../../../lib/i18n';
import { loadTftAssets, tftIconUrl, tftChampionTileUrl, type TftAssetsBundle } from '../../../lib/tft-cdragon';

interface ItemDetail {
  apiName: string;
  games: number;
  avgPlacement: number | null;
  top4Rate: number | null;
  topUsers: { characterId: string; games: number; avgPlacement: number | null }[];
}

export default function TftItemDetailPage() {
  const { t } = useI18n();
  const params = useParams();
  const search = useSearchParams();
  const id = decodeURIComponent(String(params?.id || ''));
  const [bucket, setBucket] = useState<TierBucket>((search.get('bucket') as TierBucket) || 'master_plus');
  const [data, setData] = useState<ItemDetail | null | undefined>(undefined);
  const [hasData, setHasData] = useState<boolean | null>(null);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  const [compsWithItem, setCompsWithItem] = useState<any[]>([]);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);
  useEffect(() => {
    fetch(`/api/tft/items?region=euw1&bucket=${bucket}&id=${encodeURIComponent(id)}`)
      .then(r => r.json())
      .then(d => { setHasData(!!d.hasData); setData(d.item || null); })
      .catch(() => { setHasData(false); setData(null); });
    // Cross-query: comps that frequently build this item on their lead carry.
    // Uses the existing carryItems jsonb (top-3-item triples per comp) so no
    // aggregator change is needed.
    fetch(`/api/tft/comps?region=euw1&bucket=${bucket}&days=3&patch=current&source=data`)
      .then(r => r.json())
      .then(d => {
        const filtered = (d.comps || [])
          .filter((c: any) =>
            (c.carryItems || []).some((ci: any) => (ci.items || []).includes(id)),
          )
          .slice(0, 6);
        setCompsWithItem(filtered);
      })
      .catch(() => setCompsWithItem([]));
  }, [bucket, id]);

  const itemMeta = assets?.items[id];
  const url = tftIconUrl(assets, itemMeta?.icon);
  const composition = itemMeta?.composition || [];

  // Reverse-lookup: sibling items that share at least one component with us.
  // Useful so a player on Negatron Cape sees all 9 magic-resist completed
  // items at a glance, with their own composition pills.
  const siblings = assets && composition.length > 0
    ? Object.entries(assets.items)
        .filter(([k, v]) => k !== id && v.composition && v.composition.some(c => composition.includes(c)))
        // Only the active set's primary completed items — heuristic via the
        // apiName prefix matching the requested item's prefix.
        .filter(([k]) => {
          const reqPrefix = id.replace(/_Item_.*$/, '');
          return k.startsWith(reqPrefix) || k.startsWith('TFT_Item_');
        })
        .slice(0, 12)
    : [];

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="items" />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-5 mb-5">
          <a href="/tft/items" className="text-[#7B61FF] text-xs hover:underline">← {t('nav.items')}</a>
          <div className="flex items-center gap-4 mt-2">
            {url ? (
              <img src={url} alt={itemMeta!.name} className="w-16 h-16 rounded-lg border-2 border-[#7B61FF]" />
            ) : (
              <div className="w-16 h-16 rounded-lg bg-[#1e2a3a]" />
            )}
            <div className="flex-1">
              <h1 className="text-white text-2xl font-medium">{itemMeta?.name || prettyApi(id)}</h1>
              {itemMeta?.desc && <p className="text-[#a0b0c5] text-xs mt-1 max-w-prose">{itemMeta.desc}</p>}
            </div>
          </div>

          {/* Recipe: two components → completed item. Each base item is its
              own clickable tile so the player can dig into the component
              economy from any direction. */}
          {composition.length === 2 && (
            <div className="mt-4 pt-4 border-t border-[#1e2a3a]">
              <div className="text-[#a0b0c5] text-[10px] uppercase tracking-widest mb-2">{t('tft.item.recipe')}</div>
              <div className="flex items-center gap-3 flex-wrap">
                {composition.map((compId, i) => {
                  const compMeta = assets?.items[compId];
                  const compUrl = tftIconUrl(assets, compMeta?.icon);
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <a
                        href={`/tft/items/${encodeURIComponent(compId)}?bucket=${bucket}`}
                        title={compMeta?.name || compId}
                        className="flex items-center gap-2 bg-[#141c2e] border border-[#1e2a3a] rounded px-2 py-1 hover:border-[#7B61FF]/50"
                      >
                        {compUrl ? (
                          <img src={compUrl} alt={compMeta!.name} className="w-8 h-8 rounded" />
                        ) : (
                          <div className="w-8 h-8 rounded bg-[#1e2a3a]" />
                        )}
                        <span className="text-white text-xs">{compMeta?.name || prettyApi(compId)}</span>
                      </a>
                      {i === 0 && <span className="text-[#7B61FF] text-lg font-medium">+</span>}
                    </div>
                  );
                })}
                <span className="text-[#7B61FF] text-lg font-medium">=</span>
                <div className="flex items-center gap-2 bg-[#7B61FF]/10 border border-[#7B61FF]/30 rounded px-2 py-1">
                  {url && <img src={url} alt={itemMeta!.name} className="w-8 h-8 rounded" />}
                  <span className="text-white text-xs font-medium">{itemMeta?.name || prettyApi(id)}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end mb-4">
          <TierFilter value={bucket} onChange={setBucket} />
        </div>

        {hasData === false && <EmptyData />}
        {data && (
          <>
            <div className="grid grid-cols-3 gap-3 mb-5">
              <Stat label={t('tft.avgPlacement')} value={data.avgPlacement?.toFixed(2) ?? '—'} />
              <Stat label={t('tft.top4')} value={data.top4Rate != null ? `${(data.top4Rate * 100).toFixed(1)}%` : '—'} />
              <Stat label={t('tft.gamesShort')} value={data.games.toLocaleString('de-DE')} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
              {data.topUsers.length > 0 && (
                <div>
                  <h2 className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-2">{t('tft.topUsers')}</h2>
                  <div className="flex flex-wrap gap-2">
                    {data.topUsers.map(u => {
                      const ch = assets?.champions[u.characterId];
                      const churl = tftChampionTileUrl(assets, ch);
                      return (
                        <a key={u.characterId} href={`/tft/units/${encodeURIComponent(u.characterId)}?bucket=${bucket}`}
                           className="flex flex-col items-center gap-1 bg-[#141c2e] border border-[#1e2a3a] rounded p-2 w-20 hover:border-[#7B61FF]/50">
                          {churl
                            ? <img src={churl} alt={ch!.name} className="w-10 h-10 rounded object-cover" />
                            : <div className="w-10 h-10 rounded bg-[#1e2a3a]" />}
                          <div className="text-[10px] text-white text-center truncate w-full">{ch?.name || prettyChar(u.characterId)}</div>
                          <div className="text-[10px] text-[#7a8aa0]">{u.games} {t('tft.gamesShort')}</div>
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}

              {compsWithItem.length > 0 && (
                <div>
                  <h2 className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-2">{t('tft.compsWithItem')}</h2>
                  <div className="space-y-1.5">
                    {compsWithItem.map(c => {
                      const parts = parseClusterKey(c.clusterKey);
                      const traitMeta = parts && assets ? assets.traits[parts.trait] : null;
                      const traitName = traitMeta?.name || (parts ? prettyTrait(parts.trait) : '');
                      const carry = parts && assets ? assets.champions[parts.carry] : null;
                      const carryUrl = tftChampionTileUrl(assets, carry);
                      return (
                        <a
                          key={c.slug}
                          href={`/tft/comps/${encodeURIComponent(c.slug)}?bucket=${bucket}&region=euw1`}
                          className="flex items-center gap-2 bg-[#141c2e] border border-[#1e2a3a] rounded p-2 hover:border-[#7B61FF]/40 transition-colors"
                        >
                          {carryUrl && (
                            <img src={carryUrl} alt="" className="w-8 h-8 rounded border border-[#c39bff]/60 object-cover flex-shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-white text-[11px] font-medium truncate leading-tight">
                              {traitName} {parts?.level ?? ''} · {carry?.name || (parts ? prettyChar(parts.carry) : '')}
                            </div>
                          </div>
                          <div className="text-right text-[11px] tabular-nums leading-tight">
                            <div className="text-white">Ø {c.avgPlacement?.toFixed(2) ?? '—'}</div>
                            <div className="text-[#7a8aa0]">{c.games}</div>
                          </div>
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* Sibling items — completed items that share a component with this
            one. Lets players see all options for a given starter (e.g. "I
            got a Sword early — what completed items use it?"). */}
        {siblings.length > 0 && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4">
            <h2 className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">{t('tft.item.sharedComponents')}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {siblings.map(([k, v]) => {
                const sUrl = tftIconUrl(assets, v.icon);
                return (
                  <a
                    key={k}
                    href={`/tft/items/${encodeURIComponent(k)}?bucket=${bucket}`}
                    className="flex items-center gap-2 bg-[#141c2e] border border-[#1e2a3a] rounded p-2 hover:border-[#7B61FF]/50"
                  >
                    {sUrl ? (
                      <img src={sUrl} alt={v.name} className="w-8 h-8 rounded" />
                    ) : (
                      <div className="w-8 h-8 rounded bg-[#1e2a3a]" />
                    )}
                    <span className="text-white text-[11px] truncate">{v.name}</span>
                  </a>
                );
              })}
            </div>
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-3">
      <div className="text-[#7a8aa0] text-[10px] uppercase tracking-widest">{label}</div>
      <div className="text-white text-lg font-medium mt-1">{value}</div>
    </div>
  );
}
function prettyApi(s: string) { return s.replace(/^TFT\d*_Item_/, ''); }
function prettyChar(id: string) { return id.replace(/^TFT\d+_/, ''); }
function prettyTrait(s: string) { return s.replace(/^TFT\d+_/, ''); }
function parseClusterKey(key: string) {
  const m = /^(.+)@(\d+)_(.+)$/.exec(key);
  if (!m) return null;
  return { trait: m[1], level: Number(m[2]), carry: m[3] };
}
