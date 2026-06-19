'use client';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import TierFilter, { type TierBucket } from '../../../components/tft/TierFilter';
import EmptyData from '../../../components/tft/EmptyData';
import { useI18n } from '../../../lib/i18n';
import { loadTftAssets, tftIconUrl, tftChampionTileUrl, tftTraitDisplayName, type TftAssetsBundle } from '../../../lib/tft-cdragon';
import { buildExplorerUrl } from '../../../lib/tft-explorer-url';
import { parseClusterKey } from '../../../lib/tft-cluster';
import { costColor as costColorOf } from '../../../lib/tft-ui';
import tftSet from '../../../../public/tft-set.json';

interface ItemDetail {
  apiName: string;
  games: number;
  avgPlacement: number | null;
  top4Rate: number | null;
  topUsers: {
    characterId: string;
    games: number;
    avgPlacement: number | null;
    top4Rate?: number | null;
    top1Rate?: number | null;
  }[];
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
  // ALL comps that contain this item — we slice top-6 for the "comps with item"
  // display, but use the full list to aggregate item-combo stats below.
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
          );
        setCompsWithItem(filtered);
      })
      .catch(() => setCompsWithItem([]));
  }, [bucket, id]);

  // Item-Combo-Aggregation: cross all comps that contain this item, sum the
  // per-comp carryItems-counts weighted by comp avg-place + top4. Result = the
  // strongest 2er/3er-Sets globally that contain this item. Approximation
  // because we inherit comp-level stats (not per-set), but the count weights
  // the average toward the actually-played sets — accurate enough as a "what
  // builds work" surface without a new backend aggregation.
  const itemCombos = useMemo(() => {
    type ComboAgg = { items: string[]; count: number; wPlace: number; wTop4: number };
    const bySig = new Map<string, ComboAgg>();
    for (const c of compsWithItem) {
      const sets = c.carryItems || [];
      const avg = c.avgPlacement;
      const t4 = c.top4Rate;
      if (avg == null) continue;
      for (const s of sets) {
        const set: string[] = s.items || [];
        if (!set.includes(id)) continue;
        const cnt = Number(s.count) || 0;
        if (cnt <= 0) continue;
        const sig = [...set].sort().join('|');
        const e = bySig.get(sig) || { items: set, count: 0, wPlace: 0, wTop4: 0 };
        e.count += cnt;
        e.wPlace += cnt * Number(avg);
        if (t4 != null) e.wTop4 += cnt * Number(t4);
        bySig.set(sig, e);
      }
    }
    return [...bySig.values()]
      .filter(e => e.count >= 5)
      .map(e => ({ items: e.items, games: e.count, avgPlacement: e.wPlace / e.count, top4Rate: e.wTop4 / e.count }))
      .sort((a, b) => a.avgPlacement - b.avgPlacement)
      .slice(0, 8);
  }, [compsWithItem, id]);

  const compsTop6 = useMemo(() => compsWithItem.slice(0, 6), [compsWithItem]);

  const itemMeta = assets?.items[id];
  const url = tftIconUrl(assets, itemMeta?.icon);
  const composition = itemMeta?.composition || [];

  // Reverse-lookup: sibling items that share at least one component with us.
  // Useful so a player on Negatron Cape sees all 9 magic-resist completed
  // items at a glance, with their own composition pills.
  //
  // Strict set-scoping: keep only items from the active set + the universal
  // `TFT_Item_*` namespace. The old `id.replace(/_Item_.*$/, '')`-prefix
  // heuristic collapsed to `"TFT"` for the universal `TFT_Item_*` ids, which
  // matched every set's prefix and silently pulled in retired Set-4..16
  // emblems and Set-5 radiant spats (the latter with raw i18n keys as
  // display names, e.g. "tft_item_name_Set5Skirmisher_RadiantSpat").
  // We also drop `_Corrupted` reskins (same item, different name → visually
  // duplicate entries) and any item whose display name still looks like an
  // unresolved CDragon i18n key.
  const SET_NUM = tftSet.setNumber;
  const isCurrentSetItem = (k: string) =>
    k.startsWith('TFT_Item_') ||
    k.startsWith(`TFT${SET_NUM}_Item_`) ||
    k.startsWith(`TFTSet${SET_NUM}_Item_`);
  const siblings = assets && composition.length > 0
    ? Object.entries(assets.items)
        .filter(([k, v]) =>
          k !== id &&
          isCurrentSetItem(k) &&
          !/Corrupted/i.test(k) &&
          !/^tft_item_name_/i.test(v.name || '') &&
          v.composition &&
          v.composition.some(c => composition.includes(c)),
        )
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

        <div className="flex justify-end items-center gap-2 mb-4">
          <a
            href={buildExplorerUrl({ items: [id], bucket })}
            className="px-2.5 py-1.5 rounded text-xs bg-[#141c2e] border border-[#1e2a3a] text-[#a0b0c5] hover:text-white hover:border-[#7B61FF]/60 transition-colors flex items-center gap-1.5"
            title={t('tft.drill.openInExplorer')}
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="4.5" cy="4.5" r="3" />
              <line x1="6.6" y1="6.6" x2="9.5" y2="9.5" strokeLinecap="round" />
            </svg>
            <span className="hidden sm:inline">{t('tft.drill.openInExplorer')}</span>
          </a>
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
                  <h2 className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-2">{t('tft.item.topCarrier.title')}</h2>
                  {/* 1D-Carrier-Tabelle: Carrier × (Avg-Place, Top4%, Games).
                      avgPlacement war schon im Aggregator (sumPlacement/games),
                      vorher nur nicht angezeigt. top4Rate seit 2026-06-19
                      Aggregator-Touch verfügbar — alte Snapshots ohne den
                      Top4-Bucket rendern "—" statt eines erfundenen Werts
                      (feedback_no_fake_values), füllt sich beim nächsten
                      Daily-Crawl auf. */}
                  <div className="bg-[#141c2e] border border-[#1e2a3a] rounded overflow-hidden">
                    <div className="grid grid-cols-[1fr_4rem_4rem_4rem] gap-2 px-3 py-1.5 text-[10px] uppercase tracking-widest text-[#7a8aa0] bg-[#0a0e1a]">
                      <div>{t('tft.item.topCarrier.carrier')}</div>
                      <div className="text-right">{t('tft.avgPlacement')}</div>
                      <div className="text-right">{t('tft.top4')}</div>
                      <div className="text-right">{t('tft.gamesShort')}</div>
                    </div>
                    {data.topUsers.map(u => {
                      const ch = assets?.champions[u.characterId];
                      const churl = tftChampionTileUrl(assets, ch);
                      const cost = (ch as any)?.cost ?? 1;
                      return (
                        <a
                          key={u.characterId}
                          href={`/tft/units/${encodeURIComponent(u.characterId)}?bucket=${bucket}`}
                          className="grid grid-cols-[1fr_4rem_4rem_4rem] gap-2 items-center px-3 py-1.5 text-xs hover:bg-white/5 border-t border-[#1e2a3a]"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {churl ? (
                              <img src={churl} alt={ch!.name} className="w-7 h-7 rounded border-2 object-cover flex-shrink-0" style={{ borderColor: costColorOf(cost) }} />
                            ) : (
                              <div className="w-7 h-7 rounded bg-[#1e2a3a] flex-shrink-0" />
                            )}
                            <span className="text-white truncate">{ch?.name || prettyChar(u.characterId)}</span>
                          </div>
                          <div className="text-right text-white tabular-nums">{u.avgPlacement?.toFixed(2) ?? '—'}</div>
                          <div className="text-right text-[#3ecf8e] tabular-nums">{u.top4Rate != null ? `${(u.top4Rate * 100).toFixed(0)}%` : '—'}</div>
                          <div className="text-right text-[#7a8aa0] tabular-nums">{u.games}</div>
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}

              {compsTop6.length > 0 && (
                <div>
                  <h2 className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-2">{t('tft.compsWithItem')}</h2>
                  <div className="space-y-1.5">
                    {compsTop6.map(c => {
                      const parts = parseClusterKey(c.clusterKey);
                      const traitName = parts ? (tftTraitDisplayName(assets, parts.trait) || prettyTrait(parts.trait)) : '';
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
                              {traitName} · {carry?.name || (parts ? prettyChar(parts.carry) : '')}
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

        {/* Item-Combos: strongest 2er/3er builds containing this item, weighted
            from the comps payload. Approximation — comp-level avg/top4 are
            applied to each contained item-set, weighted by the per-comp count
            of that set. A true per-combo aggregation would need an aggregator-
            touch; this client-side cross gets us the ranking without backend
            work. ≥5 games gate so noise doesn't dominate. */}
        {itemCombos.length > 0 && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4 mb-5">
            <h2 className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-1">{t('tft.item.combos.title')}</h2>
            <p className="text-[#7a8aa0] text-[11px] mb-3">{t('tft.item.combos.caption')}</p>
            <div className="space-y-1.5">
              {itemCombos.map((s, i) => (
                <div key={i} className="grid grid-cols-[1fr_4rem_4rem_4rem] gap-3 items-center bg-[#141c2e] border border-[#1e2a3a] rounded px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    {s.items.map((it, j) => {
                      const im = assets?.items[it];
                      const iurl = tftIconUrl(assets, im?.icon);
                      return iurl ? (
                        <a
                          key={j}
                          href={`/tft/items/${encodeURIComponent(it)}?bucket=${bucket}`}
                          onClick={e => e.stopPropagation()}
                          title={im?.name || it}
                          className="hover:scale-110 transition-transform"
                        >
                          <img src={iurl} alt={im?.name || it} className={`w-7 h-7 rounded ${it === id ? 'ring-2 ring-[#7B61FF]' : ''}`} />
                        </a>
                      ) : (
                        <div key={j} className="w-7 h-7 rounded bg-[#1e2a3a]" />
                      );
                    })}
                  </div>
                  <div className="text-right text-white tabular-nums text-xs">{s.avgPlacement.toFixed(2)}</div>
                  <div className="text-right text-[#3ecf8e] tabular-nums text-xs">{(s.top4Rate * 100).toFixed(0)}% T4</div>
                  <div className="text-right text-[#7a8aa0] tabular-nums text-xs">{s.games}</div>
                </div>
              ))}
            </div>
          </div>
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
