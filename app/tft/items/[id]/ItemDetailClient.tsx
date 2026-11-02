'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import TierFilter, { type TierBucket } from '../../../components/tft/TierFilter';
import { detailFiltersFrom, detailKey, sharedComponentItems } from '../../../lib/tft-detail-filters';
import type { ItemDetailInitial } from '../../../lib/seo/detail-data';
import EmptyData from '../../../components/tft/EmptyData';
import { useI18n } from '../../../lib/i18n';
import { loadTftAssets, tftIconUrl, tftChampionTileUrl, tftLabel, formatTftDesc, type TftAssetsBundle } from '../../../lib/tft-cdragon';
import { buildExplorerUrl } from '../../../lib/tft-explorer-url';
import { costColor as costColorOf } from '../../../lib/tft-ui';
import { loadItemTexts, itemTextFor, type ItemTexts } from '../../../lib/tft-item-texts';
import { compareFamilies, dataEndOf, itemListFamilies, type CompApiRow } from '../../../lib/tft-comp-families';
import { holderDeltaColor, holderDeltaText } from '../../../lib/tft-item-tier-rows';
import ItemStatLine from '../../../components/tft/ItemStatLine';
import CompFamilyRow from '../../../components/tft/CompFamilyRow';
import CompFamilyListHeader, { type CompHeaderSort } from '../../../components/tft/CompFamilyListHeader';
import StatsListPending from '../../../components/tft/StatsListPending';

/** Kombination aus /api/tft/items?id= (itemSetCombos, Migration 0115). */
interface ItemCombo { items: string[]; games: number; avgPlacement: number | null; top4Rate: number | null }

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
    /** Aus der Listenzeile des Items (holderDeltaMap), null = kein Wert. Fehlt in alten Antworten. */
    delta?: number | null;
  }[];
  /** Startdaten ohne Traeger: der Browser laedt sie nach. */
  itemsPending?: boolean;
  /** Fehlt bei Fehlschlag, im Companion-Abruf und in Antworten von vor 0115: dann keine Box. */
  combos?: ItemCombo[];
  /** Startdaten: Kombinationen kommen immer erst aus dem Abruf im Browser. */
  combosPending?: boolean;
}

// Comps-Block: Zeilen fuer die Comp-Familien (itemListFamilies).
interface CompsState { rows: CompApiRow[]; dataEnd: string | null }

// `initial`: Startdaten der Server-Huelle (page.tsx), Bloecke wie bei der
// Unit-Detailseite (UnitDetailClient.tsx).
// `texts`: Infotext dieses Items in allen 6 Sprachen (tft-item-texts-server.ts).
export default function TftItemDetailPage({ initial, texts }: { initial: ItemDetailInitial | null; texts?: ItemTexts | null }) {
  const { t, lang, withLang } = useI18n();
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
  const initialComps: CompsState | null = initial?.families
    ? { rows: initial.families.rows, dataEnd: initial.families.dataEnd }
    : null;
  const [comps, setComps] = useState<CompsState | null>(initialComps);
  // Startdaten ohne Traeger (kein Vorrat fuer diese Filter) oder ohne Kombinationen
  // (immer): Kernwerte gleich zeigen, die Antwort der API trotzdem holen.
  const initialItem = (initial?.detail?.item as ItemDetail | undefined) || null;
  const initialPending = !!(initialItem?.itemsPending || initialItem?.combosPending);
  // Filter-Schluessel der gezeigten Daten je Block: gleich → kein Abruf.
  const shownDetail = useRef<string | null>(initial?.detail && !initialPending ? initial.key : null);
  const shownComps = useRef<string | null>(initialComps ? initial!.key : null);
  // Geladene Staende je Schluessel, Startdaten zaehlen mit: zurueck auf einen
  // schon gezeigten Rang → keine neue Abfrage, und nicht die Kopie der API,
  // die bis zu 6 h aelter sein kann als die Startdaten (Zahlen sprangen).
  const loadedDetail = useRef(new Map<string, { hasData: boolean; item: ItemDetail | null }>(
    initial?.detail && !initialPending ? [[initial.key, { hasData: !!initial.detail.hasData, item: initialItem }]] : []));
  const loadedComps = useRef(new Map<string, CompsState>(initialComps ? [[initial!.key, initialComps]] : []));
  // Rangwechsel: schon geladene Staende gleich beim Klick zeigen; fuer den
  // Rest fragt der Effekt unten.
  const selectBucket = (next: TierBucket) => {
    const k = detailKey(id, { region, bucket: next, days });
    const d = loadedDetail.current.get(k);
    if (d && shownDetail.current !== k) { shownDetail.current = k; setHasData(d.hasData); setData(d.item); }
    const c = loadedComps.current.get(k);
    if (c && shownComps.current !== k) { shownComps.current = k; setComps(c); }
    setBucket(next);
  };

  // Das volle Bundle ersetzt den Ausschnitt der Startdaten; scheitert der
  // Abruf, bleibt der Ausschnitt stehen.
  useEffect(() => { loadTftAssets().then(b => { if (b) setAssets(b); }); }, []);
  // texts null = Datei fehlte auf dem Server → selbst holen. Ein leerer
  // Teil (Item ohne Text) holt nichts; dann bleibt der Bundle-Text.
  const [clientTexts, setClientTexts] = useState<ItemTexts | null>(null);
  useEffect(() => { if (!texts) loadItemTexts().then(setClientTexts); }, [texts]);
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
          const api = (d.item as ItemDetail | undefined) || null;
          // Startdaten mit Traegern: nur die Kombinationen uebernehmen — Kernwerte und
          // Traeger der API-Kopie koennen bis zu 6 h aelter sein (Zahlen sprangen).
          const keepStart = key === initial?.key && !!initialItem && !initialItem.itemsPending;
          const v = keepStart
            ? { hasData: !!initial!.detail!.hasData, item: { ...initialItem!, combosPending: false, combos: api?.combos } }
            : { hasData: !!d.hasData, item: api };
          loadedDetail.current.set(key, v);
          shownDetail.current = key;
          setHasData(v.hasData);
          setData(v.item);
        })
        .catch(() => {
          if (cancelled) return;
          shownDetail.current = null;
          // Nachladen gescheitert: Kernwerte der Startdaten bleiben, Platzhalter weg.
          if (initialPending && key === initial?.key) { setData(d => (d ? { ...d, itemsPending: false, combosPending: false } : d)); return; }
          setHasData(false); setData(null);
        });
    }
    // Comps: Familien wie im Comps-Reiter (itemListFamilies).
    if (shownComps.current !== key) {
      fetch(`/api/tft/comps?region=${region}&bucket=${bucket}&days=${days}&patch=current&source=data`)
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then(d => {
          if (cancelled) return;
          const v: CompsState = { rows: (d.comps || []) as CompApiRow[], dataEnd: dataEndOf(d.filters) };
          loadedComps.current.set(key, v);
          shownComps.current = key;
          setComps(v);
        })
        .catch(() => {
          if (cancelled) return;
          shownComps.current = null;
          setComps(null);
        });
    }
    return () => { cancelled = true; };
  }, [bucket, id, region, days]);

  // Comps wie im Comps-Reiter: die Familien, deren Item-Traeger das Item am
  // haeufigsten tragen (User 02.11.2026), hoechstens 10.
  const families = useMemo(() => (comps ? itemListFamilies(comps.rows, assets, id) : []), [comps, assets, id]);
  // Klick auf einen Spaltenkopf ordnet DIESE 10 um (User 02.11.2026), „Comps" = zurueck
  // auf die meisten Kopien. Auswahl und Bretter bleiben dieselben: itemListFamilies
  // waehlt sie fest, hier wird nur umsortiert. Kein Richtungswechsel (nicht verlangt).
  const [compSort, setCompSort] = useState<CompHeaderSort | null>(null);
  const shownFamilies = useMemo(
    () => (compSort ? [...families].sort(compareFamilies(compSort)) : families),
    [families, compSort],
  );
  const carriersPending = !!data?.itemsPending;
  const combosPending = !!data?.combosPending;
  const itemCombos = data?.combos ?? [];
  const showCarriers = !!data && (carriersPending || data.topUsers.length > 0);
  const showCombos = combosPending || itemCombos.length > 0;
  // Spalte Delta nur, wenn mindestens ein Traeger einen Wert hat (Traenke, alte Antworten: keine).
  const showDelta = !!data && data.topUsers.some(u => u.delta != null);
  const carrierCols = showDelta
    ? 'grid-cols-[minmax(0,1fr)_repeat(4,3rem)] sm:grid-cols-[minmax(0,1fr)_repeat(4,4rem)]'
    : 'grid-cols-[minmax(0,1fr)_repeat(3,4rem)]';

  const itemMeta = assets?.items[id];
  const itemText = itemTextFor(texts || clientTexts, id, lang);
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
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
        <div className="bg-surface-base border border-border-subtle rounded-lg p-5 mb-5">
          <a href={withLang("/tft/items")} className="inline-flex items-center py-1.5 -my-1.5 text-accent text-sm font-bold hover:underline">← {t('nav.items')}</a>
          <div className="flex items-center gap-4 mt-2">
            {url ? (
              <img src={url} alt={tftLabel(itemMeta, lang)} className="w-16 h-16 rounded-lg border-2 border-accent" />
            ) : (
              <div className="w-16 h-16 rounded-lg bg-surface-overlay" />
            )}
            <div className="flex-1">
              <h1 className="text-white text-2xl font-medium">{tftLabel(itemMeta, lang) || prettyApi(id)}</h1>
              {/* Werte + Wirkung aus den Item-Texten (Set 18: das Bundle hat
                  keine Beschreibung), sonst der Bundle-Text wie vorher. */}
              {itemText ? (
                <>
                  {itemText.stats.length > 0 && <ItemStatLine stats={itemText.stats} className="text-xs mt-1" />}
                  <p className="text-fg-secondary text-xs mt-1 max-w-prose whitespace-pre-line">{itemText.desc}</p>
                </>
              ) : itemMeta?.desc && (
                <p className="text-fg-secondary text-xs mt-1 max-w-prose whitespace-pre-line">{formatTftDesc(itemMeta.desc)}</p>
              )}
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
                        title={tftLabel(compMeta, lang) || compId}
                        className="flex items-center gap-2 bg-surface-raised border border-border-subtle rounded px-2 py-1 hover:border-accent-a50"
                      >
                        {compUrl ? (
                          <img src={compUrl} alt={tftLabel(compMeta, lang)} className="w-8 h-8 rounded" />
                        ) : (
                          <div className="w-8 h-8 rounded bg-surface-overlay" />
                        )}
                        <span className="text-white text-xs">{tftLabel(compMeta, lang) || prettyApi(compId)}</span>
                      </a>
                      {i === 0 && <span className="text-accent text-lg font-medium">+</span>}
                    </div>
                  );
                })}
                <span className="text-accent text-lg font-medium">=</span>
                <div className="flex items-center gap-2 bg-accent-a10 border border-accent-a30 rounded px-2 py-1">
                  {url && <img src={url} alt={tftLabel(itemMeta, lang)} className="w-8 h-8 rounded" />}
                  <span className="text-white text-xs font-medium">{tftLabel(itemMeta, lang) || prettyApi(id)}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-start items-center gap-2 mb-4">
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
          <div className="grid grid-cols-3 gap-3 mb-5">
            <Stat label={t('tft.avgPlacement')} value={data.avgPlacement?.toFixed(2) ?? '—'} />
            <Stat label={t('tft.top4')} value={data.top4Rate != null ? `${(data.top4Rate * 100).toFixed(1)}%` : '—'} />
            <Stat label={t('tft.gamesShort')} value={data.games.toLocaleString('de-DE')} />
          </div>
        )}

        {/* Traeger und Combos nebeneinander, die Comps darunter ueber die volle
            Breite (User 02.11.2026). Fehlt einer der beiden, nimmt der andere die
            ganze Zeile. */}
        {(showCarriers || showCombos) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5 items-start">
              {showCarriers && data && (
                <div className={showCombos ? '' : 'lg:col-span-2'}>
                  <h2 className="text-fg-secondary text-xs uppercase tracking-widest mb-2">{t('tft.item.topCarrier.title')}</h2>
                  {/* Platzhalter, solange die Traeger nachladen (Filter ohne Vorrat, ~3 s). */}
                  <StatsListPending show={carriersPending} e3={false} rows={8} />
                  {/* 1D-Carrier-Tabelle: Carrier × (Avg-Place, Top4%, Games).
                      avgPlacement war schon im Aggregator (sumPlacement/games),
                      vorher nur nicht angezeigt. top4Rate seit 2026-06-19
                      Aggregator-Touch verfügbar — alte Snapshots ohne den
                      Top4-Bucket rendern "—" statt eines erfundenen Werts
                      (feedback_no_fake_values), füllt sich beim nächsten
                      Daily-Crawl auf. */}
                  {!carriersPending && (
                  <div className="bg-surface-raised border border-border-subtle rounded overflow-hidden">
                    <div className={`grid ${carrierCols} gap-2 px-3 py-1.5 text-[10px] uppercase tracking-widest text-fg-muted bg-surface-sunken`}>
                      <div>{t('tft.item.topCarrier.carrier')}</div>
                      <div className="text-right">{t('tft.avgPlacement')}</div>
                      {showDelta && <div className="text-right" title={t('tft.item.holderDelta')}>{t('tft.item.sortDelta')}</div>}
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
                          className={`grid ${carrierCols} gap-2 items-center px-3 py-1.5 text-xs hover:bg-white/5 border-t border-border-subtle`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {churl ? (
                              <img src={churl} alt={tftLabel(ch, lang)} className="w-7 h-7 rounded border-2 object-cover flex-shrink-0" style={{ borderColor: costColorOf(cost) }} />
                            ) : (
                              <div className="w-7 h-7 rounded bg-surface-overlay flex-shrink-0" />
                            )}
                            <span className="text-white truncate">{tftLabel(ch, lang) || prettyChar(u.characterId)}</span>
                          </div>
                          <div className="text-right text-white tabular-nums">{u.avgPlacement?.toFixed(2) ?? '—'}</div>
                          {showDelta && (
                            u.delta != null ? (
                              <div className="text-right font-semibold tabular-nums" style={{ color: holderDeltaColor(u.delta) }} title={t('tft.item.holderDelta')}>
                                {holderDeltaText(u.delta)}
                              </div>
                            ) : <div className="text-right text-fg-muted tabular-nums">—</div>
                          )}
                          <div className="text-right text-[#3ecf8e] tabular-nums">{u.top4Rate != null ? `${(u.top4Rate * 100).toFixed(0)}%` : '—'}</div>
                          <div className="text-right text-fg-muted tabular-nums">{u.games}</div>
                        </a>
                      );
                    })}
                  </div>
                  )}
                </div>
              )}

              {/* Item-Kombinationen (Migration 0115): Item-Sets der 10 meistgespielten Traeger,
                  die das Item enthalten, mit echtem Ø und Top 4 je Set — auch fuer Tank-Items.
                  Die 8 meistgespielten ab 100 Spielen, nach Ø (itemSetCombos). */}
              {showCombos && (
          <div className={`bg-surface-base border border-border-subtle rounded p-4 ${showCarriers ? '' : 'lg:col-span-2'}`}>
            <h2 className="text-fg-secondary text-xs uppercase tracking-widest mb-3">{t('tft.item.combos.title')}</h2>
            <StatsListPending show={combosPending} e3={false} rows={8} />
            <div className="space-y-1.5">
              {itemCombos.map((s, i) => (
                // Handy: schmalere Zahlen-Spalten, sonst quetschen die drei Item-Bilder (390 px: 74 px fuer 96 px Bilder).
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_2.75rem_4.5rem_3rem] gap-2 sm:grid-cols-[1fr_4rem_4rem_4rem] sm:gap-3 items-center bg-surface-raised border border-border-subtle rounded px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    {s.items.map((it, j) => {
                      const im = assets?.items[it];
                      const iurl = tftIconUrl(assets, im?.icon);
                      return iurl ? (
                        <a
                          key={j}
                          href={withLang(`/tft/items/${encodeURIComponent(it)}?bucket=${bucket}`)}
                          onClick={e => e.stopPropagation()}
                          title={tftLabel(im, lang) || it}
                          className="flex-shrink-0 hover:scale-110 transition-transform"
                        >
                          <img src={iurl} alt={tftLabel(im, lang) || it} className={`w-7 h-7 rounded ${it === id ? 'ring-2 ring-accent' : ''}`} />
                        </a>
                      ) : (
                        <div key={j} className="w-7 h-7 flex-shrink-0 rounded bg-surface-overlay" />
                      );
                    })}
                  </div>
                  <div className="text-right text-white tabular-nums text-xs">{s.avgPlacement?.toFixed(2) ?? '—'}</div>
                  <div className="text-right text-[#3ecf8e] tabular-nums text-xs">{s.top4Rate != null ? `${(s.top4Rate * 100).toFixed(0)}% Top 4` : '—'}</div>
                  <div className="text-right text-fg-muted tabular-nums text-xs">{s.games}</div>
                </div>
              ))}
            </div>
          </div>
              )}
            </div>
        )}

        {/* Comps wie im Comps-Reiter (CompFamilyRow), ueber die volle Breite. */}
        {shownFamilies.length > 0 && (
          <section className="mb-5">
            <h2 className="text-fg-secondary text-xs uppercase tracking-widest mb-2">{t('tft.compsWithItem')}</h2>
            <CompFamilyListHeader t={t} sort={compSort} onSort={setCompSort} />
            <div className="space-y-1.5">
              {shownFamilies.map((f, i) => (
                <CompFamilyRow
                  key={f.familyKey}
                  family={f}
                  rank={i + 1}
                  assets={assets}
                  region={region}
                  bucket={bucket}
                  days={days}
                  patch="current"
                  end={comps?.dataEnd ?? null}
                />
              ))}
            </div>
          </section>
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
                      <img src={sUrl} alt={tftLabel(v, lang)} className="w-8 h-8 rounded" />
                    ) : (
                      <div className="w-8 h-8 rounded bg-surface-overlay" />
                    )}
                    <span className="text-white text-[11px] truncate">{tftLabel(v, lang)}</span>
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
