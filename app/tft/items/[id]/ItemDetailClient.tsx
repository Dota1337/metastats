'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import TierFilter, { type TierBucket } from '../../../components/tft/TierFilter';
import { compsWithItem as selectCompsWithItem, detailFiltersFrom, detailKey, sharedComponentItems } from '../../../lib/tft-detail-filters';
import type { ItemDetailInitial } from '../../../lib/seo/detail-data';
import EmptyData from '../../../components/tft/EmptyData';
import { useI18n } from '../../../lib/i18n';
import { loadTftAssets, tftIconUrl, tftChampionTileUrl, tftTraitDisplayName, formatTftDesc, type TftAssetsBundle } from '../../../lib/tft-cdragon';
import { buildExplorerUrl } from '../../../lib/tft-explorer-url';
import { parseClusterKey } from '../../../lib/tft-cluster';
import { costColor as costColorOf } from '../../../lib/tft-ui';
import { compPath } from '../../../lib/tft-comp-path';

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
  /** Startdaten ohne Traeger: der Browser laedt sie nach. */
  itemsPending?: boolean;
}

// `initial`: Startdaten der Server-Huelle (page.tsx), Bloecke wie bei der
// Unit-Detailseite (UnitDetailClient.tsx).
export default function TftItemDetailPage({ initial }: { initial: ItemDetailInitial | null }) {
  const { t, withLang } = useI18n();
  const params = useParams();
  const search = useSearchParams();
  const id = decodeURIComponent(String(params?.id || ''));
  // Region + Zeitraum aus der Liste uebernehmen (Defaults wie dort).
  const { region, days, bucket: initialBucket } = detailFiltersFrom(search);
  const [bucket, setBucket] = useState<TierBucket>(initialBucket);
  const [data, setData] = useState<ItemDetail | null | undefined>(
    () => initial?.detail ? ((initial.detail.item as ItemDetail | undefined) || null) : undefined);
  const [hasData, setHasData] = useState<boolean | null>(() => initial?.detail ? !!initial.detail.hasData : null);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(() => initial?.assets ?? null);
  // ALL comps that contain this item — we slice top-6 for the "comps with item"
  // display, but use the full list to aggregate item-combo stats below.
  const [compsWithItem, setCompsWithItem] = useState<any[]>(() => initial?.comps ?? []);
  // Startdaten ohne Traeger (kein Vorrat fuer diese Filter): Kernwerte gleich
  // zeigen, die Antwort der API trotzdem holen.
  const initialPending = !!(initial?.detail?.item as ItemDetail | undefined)?.itemsPending;
  // Filter-Schluessel der gezeigten Daten je Block: gleich → kein Abruf.
  const shownDetail = useRef<string | null>(initial?.detail && !initialPending ? initial.key : null);
  const shownComps = useRef<string | null>(initial?.comps ? initial.key : null);
  // Geladene Staende je Schluessel, Startdaten zaehlen mit: zurueck auf einen
  // schon gezeigten Rang → keine neue Abfrage, und nicht die Kopie der API,
  // die bis zu 6 h aelter sein kann als die Startdaten (Zahlen sprangen).
  const loadedDetail = useRef(new Map<string, { hasData: boolean; item: ItemDetail | null }>(
    initial?.detail && !initialPending ? [[initial.key, { hasData: !!initial.detail.hasData, item: (initial.detail.item as ItemDetail | undefined) || null }]] : []));
  const loadedComps = useRef(new Map<string, any[]>(initial?.comps ? [[initial.key, initial.comps]] : []));
  // Rangwechsel: schon geladene Staende gleich beim Klick zeigen; fuer den
  // Rest fragt der Effekt unten.
  const selectBucket = (next: TierBucket) => {
    const k = detailKey(id, { region, bucket: next, days });
    const d = loadedDetail.current.get(k);
    if (d && shownDetail.current !== k) { shownDetail.current = k; setHasData(d.hasData); setData(d.item); }
    const c = loadedComps.current.get(k);
    if (c && shownComps.current !== k) { shownComps.current = k; setCompsWithItem(c); }
    setBucket(next);
  };

  // Das volle Bundle ersetzt den Ausschnitt der Startdaten; scheitert der
  // Abruf, bleibt der Ausschnitt stehen.
  useEffect(() => { loadTftAssets().then(b => { if (b) setAssets(b); }); }, []);
  useEffect(() => {
    // Alte Antworten nach einem Rangwechsel verwerfen.
    let cancelled = false;
    const key = detailKey(id, { region, bucket, days });
    // Schon geladene Staende zeigt selectBucket beim Klick. Ein Fehlschlag
    // wird nicht gemerkt (Schluessel null): beim naechsten Wechsel auf diesen
    // Rang fragt die Seite neu.
    if (shownDetail.current !== key) {
      fetch(`/api/tft/items?region=${region}&bucket=${bucket}&days=${days}&id=${encodeURIComponent(id)}`)
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then(d => {
          if (cancelled) return;
          const v = { hasData: !!d.hasData, item: (d.item as ItemDetail | undefined) || null };
          loadedDetail.current.set(key, v);
          shownDetail.current = key;
          setHasData(v.hasData);
          setData(v.item);
        })
        .catch(() => {
          if (cancelled) return;
          shownDetail.current = null;
          // Nachladen der Traeger gescheitert: Kernwerte der Startdaten bleiben.
          if (initialPending && key === initial?.key) { setData(d => (d ? { ...d, itemsPending: false } : d)); return; }
          setHasData(false); setData(null);
        });
    }
    // Cross-query: comps that frequently build this item on their lead carry.
    // Uses the existing carryItems jsonb (top-3-item triples per comp) so no
    // aggregator change is needed.
    if (shownComps.current !== key) {
      fetch(`/api/tft/comps?region=${region}&bucket=${bucket}&days=${days}&patch=current&source=data`)
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then(d => {
          if (cancelled) return;
          const filtered = selectCompsWithItem(d.comps || [], id);
          loadedComps.current.set(key, filtered);
          shownComps.current = key;
          setCompsWithItem(filtered);
        })
        .catch(() => { if (cancelled) return; shownComps.current = null; setCompsWithItem([]); });
    }
    return () => { cancelled = true; };
  }, [bucket, id, region, days]);

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
  // Set-scoping via the asset bundle's `active.items` list (Riot set data
  // cross-checked against played items, see scripts/fetch-tft-assets.mjs).
  // A key-prefix check (`TFT_Item_` / `TFT<N>_Item_`) used to do this, but
  // Set 18 ships every completed item under `DA_`, so the list came up empty.
  // Retired emblems / Set-5 radiant spats are not in `active.items` either.
  // We also drop `_Corrupted` reskins (same item, different name → visually
  // duplicate entries) and any item whose display name still looks like an
  // unresolved CDragon i18n key.
  const siblings = assets ? sharedComponentItems(assets.items, assets.active?.items, id, composition) : [];

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav active="items" />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <div className="bg-surface-base border border-border-subtle rounded-lg p-5 mb-5">
          <a href={withLang("/tft/items")} className="text-accent text-xs hover:underline">← {t('nav.items')}</a>
          <div className="flex items-center gap-4 mt-2">
            {url ? (
              <img src={url} alt={itemMeta!.name} className="w-16 h-16 rounded-lg border-2 border-accent" />
            ) : (
              <div className="w-16 h-16 rounded-lg bg-surface-overlay" />
            )}
            <div className="flex-1">
              <h1 className="text-white text-2xl font-medium">{itemMeta?.name || prettyApi(id)}</h1>
              {itemMeta?.desc && <p className="text-fg-secondary text-xs mt-1 max-w-prose">{formatTftDesc(itemMeta.desc)}</p>}
            </div>
          </div>

          {/* Recipe: two components → completed item. Each base item is its
              own clickable tile so the player can dig into the component
              economy from any direction. */}
          {composition.length === 2 && (
            <div className="mt-4 pt-4 border-t border-border-subtle">
              <div className="text-fg-secondary text-[10px] uppercase tracking-widest mb-2">{t('tft.item.recipe')}</div>
              <div className="flex items-center gap-3 flex-wrap">
                {composition.map((compId, i) => {
                  const compMeta = assets?.items[compId];
                  const compUrl = tftIconUrl(assets, compMeta?.icon);
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <a
                        href={withLang(`/tft/items/${encodeURIComponent(compId)}?bucket=${bucket}`)}
                        title={compMeta?.name || compId}
                        className="flex items-center gap-2 bg-surface-raised border border-border-subtle rounded px-2 py-1 hover:border-accent-a50"
                      >
                        {compUrl ? (
                          <img src={compUrl} alt={compMeta!.name} className="w-8 h-8 rounded" />
                        ) : (
                          <div className="w-8 h-8 rounded bg-surface-overlay" />
                        )}
                        <span className="text-white text-xs">{compMeta?.name || prettyApi(compId)}</span>
                      </a>
                      {i === 0 && <span className="text-accent text-lg font-medium">+</span>}
                    </div>
                  );
                })}
                <span className="text-accent text-lg font-medium">=</span>
                <div className="flex items-center gap-2 bg-accent-a10 border border-accent-a30 rounded px-2 py-1">
                  {url && <img src={url} alt={itemMeta!.name} className="w-8 h-8 rounded" />}
                  <span className="text-white text-xs font-medium">{itemMeta?.name || prettyApi(id)}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end items-center gap-2 mb-4">
          <a
            href={withLang(buildExplorerUrl({ items: [id], bucket }))}
            className="px-2.5 py-1.5 rounded text-xs bg-surface-raised border border-border-subtle text-fg-secondary hover:text-white hover:border-accent-a60 transition-colors flex items-center gap-1.5"
            title={t('tft.drill.openInExplorer')}
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="4.5" cy="4.5" r="3" />
              <line x1="6.6" y1="6.6" x2="9.5" y2="9.5" strokeLinecap="round" />
            </svg>
            <span className="hidden sm:inline">{t('tft.drill.openInExplorer')}</span>
          </a>
          <TierFilter value={bucket} onChange={selectBucket} />
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
                  <h2 className="text-fg-secondary text-xs uppercase tracking-widest mb-2">{t('tft.item.topCarrier.title')}</h2>
                  {/* 1D-Carrier-Tabelle: Carrier × (Avg-Place, Top4%, Games).
                      avgPlacement war schon im Aggregator (sumPlacement/games),
                      vorher nur nicht angezeigt. top4Rate seit 2026-06-19
                      Aggregator-Touch verfügbar — alte Snapshots ohne den
                      Top4-Bucket rendern "—" statt eines erfundenen Werts
                      (feedback_no_fake_values), füllt sich beim nächsten
                      Daily-Crawl auf. */}
                  <div className="bg-surface-raised border border-border-subtle rounded overflow-hidden">
                    <div className="grid grid-cols-[1fr_4rem_4rem_4rem] gap-2 px-3 py-1.5 text-[10px] uppercase tracking-widest text-fg-muted bg-surface-sunken">
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
                          href={withLang(`/tft/units/${encodeURIComponent(u.characterId)}?bucket=${bucket}`)}
                          className="grid grid-cols-[1fr_4rem_4rem_4rem] gap-2 items-center px-3 py-1.5 text-xs hover:bg-white/5 border-t border-border-subtle"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {churl ? (
                              <img src={churl} alt={ch!.name} className="w-7 h-7 rounded border-2 object-cover flex-shrink-0" style={{ borderColor: costColorOf(cost) }} />
                            ) : (
                              <div className="w-7 h-7 rounded bg-surface-overlay flex-shrink-0" />
                            )}
                            <span className="text-white truncate">{ch?.name || prettyChar(u.characterId)}</span>
                          </div>
                          <div className="text-right text-white tabular-nums">{u.avgPlacement?.toFixed(2) ?? '—'}</div>
                          <div className="text-right text-[#3ecf8e] tabular-nums">{u.top4Rate != null ? `${(u.top4Rate * 100).toFixed(0)}%` : '—'}</div>
                          <div className="text-right text-fg-muted tabular-nums">{u.games}</div>
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}

              {compsTop6.length > 0 && (
                <div>
                  <h2 className="text-fg-secondary text-xs uppercase tracking-widest mb-2">{t('tft.compsWithItem')}</h2>
                  <div className="space-y-1.5">
                    {compsTop6.map(c => {
                      const parts = parseClusterKey(c.clusterKey);
                      const traitName = parts ? (tftTraitDisplayName(assets, parts.trait) || prettyTrait(parts.trait)) : '';
                      const carry = parts && assets ? assets.champions[parts.carry] : null;
                      const carryUrl = tftChampionTileUrl(assets, carry);
                      return (
                        <a
                          key={c.slug}
                          href={withLang(`${compPath(c.slug)}?bucket=${bucket}&region=${region}&days=${days}`)}
                          className="flex items-center gap-2 bg-surface-raised border border-border-subtle rounded p-2 hover:border-accent-a40 transition-colors"
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
                            <div className="text-fg-muted">{c.games}</div>
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
          <div className="bg-surface-base border border-border-subtle rounded p-4 mb-5">
            <h2 className="text-fg-secondary text-xs uppercase tracking-widest mb-1">{t('tft.item.combos.title')}</h2>
            <p className="text-fg-muted text-[11px] mb-3">{t('tft.item.combos.caption')}</p>
            <div className="space-y-1.5">
              {itemCombos.map((s, i) => (
                <div key={i} className="grid grid-cols-[1fr_4rem_4rem_4rem] gap-3 items-center bg-surface-raised border border-border-subtle rounded px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    {s.items.map((it, j) => {
                      const im = assets?.items[it];
                      const iurl = tftIconUrl(assets, im?.icon);
                      return iurl ? (
                        <a
                          key={j}
                          href={withLang(`/tft/items/${encodeURIComponent(it)}?bucket=${bucket}`)}
                          onClick={e => e.stopPropagation()}
                          title={im?.name || it}
                          className="hover:scale-110 transition-transform"
                        >
                          <img src={iurl} alt={im?.name || it} className={`w-7 h-7 rounded ${it === id ? 'ring-2 ring-accent' : ''}`} />
                        </a>
                      ) : (
                        <div key={j} className="w-7 h-7 rounded bg-surface-overlay" />
                      );
                    })}
                  </div>
                  <div className="text-right text-white tabular-nums text-xs">{s.avgPlacement.toFixed(2)}</div>
                  <div className="text-right text-[#3ecf8e] tabular-nums text-xs">{(s.top4Rate * 100).toFixed(0)}% Top 4</div>
                  <div className="text-right text-fg-muted tabular-nums text-xs">{s.games}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sibling items — completed items that share a component with this
            one. Lets players see all options for a given starter (e.g. "I
            got a Sword early — what completed items use it?"). */}
        {siblings.length > 0 && (
          <div className="bg-surface-base border border-border-subtle rounded p-4">
            <h2 className="text-fg-secondary text-xs uppercase tracking-widest mb-3">{t('tft.item.sharedComponents')}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {siblings.map(([k, v]) => {
                const sUrl = tftIconUrl(assets, v.icon);
                return (
                  <a
                    key={k}
                    href={withLang(`/tft/items/${encodeURIComponent(k)}?bucket=${bucket}`)}
                    className="flex items-center gap-2 bg-surface-raised border border-border-subtle rounded p-2 hover:border-accent-a50"
                  >
                    {sUrl ? (
                      <img src={sUrl} alt={v.name} className="w-8 h-8 rounded" />
                    ) : (
                      <div className="w-8 h-8 rounded bg-surface-overlay" />
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
    <div className="bg-surface-base border border-border-subtle rounded p-3">
      <div className="text-fg-muted text-[10px] uppercase tracking-widest">{label}</div>
      <div className="text-white text-lg font-medium mt-1">{value}</div>
    </div>
  );
}
function prettyApi(s: string) { return s.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?(?:Item_)?/, ''); }
function prettyChar(id: string) { return id.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, ''); }
function prettyTrait(s: string) { return s.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, ''); }
