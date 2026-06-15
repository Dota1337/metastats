'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams, usePathname } from 'next/navigation';
import {
  ResponsiveContainer, ComposedChart, AreaChart, Area, Bar, Line, XAxis, YAxis,
  Tooltip as RechartsTooltip, ReferenceLine, Cell,
} from 'recharts';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import TierFilter, { type TierBucket } from '../../../components/tft/TierFilter';
import EmptyData from '../../../components/tft/EmptyData';
import CompCard from '../../../components/tft/CompCard';
import { useI18n, type TranslationKey } from '../../../lib/i18n';
import { loadTftAssets, tftIconUrl, tftChampionTileUrl, findChampion, findItem, type TftAssetsBundle } from '../../../lib/tft-cdragon';
import PositionHeatmap from '../../../components/tft/PositionHeatmap';
import { formatStage } from '../../../lib/tft-stage';
import { aggregateComponents } from '../../../lib/tft-components';
import { compDefiningAugmentApiNameFromSlug } from '../../../lib/tft-comp-defining-augments';

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
  // Region from the URL — the comps list passes ?region=… in the href and its
  // default is 'all'. Was hardcoded to 'euw1', which made the detail show
  // "no data" for any comp with <30 games in euw1 but popular across all
  // regions (list aggregated all regions, detail only queried euw1).
  const [region, setRegion] = useState<string>(search.get('region') || 'all');
  const [bucket, setBucket] = useState<TierBucket>((search.get('bucket') as TierBucket) || 'master_plus');

  // Sync region/bucket changes back to the URL so refreshes + share-links keep
  // the user's filter combo. router.replace avoids piling up history entries.
  useEffect(() => {
    if (!pathname) return;
    const next = new URLSearchParams(search.toString());
    if (region === 'all') next.delete('region'); else next.set('region', region);
    if (bucket === 'master_plus') next.delete('bucket'); else next.set('bucket', bucket);
    const q = next.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }, [region, bucket, pathname, router, search]);
  const [comp, setComp] = useState<any | null | undefined>(undefined);
  const [proComp, setProComp] = useState<any | null>(null);
  const [hasData, setHasData] = useState<boolean | null>(null);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  // Trends-Time-Series: per-day avg-place / top4-rate / games über die
  // letzten N Tage. Standard 14 — User kann auf 30 umschalten.
  const [trendDays, setTrendDays] = useState<14 | 30>(14);
  const [trendPoints, setTrendPoints] = useState<Array<{
    day: string; games: number; avgPlacement: number | null; top4Rate: number | null; top1Rate: number | null;
  }>>([]);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tft/comps/trend?slug=${encodeURIComponent(slug)}&region=${region}&bucket=${bucket}&days=${trendDays}`)
      .then(r => r.ok ? r.json() : { points: [] })
      .then(d => { if (!cancelled) setTrendPoints(d.points || []); })
      .catch(() => { if (!cancelled) setTrendPoints([]); });
    return () => { cancelled = true; };
  }, [slug, region, bucket, trendDays]);

  useEffect(() => {
    // Detail uses the SAME window as /tft/patch/winners (30 days, min 50
    // games) so any comp that's visible in the diff view always resolves
    // here too. The previous 3-day default split the two views: a comp
    // could show up as a patch winner (30d, min 50) and then "no data" in
    // the detail (3d, min 30). User-Befund von 2026-06-07.
    //
    // Pull the normal-bucket comp + the pro-pool variant in parallel so the
    // "Pro vs Solo Queue" section lights up as soon as both arrive.
    Promise.all([
      fetch(`/api/tft/comps?region=${region}&bucket=${bucket}&slug=${encodeURIComponent(slug)}&days=30&minGames=50`).then(r => r.json()),
      fetch(`/api/tft/comps?region=all&bucket=pro_pool&slug=${encodeURIComponent(slug)}&days=30&minGames=5`).then(r => r.ok ? r.json() : { comp: null }),
    ]).then(([normal, pro]) => {
      setHasData(!!normal.hasData);
      setComp(normal.comp || null);
      setProComp(pro.comp || null);
    }).catch(() => { setHasData(false); setComp(null); });
  }, [bucket, slug, region]);

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="comps" />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <a href="/tft/comps" className="text-[#7B61FF] text-xs hover:underline">← {t('nav.comps')}</a>

        <div className="flex flex-wrap items-center justify-end gap-2 mt-2 mb-4">
          <TierFilter value={bucket} onChange={setBucket} />
          <select
            value={region}
            onChange={e => setRegion(e.target.value)}
            className="bg-[#141c2e] border border-[#1e2a3a] rounded text-white text-xs px-2 py-1.5"
            aria-label={t('tft.filter.region')}
          >
            {REGIONS.map(r => (
              <option key={r.value} value={r.value}>
                {r.value === 'all' ? t(r.label as TranslationKey) : r.label}
              </option>
            ))}
          </select>
        </div>

        {hasData === false && <EmptyData />}
        {comp === null && hasData && (
          <div className="text-[#a0b0c5] text-center py-8">{t('tft.comp.notFound')}</div>
        )}

        {comp && (
          <>
            <CompCard comp={comp} assets={assets} />

            {/* Trend-Time-Series — per-day avg-place + games sample über
                14/30 Tage. Hebt einen Patch-internen Anstieg/Fall hervor
                (z.B. nach Hotfix oder Pro-Discovery), den die statischen
                Patch-Snapshots oben nicht zeigen. */}
            <div className="mt-4 bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-white text-sm font-medium">{t('tft.trend.title')}</h3>
                <div className="flex gap-1 bg-[#141c2e] border border-[#1e2a3a] rounded p-0.5">
                  {([14, 30] as const).map(d => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setTrendDays(d)}
                      className={`px-2.5 py-0.5 text-[11px] rounded ${
                        trendDays === d
                          ? 'bg-[#7B61FF] text-white'
                          : 'text-[#a0b0c5] hover:text-white'
                      }`}
                    >
                      {t(d === 14 ? 'tft.trend.last14' : 'tft.trend.last30')}
                    </button>
                  ))}
                </div>
              </div>
              {trendPoints.length >= 2 ? (
                <div style={{ width: '100%', height: 180 }}>
                  <ResponsiveContainer>
                    <ComposedChart data={trendPoints} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                      <XAxis
                        dataKey="day"
                        tick={{ fill: '#7a8aa0', fontSize: 10 }}
                        tickFormatter={(d: string) => d.slice(5)}
                        axisLine={{ stroke: '#1e2a3a' }}
                        tickLine={false}
                      />
                      <YAxis
                        yAxisId="place"
                        domain={[3, 6]}
                        reversed
                        tick={{ fill: '#7a8aa0', fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        width={30}
                      />
                      <YAxis
                        yAxisId="games"
                        orientation="right"
                        tick={{ fill: '#5a6a80', fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        width={40}
                      />
                      <RechartsTooltip
                        contentStyle={{ backgroundColor: '#0a0e1a', border: '1px solid #1e2a3a', borderRadius: 4, fontSize: 11 }}
                        labelStyle={{ color: '#a0b0c5' }}
                        formatter={(value: any, name: any) => {
                          if (name === 'avgPlacement') return [Number(value).toFixed(2), t('tft.avgPlacement')];
                          if (name === 'games') return [value, t('tft.gamesShort')];
                          return [value, String(name ?? '')];
                        }}
                      />
                      <Bar yAxisId="games" dataKey="games" fill="#1e2a3a" radius={[2, 2, 0, 0]} />
                      <Line
                        yAxisId="place"
                        dataKey="avgPlacement"
                        stroke="#c39bff"
                        strokeWidth={2}
                        dot={{ fill: '#c39bff', r: 3 }}
                        connectNulls
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="text-[#5a6a80] text-xs text-center py-6">{t('tft.trend.empty')}</div>
              )}
            </div>

            {/* Pro vs Solo-Queue divergence — only shown when the pro_pool
                has at least a handful of games for this comp. Surfaces the
                kind of insight no other TFT site has: do pros play this
                differently than the ladder average? */}
            {proComp && proComp.games >= 5 && (
              <section className="mt-5 bg-gradient-to-br from-[#0d1526] to-[#0a1c14] border border-[#3ecf8e]/30 rounded p-4">
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

            {/* Leveling tempo — surfaces avg final level + avg last-round
                so users see at a glance whether this comp wants to be Lvl 8
                by Stage 5 or settles at Lvl 7 because it died earlier. */}
            {(comp.avgLevel != null || comp.avgLastRound != null) && (
              <section className="mt-5 bg-[#0d1526] border border-[#1e2a3a] rounded p-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
                <Stat label={t('tft.comp.avgLevel')} value={comp.avgLevel != null ? comp.avgLevel.toFixed(1) : '—'} />
                <Stat label={t('tft.comp.avgLastRound')} value={comp.avgLastRound != null ? formatStage(comp.avgLastRound) : '—'} />
                <Stat label={t('tft.comp.tempo')} value={tempoLabel(comp.avgLevel, comp.avgLastRound, t)} />
                {/* Comp-Eco (migration 0024) — only shown once the crawl has filled sum_gold_left */}
                {comp.avgGoldLeft != null && (
                  <Stat label={t('tft.avgGoldLeft')} value={comp.avgGoldLeft.toFixed(1)} />
                )}
                <Stat label={t('tft.gamesShort')} value={String(comp.games)} />
              </section>
            )}

            {/* Comp-DNA: Board-Composition + Aggro + Skill-Cap + Tempo.
                Verständliche Labels statt abstrakter Scores. */}
            {(comp.aggroIndex != null || comp.skillCapIndex != null || (comp.levelingTempo && comp.levelingTempo.length > 0) || comp.boardComposition != null) && (
              <section className="mt-5 bg-[#0d1526] border border-[#1e2a3a] rounded p-4">
                <h2 className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">{t('tft.comp.compDna')}</h2>
                {comp.boardComposition && (
                  <BoardCompositionPanel
                    composition={comp.boardComposition}
                    assets={assets}
                    t={t as (k: string) => string}
                  />
                )}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {comp.aggroIndex != null && (
                    <div className="bg-[#141c2e] border border-[#1e2a3a] rounded p-3">
                      <div className="text-[#7a8aa0] text-[10px] uppercase tracking-widest">{t('tft.comp.aggroIndex')}</div>
                      <div className="flex items-baseline gap-1.5 mt-1">
                        <span className="text-white text-2xl font-medium tabular-nums">{comp.aggroIndex.toFixed(2)}</span>
                        <span className="text-[#7a8aa0] text-[11px]">{t('tft.comp.aggro.perGame')}</span>
                      </div>
                      {comp.aggroLobbyAverage != null && (
                        <div className="text-[#5a6a80] text-[10px] tabular-nums mt-0.5">
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
                    <div className="bg-[#141c2e] border border-[#1e2a3a] rounded p-3">
                      <div className="text-[#7a8aa0] text-[10px] uppercase tracking-widest">{t('tft.comp.skillCap')}</div>
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
                                  <span className="text-[#a0b0c5] w-16 truncate">{t(`tft.bucket.${bk.bucket}` as TranslationKey) || bk.bucket}</span>
                                  <div className="flex-1 h-1 bg-[#1e2a3a] rounded overflow-hidden">
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
                  {comp.tempoMeta && (
                    <div className="bg-[#141c2e] border border-[#1e2a3a] rounded p-3">
                      <div className="text-[#7a8aa0] text-[10px] uppercase tracking-widest">{t('tft.comp.levelTempo')}</div>
                      <div className="text-white text-lg font-medium mt-1">
                        {comp.tempoMeta.category === 'reroll'
                          ? (comp.tempoMeta.rerollCost
                              ? (t('tft.comp.tempo.rerollCost') as string).replace('{cost}', String(comp.tempoMeta.rerollCost))
                              : t('tft.comp.tempo.reroll'))
                          : comp.tempoMeta.category === 'standard' ? t('tft.comp.tempo.standard')
                          : comp.tempoMeta.category === 'fast9' ? t('tft.comp.tempo.fast9')
                          : t('tft.comp.tempo.capout')}
                      </div>
                      <div className="text-[#a0b0c5] text-[11px] mt-1.5 tabular-nums">
                        {t('tft.comp.tempo.peakLevel')}: Lvl {comp.tempoMeta.peakLevel} ({(comp.tempoMeta.peakShare * 100).toFixed(0)}%)
                      </div>
                      {comp.tempoMeta.avgEndStage != null && (
                        <div className="text-[#a0b0c5] text-[11px] tabular-nums">
                          {t('tft.comp.tempo.avgEnd')}: {formatStage(comp.tempoMeta.avgEndStage)}
                        </div>
                      )}
                      {comp.levelingTempo && comp.levelingTempo.length > 0 && (() => {
                        const pts = (comp.levelingTempo as { level: number; share: number | null }[])
                          .filter(p => p.share != null);
                        if (pts.length === 0) return null;
                        const chartData = pts.map(p => ({
                          level: `Lvl ${p.level}`,
                          share: Math.round((p.share || 0) * 100),
                        }));
                        return (
                          <div style={{ width: '100%', height: 70 }} className="mt-2">
                            <ResponsiveContainer>
                              <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -32, bottom: 0 }}>
                                <defs>
                                  <linearGradient id="tempoFill" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#7B61FF" stopOpacity={0.5} />
                                    <stop offset="100%" stopColor="#7B61FF" stopOpacity={0.05} />
                                  </linearGradient>
                                </defs>
                                <XAxis dataKey="level" tick={{ fill: '#5a6a80', fontSize: 8 }} axisLine={{ stroke: '#1e2a3a' }} tickLine={false} interval={0} />
                                <YAxis tick={false} axisLine={false} tickLine={false} width={20} />
                                <Area type="monotone" dataKey="share" stroke="#7B61FF" strokeWidth={1.5} fill="url(#tempoFill)" />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Death-Round + Survival-to-Top4 — unique to metastats. Shows
                where this comp dies in the lobby distribution and at which
                round the "you're safe to commit" inflection happens. */}
            {comp.deathStory && comp.roundHistogram && comp.roundHistogram.length > 0 && (() => {
              const story = comp.deathStory as {
                mostCommonRound: { round: number; share: number; phase: 'early'|'mid'|'late'|'end'; top4Rate: number | null } | null;
                top4ThresholdRound: { round: number; top4Rate: number; share: number } | null;
                stableRound: { round: number; top4Rate: number; share: number } | null;
                phaseBreakdown: { phase: 'early'|'mid'|'late'|'end'; games: number; share: number; top4InPhase: number | null; cumTop4AfterPhase: number | null; survivorsAfterPhase: number | null }[];
              };
              const phaseLabel = (p: 'early'|'mid'|'late'|'end') => t(`tft.comp.phase.${p}` as TranslationKey) as string;
              const phaseRangeLabel = (p: 'early'|'mid'|'late'|'end') =>
                t(`tft.comp.phase.${p === 'early' ? 'earlyRange' : p === 'mid' ? 'midRange' : p === 'late' ? 'lateRange' : 'endRange'}` as TranslationKey) as string;
              // Storyline-Satz aus den 2-3 stärksten KPIs zusammensetzen.
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
                <section className="mt-5 bg-[#0d1526] border border-[#1e2a3a] rounded p-4">
                  <h2 className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">
                    {t('tft.comp.death.title')}
                  </h2>

                  {/* Layer 1 — drei KPI-Karten */}
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

                  {/* Layer 2 — Storyline */}
                  {storyParts.length > 0 && (
                    <div className="bg-[#141c2e] border border-[#1e2a3a] rounded p-3 mb-3 text-[#c5d0e0] text-[13px] leading-relaxed">
                      {storyParts.join(' ')}
                    </div>
                  )}

                  {/* Layer 3 — 4-Phasen-Heatmap */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                    {story.phaseBreakdown.map(p => (
                      <PhasePanel
                        key={p.phase}
                        title={phaseLabel(p.phase)}
                        range={phaseRangeLabel(p.phase)}
                        share={p.share}
                        cumTop4={p.cumTop4AfterPhase}
                        isEndPhase={p.phase === 'end'}
                        t={t as (k: string) => string}
                      />
                    ))}
                  </div>

                  {/* Layer 4 — Detail-Chart (collapsible) */}
                  <details className="mt-3 group">
                    <summary className="cursor-pointer text-[11px] text-[#7a8aa0] hover:text-white select-none">
                      {t('tft.comp.death.detailsToggle')}
                    </summary>
                    <div className="mt-2 bg-[#141c2e] border border-[#1e2a3a] rounded p-3">
                      {(() => {
                        const hist = comp.roundHistogram as { round: number; games: number; top4: number }[];
                        const survival = (comp.survivalToTop4 || []) as { round: number; atLeast: number; top4Rate: number | null }[];
                        const survByRound = new Map(survival.map(s => [s.round, s]));
                        const chartData = hist.map(p => ({
                          round: p.round,
                          stage: formatStage(p.round),
                          games: p.games,
                          top4Rate: p.games > 0 ? (p.top4 / p.games) * 100 : 0,
                          survivalRate: (survByRound.get(p.round)?.top4Rate ?? 0) * 100,
                        }));
                        return (
                          <div style={{ width: '100%', height: 200 }}>
                            <ResponsiveContainer>
                              <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                                <XAxis dataKey="stage" tick={{ fill: '#5a6a80', fontSize: 10 }} axisLine={{ stroke: '#1e2a3a' }} tickLine={false} interval="preserveStartEnd" />
                                <YAxis yAxisId="left" tick={{ fill: '#5a6a80', fontSize: 10 }} axisLine={false} tickLine={false} width={28} />
                                <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fill: '#3ecf8e', fontSize: 10 }} axisLine={false} tickLine={false} width={32} tickFormatter={v => `${v}%`} />
                                <RechartsTooltip
                                  contentStyle={{ backgroundColor: '#0d1526', border: '1px solid #1e2a3a', borderRadius: 4, fontSize: 11 }}
                                  labelStyle={{ color: '#a0b0c5' }}
                                  formatter={(value: any, name: any): any => {
                                    if (name === 'games') return [value, t('tft.comp.dieHere')];
                                    if (name === 'survivalRate') return [`${Number(value).toFixed(0)}%`, t('tft.comp.survivalChart')];
                                    return [value, name];
                                  }}
                                />
                                <Bar yAxisId="left" dataKey="games" radius={[2, 2, 0, 0]}>
                                  {chartData.map((d, idx) => {
                                    const hue = Math.round(120 * (d.top4Rate / 100));
                                    return <Cell key={idx} fill={`hsl(${hue}, 60%, 45%)`} />;
                                  })}
                                </Bar>
                                <Line yAxisId="right" type="monotone" dataKey="survivalRate" stroke="#3ecf8e" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#3ecf8e' }} />
                              </ComposedChart>
                            </ResponsiveContainer>
                          </div>
                        );
                      })()}
                      <div className="flex justify-between text-[9px] text-[#5a6a80] mt-1.5">
                        <span><span className="inline-block w-2 h-2 bg-[#e44040] rounded-sm mr-1"/>{t('tft.comp.dieHere')}</span>
                        <span><span className="inline-block w-2 h-2 bg-[#3ecf8e] rounded-sm mr-1"/>{t('tft.comp.survivalChart')}</span>
                      </div>
                    </div>
                  </details>
                </section>
              );
            })()}

            {/* Matchups — counter edges from the comp-pair table. Beats /
                even (45–55% coin-flips) / loses-to, each linking to the
                opponent comp. Previously computed by the API but never shown. */}
            {comp.counters && ((comp.counters.beats?.length ?? 0) + (comp.counters.losesTo?.length ?? 0)) > 0 && (
              <section className="mt-5 bg-[#0d1526] border border-[#1e2a3a] rounded p-4">
                <h2 className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">{t('tft.comp.matchups')}</h2>
                {/* Even-Spalte (45-55 %) bewusst weggelassen — der Coin-Flip-Bereich
                    bringt keine Entscheidungs-Information; Spieler interessieren sich
                    nur für klare Vorteile/Nachteile. */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <MatchupColumn title={t('tft.comp.beats')}   color="#3ecf8e" edges={comp.counters.beats}   assets={assets} bucket={bucket} t={t} />
                  <MatchupColumn title={t('tft.comp.losesTo')} color="#e44040" edges={comp.counters.losesTo} assets={assets} bucket={bucket} t={t} />
                </div>
              </section>
            )}

            {/* Komponent-Priority (W1-B): rolls each top item-set up to its
                Carousel components. Pro question „welches Bauteil zuerst
                greifen?" beantwortet sich aus carryItems × recipes. Reine
                Client-Aggregation, keine zusätzlichen API-Calls. */}
            {comp.carryItems && comp.carryItems.length > 0 && assets && (() => {
              const components = aggregateComponents(comp.carryItems, assets, 6);
              if (components.length === 0) return null;
              return (
                <section className="mt-5 bg-[#0d1526] border border-[#1e2a3a] rounded p-4">
                  <h2 className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">{t('tft.comp.componentPriority')}</h2>
                  <div className="flex flex-wrap gap-2">
                    {components.map((c, i) => {
                      const meta = assets.items[c.component];
                      const url = tftIconUrl(assets, meta?.icon);
                      const pct = (c.weight * 100).toFixed(0);
                      const fromItemsTitle = c.fromItems
                        .slice(0, 4)
                        .map(it => assets.items[it]?.name || it.replace(/^TFT\d*_Item_/, ''))
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
                              <img src={url} alt={meta?.name || ''} className="w-12 h-12 rounded border-2" style={{ borderColor: i === 0 ? '#e0c75a' : '#1e2a3a' }} />
                            ) : (
                              <div className="w-12 h-12 rounded bg-[#1e2a3a]" />
                            )}
                            {i === 0 && (
                              <span className="absolute -top-1 -right-1 text-[9px] bg-[#e0c75a] text-[#0d1526] px-1 rounded font-bold">1</span>
                            )}
                          </div>
                          <div className="text-white text-[10px] mt-1 truncate max-w-full">
                            {meta?.name?.split(' ').pop() || c.component.split('_').pop()}
                          </div>
                          <div className="w-full h-1 bg-[#1e2a3a] rounded mt-1 overflow-hidden">
                            <div className="h-full bg-[#7B61FF]" style={{ width: `${pct}%` }} />
                          </div>
                          <div className="text-[#a0b0c5] text-[10px] tabular-nums">{pct}%</div>
                        </a>
                      );
                    })}
                  </div>
                </section>
              );
            })()}

            {/* Top Item-Sets pro Carry — extends what CompCard only teased
                inline. Each set shows its 3 items + relative pick share. */}
            {comp.carryItems && comp.carryItems.length > 0 && (
              <section className="mt-5 bg-[#0d1526] border border-[#1e2a3a] rounded p-4">
                <h2 className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">{t('tft.comp.topItemSets')}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {comp.carryItems.slice(0, 3).map((set: { items: string[]; count: number }, i: number) => {
                    const totalCount = comp.carryItems.reduce((s: number, c: any) => s + (Number(c.count) || 0), 0);
                    const pct = totalCount > 0 ? (Number(set.count) / totalCount) * 100 : 0;
                    return (
                      <div key={i} className="bg-[#141c2e] border border-[#1e2a3a] rounded p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[#a0b0c5] text-[10px] uppercase tracking-widest">
                            {t('tft.comp.itemSet')} {i + 1}
                          </span>
                          <span className="text-[#7B61FF] text-xs font-medium tabular-nums">
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
                                  <img src={url} alt={meta!.name} className="w-8 h-8 rounded border border-[#0d1526]" />
                                ) : (
                                  <div className="w-8 h-8 rounded bg-[#1e2a3a]" />
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

            {/* Augments-by-Stage section entfernt — Riot hat Augment-Stats
                untersagt. Datenfeld typicalAugments bleibt im API-Payload
                (Migration unverändert), aber wird nicht mehr angezeigt. */}

            {/* W3-A: Carry-Star-Outcome — wenn der Carry sein 3★ schafft,
                wie gut wird der Run typischerweise? Reroll-Comps zeigen hier
                eine drastische Spreizung zwischen 2★ und 3★, Fast-8-Comps
                kapern nur selten 3★ und schlagen sich da fast immer durch. */}
            {(comp.carryStarOutcome && comp.carryStarOutcome.length >= 2) && (() => {
              const totalGames = (comp.carryStarOutcome as { games: number }[]).reduce((s: number, x: { games: number }) => s + x.games, 0);
              if (totalGames === 0) return null;
              return (
                <section className="mt-5 bg-[#0d1526] border border-[#1e2a3a] rounded p-4">
                  <h2 className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">{t('tft.comp.carryStarOutcome')}</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {(comp.carryStarOutcome as { star: number; games: number; avgPlacement: number; top4Rate: number; top1Rate: number }[]).map((row) => {
                      const share = totalGames > 0 ? (row.games / totalGames) * 100 : 0;
                      const starColor = row.star === 3 ? '#c39bff' : row.star === 2 ? '#e0c75a' : '#9ab0bf';
                      return (
                        <div key={row.star} className="bg-[#141c2e] border rounded p-3" style={{ borderColor: `${starColor}40` }}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-base font-medium" style={{ color: starColor }}>
                              {'★'.repeat(row.star)}
                            </span>
                            <span className="text-[#7a8aa0] text-[10px] tabular-nums">
                              {share.toFixed(0)}% · {row.games}
                            </span>
                          </div>
                          <div className="grid grid-cols-3 gap-1 text-[11px] tabular-nums">
                            <div>
                              <div className="text-[#7a8aa0] text-[9px] uppercase tracking-widest">{t('tft.avgPlacement')}</div>
                              <div className="text-white text-base font-medium">{row.avgPlacement.toFixed(2)}</div>
                            </div>
                            <div>
                              <div className="text-[#7a8aa0] text-[9px] uppercase tracking-widest">{t('tft.top4')}</div>
                              <div className="text-white">{(row.top4Rate * 100).toFixed(0)}%</div>
                            </div>
                            <div>
                              <div className="text-[#7a8aa0] text-[9px] uppercase tracking-widest">{t('tft.top1')}</div>
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

            {/* W4-B: Contested-Penalty — wie stark fällt der Avg-Place ab, wenn
                2+ Spieler die gleiche Comp in der Lobby forcen. Aggregator
                schreibt das pro Match aus der Lobby-cluster_key-Verteilung. */}
            {(comp.contestedOutcome && comp.contestedOutcome.length >= 2) && (() => {
              const solo = (comp.contestedOutcome as { contested: number; avgPlacement: number; games: number; top4Rate: number; top1Rate: number }[]).find((c) => c.contested === 1);
              const totalGames = (comp.contestedOutcome as { games: number }[]).reduce((s: number, x: { games: number }) => s + x.games, 0);
              if (totalGames === 0) return null;
              return (
                <section className="mt-5 bg-[#0d1526] border border-[#1e2a3a] rounded p-4">
                  <h2 className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">{t('tft.comp.contestedPenalty')}</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {(comp.contestedOutcome as { contested: number; games: number; avgPlacement: number; top4Rate: number; top1Rate: number }[]).map((row) => {
                      const share = totalGames > 0 ? (row.games / totalGames) * 100 : 0;
                      const delta = solo && solo.games > 0 && row.contested !== 1 ? row.avgPlacement - solo.avgPlacement : null;
                      const accentColor = row.contested === 1 ? '#3ecf8e' : row.contested === 2 ? '#e0c75a' : '#e44040';
                      const label = row.contested === 1 ? t('tft.comp.contestedSolo')
                                  : row.contested === 2 ? t('tft.comp.contestedDuo')
                                  : t('tft.comp.contestedTriple');
                      return (
                        <div key={row.contested} className="bg-[#141c2e] border rounded p-3" style={{ borderColor: `${accentColor}40` }}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-medium uppercase tracking-widest" style={{ color: accentColor }}>{label}</span>
                            <span className="text-[#7a8aa0] text-[10px] tabular-nums">
                              {share.toFixed(0)}% · {row.games}
                            </span>
                          </div>
                          <div className="grid grid-cols-3 gap-1 text-[11px] tabular-nums">
                            <div>
                              <div className="text-[#7a8aa0] text-[9px] uppercase tracking-widest">{t('tft.avgPlacement')}</div>
                              <div className="text-white text-base font-medium">{row.avgPlacement.toFixed(2)}</div>
                              {delta != null && (
                                <div className="text-[10px] tabular-nums mt-0.5" style={{ color: delta > 0 ? '#e44040' : '#3ecf8e' }}>
                                  {delta > 0 ? '+' : ''}{delta.toFixed(2)}
                                </div>
                              )}
                            </div>
                            <div>
                              <div className="text-[#7a8aa0] text-[9px] uppercase tracking-widest">{t('tft.top4')}</div>
                              <div className="text-white">{(row.top4Rate * 100).toFixed(0)}%</div>
                            </div>
                            <div>
                              <div className="text-[#7a8aa0] text-[9px] uppercase tracking-widest">{t('tft.top1')}</div>
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

            {/* W3-B: Econ-ROI / Roll-Stage-Pro-Sicht. Macht aus dem rohen
                level_dist + level_sum_last_round eine Pro-lesbare Aussage:
                "Wo ist das Cap dieser Comp und wie tief kommt sie dort?" */}
            {comp.levelingTempo && comp.levelingTempo.length >= 2 && (() => {
              const lt = comp.levelingTempo as { level: number; share: number | null; avgLastRound: number | null; games: number }[];
              const valid = lt.filter(p => p.share != null && p.games >= 10);
              if (valid.length === 0) return null;
              // Cap-Level: höchste Share (ignoriert Level 4 als reine
              // Eliminations-Stutzer-Häufung; Reroll/Fast8-Modus kapitulieren
              // an Level 6/8/9). Optimaler Reach: avgLastRound bei diesem
              // Level — höher = die Comp kommt nach Cap noch tief in die
              // Lobby rein.
              const capLevel = valid.reduce((b, p) => (p.share ?? 0) > (b.share ?? 0) ? p : b);
              const chartData = valid.map(p => ({
                label: `Lvl ${p.level}`,
                share: Math.round((p.share || 0) * 100),
                avgRound: p.avgLastRound,
                avgStage: p.avgLastRound != null ? formatStage(p.avgLastRound) : '—',
              }));
              return (
                <section className="mt-5 bg-[#0d1526] border border-[#1e2a3a] rounded p-4">
                  <h2 className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">{t('tft.comp.econRoi')}</h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                    <Stat label={t('tft.comp.capLevel')} value={`Lvl ${capLevel.level}`} />
                    <Stat
                      label={t('tft.comp.capShare')}
                      value={capLevel.share != null ? `${(capLevel.share * 100).toFixed(0)}%` : '—'}
                    />
                    <Stat
                      label={t('tft.comp.capReach')}
                      value={capLevel.avgLastRound != null ? formatStage(capLevel.avgLastRound) : '—'}
                    />
                  </div>
                  <div className="bg-[#141c2e] border border-[#1e2a3a] rounded p-3">
                    <div style={{ width: '100%', height: 200 }}>
                      <ResponsiveContainer>
                        <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                          <XAxis
                            dataKey="label"
                            tick={{ fill: '#5a6a80', fontSize: 10 }}
                            axisLine={{ stroke: '#1e2a3a' }}
                            tickLine={false}
                          />
                          <YAxis
                            yAxisId="left"
                            tick={{ fill: '#5a6a80', fontSize: 10 }}
                            axisLine={false}
                            tickLine={false}
                            width={28}
                            tickFormatter={(v: any) => `${v}%`}
                          />
                          <YAxis
                            yAxisId="right"
                            orientation="right"
                            tick={{ fill: '#3ecf8e', fontSize: 10 }}
                            axisLine={false}
                            tickLine={false}
                            width={36}
                            tickFormatter={(v: any) => formatStage(Number(v))}
                            domain={[(dataMin: number) => Math.max(8, dataMin - 2), (dataMax: number) => dataMax + 2]}
                          />
                          <RechartsTooltip
                            contentStyle={{ backgroundColor: '#0d1526', border: '1px solid #1e2a3a', borderRadius: 4, fontSize: 11 }}
                            labelStyle={{ color: '#a0b0c5' }}
                            formatter={(value: any, name: any, item: any): any => {
                              if (name === 'share') return [`${value}%`, t('tft.comp.levelShare')];
                              if (name === 'avgRound') {
                                const stage = item?.payload?.avgStage;
                                return [stage, t('tft.comp.avgLastRound')];
                              }
                              return [value, name];
                            }}
                          />
                          <Bar yAxisId="left" dataKey="share" fill="#7B61FF" radius={[2, 2, 0, 0]} />
                          <Line
                            yAxisId="right"
                            type="monotone"
                            dataKey="avgRound"
                            stroke="#3ecf8e"
                            strokeWidth={2}
                            dot={{ r: 3, fill: '#3ecf8e' }}
                            activeDot={{ r: 5, fill: '#3ecf8e' }}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex justify-between text-[9px] text-[#5a6a80] mt-1.5">
                      <span><span className="inline-block w-2 h-2 bg-[#7B61FF] rounded-sm mr-1"/>{t('tft.comp.levelShare')}</span>
                      <span><span className="inline-block w-2 h-2 bg-[#3ecf8e] rounded-sm mr-1"/>{t('tft.comp.avgLastRound')}</span>
                    </div>
                  </div>
                </section>
              );
            })()}

            {/* Position heatmap per typical unit — renders empty when the
                Overwolf companion app hasn't submitted enough observations
                yet for the units in this comp. */}
            {comp.typicalUnits && comp.typicalUnits.length > 0 && (
              <PositionHeatmap
                units={comp.typicalUnits}
                carryCharacterId={parseClusterKey(comp.clusterKey)?.carry}
                clusterKey={comp.clusterKey}
                assets={assets}
              />
            )}

            {/* All typical units in larger size, clickable */}
            {comp.typicalUnits && comp.typicalUnits.length > 0 && (
              <section className="mt-5 bg-[#0d1526] border border-[#1e2a3a] rounded p-4">
                <h2 className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">{t('tft.comp.typicalUnits')}</h2>
                <div className="flex flex-wrap gap-2">
                  {comp.typicalUnits.map((u: { characterId: string; count: number }) => {
                    const ch = findChampion(assets, u.characterId);
                    const url = tftChampionTileUrl(assets, ch);
                    const cost = ch?.cost ?? 1;
                    return (
                      <a
                        key={u.characterId}
                        href={`/tft/units/${encodeURIComponent(u.characterId)}?bucket=${bucket}`}
                        className="flex flex-col items-center hover:scale-105 transition"
                      >
                        {url ? (
                          <img src={url} alt={ch!.name} className="w-12 h-12 rounded object-cover border-2" style={{ borderColor: costColor(cost) }} />
                        ) : (
                          <div className="w-12 h-12 rounded bg-[#1e2a3a]" />
                        )}
                        <div className="text-white text-[10px] mt-0.5 text-center max-w-[60px] truncate">
                          {ch?.name || u.characterId.replace(/^TFT\d+_/, '')}
                        </div>
                      </a>
                    );
                  })}
                </div>
              </section>
            )}

          </>
        )}
      </div>
      <Footer />
    </main>
  );
}

// Vollständiges Cluster-Key-Parsing inkl. aller Sub-Cluster-Suffixe:
//   *N      = N-Star-Carry-Variante
//   ~<slug> = Comp-definierendes Augment (z.B. ~TwoTanky)
//   #<id>   = Secondary-Damage-Carry
function parseClusterKey(key: string): {
  trait: string; level: number; carry: string;
  carryStar: number; augmentSlug: string | null; secondary: string | null;
} | null {
  if (!key) return null;
  const m = /^(.+)@(\d+)_([^#*~]+)(?:\*(\d))?(?:~([A-Za-z]+))?(?:#(.+))?$/.exec(key);
  if (!m) return null;
  return {
    trait: m[1], level: Number(m[2]), carry: m[3],
    carryStar: m[4] ? Number(m[4]) : 2,
    augmentSlug: m[5] || null,
    secondary: m[6] || null,
  };
}

interface CounterEdge { opponent: string; games: number; winRate: number }

// One matchup column (beats / loses-to). Each edge linkt auf die Gegen-Comp
// und zeigt Win-Rate + Sample-Size. Naming: Trait · Carry plus die gleichen
// Variant-Badges (3★ / Augment / Secondary-Carry) wie in CompCard/CompRow,
// damit der User auf einen Blick erkennt ob die Counter-Comp eine Reroll-,
// Augment- oder Dual-Carry-Variante ist.
function MatchupColumn({ title, color, edges, assets, bucket, t }: {
  title: string;
  color: string;
  edges?: CounterEdge[];
  assets: TftAssetsBundle | null;
  bucket: string;
  t: (k: any) => string;
}) {
  return (
    <div className="bg-[#141c2e] border border-[#1e2a3a] rounded p-3">
      <div className="text-[10px] uppercase tracking-widest mb-2" style={{ color }}>{title}</div>
      {!edges || edges.length === 0 ? (
        <div className="text-[#7a8aa0] text-[10px] py-1">{t('tft.comp.noMatchupData')}</div>
      ) : (
        <div className="space-y-1.5">
          {edges.map(e => {
            const parts = parseClusterKey(e.opponent);
            const traitName = parts && assets
              ? (assets.traits[parts.trait]?.name || parts.trait.replace(/^TFT\d+_/, ''))
              : '';
            const carry = parts && assets ? assets.champions[parts.carry] : null;
            const carryName = carry?.name || (parts ? parts.carry.replace(/^TFT\d+_/, '') : e.opponent);
            const url = tftChampionTileUrl(assets, carry);
            const secondaryCh = parts?.secondary && assets ? assets.champions[parts.secondary] : null;
            const secondaryName = secondaryCh?.name || (parts?.secondary ? parts.secondary.replace(/^TFT\d+_/, '') : null);
            const augApiName = parts?.augmentSlug
              ? compDefiningAugmentApiNameFromSlug(parts.augmentSlug)
              : null;
            const augName = (augApiName && assets ? assets.items[augApiName]?.name : null) || parts?.augmentSlug;
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
                  <div className="w-7 h-7 rounded bg-[#1e2a3a] flex-shrink-0 mt-0.5" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-[#a0b0c5] text-[9px] truncate">{traitName}</div>
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
                    <div className="text-[#7a8aa0] text-[9px] truncate">+ {secondaryName}</div>
                  )}
                </div>
                <div className="flex flex-col items-end flex-shrink-0">
                  <span className="text-[11px] tabular-nums font-medium" style={{ color }}>{(e.winRate * 100).toFixed(0)}%</span>
                  <span className="text-[#5a6a80] text-[9px] tabular-nums">{e.games}</span>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

function prettyComp(slug: string) {
  const m = /^(.+)@(\d+)_(.+)$/.exec(slug);
  if (!m) return slug;
  return `${m[1].replace(/^TFT\d+_/, '')} ${m[2]} · ${m[3].replace(/^TFT\d+_/, '')}`;
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
    <div className="bg-[#0a0e1a] border border-[#1e2a3a] rounded px-3 py-2">
      <div className="text-[#a0b0c5] text-[10px] uppercase tracking-widest">{label}</div>
      <div className="text-white text-base font-semibold mt-0.5">{value}</div>
    </div>
  );
}

// Pro-vs-Solo-Queue delta stat. Shows the pro value as the headline plus a
// signed Δ vs the regular bucket. `lowerIsBetter` flips the green/red color
// for metrics like avg placement (lower = stronger). `rawOnly` shows the
// pro number without a Δ — used for sample-size context where there's no
// comparable "ladder" denominator that makes sense to subtract.
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
      <div className="bg-[#0a0e1a] border border-[#1e2a3a] rounded px-3 py-2">
        <div className="text-[#a0b0c5] text-[10px] uppercase tracking-widest">{label}</div>
        <div className="text-[#7a8aa0] text-base font-semibold mt-0.5">—</div>
      </div>
    );
  }
  const delta = solo != null ? pro - solo : null;
  const betterColor = '#3ecf8e';
  const worseColor = '#e44040';
  const color = delta == null || delta === 0
    ? '#a0b0c5'
    : (lowerIsBetter ? (delta < 0 ? betterColor : worseColor)
                     : (delta > 0 ? betterColor : worseColor));
  const arrow = delta == null || delta === 0
    ? ''
    : (lowerIsBetter ? (delta < 0 ? '▲' : '▼')
                     : (delta > 0 ? '▲' : '▼'));
  return (
    <div className="bg-[#0a0e1a] border border-[#1e2a3a] rounded px-3 py-2">
      <div className="text-[#a0b0c5] text-[10px] uppercase tracking-widest">{label}</div>
      <div className="text-white text-base font-semibold mt-0.5 tabular-nums">{fmt(pro)}</div>
      {!rawOnly && delta != null && (
        <div className="text-[10px] tabular-nums mt-0.5" style={{ color }}>
          {arrow} {fmt(Math.abs(delta))} vs Solo-Queue
        </div>
      )}
    </div>
  );
}


// Light heuristic: comps that hit higher avg level for the same last-round
// were leveling faster than the lobby average, so we tag them "early-level"
// vs "slow-roll". Threshold is loose — there's no objective truth here, but
// avg-level <= 7 with similar last-round signals a reroll archetype.
function tempoLabel(avgLevel: number | null | undefined, avgRound: number | null | undefined, t: (k: any) => string): string {
  if (avgLevel == null) return '—';
  if (avgLevel >= 8.5) return t('tft.comp.tempo.fastEight');
  if (avgLevel <= 7.0) return t('tft.comp.tempo.slowRoll');
  return t('tft.comp.tempo.balanced');
}

// Death-Story KPI-Karte: Hauptzahl + Sub-Beschreibung, akzentuiert in
// passender Farbe (rot=Risiko, gelb=Übergang, grün=Safe).
function DeathKpi({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div className="bg-[#141c2e] border border-[#1e2a3a] rounded p-3" style={{ borderLeft: `3px solid ${accent}` }}>
      <div className="text-[#7a8aa0] text-[10px] uppercase tracking-widest">{label}</div>
      <div className="text-white text-lg font-medium mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-[#7a8aa0] text-[11px] mt-1">{sub}</div>}
    </div>
  );
}

// Phasen-Panel der 4-Bucket-Heatmap. Zeigt pro Phase den Anteil der Spiele
// die HIER endeten + die Top-4-Rate für die, die diese Phase überlebt haben.
// Farbe der Top-4-Bar mappt grün (90%+) → gelb → rot.
function PhasePanel({
  title, range, share, cumTop4, isEndPhase, t,
}: {
  title: string;
  range: string;
  share: number;
  cumTop4: number | null;
  isEndPhase: boolean;
  t: (k: string) => string;
}) {
  const sharePct = Math.round(share * 100);
  const top4Pct = cumTop4 != null ? Math.round(cumTop4 * 100) : null;
  const hue = top4Pct != null ? Math.round(120 * (top4Pct / 100)) : 0;
  return (
    <div className="bg-[#141c2e] border border-[#1e2a3a] rounded p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-white text-sm font-medium">{title}</span>
        <span className="text-[#5a6a80] text-[10px]">{range}</span>
      </div>
      <div className="mt-2 text-[10px] text-[#7a8aa0]">
        {t('tft.comp.phase.diedHere')}
      </div>
      <div className="text-white text-base font-medium tabular-nums">{sharePct}%</div>
      <div className="mt-1 h-1 bg-[#1e2a3a] rounded overflow-hidden">
        <div className="h-full bg-[#e44040]" style={{ width: `${Math.min(100, sharePct * 2)}%` }} />
      </div>
      {!isEndPhase && top4Pct != null && (
        <>
          <div className="mt-2 text-[10px] text-[#7a8aa0]">
            {t('tft.comp.phase.top4IfSurvived')}
          </div>
          <div className="text-white text-base font-medium tabular-nums" style={{ color: `hsl(${hue}, 60%, 60%)` }}>
            {top4Pct}%
          </div>
          <div className="mt-1 h-1 bg-[#1e2a3a] rounded overflow-hidden">
            <div className="h-full" style={{ width: `${top4Pct}%`, backgroundColor: `hsl(${hue}, 60%, 50%)` }} />
          </div>
        </>
      )}
    </div>
  );
}

// Board-Komposition: pro Unit ein Slot mit Farbcode nach Cooccurrence-Klasse.
// Hover zeigt %-Cooccurrence; Core = immer dabei, Flex = situativ, Tech = gezielt.
function BoardCompositionPanel({
  composition,
  assets,
  t,
}: {
  composition: { core: number; flex: number; tech: number; slots: Array<{ characterId: string; count: number; cooccurrence: number; kind: 'core' | 'flex' | 'tech' }> };
  assets: TftAssetsBundle | null;
  t: (k: string) => string;
}) {
  const COLORS = {
    core: { ring: '#7B61FF', label: '#c39bff', bg: 'rgba(123,97,255,0.15)' },
    flex: { ring: '#3a8ddc', label: '#7ab9ec', bg: 'rgba(58,141,220,0.12)' },
    tech: { ring: '#5a6a80', label: '#7a8aa0', bg: 'rgba(90,106,128,0.12)' },
  } as const;
  return (
    <div className="bg-[#141c2e] border border-[#1e2a3a] rounded p-3 mb-3">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[#7a8aa0] text-[10px] uppercase tracking-widest">{t('tft.comp.board.title')}</span>
        <div className="flex gap-3 text-[11px] tabular-nums">
          <span style={{ color: COLORS.core.label }}>{composition.core} {t('tft.comp.board.core')}</span>
          <span style={{ color: COLORS.flex.label }}>{composition.flex} {t('tft.comp.board.flex')}</span>
          <span style={{ color: COLORS.tech.label }}>{composition.tech} {t('tft.comp.board.tech')}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {composition.slots.map(s => {
          const ch = findChampion(assets, s.characterId);
          const url = tftChampionTileUrl(assets, ch);
          const c = COLORS[s.kind];
          const pct = Math.round(s.cooccurrence * 100);
          return (
            <a
              key={s.characterId}
              href={`/tft/units/${encodeURIComponent(s.characterId)}`}
              title={`${ch?.name || s.characterId} — ${pct}% ${t(`tft.comp.board.${s.kind}`)}`}
              className="relative flex flex-col items-center gap-0.5 hover:scale-105 transition-transform"
            >
              <div
                className="w-10 h-10 rounded border-2 overflow-hidden"
                style={{ borderColor: c.ring, backgroundColor: c.bg }}
              >
                {url && <img src={url} alt={ch?.name || s.characterId} className="w-full h-full object-cover" />}
              </div>
              <span className="text-[9px] tabular-nums" style={{ color: c.label }}>{pct}%</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
