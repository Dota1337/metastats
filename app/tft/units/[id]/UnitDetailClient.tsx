'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import TierFilter, { type TierBucket } from '../../../components/tft/TierFilter';
import { detailFiltersFrom, detailKey } from '../../../lib/tft-detail-filters';
import type { UnitDetailInitial } from '../../../lib/seo/detail-data';
import EmptyData from '../../../components/tft/EmptyData';
import { useI18n } from '../../../lib/i18n';
import { loadTftAssets, tftIconUrl, tftChampionTileUrl, tftTraitDisplayName, type TftAssetsBundle } from '../../../lib/tft-cdragon';
import { buildExplorerUrl } from '../../../lib/tft-explorer-url';
import { dataEndOf, unitListFamilies, type CompApiRow } from '../../../lib/tft-comp-families';
import { loadUnitInfo, type UnitInfoFile } from '../../../lib/tft-unit-info';
import { costColor } from '../../../lib/tft-ui';
import CompFamilyRow from '../../../components/tft/CompFamilyRow';
import CompFamilyListHeader from '../../../components/tft/CompFamilyListHeader';
import UnitAbilityCard from '../../../components/tft/unit/UnitAbilityCard';
import UnitBuilds from '../../../components/tft/unit/UnitBuilds';
import { ItemSlotsCard, StarDistCard, TimelineCard, type TimelinePoint } from '../../../components/tft/unit/UnitSideCards';
import { UNIT_DEFAULT_FILTERS, useUnitExplorer, type UnitExplorerFilters } from '../../../components/tft/unit/useUnitExplorer';

type SlotEntry = { item: string; count: number };
type SlotData = { total: number; entries: SlotEntry[] };

interface UnitDetail {
  characterId: string;
  games: number;
  avgPlacement: number | null;
  top4Rate: number | null;
  top1Rate: number | null;
  itemSlotsByTier: Record<string, Record<string, SlotData>> | null;
  /** Kopien je Stern — Standard-Stern der Item-Plaetze. */
  starGames: Record<string, number> | null;
  /** Startdaten ohne Item-Bloecke: der Browser laedt sie nach. */
  itemsPending?: boolean;
}

type CompsState = { rows: CompApiRow[]; dataEnd: string | null };

// Unit-Detailseite (Umbau 19.10.2026 nach dem Vorbild metatft.com/units):
// Kopf mit Kernzahlen → Seitenleiste (Faehigkeit | Werte, Sterne, Item-Plaetze,
// Verlauf) + Hauptteil (Empfehlungen, Build-/Item-Tabellen aus dem Explorer)
// → Comps mit dieser Unit wie im Comps-Reiter.
//
// `initial`: Startdaten der Server-Huelle (page.tsx) fuer die Filter der
// Adresse — Kernzahlen und Comp-Zeilen jeweils mit der Antwort, die die API
// gaebe, oder null (dann fragt die Seite selbst). `info`: Faehigkeit + Werte.
export default function TftUnitDetailPage({ initial, info: initialInfo }: { initial: UnitDetailInitial | null; info: UnitInfoFile | null }) {
  const { t, withLang } = useI18n();
  const params = useParams();
  const search = useSearchParams();
  const id = decodeURIComponent(String(params?.id || ''));
  // Region + Zeitraum aus der Liste uebernehmen (Defaults wie dort).
  const { region, days, bucket: initialBucket } = detailFiltersFrom(search);
  const [bucket, setBucket] = useState<TierBucket>(initialBucket);
  const [data, setData] = useState<UnitDetail | null | undefined>(
    () => initial?.detail ? ((initial.detail.unit as UnitDetail | undefined) || null) : undefined);
  const [hasData, setHasData] = useState<boolean | null>(() => initial?.detail ? !!initial.detail.hasData : null);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(() => initial?.assets ?? null);
  const [comps, setComps] = useState<CompsState | null>(() => initial?.comps ?? null);
  const [info, setInfo] = useState<UnitInfoFile | null>(initialInfo);
  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
  const [filters, setFilters] = useState<UnitExplorerFilters>(UNIT_DEFAULT_FILTERS);
  const explorer = useUnitExplorer(id, region, bucket, filters);

  const initialPending = !!(initial?.detail?.unit as UnitDetail | undefined)?.itemsPending;
  // Filter-Schluessel der gezeigten Daten je Block: gleich → kein Abruf.
  const shownDetail = useRef<string | null>(initial?.detail && !initialPending ? initial.key : null);
  const shownComps = useRef<string | null>(initial?.comps ? initial.key : null);
  // Geladene Staende je Schluessel, Startdaten zaehlen mit: zurueck auf einen
  // schon gezeigten Rang → keine neue Abfrage.
  const loadedDetail = useRef(new Map<string, { hasData: boolean; unit: UnitDetail | null }>(
    initial?.detail && !initialPending ? [[initial.key, { hasData: !!initial.detail.hasData, unit: (initial.detail.unit as UnitDetail | undefined) || null }]] : []));
  const loadedComps = useRef(new Map<string, CompsState>(initial?.comps ? [[initial.key, initial.comps]] : []));
  const selectBucket = (next: TierBucket) => {
    const k = detailKey(id, { region, bucket: next, days });
    const d = loadedDetail.current.get(k);
    if (d && shownDetail.current !== k) { shownDetail.current = k; setHasData(d.hasData); setData(d.unit); }
    const c = loadedComps.current.get(k);
    if (c && shownComps.current !== k) { shownComps.current = k; setComps(c); }
    setBucket(next);
  };

  // Das volle Bundle ersetzt den Ausschnitt der Startdaten; scheitert der
  // Abruf, bleibt der Ausschnitt stehen.
  useEffect(() => { loadTftAssets().then(b => { if (b) setAssets(b); }); }, []);
  useEffect(() => { if (!initialInfo) loadUnitInfo().then(setInfo); }, [initialInfo]);
  useEffect(() => {
    fetch(`/api/tft/unit-history?characterId=${encodeURIComponent(id)}&bucket=${bucket}&patches=5`)
      .then(r => r.ok ? r.json() : { timeline: [] })
      .then(d => setTimeline(d.timeline || []))
      .catch(() => setTimeline([]));
  }, [id, bucket]);
  useEffect(() => {
    // Alte Antworten nach einem Rangwechsel verwerfen.
    let cancelled = false;
    const key = detailKey(id, { region, bucket, days });
    if (shownDetail.current !== key) {
      fetch(`/api/tft/units?region=${region}&bucket=${bucket}&days=${days}&id=${encodeURIComponent(id)}`)
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then(d => {
          if (cancelled) return;
          const v = { hasData: !!d.hasData, unit: (d.unit as UnitDetail | undefined) || null };
          loadedDetail.current.set(key, v);
          shownDetail.current = key;
          setHasData(v.hasData);
          setData(v.unit);
        })
        .catch(() => {
          if (cancelled) return;
          shownDetail.current = null;
          if (initialPending && key === initial?.key) { setData(d => (d ? { ...d, itemsPending: false } : d)); return; }
          setHasData(false); setData(null);
        });
    }
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
        .catch(() => { if (cancelled) return; shownComps.current = null; setComps(null); });
    }
    return () => { cancelled = true; };
  }, [bucket, id, region, days]);

  const champ = assets?.champions[id];
  const unitName = champ?.name || prettyChar(id);
  // Comps wie im Comps-Reiter: dieselben Familien, nur die mit dieser Unit im Brett.
  const families = useMemo(() => (comps ? unitListFamilies(comps.rows, assets, id) : []), [comps, assets, id]);
  const splash = tftIconUrl(assets, champ?.icon);
  const tile = tftChampionTileUrl(assets, champ);

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav active="units" />
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-5">
        {/* Kopf */}
        <section className="relative overflow-hidden rounded-xl border border-border-subtle bg-surface-base mb-4">
          {splash && (
            <img src={splash} alt="" aria-hidden="true" className="absolute inset-y-0 right-0 w-full md:w-3/4 h-full object-cover object-[center_20%] opacity-60" />
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-surface-base via-surface-base/85 to-surface-base/20" aria-hidden="true" />
          <div className="relative p-4 sm:p-6">
            <a href={withLang('/tft/units')} className="text-accent text-xs hover:underline">← {t('nav.units')}</a>
            <div className="flex flex-col md:flex-row md:items-end gap-4 md:gap-6 mt-3">
              <div className="flex items-center gap-4 min-w-0 flex-1">
                <div className="relative shrink-0">
                  {tile ? (
                    <img src={tile} alt={unitName} className="w-20 h-20 rounded-lg border-2 object-cover" style={{ borderColor: champ ? costColor(champ.cost) : undefined }} />
                  ) : (
                    <div className="w-20 h-20 rounded-lg bg-surface-overlay" />
                  )}
                  {champ?.cost ? (
                    <span
                      className="absolute -bottom-1.5 -right-1.5 min-w-[1.5rem] h-6 px-1 rounded-md text-[12px] font-bold flex items-center justify-center text-[#11151c] border border-surface-base"
                      style={{ background: costColor(champ.cost) }}
                    >
                      {champ.cost}
                    </span>
                  ) : null}
                </div>
                <div className="min-w-0">
                  <h1 className="text-white text-2xl sm:text-3xl font-semibold leading-tight truncate">{unitName}</h1>
                  {champ?.traits?.length ? (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {champ.traits.map(tr => {
                        const icon = tftIconUrl(assets, assets?.traits[tr]?.icon);
                        return (
                          <a
                            key={tr}
                            href={withLang(`/tft/traits/${encodeURIComponent(tr)}`)}
                            className="inline-flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-full bg-surface-raised/80 border border-border-subtle text-[12px] text-fg-secondary hover:text-white hover:border-accent-a60 transition-colors"
                          >
                            {icon && <img src={icon} alt="" className="w-4 h-4" />}
                            {tftTraitDisplayName(assets, tr) || prettyChar(tr)}
                          </a>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </div>
              {data && (
                <div className="grid grid-cols-4 gap-2 sm:gap-3 md:w-[26rem] shrink-0">
                  <HeroStat label={t('tft.avgPlacement')} value={data.avgPlacement?.toFixed(2) ?? '—'} />
                  <HeroStat label={t('tft.top4')} value={data.top4Rate != null ? `${(data.top4Rate * 100).toFixed(1)}%` : '—'} />
                  <HeroStat label={t('tft.top1')} value={data.top1Rate != null ? `${(data.top1Rate * 100).toFixed(1)}%` : '—'} />
                  <HeroStat label={t('tft.gamesShort')} value={data.games.toLocaleString('de-DE')} />
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 mt-4">
              <a
                href={withLang(buildExplorerUrl({ units: [id], bucket, region }))}
                className="px-2.5 py-1.5 rounded text-xs bg-surface-raised border border-border-subtle text-fg-secondary hover:text-white hover:border-accent-a60 transition-colors flex items-center gap-1.5"
                title={t('tft.drill.openInExplorer')}
              >
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <circle cx="4.5" cy="4.5" r="3" />
                  <line x1="6.6" y1="6.6" x2="9.5" y2="9.5" strokeLinecap="round" />
                </svg>
                <span className="hidden sm:inline">{t('tft.drill.openInExplorer')}</span>
              </a>
              <TierFilter value={bucket} onChange={selectBucket} />
            </div>
          </div>
        </section>

        {hasData === false && <EmptyData />}
        {data === null && hasData && (
          <div className="text-fg-secondary text-center py-8">{t('tft.unit.notFound')}</div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[20rem_minmax(0,1fr)] gap-4 items-start">
          <aside className="space-y-4 order-2 lg:order-1">
            <UnitAbilityCard unitId={id} info={info} assets={assets} />
            <StarDistCard
              unitId={id}
              stars={explorer.stars}
              active={filters.star}
              onPick={s => setFilters({ ...filters, star: s })}
            />
            <ItemSlotsCard slotsByTier={data?.itemSlotsByTier} starGames={data?.starGames} star={filters.star} assets={assets} />
            <TimelineCard timeline={timeline} />
          </aside>
          <div className="order-1 lg:order-2 min-w-0">
            <UnitBuilds
              unitId={id}
              unitName={unitName}
              region={region}
              bucket={bucket}
              assets={assets}
              data={explorer}
              filters={filters}
              setFilters={setFilters}
            />
          </div>
        </div>

        {families.length > 0 && (
          <section className="mt-6">
            <h2 className="text-white text-[16px] font-semibold mb-2">{t('tft.compsWithUnit')}</h2>
            <CompFamilyListHeader t={t} />
            <div className="space-y-1.5">
              {families.map((f, i) => (
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
      </div>
      <Footer />
    </main>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-raised/80 border border-border-subtle rounded-lg px-2 py-2 sm:px-3 text-center backdrop-blur-sm">
      <div className="text-white text-[15px] sm:text-lg font-semibold tabular-nums leading-tight">{value}</div>
      <div className="text-fg-muted text-[10px] sm:text-[11px] mt-0.5 truncate">{label}</div>
    </div>
  );
}

function prettyChar(s: string) { return s.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, ''); }
