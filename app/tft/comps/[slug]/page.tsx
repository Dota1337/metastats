'use client';
import { useEffect, useState } from 'react';
import { withAlpha } from '../../../lib/color';
import { CURRENT_SET } from '../../../lib/current-set';
import { useParams, useRouter, useSearchParams, usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import TierFilter, { type TierBucket, tierBucketFromParam } from '../../../components/tft/TierFilter';
import EmptyData from '../../../components/tft/EmptyData';
import ApiUnavailable from '../../../components/ApiUnavailable';
import CompCard from '../../../components/tft/CompCard';
import { useI18n, type TranslationKey } from '../../../lib/i18n';
import { loadTftAssets, tftIconUrl, tftChampionTileUrl, findChampion, findItem, type TftAssetsBundle } from '../../../lib/tft-cdragon';
import CompBoardPanel, { type CompBoardParams } from '../../../components/tft/CompBoardPanel';
import VariantsSwitcher from '../../../components/tft/VariantsSwitcher';
import CompActiveTraits from '../../../components/tft/CompActiveTraits';
import CompLevelActiveTraits from '../../../components/tft/CompLevelActiveTraits';
import { GuideAugments, GuideEarlyGame, GuideCarouselPicks, GuideLevelPlan } from '../../../components/tft/CompGuide';
import CompJumpBar from '../../../components/tft/CompJumpBar';
import CompFlexUnits from '../../../components/tft/CompFlexUnits';
import { OutcomePlacement, OutcomeItems, OutcomeUnitEffect, OutcomeEndLevel } from '../../../components/tft/CompOutcome';

// Recharts-Komponenten lazy via next/dynamic — sparen ~95 KB Bundle aus
// initial-Load der Detail-Page (perf-critic-Verdict 2026-06-21). Skeleton
// matched die Chart-Höhe damit kein Layout-Shift entsteht. ssr:false weil
// Recharts ResizeObserver braucht — kein Server-Render möglich.
const CompTrendChart = dynamic(() => import('../../../components/tft/CompTrendChart'), {
  ssr: false,
  loading: () => <ChartSkeleton height={220} className="mt-5 rounded-lg" />,
});
const CompEconChart = dynamic(() => import('../../../components/tft/CompEconChart'), {
  ssr: false,
  loading: () => <ChartSkeleton height={260} className="mt-5 rounded" />,
});
const CompDeathChart = dynamic(() => import('../../../components/tft/CompDeathChart'), {
  ssr: false,
  loading: () => <ChartSkeleton height={220} className="rounded" />,
});

function ChartSkeleton({ height, className = '' }: { height: number; className?: string }) {
  return (
    <div
      className={`bg-surface-base border border-border-subtle ${className}`}
      style={{ height }}
      aria-hidden="true"
    />
  );
}
import { formatStage } from '../../../lib/tft-stage';
import { aggregateComponents } from '../../../lib/tft-components';
import { compDefiningAugmentApiNameFromSlug, shownAugmentSlug } from '../../../lib/tft-comp-defining-augments';
import { dedupeByPrimaryCluster, primaryClusterKey, parseClusterKey } from '../../../lib/tft-cluster';
import { loadCompGuidesBundle, findCompGuide } from '../../../lib/tft-comp-guides';
import { descriptorTag } from '../../../lib/tft-comp-descriptor';
import { computeRoles, namedCarries, shownItems, componentCheckFromItems } from '../../../lib/tft-comp-roles';

// Sample-Validity-Gate: Cards unter dieser Games-Schwelle werden dezent
// grayed-out + Low-Sample-Badge bekommen (data-skeptic-Befund 2026-06-21:
// Section-Gate ≥2 Rows reicht NICHT — pro Card-Sample-Validität auch nötig
// damit der User Noise-Cards visuell unterscheidet von belastbaren).
const MIN_GAMES_PER_OUTCOME_CARD = 30;

// Same region set as /tft/patch/winners — the regions where the daily-crawl
// has enough volume to make comp-detail rendering meaningful.
const REGIONS = [
  { value: 'all',  label: 'tft.filter.allRegions' },
  { value: 'euw1', label: 'EUW' },
  { value: 'kr',   label: 'KR' },
  { value: 'na1',  label: 'NA' },
  { value: 'eun1', label: 'EUNE' },
  { value: 'br1',  label: 'BR' },
  { value: 'jp1',  label: 'JP' },
] as const;

export default function TftCompDetailPage() {
  const { t } = useI18n();
  const params = useParams();
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const slug = decodeURIComponent(String(params?.slug || ''));
  const [region, setRegion] = useState<string>(search.get('region') || 'all');
  const [bucket, setBucket] = useState<TierBucket>(tierBucketFromParam(search.get('bucket')));
  // Variant-Mode: family (default — alle Sub-Cluster der Family aggregiert) oder
  // exact (Single-Sub-Cluster). Wird live aus searchParams gelesen, damit der
  // Toggle im VariantsSwitcher ohne Page-Reload reagiert.
  const variantMode = search.get('variant') === 'exact' ? 'exact' : 'family';
  // Zeitraum aus der Liste uebernehmen (1/3/7 Tage, Default 3 wie dort),
  // damit Liste und Detail dieselben Zahlen zeigen.
  const days = Math.max(1, Math.min(7, parseInt(search.get('days') || '3', 10) || 3));

  useEffect(() => {
    if (!pathname) return;
    const next = new URLSearchParams(search.toString());
    if (region === 'all') next.delete('region'); else next.set('region', region);
    if (bucket === 'master_plus') next.delete('bucket'); else next.set('bucket', bucket);
    const q = next.toString();
    // Sprungmarke (#abschnitt) behalten — sonst verliert ein geteilter Link sie
    // beim ersten Abgleich der Filter mit der URL.
    router.replace((q ? `${pathname}?${q}` : pathname) + window.location.hash, { scroll: false });
  }, [region, bucket, pathname, router, search]);

  const [comp, setComp] = useState<any | null | undefined>(undefined);
  // Filterstand, zu dem `comp` geladen wurde. Beim Filterwechsel bleibt die alte
  // Comp stehen, bis die neue da ist — das Aufstellungsbrett fragt mit diesem
  // Stand ab, nie mit neuen Filtern und alten Carries (perf-critic 2026-10-10),
  // und bleibt dabei stehen statt kurz zu verschwinden.
  const [compFilters, setCompFilters] = useState<{ slug: string; region: string; bucket: string; days: number } | null>(null);
  const [proComp, setProComp] = useState<any | null>(null);
  // Drei Zustaende statt boolean: 'empty' heisst "es gibt wirklich keine Daten",
  // 'error' heisst "die Antwort ist ausgeblieben" (RPC-Timeout, 5xx). Vorher
  // wurde beides zu hasData:false und die Seite behauptete "Keine Daten",
  // obwohl der Datensatz existiert.
  const [dataState, setDataState] = useState<'loading' | 'ok' | 'empty' | 'error'>('loading');
  const [reloadKey, setReloadKey] = useState(0);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  const [compGuidesBundle, setCompGuidesBundle] = useState<Awaited<ReturnType<typeof loadCompGuidesBundle>> | null>(null);
  const [trendDays, setTrendDays] = useState<14 | 30>(14);
  const [trendPoints, setTrendPoints] = useState<Array<{
    day: string; games: number; avgPlacement: number | null; top4Rate: number | null; top1Rate: number | null; patch?: string | null;
  }>>([]);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);
  useEffect(() => { loadCompGuidesBundle().then(setCompGuidesBundle); }, []);

  useEffect(() => {
    let cancelled = false;
    const familySlugs = variantMode === 'family' && comp?.aliasedFromFamily?.mergedFrom?.length > 1
      ? `&familySlugs=${[...comp.aliasedFromFamily.mergedFrom].sort().map((s: string) => encodeURIComponent(s)).join(',')}`
      : '';
    fetch(`/api/tft/comps/trend?slug=${encodeURIComponent(slug)}&region=${region}&bucket=${bucket}&days=${trendDays}&variant=${variantMode}${familySlugs}`)
      .then(r => r.ok ? r.json() : { points: [] })
      .then(d => { if (!cancelled) setTrendPoints(d.points || []); })
      .catch(() => { if (!cancelled) setTrendPoints([]); });
    return () => { cancelled = true; };
  }, [slug, region, bucket, trendDays, variantMode, comp]);

  useEffect(() => {
    // cancelled-Guard vor JEDEM Setter: der Detail-RPC laeuft je nach Bucket
    // zwischen 0,1 s (Snapshot) und ~19 s (live). Ohne Guard ueberschreibt die
    // spaete Antwort des alten Buckets den bereits geladenen neuen.
    let cancelled = false;
    setDataState('loading');
    Promise.all([
      fetch(`/api/tft/comps?region=${region}&bucket=${bucket}&slug=${encodeURIComponent(slug)}&days=${days}&minGames=30&variant=${variantMode}`)
        .then(r => { if (!r.ok) throw new Error(`comps ${r.status}`); return r.json(); }),
      fetch(`/api/tft/comps?region=all&bucket=pro_pool&slug=${encodeURIComponent(slug)}&days=${days}&minGames=5&variant=${variantMode}`)
        .then(r => r.ok ? r.json() : { comp: null })
        .catch(() => ({ comp: null })),
    ]).then(([normal, pro]) => {
      if (cancelled) return;
      setDataState(normal.hasData ? 'ok' : 'empty');
      setComp(normal.comp || null);
      setCompFilters({ slug, region, bucket, days });
      setProComp(pro.comp || null);
    }).catch(() => {
      if (cancelled) return;
      setDataState('error');
      setComp(null);
      setProComp(null);
    });
    return () => { cancelled = true; };
  }, [bucket, slug, region, days, variantMode, reloadKey]);

  // Patch-Drop-Erkennung im Trend: wenn die Reihe einen Patch-Wechsel enthält,
  // setze eine ReferenceLine an dem Tag wo der Wechsel passiert. Visualisiert
  // dem User dass ein Knick in der Trend-Kurve aus Pre-Patch-Daten kommt und
  // KEINE echte Comp-Schwankung ist (data-skeptic-Verdict 2026-06-21).
  const patchBoundary = (() => {
    if (!trendPoints || trendPoints.length < 2) return null;
    let prev: string | null | undefined = null;
    for (const p of trendPoints) {
      const cur = (p as any).patch;
      if (prev != null && cur != null && cur !== prev) {
        return { day: p.day, patch: cur };
      }
      if (cur != null) prev = cur;
    }
    return null;
  })();

  // Carries an den Items erkannt (tft-comp-roles), wie Liste und Kopfzeile —
  // der Key-Carry lag bei Zwei-Carry-Comps oft auf der falschen Unit.
  const compIsComponent = componentCheckFromItems(assets?.items);
  const compRoles = comp
    ? computeRoles(comp.typicalUnits, comp.games, { set: assets?.set, isComponent: compIsComponent, keyCarry: parseClusterKey(comp.clusterKey)?.carry })
    : null;
  const namedCompCarries: string[] = compRoles ? namedCarries(compRoles, parseClusterKey(comp.clusterKey)?.carry) : [];
  const leadCarry: string | null = namedCompCarries[0] || null;

  // Guide (MetaTFT) zur Comp: Augments, Early Game, Carousel-Picks, Levelplan.
  // Die Teile stehen seit 2026-10-10 an verschiedenen Orten der Seite.
  const guideParts = comp ? parseClusterKey(comp.clusterKey) : null;
  const guideMatch = comp && guideParts
    ? findCompGuide(compGuidesBundle, { trait: guideParts.trait, carry: guideParts.carry },
        (comp.typicalUnits || []).map((u: { characterId: string }) => u.characterId), namedCompCarries)
    : null;
  const guide = guideMatch?.guide ?? null;

  // Aufstellungsbrett oben (wie Liste und App, /api/tft/comps/board). Dieselbe
  // MetaTFT-Comp wie Augments, Early Game und Levelplan der Seite — sonst
  // stammten Brett und Levelplan aus verschiedenen Comps. Erst abfragen, wenn
  // die Anleitungen geladen sind (sonst zwei Abrufe: erst ohne, dann mit Guide),
  // und immer mit dem Filterstand, zu dem `comp` gehoert.
  const boardParams: CompBoardParams | null = comp && compRoles && compGuidesBundle && compFilters
    ? {
        slug: compFilters.slug, patch: 'current', bucket: compFilters.bucket, days: compFilters.days, region: compFilters.region,
        carries: [...new Set([...compRoles.carries, ...(compRoles.itemCarriers || [])])].filter(Boolean).slice(0, 6),
        // Wie CompRow: ohne Anleitungs-Datei ordnet die Route selbst zu.
        guide: compGuidesBundle.bundle ? guideMatch?.slug ?? null : undefined,
      }
    : null;
  const hasOutcomeItems: boolean = !!comp?.outcome
    && (comp.outcome.units || []).some((u: { itemCopies: number; items: unknown[] }) => u.itemCopies > 0 && u.items.length > 0);

  // Carry-Star-Outcome — Reroll-Entscheidung Stage 3-5/3-6. Wird zweimal
  // gerendert: am Handy oben ueber den Spalten, am PC oben in der rechten Spalte.
  const carryStarBox = comp && comp.carryStarOutcome && comp.carryStarOutcome.length >= 2 ? (() => {
    const totalGames = (comp.carryStarOutcome as { games: number }[]).reduce((s: number, x: { games: number }) => s + x.games, 0);
    if (totalGames === 0) return null;
    return (
      <section className="mt-5 bg-surface-base border border-border-subtle rounded p-4">
        <h2 className="text-fg-secondary text-xs uppercase tracking-widest mb-3">{t('tft.comp.carryStarOutcome')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-3">
          {(comp.carryStarOutcome as { star: number; games: number; avgPlacement: number; top4Rate: number; top1Rate: number }[]).map((row) => {
            const share = totalGames > 0 ? (row.games / totalGames) * 100 : 0;
            // Star-Color: 1=grau, 2=gold, 3=prismatic, 4=chromatic
            // (Set-14-Mechanik: Sona Command Mods + Aurelion Sol Quest Rewards)
            const starColor = row.star === 4 ? '#e75480'
              : row.star === 3 ? '#c39bff'
              : row.star === 2 ? '#e0c75a'
              : '#9ab0bf';
            const lowSample = row.games < MIN_GAMES_PER_OUTCOME_CARD;
            return (
              <div
                key={row.star}
                className="bg-surface-raised border rounded p-3"
                style={{ borderColor: `${withAlpha(starColor, 0x40)}`, opacity: lowSample ? 0.55 : 1 }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-base font-medium" style={{ color: starColor }}>
                    {'★'.repeat(row.star)}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {lowSample && (
                      <span
                        className="text-[8px] uppercase tracking-wider px-1 py-[1px] rounded"
                        style={{ color: '#e0a040', backgroundColor: 'rgba(224,160,64,0.12)', border: '1px solid rgba(224,160,64,0.35)' }}
                        title={`${row.games} ${t('tft.gamesShort')} < ${MIN_GAMES_PER_OUTCOME_CARD}`}
                      >
                        {t('tft.comp.lowSample')}
                      </span>
                    )}
                    <span className="text-fg-muted text-[10px] tabular-nums">
                      {share.toFixed(0)}% · {row.games}
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-1 text-[11px] tabular-nums">
                  <div>
                    <div className="text-fg-muted text-[9px] uppercase tracking-widest">{t('tft.avgPlacement')}</div>
                    <div className="text-white text-base font-medium">{row.avgPlacement.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-fg-muted text-[9px] uppercase tracking-widest">{t('tft.top4')}</div>
                    <div className="text-white">{(row.top4Rate * 100).toFixed(0)}%</div>
                  </div>
                  <div>
                    <div className="text-fg-muted text-[9px] uppercase tracking-widest">{t('tft.top1')}</div>
                    <div className="text-white">{(row.top1Rate * 100).toFixed(0)}%</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    );
  })() : null;

  // Bauteil-Prioritaet aus den Carry-Items plus die Carousel-Picks der ersten
  // Runde aus dem Guide — frueher zwei Boxen (User 2026-10-10: Doppeltes
  // zusammenlegen). Antwortet: „welches Bauteil zuerst greifen?"
  const componentsBox = comp ? (() => {
    const components = comp.carryItems && comp.carryItems.length > 0 && assets
      ? aggregateComponents(comp.carryItems, assets, 6)
      : [];
    const picks = guide && guide.carousel.length > 0 ? guide : null;
    if (components.length === 0 && !picks) return null;
    return (
      <section className="mt-5 bg-surface-base border border-border-subtle rounded p-4">
        <h2 className="text-fg-secondary text-xs uppercase tracking-widest mb-3">{t('tft.comp.componentPriority')}</h2>
        {components.length > 0 && assets && (
          <div className="flex flex-wrap gap-2">
            {components.map((c, i) => {
              const meta = assets.items[c.component];
              const url = tftIconUrl(assets, meta?.icon);
              const pct = (c.weight * 100).toFixed(0);
              const fromItemsTitle = c.fromItems
                .slice(0, 4)
                .map(it => assets.items[it]?.name || it.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?(?:Item_)?/, ''))
                .join(' · ');
              return (
                <a
                  key={c.component}
                  href={`/tft/items/${encodeURIComponent(c.component)}?bucket=${bucket}`}
                  title={`${meta?.name || c.component} — ${t('tft.comp.componentInItems')}: ${fromItemsTitle}`}
                  className="flex flex-col items-center w-16 hover:scale-105 transition-transform"
                >
                  <div className="relative">
                    {url ? (
                      <img src={url} alt={meta?.name || ''} className="w-12 h-12 rounded border-2" style={{ borderColor: i === 0 ? '#e0c75a' : 'var(--border-subtle)' }} />
                    ) : (
                      <div className="w-12 h-12 rounded bg-surface-overlay" />
                    )}
                    {i === 0 && (
                      <span className="absolute -top-1 -right-1 text-[9px] bg-[#e0c75a] text-surface-base px-1 rounded font-bold">1</span>
                    )}
                  </div>
                  <div className="text-white text-[10px] mt-1 truncate max-w-full">
                    {meta?.name?.split(' ').pop() || c.component.split('_').pop()}
                  </div>
                  <div className="w-full h-1 bg-surface-overlay rounded mt-1 overflow-hidden">
                    <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="text-fg-secondary text-[10px] tabular-nums">{pct}%</div>
                </a>
              );
            })}
          </div>
        )}
        {picks && (
          <div className={components.length > 0 ? 'mt-4' : ''}>
            <div className="text-fg-muted text-[10px] uppercase tracking-widest mb-2">{t('tft.comp.carousel')}</div>
            <GuideCarouselPicks guide={picks} assets={assets} />
          </div>
        )}
      </section>
    );
  })() : null;

  // Leveln in einer Box (User 2026-10-10: vorher vier Boxen) — Levelplan aus dem
  // Guide, Kennzahlen, Endlevel der Boards in Stage 5, ROI je Level zugeklappt.
  const levelingBox = comp ? (() => {
    const lt = (comp.levelingTempo || []) as { level: number; share: number | null; avgLastRound: number | null; games: number }[];
    const validLt = lt.filter(p => p.share != null && p.games >= 10);
    const capLevel = validLt.length > 0
      ? validLt.reduce((b, p) => (p.share ?? 0) > (b.share ?? 0) ? p : b)
      : null;
    const parts = parseClusterKey(comp.clusterKey);
    const carryChamp = leadCarry && assets ? assets.champions[leadCarry] : null;
    const tag = descriptorTag({
      avgLevel: comp.avgLevel,
      top1Rate: comp.top1Rate,
      top4Rate: comp.top4Rate,
      carryCost: carryChamp?.cost,
      carryStar: parts?.carryStar,
    });
    const hasStats = comp.avgLevel != null || comp.avgLastRound != null || lt.length >= 2;
    const roiData = lt.length >= 2
      ? validLt.map(p => ({
          label: `Lvl ${p.level}`,
          share: Math.round((p.share || 0) * 100),
          avgRound: p.avgLastRound,
          avgStage: p.avgLastRound != null ? formatStage(p.avgLastRound) : '—',
        }))
      : [];
    const hasEndLevel = (comp.outcome?.levelsStage5?.length ?? 0) >= 2;
    if (!hasStats && !hasEndLevel && !guide && roiData.length === 0) return null;
    return (
      <section id="cj-leveling" data-jump="leveling" className="mt-5 scroll-mt-16 bg-surface-base border border-border-subtle rounded p-4">
        <h2 className="text-fg-secondary text-xs uppercase tracking-widest mb-3">{t('tft.comp.leveling')}</h2>
        <div className="space-y-4">
          {guide && <GuideLevelPlan guide={guide} />}
          {hasStats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 gap-2">
              <Stat label={t('tft.comp.avgLevel')} value={comp.avgLevel != null ? comp.avgLevel.toFixed(1) : '—'} />
              <Stat label={t('tft.comp.avgLastRound')} value={comp.avgLastRound != null ? formatStage(comp.avgLastRound) : '—'} />
              <Stat label={t('tft.comp.tempo')} value={tag?.label ?? '—'} />
              {capLevel && (
                <Stat label={t('tft.comp.capLevel')} value={`Lvl ${capLevel.level}`} />
              )}
              {capLevel?.avgLastRound != null && (
                <Stat label={t('tft.comp.capReach')} value={formatStage(capLevel.avgLastRound)} />
              )}
              {comp.avgGoldLeft != null && (
                <Stat label={t('tft.avgGoldLeft')} value={comp.avgGoldLeft.toFixed(1)} />
              )}
            </div>
          )}
          {comp.outcome && <OutcomeEndLevel outcome={comp.outcome} t={t} bare />}
          {roiData.length > 0 && <RoiDetails chartData={roiData} label={t('tft.comp.econRoi')} />}
        </div>
      </section>
    );
  })() : null;

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav active="comps" />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <a href="/tft/comps" className="text-accent text-xs hover:underline">← {t('nav.comps')}</a>

        <div className="flex flex-wrap items-center justify-end gap-2 mt-2 mb-4">
          <a
            href={`/tft/comps?compareA=${encodeURIComponent(slug)}`}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-surface-raised border border-border-subtle text-fg-secondary hover:text-white hover:border-accent-a50 text-xs transition-colors"
            title={t('tft.compare.fromDetail')}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="17 1 21 5 17 9" />
              <path d="M3 11V9a4 4 0 0 1 4-4h14" />
              <polyline points="7 23 3 19 7 15" />
              <path d="M21 13v2a4 4 0 0 1-4 4H3" />
            </svg>
            <span className="hidden sm:inline">{t('tft.compare.fromDetail')}</span>
          </a>
          <TierFilter value={bucket} onChange={setBucket} />
          <select
            value={region}
            onChange={e => setRegion(e.target.value)}
            className="bg-surface-raised border border-border-subtle rounded text-white text-xs px-2 py-1.5"
            aria-label={t('tft.filter.region')}
          >
            {REGIONS.map(r => (
              <option key={r.value} value={r.value}>
                {r.value === 'all' ? t(r.label as TranslationKey) : r.label}
              </option>
            ))}
          </select>
        </div>

        {dataState === 'empty' && <EmptyData />}
        {dataState === 'error' && (
          <ApiUnavailable
            messageKey="error.temporarilyUnavailable"
            onRetry={() => setReloadKey(k => k + 1)}
          />
        )}
        {comp === null && dataState === 'ok' && (
          <div className="text-fg-secondary text-center py-8">{t('tft.comp.notFound')}</div>
        )}

        {comp && (
          <div id="cj-root">
            {/* ═══════════════════════════════════════════════════════════
                Kopf, volle Breite: Name + Board mit Core/Flex (CompCard).
                Direkt darunter das Wichtigste wie in der App (User
                2026-10-10, „Positionen, Itemization etc. weiter nach oben"):
                links Aufstellung + Leveln, rechts Items; am Handy Aufstellung,
                Items, Leveln. Dann Varianten, Synergien und zwei Spalten
                (Variante D): links „In der Runde", rechts „Strategie", danach
                die Analyse. Am Handy erst links, dann rechts — das
                3★-Ergebnis steht dort deshalb zusaetzlich nach dem Raster.
                ═══════════════════════════════════════════════════════════ */}
            <CompCard comp={comp} assets={assets} />

            <CompJumpBar rootId="cj-root" />

            <div className="lg:grid lg:grid-cols-2 lg:grid-rows-[auto_1fr] lg:gap-x-6 lg:items-start">
              <div id="cj-positioning" data-jump="positioning" className="scroll-mt-16 min-w-0 lg:col-start-1 lg:row-start-1">
                {boardParams && (
                  <CompBoardPanel id="cj-board" params={boardParams} assets={assets} framed showPlan={false} hideWhenEmpty />
                )}
              </div>

              <div id="cj-items" data-jump="items" className="scroll-mt-16 min-w-0 lg:col-start-2 lg:row-start-1 lg:row-span-2">
                {componentsBox}
                {/* Items je Unit — der erste Reiter ist der Carry, seine 3er-Kombis
                    ersetzen die fruehere Box „Item-Sets am Carry". Die steht nur
                    noch da, wenn es keine Items je Unit gibt. */}
                {hasOutcomeItems && <OutcomeItems outcome={comp.outcome} assets={assets} bucket={bucket} t={t} />}
                {/* Top Item-Sets pro Carry — Item-Build für Carousels Stage 2-4+. */}
                {!hasOutcomeItems && comp.carryItems && comp.carryItems.length > 0 && (
                  <section className="mt-5 bg-surface-base border border-border-subtle rounded p-4">
                    <h2 className="text-fg-secondary text-xs uppercase tracking-widest mb-3">{t('tft.comp.topItemSets')}</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {comp.carryItems.slice(0, 3).map((set: { items: string[]; count: number }, i: number) => {
                        const totalCount = comp.carryItems.reduce((s: number, c: any) => s + (Number(c.count) || 0), 0);
                        const pct = totalCount > 0 ? (Number(set.count) / totalCount) * 100 : 0;
                        return (
                          <div key={i} className="bg-surface-raised border border-border-subtle rounded p-3">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-fg-secondary text-[10px] uppercase tracking-widest">
                                {t('tft.comp.itemSet')} {i + 1}
                              </span>
                              <span className="text-accent text-xs font-medium tabular-nums">
                                {pct.toFixed(0)}%
                              </span>
                            </div>
                            <div className="flex gap-1.5">
                              {set.items.map((it, j) => {
                                const meta = findItem(assets, it);
                                const url = tftIconUrl(assets, meta?.icon);
                                return (
                                  <a
                                    key={j}
                                    href={`/tft/items/${encodeURIComponent(it)}?bucket=${bucket}`}
                                    title={meta?.name || it}
                                    className="hover:scale-110 transition"
                                  >
                                    {url ? (
                                      <img src={url} alt={meta!.name} className="w-8 h-8 rounded border border-surface-base" />
                                    ) : (
                                      <div className="w-8 h-8 rounded bg-surface-overlay" />
                                    )}
                                  </a>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}
              </div>

              <div className="min-w-0 lg:col-start-1 lg:row-start-2">
                {levelingBox}
              </div>
            </div>

            {carryStarBox && <div className="lg:hidden">{carryStarBox}</div>}

            <VariantsSwitcher
              clusterKey={comp.clusterKey}
              region={region}
              bucket={bucket}
              days={days}
              patch={null}
              assets={assets}
              familyMergeActive={variantMode === 'family'}
              familySize={comp?.aliasedFromFamily?.mergedFrom?.length ?? 1}
              families={variantMode === 'family' ? comp?.mergedFamilies ?? null : null}
            />

            <CompActiveTraits
              typicalUnits={comp.typicalUnits}
              clusterKey={comp.clusterKey}
              assets={assets}
              bucket={bucket}
            />

            <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-6 lg:items-start">
              <div className="min-w-0">
                <BlockHeadline label={t('tft.comp.block.live')} />

                {/* Guide aus MetaTFT: Augments + Early Game (Stage 2-1 / 3-2 / 4-2). */}
                {guide && (
                  <div id="cj-augments" data-jump="augments" className="scroll-mt-16">
                    <GuideAugments guide={guide} assets={assets} />
                  </div>
                )}
                {guide && (
                  <div id="cj-early" data-jump="early" className="scroll-mt-16">
                    <GuideEarlyGame guide={guide} assets={assets} />
                  </div>
                )}

                {/* Boards by Activation-Level — End-Board pro Trait-Aktivierungs-
                    Stufe mit Stats. Kritisch für Cap-Decision Stage 4-5+. */}
                {(comp.levelOutcome && comp.levelOutcome.length >= 2) && (() => {
                  const rows = comp.levelOutcome as Array<{
                    level: number; games: number; share: number; avgPlacement: number;
                    top4Rate: number; top1Rate: number; star3Games: number;
                    typicalUnits: Array<{
                      characterId: string; count: number; cooccurrence: number;
                      topItems: Array<{ apiName: string; count: number }>;
                    }>;
                  }>;
                  const totalGames = rows.reduce((s, x) => s + x.games, 0);
                  if (totalGames === 0) return null;
                  const bestAvg = Math.min(...rows.map(x => x.avgPlacement));
                  const carryCid = leadCarry;
                  const isComponent = componentCheckFromItems(assets?.items);
                  return (
                    <section className="mt-5 bg-surface-base border border-border-subtle rounded p-4">
                      <h2 className="text-fg-secondary text-xs uppercase tracking-widest mb-3">{t('tft.comp.levelOutcome')}</h2>
                      <div className="space-y-3">
                        {rows.map(row => {
                          const share = totalGames > 0 ? (row.games / totalGames) * 100 : 0;
                          const star3Share = row.games > 0 ? (row.star3Games / row.games) * 100 : 0;
                          const isBest = row.avgPlacement === bestAvg;
                          const accentColor = isBest ? '#3ecf8e' : '#7B61FF';
                          const lowSample = row.games < MIN_GAMES_PER_OUTCOME_CARD;
                          const rowRoles = computeRoles(row.typicalUnits, row.games, { set: assets?.set, isComponent });
                          const sortedUnits = [...row.typicalUnits].sort((a, b) => {
                            const ca = assets?.champions[a.characterId]?.cost ?? 1;
                            const cb = assets?.champions[b.characterId]?.cost ?? 1;
                            if (ca !== cb) return ca - cb;
                            const na = (assets?.champions[a.characterId]?.name || a.characterId).toLowerCase();
                            const nb = (assets?.champions[b.characterId]?.name || b.characterId).toLowerCase();
                            return na.localeCompare(nb);
                          });
                          return (
                            <div
                              key={row.level}
                              className="bg-surface-raised border rounded p-3"
                              style={{ borderColor: `${withAlpha(accentColor, 0x60)}`, borderWidth: isBest ? 2 : 1, opacity: lowSample ? 0.55 : 1 }}
                            >
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2">
                                <span className="text-base font-semibold" style={{ color: accentColor }}>
                                  {(t('tft.comp.levelOutcome.activation') as string).replace('{n}', String(row.level))}
                                </span>
                                <span className="text-fg-secondary text-xs tabular-nums">
                                  {row.typicalUnits.length} {t('tft.comp.levelOutcome.units')}
                                </span>
                                {lowSample && (
                                  <span
                                    className="text-[8px] uppercase tracking-wider px-1 py-[1px] rounded"
                                    style={{ color: '#e0a040', backgroundColor: 'rgba(224,160,64,0.12)', border: '1px solid rgba(224,160,64,0.35)' }}
                                    title={`${row.games} ${t('tft.gamesShort')} < ${MIN_GAMES_PER_OUTCOME_CARD}`}
                                  >
                                    {t('tft.comp.lowSample')}
                                  </span>
                                )}
                                <div className="ml-auto flex items-center gap-3 text-xs tabular-nums">
                                  <span className="text-fg-muted">{row.games} {t('tft.gamesShort')} · {share.toFixed(0)}%</span>
                                  <span><span className="text-fg-muted">{t('tft.avgPlacement')} </span><span className="text-white font-semibold">{row.avgPlacement.toFixed(2)}</span></span>
                                  <span className="hidden sm:inline"><span className="text-fg-muted">{t('tft.top4')} </span><span className="text-white font-medium">{(row.top4Rate * 100).toFixed(0)}%</span></span>
                                  <span className="hidden md:inline"><span className="text-fg-muted">{t('tft.top1')} </span><span className="text-white font-medium">{(row.top1Rate * 100).toFixed(0)}%</span></span>
                                </div>
                              </div>
                              {sortedUnits.length > 0 && (
                                <div className="flex flex-wrap items-start gap-1.5">
                                  {sortedUnits.map(u => {
                                    const ch = findChampion(assets, u.characterId);
                                    const url = tftChampionTileUrl(assets, ch);
                                    const cost = ch?.cost ?? 1;
                                    const isCarry = u.characterId === carryCid;
                                    const items = shownItems(u, rowRoles, isComponent, 3);
                                    return (
                                      <div key={u.characterId} className="flex flex-col items-center gap-1 flex-shrink-0">
                                        <a
                                          href={`/tft/units/${encodeURIComponent(u.characterId)}?bucket=${bucket}`}
                                          className="w-10 h-10 rounded-md border-2 overflow-hidden block hover:scale-110 transition-transform shadow-sm"
                                          style={{ borderColor: isCarry ? '#c39bff' : costColor(cost) }}
                                          title={ch?.name || u.characterId}
                                        >
                                          {url && <img src={url} alt={ch?.name || ''} className="w-full h-full object-cover" />}
                                        </a>
                                        {items.length > 0 && (
                                          <div className="flex items-center gap-[2px]">
                                            {items.map(it => {
                                              const meta = findItem(assets, it.apiName);
                                              const iconUrl = tftIconUrl(assets, meta?.icon);
                                              return (
                                                <a
                                                  key={it.apiName}
                                                  href={`/tft/items/${encodeURIComponent(it.apiName)}`}
                                                  className="w-[14px] h-[14px] rounded-sm bg-surface-sunken border border-border-subtle overflow-hidden block hover:border-[#c39bff]/60"
                                                  title={meta?.name || it.apiName}
                                                >
                                                  {iconUrl && <img src={iconUrl} alt={meta?.name || it.apiName} className="w-full h-full object-cover" />}
                                                </a>
                                              );
                                            })}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              {star3Share >= 10 && (
                                <div className="text-[#c39bff] text-[10px] mt-2 tabular-nums">
                                  {(t('tft.comp.levelOutcome.star3Share') as string).replace('{pct}', star3Share.toFixed(0))}
                                </div>
                              )}
                              <CompLevelActiveTraits
                                typicalUnits={row.typicalUnits}
                                clusterKey={comp.clusterKey}
                                assets={assets}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  );
                })()}
              </div>

              <div className="min-w-0">
                <BlockHeadline label={t('tft.comp.block.strategy')} />
                {carryStarBox && <div className="hidden lg:block">{carryStarBox}</div>}
                {comp.outcome && <OutcomePlacement outcome={comp.outcome} t={t} />}

                {/* Contested-Penalty — Solo/Duo/Triple Outcome-Cards. */}
                {(comp.contestedOutcome && comp.contestedOutcome.length >= 2) && (() => {
                  const solo = (comp.contestedOutcome as { contested: number; avgPlacement: number; games: number; top4Rate: number; top1Rate: number }[]).find((c) => c.contested === 1);
                  const totalGames = (comp.contestedOutcome as { games: number }[]).reduce((s: number, x: { games: number }) => s + x.games, 0);
                  if (totalGames === 0) return null;
                  return (
                    <section className="mt-5 bg-surface-base border border-border-subtle rounded p-4">
                      <h2 className="text-fg-secondary text-xs uppercase tracking-widest mb-3">{t('tft.comp.contestedPenalty')}</h2>
                      <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-3">
                        {(comp.contestedOutcome as { contested: number; games: number; avgPlacement: number; top4Rate: number; top1Rate: number }[]).map((row) => {
                          const share = totalGames > 0 ? (row.games / totalGames) * 100 : 0;
                          const delta = solo && solo.games > 0 && row.contested !== 1 ? row.avgPlacement - solo.avgPlacement : null;
                          const accentColor = row.contested === 1 ? '#3ecf8e' : row.contested === 2 ? '#e0c75a' : '#e44040';
                          const label = row.contested === 1 ? t('tft.comp.contestedSolo')
                                      : row.contested === 2 ? t('tft.comp.contestedDuo')
                                      : t('tft.comp.contestedTriple');
                          const lowSample = row.games < MIN_GAMES_PER_OUTCOME_CARD;
                          return (
                            <div
                              key={row.contested}
                              className="bg-surface-raised border rounded p-3"
                              style={{ borderColor: `${withAlpha(accentColor, 0x40)}`, opacity: lowSample ? 0.55 : 1 }}
                            >
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium uppercase tracking-widest" style={{ color: accentColor }}>{label}</span>
                                <div className="flex items-center gap-1.5">
                                  {lowSample && (
                                    <span
                                      className="text-[8px] uppercase tracking-wider px-1 py-[1px] rounded"
                                      style={{ color: '#e0a040', backgroundColor: 'rgba(224,160,64,0.12)', border: '1px solid rgba(224,160,64,0.35)' }}
                                      title={`${row.games} ${t('tft.gamesShort')} < ${MIN_GAMES_PER_OUTCOME_CARD}`}
                                    >
                                      {t('tft.comp.lowSample')}
                                    </span>
                                  )}
                                  <span className="text-fg-muted text-[10px] tabular-nums">
                                    {share.toFixed(0)}% · {row.games}
                                  </span>
                                </div>
                              </div>
                              <div className="grid grid-cols-3 gap-1 text-[11px] tabular-nums">
                                <div>
                                  <div className="text-fg-muted text-[9px] uppercase tracking-widest">{t('tft.avgPlacement')}</div>
                                  <div className="text-white text-base font-medium">{row.avgPlacement.toFixed(2)}</div>
                                  {delta != null && (
                                    <div className="text-[10px] tabular-nums mt-0.5" style={{ color: delta > 0 ? '#e44040' : '#3ecf8e' }}>
                                      {delta > 0 ? '+' : ''}{delta.toFixed(2)}
                                    </div>
                                  )}
                                </div>
                                <div>
                                  <div className="text-fg-muted text-[9px] uppercase tracking-widest">{t('tft.top4')}</div>
                                  <div className="text-white">{(row.top4Rate * 100).toFixed(0)}%</div>
                                </div>
                                <div>
                                  <div className="text-fg-muted text-[9px] uppercase tracking-widest">{t('tft.top1')}</div>
                                  <div className="text-white">{(row.top1Rate * 100).toFixed(0)}%</div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  );
                })()}

                <CompFlexUnits
                  units={comp.flexUnits || []}
                  assets={assets}
                  bucket={bucket}
                  t={t}
                />
              </div>
            </div>

            {/* ═══════════════════════════════════════════════════════════
                Detail-Analyse: Unit-Wirkung, Matchups, Comp-DNA, Spielverlauf
                in zwei Spalten; Pro vs Solo und Trend voll breit.
                ═══════════════════════════════════════════════════════════ */}
            <div id="cj-analysis" data-jump="analysis" className="scroll-mt-16">
              <BlockHeadline label={t('tft.comp.block.deep')} />
            </div>

            {/* Der Block 'Pros Playing this Comp' (ProsByCompSection) ist am
                2026-09-01 auf Wunsch des Users entfernt worden. Die
                Pro-Datensammlung ist seit demselben Tag stillgelegt, der Kader
                friert also ein — siehe app/lib/feature-flags.ts. Die Komponente
                und der Endpoint bleiben liegen, Zurueckholen ist ein Import
                plus dieser eine Aufruf. */}

            <div className="lg:grid lg:grid-cols-2 lg:gap-6 lg:items-start">
              <div className="min-w-0">
                {comp.outcome && <OutcomeUnitEffect outcome={comp.outcome} assets={assets} bucket={bucket} t={t} />}
              </div>
              <div className="min-w-0">
                {/* Comp-DNA: AggroIndex + SkillCap. Das Board mit Core/Flex steht
                    seit 2026-10-10 im Kopf (CompCard). */}
                {(comp.aggroIndex != null || comp.skillCapCategory) && (
                  <section className="mt-5 bg-surface-base border border-border-subtle rounded p-4">
                    <h2 className="text-fg-secondary text-xs uppercase tracking-widest mb-3">{t('tft.comp.compDna')}</h2>
                    <div className={`grid grid-cols-1 ${comp.aggroIndex != null && comp.skillCapCategory ? 'lg:grid-cols-2' : ''} gap-4`}>
                      {comp.aggroIndex != null && (
                        <div className="bg-surface-raised border border-border-subtle rounded p-3">
                          <div className="text-fg-muted text-[10px] uppercase tracking-widest">{t('tft.comp.aggroIndex')}</div>
                          <div className="flex items-baseline gap-1.5 mt-1">
                            <span className="text-white text-2xl font-medium tabular-nums">{comp.aggroIndex.toFixed(2)}</span>
                            <span className="text-fg-muted text-[11px]">{t('tft.comp.aggro.perGame')}</span>
                          </div>
                          {comp.aggroLobbyAverage != null && (
                            <div className="text-fg-faint text-[10px] tabular-nums mt-0.5">
                              {t('tft.comp.aggro.lobbyAvg')}: {comp.aggroLobbyAverage.toFixed(2)}
                            </div>
                          )}
                          <div className="text-[#c39bff] text-[11px] mt-1.5">
                            {comp.aggroIndex >= 1.2 ? t('tft.comp.aggro.push')
                              : comp.aggroIndex >= 0.7 ? t('tft.comp.aggro.balanced')
                              : t('tft.comp.aggro.econ')}
                          </div>
                        </div>
                      )}
                      {comp.skillCapCategory && (
                        <div className="bg-surface-raised border border-border-subtle rounded p-3">
                          <div className="text-fg-muted text-[10px] uppercase tracking-widest">{t('tft.comp.skillCap')}</div>
                          <div className="text-white text-lg font-medium mt-1">
                            {comp.skillCapCategory === 'high' ? t('tft.comp.skillCap.execution')
                              : comp.skillCapCategory === 'moderate' ? t('tft.comp.skillCap.medium')
                              : t('tft.comp.skillCap.consistent')}
                          </div>
                          {comp.skillCapBuckets && comp.skillCapBuckets.length > 0 && (() => {
                            const minP = Math.min(...comp.skillCapBuckets.map((b: any) => b.avgPlacement));
                            const maxP = Math.max(...comp.skillCapBuckets.map((b: any) => b.avgPlacement));
                            const range = Math.max(0.01, maxP - minP);
                            return (
                              <div className="space-y-1 mt-2">
                                {comp.skillCapBuckets.map((bk: any) => {
                                  const norm = 1 - ((bk.avgPlacement - minP) / range);
                                  const hue = Math.round(120 * norm);
                                  return (
                                    <div key={bk.bucket} className="flex items-center gap-2 text-[10px] tabular-nums">
                                      <span className="text-fg-secondary w-16 truncate">{t(`tft.bucket.${bk.bucket}` as TranslationKey) || bk.bucket}</span>
                                      <div className="flex-1 h-1 bg-surface-overlay rounded overflow-hidden">
                                        <div className="h-full" style={{ width: `${(norm * 100).toFixed(0)}%`, backgroundColor: `hsl(${hue}, 60%, 50%)` }} />
                                      </div>
                                      <span className="text-white w-10 text-right">{bk.avgPlacement.toFixed(2)}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  </section>
                )}

                {/* Death-Round + Survival */}
                {comp.deathStory && comp.roundHistogram && comp.roundHistogram.length > 0 && (() => {
                  const story = comp.deathStory as {
                    mostCommonRound: { round: number; share: number; phase: 'early'|'mid'|'late'|'end'; top4Rate: number | null } | null;
                    top4ThresholdRound: { round: number; top4Rate: number; share: number } | null;
                    stableRound: { round: number; top4Rate: number; share: number } | null;
                    phaseBreakdown: { phase: 'early'|'mid'|'late'|'end'; games: number; share: number; top4InPhase: number | null; cumTop4AfterPhase: number | null; survivorsAfterPhase: number | null }[];
                  };
                  const phaseLabel = (p: 'early'|'mid'|'late'|'end') => t(`tft.comp.phase.${p}` as TranslationKey) as string;
                  const storyParts: string[] = [];
                  if (story.mostCommonRound) {
                    storyParts.push(
                      (t('tft.comp.death.story.dies') as string)
                        .replace('{phase}', phaseLabel(story.mostCommonRound.phase))
                        .replace('{stage}', formatStage(story.mostCommonRound.round)),
                    );
                  }
                  if (story.stableRound) {
                    storyParts.push(
                      (t('tft.comp.death.story.stable') as string)
                        .replace('{stage}', formatStage(story.stableRound.round))
                        .replace('{pct}', String(Math.floor(story.stableRound.top4Rate * 100))),
                    );
                  } else if (story.top4ThresholdRound) {
                    storyParts.push(
                      (t('tft.comp.death.story.threshold') as string)
                        .replace('{stage}', formatStage(story.top4ThresholdRound.round))
                        .replace('{pct}', String(Math.floor(story.top4ThresholdRound.top4Rate * 100))),
                    );
                  }
                  return (
                    <section className="mt-5 bg-surface-base border border-border-subtle rounded p-4">
                      <h2 className="text-fg-secondary text-xs uppercase tracking-widest mb-3">
                        {t('tft.comp.death.title')}
                      </h2>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                        <DeathKpi
                          label={t('tft.comp.modeRound') as string}
                          value={story.mostCommonRound ? formatStage(story.mostCommonRound.round) : '—'}
                          sub={story.mostCommonRound
                            ? (t('tft.comp.death.commonSub') as string)
                                .replace('{share}', (story.mostCommonRound.share * 100).toFixed(0))
                                .replace('{phase}', phaseLabel(story.mostCommonRound.phase))
                            : ''}
                          accent="#e44040"
                        />
                        <DeathKpi
                          label={t('tft.comp.survivalInflection') as string}
                          value={story.top4ThresholdRound
                            ? `${formatStage(story.top4ThresholdRound.round)} · ${(story.top4ThresholdRound.top4Rate * 100).toFixed(0)}%`
                            : '—'}
                          sub={t('tft.comp.death.thresholdSub') as string}
                          accent="#f0c040"
                        />
                        <DeathKpi
                          label={t('tft.comp.death.stable') as string}
                          value={story.stableRound
                            ? `${formatStage(story.stableRound.round)} · ${(story.stableRound.top4Rate * 100).toFixed(0)}%`
                            : '—'}
                          sub={t('tft.comp.death.stableSub') as string}
                          accent="#3ecf8e"
                        />
                      </div>
                      {storyParts.length > 0 && (
                        <div className="bg-surface-raised border border-border-subtle rounded p-3 mb-3 text-[#c5d0e0] text-[13px] leading-relaxed">
                          {storyParts.join(' ')}
                        </div>
                      )}
                      <details className="mt-3 group">
                        <summary className="cursor-pointer text-[11px] text-fg-muted hover:text-white select-none">
                          {t('tft.comp.death.detailsToggle')}
                        </summary>
                        <div className="mt-2 bg-surface-raised border border-border-subtle rounded p-3">
                          <CompDeathChart
                            roundHistogram={comp.roundHistogram as { round: number; games: number; top4: number }[]}
                            survivalToTop4={(comp.survivalToTop4 || []) as { round: number; atLeast: number; top4Rate: number | null }[]}
                          />
                        </div>
                      </details>
                    </section>
                  );
                })()}

                {/* Matchups */}
                {comp.counters && ((comp.counters.beats?.length ?? 0) + (comp.counters.losesTo?.length ?? 0)) > 0 && (
                  <section className="mt-5 bg-surface-base border border-border-subtle rounded p-4">
                    <h2 className="text-fg-secondary text-xs uppercase tracking-widest mb-3">{t('tft.comp.matchups')}</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <MatchupColumn title={t('tft.comp.beats')}   color="#3ecf8e" edges={comp.counters.beats}   assets={assets} bucket={bucket} t={t} />
                      <MatchupColumn title={t('tft.comp.losesTo')} color="#e44040" edges={comp.counters.losesTo} assets={assets} bucket={bucket} t={t} />
                    </div>
                  </section>
                )}
              </div>
            </div>

            {/* Pro vs Solo */}
            {proComp && proComp.games >= 5 && (
              <section className="mt-5 bg-gradient-to-br from-surface-base to-[#0a1c14] border border-[#3ecf8e]/30 rounded p-4">
                <h2 className="text-[#3ecf8e] text-xs uppercase tracking-widest mb-3">
                  {t('tft.comp.proVsSolo')}
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <DeltaStat
                    label={t('tft.avgPlacement')}
                    pro={proComp.avgPlacement}
                    solo={comp.avgPlacement}
                    lowerIsBetter
                    fmt={n => n.toFixed(2)}
                  />
                  <DeltaStat
                    label={t('tft.top4')}
                    pro={proComp.top4Rate}
                    solo={comp.top4Rate}
                    fmt={n => `${(n * 100).toFixed(1)}%`}
                  />
                  <DeltaStat
                    label={t('tft.top1')}
                    pro={proComp.top1Rate}
                    solo={comp.top1Rate}
                    fmt={n => `${(n * 100).toFixed(1)}%`}
                  />
                  <DeltaStat
                    label={t('tft.gamesShort')}
                    pro={proComp.games}
                    solo={null}
                    fmt={n => String(Math.round(n))}
                    rawOnly
                  />
                </div>
              </section>
            )}

            {/* Trend-Time-Series mit Patch-Drop-ReferenceLine */}
            <CompTrendChart
              trendPoints={trendPoints}
              trendDays={trendDays}
              onTrendDaysChange={setTrendDays}
              patchBoundary={patchBoundary}
            />
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}

interface CounterEdge { opponent: string; games: number; winRate: number }

function dedupeMatchupEdges(edges: CounterEdge[] | undefined): CounterEdge[] {
  if (!edges || edges.length === 0) return [];
  return dedupeByPrimaryCluster(
    edges,
    e => e.opponent,
    e => e.games,
    group => {
      const totalGames = group.reduce((s, e) => s + e.games, 0);
      const weightedWin = totalGames > 0
        ? group.reduce((s, e) => s + e.winRate * e.games, 0) / totalGames
        : 0;
      const top = [...group].sort((a, b) => b.games - a.games)[0];
      return {
        opponent: primaryClusterKey(top.opponent),
        games: totalGames,
        winRate: weightedWin,
      };
    },
  );
}

function MatchupColumn({ title, color, edges, assets, bucket, t }: {
  title: string;
  color: string;
  edges?: CounterEdge[];
  assets: TftAssetsBundle | null;
  bucket: string;
  t: (k: any) => string;
}) {
  const merged = dedupeMatchupEdges(edges);
  return (
    <div className="bg-surface-raised border border-border-subtle rounded p-3">
      <div className="text-[10px] uppercase tracking-widest mb-2" style={{ color }}>{title}</div>
      {merged.length === 0 ? (
        <div className="text-fg-muted text-[10px] py-1">{t('tft.comp.noMatchupData')}</div>
      ) : (
        <div className="space-y-1.5">
          {merged.map(e => {
            const parts = parseClusterKey(e.opponent);
            const traitName = parts && assets
              ? (assets.traits[parts.trait]?.name || parts.trait.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, ''))
              : '';
            const carry = parts && assets ? assets.champions[parts.carry] : null;
            const carryName = carry?.name || (parts ? parts.carry.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '') : e.opponent);
            const url = tftChampionTileUrl(assets, carry);
            const secondaryCh = parts?.secondary && assets ? assets.champions[parts.secondary] : null;
            const secondaryName = secondaryCh?.name || (parts?.secondary ? parts.secondary.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '') : null);
            const augSlug = shownAugmentSlug(parts?.augmentSlug);
            const augApiName = augSlug ? compDefiningAugmentApiNameFromSlug(augSlug) : null;
            const augName = (augApiName && assets ? assets.items[augApiName]?.name : null) || augSlug;
            return (
              <a
                key={e.opponent}
                href={`/tft/comps/${encodeURIComponent(e.opponent)}?bucket=${bucket}`}
                title={`${traitName} · ${carryName}`}
                className="flex items-start gap-2 hover:opacity-80 transition"
              >
                {url ? (
                  <img src={url} alt="" className="w-7 h-7 rounded border border-[#c39bff]/50 flex-shrink-0 mt-0.5" />
                ) : (
                  <div className="w-7 h-7 rounded bg-surface-overlay flex-shrink-0 mt-0.5" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-fg-secondary text-[9px] truncate">{traitName}</div>
                  <div className="text-white text-[11px] truncate flex items-center gap-1">
                    <span className="truncate">{carryName}</span>
                    {parts?.carryStar === 3 && (
                      <span
                        className="inline-flex items-center px-1 py-[1px] rounded text-[8px] font-semibold tabular-nums flex-shrink-0"
                        style={{ color: '#e0c75a', backgroundColor: 'rgba(224,199,90,0.15)', border: '1px solid rgba(224,199,90,0.4)' }}
                      >3★</span>
                    )}
                    {augName && (
                      <span
                        className="inline-flex items-center px-1 py-[1px] rounded text-[8px] font-medium flex-shrink-0"
                        style={{ color: '#c39bff', backgroundColor: 'rgba(123,97,255,0.12)', border: '1px solid rgba(123,97,255,0.4)' }}
                      >{augName}</span>
                    )}
                  </div>
                  {secondaryName && (
                    <div className="text-fg-muted text-[9px] truncate">+ {secondaryName}</div>
                  )}
                </div>
                <div className="flex flex-col items-end flex-shrink-0">
                  <span className="text-[11px] tabular-nums font-medium" style={{ color }}>{(e.winRate * 100).toFixed(0)}%</span>
                  <span className="text-fg-faint text-[9px] tabular-nums">{e.games}</span>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

function costColor(cost: number) {
  return cost === 1 ? '#9aa6b2'
    : cost === 2 ? '#3a8'
    : cost === 3 ? '#3a8ddc'
    : cost === 4 ? '#c39bff'
    : '#e0c75a';
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-sunken border border-border-subtle rounded px-3 py-2">
      <div className="text-fg-secondary text-[10px] uppercase tracking-widest">{label}</div>
      <div className="text-white text-base font-semibold mt-0.5">{value}</div>
    </div>
  );
}

function DeltaStat({
  label, pro, solo, lowerIsBetter, fmt, rawOnly,
}: {
  label: string;
  pro: number | null | undefined;
  solo: number | null | undefined;
  lowerIsBetter?: boolean;
  fmt: (n: number) => string;
  rawOnly?: boolean;
}) {
  if (pro == null) {
    return (
      <div className="bg-surface-sunken border border-border-subtle rounded px-3 py-2">
        <div className="text-fg-secondary text-[10px] uppercase tracking-widest">{label}</div>
        <div className="text-fg-muted text-base font-semibold mt-0.5">—</div>
      </div>
    );
  }
  const delta = solo != null ? pro - solo : null;
  const betterColor = '#3ecf8e';
  const worseColor = '#e44040';
  const color = delta == null || delta === 0
    ? 'var(--fg-secondary)'
    : (lowerIsBetter ? (delta < 0 ? betterColor : worseColor)
                     : (delta > 0 ? betterColor : worseColor));
  const arrow = delta == null || delta === 0
    ? ''
    : (lowerIsBetter ? (delta < 0 ? '▲' : '▼')
                     : (delta > 0 ? '▲' : '▼'));
  return (
    <div className="bg-surface-sunken border border-border-subtle rounded px-3 py-2">
      <div className="text-fg-secondary text-[10px] uppercase tracking-widest">{label}</div>
      <div className="text-white text-base font-semibold mt-0.5 tabular-nums">{fmt(pro)}</div>
      {!rawOnly && delta != null && (
        <div className="text-[10px] tabular-nums mt-0.5" style={{ color }}>
          {arrow} {fmt(Math.abs(delta))} vs Solo-Queue
        </div>
      )}
    </div>
  );
}

function DeathKpi({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div className="bg-surface-raised border border-border-subtle rounded p-3" style={{ borderLeft: `3px solid ${accent}` }}>
      <div className="text-fg-muted text-[10px] uppercase tracking-widest">{label}</div>
      <div className="text-white text-lg font-medium mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-fg-muted text-[11px] mt-1">{sub}</div>}
    </div>
  );
}


// Block-Headline — dezenter Section-Trenner mit zentriertem Label, der die
// drei Workflow-Blöcke der Detail-Page (In der Runde / Strategie / Detail-
// Analyse) visuell trennt. Quelle: reference_tft_spielerworkflow.md.
function BlockHeadline({ label }: { label: string }) {
  return (
    <div className="mt-7 mb-1 flex items-center gap-3">
      <div className="h-px flex-1 bg-surface-overlay" />
      <span className="text-fg-muted text-[10px] uppercase tracking-widest font-medium">{label}</span>
      <div className="h-px flex-1 bg-surface-overlay" />
    </div>
  );
}
// ROI je Level, zugeklappt in der Leveln-Box. Das Diagramm wird erst beim
// Aufklappen gezeichnet — Recharts misst beim Start seine Breite, in einem
// geschlossenen <details> waere die 0.
function RoiDetails({ chartData, label }: {
  chartData: { label: string; share: number; avgRound: number | null; avgStage: string }[];
  label: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={e => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer text-[11px] text-fg-muted hover:text-white select-none">{label}</summary>
      {open && <div className="mt-2"><CompEconChart chartData={chartData} bare /></div>}
    </details>
  );
}
