'use client';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import {
  ResponsiveContainer, ComposedChart, AreaChart, Area, Bar, Line, XAxis, YAxis,
  Tooltip as RechartsTooltip, ReferenceLine, Cell,
} from 'recharts';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import TierFilter, { type TierBucket } from '../../../components/tft/TierFilter';
import EmptyData from '../../../components/tft/EmptyData';
import CompCard from '../../../components/tft/CompCard';
import { useI18n } from '../../../lib/i18n';
import { loadTftAssets, tftIconUrl, tftChampionTileUrl, type TftAssetsBundle } from '../../../lib/tft-cdragon';
import PositionHeatmap from '../../../components/tft/PositionHeatmap';
import { formatStage } from '../../../lib/tft-stage';
import { aggregateComponents } from '../../../lib/tft-components';

// Slot meaning in tft_daily_augment_stats: 0 = stage 2-1, 1 = 3-2, 2 = 4-2.
const SLOT_LABELS = ['2-1', '3-2', '4-2'] as const;

interface AugmentRow {
  apiName: string;
  slot: number | null;
  games: number;
  avgPlacement: number | null;
}

export default function TftCompDetailPage() {
  const { t } = useI18n();
  const params = useParams();
  const search = useSearchParams();
  const slug = decodeURIComponent(String(params?.slug || ''));
  // Region from the URL — the comps list passes ?region=… in the href and its
  // default is 'all'. Was hardcoded to 'euw1', which made the detail show
  // "no data" for any comp with <30 games in euw1 but popular across all
  // regions (list aggregated all regions, detail only queried euw1).
  const region = search.get('region') || 'all';
  const [bucket, setBucket] = useState<TierBucket>((search.get('bucket') as TierBucket) || 'master_plus');
  const [comp, setComp] = useState<any | null | undefined>(undefined);
  const [proComp, setProComp] = useState<any | null>(null);
  const [hasData, setHasData] = useState<boolean | null>(null);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  // Per-slot augment lookup: apiName -> { 0: {games, avgPlacement}, 1: {…}, 2: {…} }
  const [augmentSlotMap, setAugmentSlotMap] = useState<Record<string, Record<number, { games: number; avgPlacement: number | null }>>>({});

  useEffect(() => { loadTftAssets().then(setAssets); }, []);

  useEffect(() => {
    // Pull the normal-bucket comp + the pro-pool variant in parallel so the
    // "Pro vs Solo Queue" section lights up as soon as both arrive.
    Promise.all([
      fetch(`/api/tft/comps?region=${region}&bucket=${bucket}&slug=${encodeURIComponent(slug)}`).then(r => r.json()),
      fetch(`/api/tft/comps?region=all&bucket=pro_pool&slug=${encodeURIComponent(slug)}&minGames=5`).then(r => r.ok ? r.json() : { comp: null }),
    ]).then(([normal, pro]) => {
      setHasData(!!normal.hasData);
      setComp(normal.comp || null);
      setProComp(pro.comp || null);
    }).catch(() => { setHasData(false); setComp(null); });
  }, [bucket, slug, region]);

  // Pull augment-by-slot stats so we can show each typical augment's likely
  // offer slot (2-1 / 3-2 / 4-2). Done in parallel with the comp fetch so
  // the slot pills land as the comp data renders.
  useEffect(() => {
    Promise.all([0, 1, 2].map(slot =>
      fetch(`/api/tft/augments?region=${region}&bucket=${bucket}&slot=${slot}`)
        .then(r => r.ok ? r.json() : { augments: [] })
        .then(d => ({ slot, augments: (d.augments || []) as AugmentRow[] }))
        .catch(() => ({ slot, augments: [] as AugmentRow[] }))
    )).then(results => {
      const map: typeof augmentSlotMap = {};
      for (const { slot, augments } of results) {
        for (const a of augments) {
          if (!map[a.apiName]) map[a.apiName] = {};
          map[a.apiName][slot] = { games: a.games, avgPlacement: a.avgPlacement };
        }
      }
      setAugmentSlotMap(map);
    });
  }, [bucket, region]);

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="comps" />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <a href="/tft/comps" className="text-[#7B61FF] text-xs hover:underline">← {t('nav.comps')}</a>

        <div className="flex justify-end mt-2 mb-4">
          <TierFilter value={bucket} onChange={setBucket} />
        </div>

        {hasData === false && <EmptyData />}
        {comp === null && hasData && (
          <div className="text-[#a0b0c5] text-center py-8">{t('tft.comp.notFound')}</div>
        )}

        {comp && (
          <>
            <CompCard comp={comp} assets={assets} />

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

            {/* Comp-DNA: Aggro-Index + Skill-Cap-Index + Leveling-Tempo-Curve.
                Sprint-2 stack — three data angles no other TFT site exposes. */}
            {(comp.aggroIndex != null || comp.skillCapIndex != null || (comp.levelingTempo && comp.levelingTempo.length > 0) || comp.flexScore != null) && (
              <section className="mt-5 bg-[#0d1526] border border-[#1e2a3a] rounded p-4">
                <h2 className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">{t('tft.comp.compDna')}</h2>
                {comp.flexScore != null && (
                  <div className="bg-[#141c2e] border border-[#1e2a3a] rounded p-3 mb-3">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[#7a8aa0] text-[10px] uppercase tracking-widest">{t('tft.comp.flexScore')}</span>
                      <span className="text-white text-xl font-medium tabular-nums">{(comp.flexScore * 100).toFixed(0)}</span>
                      <span className="text-[#a0b0c5] text-[11px]">
                        {comp.flexScore >= 0.85 ? t('tft.comp.flex.flexible') :
                         comp.flexScore >= 0.7 ? t('tft.comp.flex.adaptive') :
                         t('tft.comp.flex.locked')}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 bg-[#1e2a3a] rounded overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-[#e44040] via-[#f0c040] to-[#3ecf8e]" style={{ width: `${(comp.flexScore * 100).toFixed(0)}%` }} />
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {comp.aggroIndex != null && (
                    <div className="bg-[#141c2e] border border-[#1e2a3a] rounded p-3">
                      <div className="text-[#7a8aa0] text-[10px] uppercase tracking-widest">{t('tft.comp.aggroIndex')}</div>
                      <div className="text-white text-xl font-medium mt-1 tabular-nums">{comp.aggroIndex.toFixed(2)}</div>
                      <div className="text-[#a0b0c5] text-[11px] mt-1">
                        {comp.aggroIndex >= 1.2 ? t('tft.comp.aggro.push')
                          : comp.aggroIndex >= 0.7 ? t('tft.comp.aggro.balanced')
                          : t('tft.comp.aggro.econ')}
                      </div>
                    </div>
                  )}
                  {comp.skillCapIndex != null && (
                    <div className="bg-[#141c2e] border border-[#1e2a3a] rounded p-3">
                      <div className="text-[#7a8aa0] text-[10px] uppercase tracking-widest">{t('tft.comp.skillCap')}</div>
                      <div className="text-white text-xl font-medium mt-1 tabular-nums">Δ {comp.skillCapIndex.toFixed(2)}</div>
                      <div className="text-[#a0b0c5] text-[11px] mt-1">
                        {comp.skillCapIndex >= 1.0 ? t('tft.comp.skillCap.execution')
                          : comp.skillCapIndex >= 0.5 ? t('tft.comp.skillCap.medium')
                          : t('tft.comp.skillCap.consistent')}
                      </div>
                      {comp.skillCapBuckets && comp.skillCapBuckets.length > 0 && (() => {
                        // Visual bar comparison: lower avg_place = better,
                        // map 1..8 placement range to a 0..1 quality bar.
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
                                  <span className="text-[#a0b0c5] w-16 truncate">{t(`tft.bucket.${bk.bucket}` as any) || bk.bucket}</span>
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
                  {comp.levelingTempo && comp.levelingTempo.length > 0 && (() => {
                    // Tempo curve: share of games ending at each final level.
                    // The peak shows where this comp typically tops out; the
                    // tooltip carries the avg death-round per level.
                    const pts = (comp.levelingTempo as { level: number; share: number | null; avgLastRound: number | null }[])
                      .filter(p => p.share != null);
                    if (pts.length === 0) return null;
                    const chartData = pts.map(p => ({
                      level: `Lvl ${p.level}`,
                      share: Math.round((p.share || 0) * 100),
                      avgLastRound: p.avgLastRound,
                    }));
                    return (
                      <div className="bg-[#141c2e] border border-[#1e2a3a] rounded p-3">
                        <div className="text-[#7a8aa0] text-[10px] uppercase tracking-widest mb-1.5">{t('tft.comp.levelTempo')}</div>
                        <div style={{ width: '100%', height: 132 }}>
                          <ResponsiveContainer>
                            <AreaChart data={chartData} margin={{ top: 4, right: 6, left: -26, bottom: 0 }}>
                              <defs>
                                <linearGradient id="tempoFill" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#7B61FF" stopOpacity={0.5} />
                                  <stop offset="100%" stopColor="#7B61FF" stopOpacity={0.05} />
                                </linearGradient>
                              </defs>
                              <XAxis dataKey="level" tick={{ fill: '#5a6a80', fontSize: 9 }} axisLine={{ stroke: '#1e2a3a' }} tickLine={false} interval={0} />
                              <YAxis tick={{ fill: '#5a6a80', fontSize: 9 }} axisLine={false} tickLine={false} width={30} tickFormatter={(v: any) => `${v}%`} />
                              <RechartsTooltip
                                contentStyle={{ backgroundColor: '#0d1526', border: '1px solid #1e2a3a', borderRadius: 4, fontSize: 11 }}
                                labelStyle={{ color: '#a0b0c5' }}
                                formatter={(value: any, _name: any, item: any) => {
                                  const alr = item?.payload?.avgLastRound;
                                  return [`${value}%${alr != null ? ` · Ø ${formatStage(alr)}` : ''}`, t('tft.comp.levelShare')];
                                }}
                              />
                              <Area type="monotone" dataKey="share" stroke="#7B61FF" strokeWidth={2} fill="url(#tempoFill)" />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </section>
            )}

            {/* Death-Round + Survival-to-Top4 — unique to metastats. Shows
                where this comp dies in the lobby distribution and at which
                round the "you're safe to commit" inflection happens. */}
            {comp.roundHistogram && comp.roundHistogram.length > 0 && (() => {
              const hist: { round: number; games: number; top4: number }[] = comp.roundHistogram;
              const survival: { round: number; atLeast: number; top4Rate: number | null }[] = comp.survivalToTop4 || [];
              const maxGames = hist.reduce((m, p) => Math.max(m, p.games), 0) || 1;
              const totalGames = comp.games || 1;
              const modeBin = hist.reduce((best, p) => (p.games > best.games ? p : best), hist[0]);
              // Survival inflection: lowest round at which top4-rate ≥ 0.5
              const inflection = survival.find(p => (p.top4Rate ?? 0) >= 0.5);
              const inflectionPct = inflection && inflection.atLeast
                ? (inflection.atLeast / totalGames) * 100
                : null;
              return (
                <section className="mt-5 bg-[#0d1526] border border-[#1e2a3a] rounded p-4">
                  <h2 className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">
                    {t('tft.comp.deathCurve')}
                  </h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                    <Stat label={t('tft.comp.modeRound')} value={modeBin ? formatStage(modeBin.round) : '—'} />
                    <Stat
                      label={t('tft.comp.survivalInflection')}
                      value={inflection ? `${formatStage(inflection.round)} (${(inflection.top4Rate! * 100).toFixed(0)}%)` : '—'}
                    />
                    <Stat
                      label={t('tft.comp.inflectionShare')}
                      value={inflectionPct != null ? `${inflectionPct.toFixed(0)}%` : '—'}
                    />
                  </div>
                  <div className="bg-[#141c2e] border border-[#1e2a3a] rounded p-3">
                    {(() => {
                      // Merge histogram + survival data into a single dataset
                      // so Recharts renders the death-bar histogram + the
                      // survival→top4 line over the same X-axis.
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
                              <XAxis
                                dataKey="stage"
                                tick={{ fill: '#5a6a80', fontSize: 10 }}
                                axisLine={{ stroke: '#1e2a3a' }}
                                tickLine={false}
                                interval="preserveStartEnd"
                              />
                              <YAxis
                                yAxisId="left"
                                tick={{ fill: '#5a6a80', fontSize: 10 }}
                                axisLine={false}
                                tickLine={false}
                                width={28}
                              />
                              <YAxis
                                yAxisId="right"
                                orientation="right"
                                domain={[0, 100]}
                                tick={{ fill: '#3ecf8e', fontSize: 10 }}
                                axisLine={false}
                                tickLine={false}
                                width={32}
                                tickFormatter={v => `${v}%`}
                              />
                              <RechartsTooltip
                                contentStyle={{
                                  backgroundColor: '#0d1526',
                                  border: '1px solid #1e2a3a',
                                  borderRadius: 4,
                                  fontSize: 11,
                                }}
                                labelStyle={{ color: '#a0b0c5' }}
                                formatter={(value: any, name: any): any => {
                                  if (name === 'games') return [value, t('tft.comp.dieHere')];
                                  if (name === 'survivalRate') return [`${Number(value).toFixed(0)}%`, t('tft.comp.survivalChart')];
                                  return [value, name];
                                }}
                              />
                              {modeBin && (
                                <ReferenceLine
                                  yAxisId="left"
                                  x={formatStage(modeBin.round)}
                                  stroke="#7B61FF"
                                  strokeDasharray="3 3"
                                  strokeOpacity={0.6}
                                />
                              )}
                              <Bar yAxisId="left" dataKey="games" radius={[2, 2, 0, 0]}>
                                {chartData.map((d, idx) => {
                                  const hue = Math.round(120 * (d.top4Rate / 100));
                                  return <Cell key={idx} fill={`hsl(${hue}, 60%, 45%)`} />;
                                })}
                              </Bar>
                              <Line
                                yAxisId="right"
                                type="monotone"
                                dataKey="survivalRate"
                                stroke="#3ecf8e"
                                strokeWidth={2}
                                dot={false}
                                activeDot={{ r: 4, fill: '#3ecf8e' }}
                              />
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
                </section>
              );
            })()}

            {/* Matchups — counter edges from the comp-pair table. Beats /
                even (45–55% coin-flips) / loses-to, each linking to the
                opponent comp. Previously computed by the API but never shown. */}
            {comp.counters && ((comp.counters.beats?.length ?? 0) + (comp.counters.even?.length ?? 0) + (comp.counters.losesTo?.length ?? 0)) > 0 && (
              <section className="mt-5 bg-[#0d1526] border border-[#1e2a3a] rounded p-4">
                <h2 className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">{t('tft.comp.matchups')}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <MatchupColumn title={t('tft.comp.beats')}   color="#3ecf8e" edges={comp.counters.beats}   assets={assets} bucket={bucket} t={t} />
                  <MatchupColumn title={t('tft.comp.even')}    color="#a0b0c5" edges={comp.counters.even}    assets={assets} bucket={bucket} t={t} />
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
                        <div
                          key={c.component}
                          title={`${meta?.name || c.component} — ${t('tft.comp.componentInItems')}: ${fromItemsTitle}`}
                          className="flex flex-col items-center w-16"
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
                        </div>
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
                            const meta = assets?.items[it];
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

            {/* Augments grouped by likely stage offer — joined client-side
                with the per-slot augment-stats endpoint. Each augment lands
                in the slot where it has the most games (= dominant offer
                stage), so users see at a glance "this comp wants X at 2-1,
                Y at 3-2, Z at 4-2". */}
            {comp.typicalAugments && comp.typicalAugments.length > 0 && (
              <section className="mt-5 bg-[#0d1526] border border-[#1e2a3a] rounded p-4">
                <h2 className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">{t('tft.comp.augmentsByStage')}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[0, 1, 2].map(slot => {
                    const augmentsForSlot = (comp.typicalAugments as { apiName: string; count: number }[])
                      .filter(a => {
                        const slotMap = augmentSlotMap[a.apiName];
                        if (!slotMap) return false;
                        // Find dominant slot for this augment
                        const slots = Object.entries(slotMap).map(([k, v]) => ({ slot: Number(k), games: v.games }));
                        if (slots.length === 0) return false;
                        const dominant = slots.reduce((a, b) => a.games > b.games ? a : b);
                        return dominant.slot === slot;
                      })
                      .slice(0, 4);
                    return (
                      <div key={slot} className="bg-[#141c2e] border border-[#1e2a3a] rounded p-3">
                        <div className="text-[#a0b0c5] text-[10px] uppercase tracking-widest mb-2">
                          {t('tft.comp.stage')} {SLOT_LABELS[slot]}
                        </div>
                        {augmentsForSlot.length === 0 ? (
                          <div className="text-[#7a8aa0] text-[10px] py-2">{t('tft.comp.noStageData')}</div>
                        ) : (
                          <div className="space-y-1.5">
                            {augmentsForSlot.map(a => {
                              const meta = assets?.augments[a.apiName];
                              const url = tftIconUrl(assets, meta?.icon);
                              const tierColor = meta?.tier === 3 ? '#c39bff' : meta?.tier === 2 ? '#e0c75a' : '#9ab0bf';
                              return (
                                <div key={a.apiName} className="flex items-center gap-2">
                                  {url ? (
                                    <img src={url} alt={meta!.name} title={meta!.name} className="w-7 h-7 rounded border" style={{ borderColor: tierColor }} />
                                  ) : (
                                    <div className="w-7 h-7 rounded border bg-[#1e2a3a]" style={{ borderColor: tierColor }} title={a.apiName} />
                                  )}
                                  <span className="text-white text-[11px] truncate flex-1" style={{ color: tierColor }}>
                                    {meta?.name || a.apiName.replace(/^TFT\d+_Augment_/, '')}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

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
                    const ch = assets?.champions[u.characterId];
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

function parseClusterKey(key: string): { trait: string; level: number; carry: string } | null {
  if (!key) return null;
  const m = /^(.+)@(\d+)_(.+)$/.exec(key);
  if (!m) return null;
  return { trait: m[1], level: Number(m[2]), carry: m[3] };
}

interface CounterEdge { opponent: string; games: number; winRate: number }

// One matchup column (beats / even / loses-to). Each edge links to the
// opponent comp's page and shows this comp's win-rate vs it + sample size.
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
            const traitName = parts && assets ? (assets.traits[parts.trait]?.name || parts.trait.replace(/^TFT\d+_/, '')) : '';
            const carry = parts && assets ? assets.champions[parts.carry] : null;
            const url = tftChampionTileUrl(assets, carry);
            const label = carry?.name || (parts ? parts.carry.replace(/^TFT\d+_/, '') : e.opponent);
            return (
              <a
                key={e.opponent}
                href={`/tft/comps/${encodeURIComponent(e.opponent)}?bucket=${bucket}`}
                title={`${traitName} · ${label}`}
                className="flex items-center gap-2 hover:opacity-80 transition"
              >
                {url ? (
                  <img src={url} alt="" className="w-6 h-6 rounded border border-[#c39bff]/50 flex-shrink-0" />
                ) : (
                  <div className="w-6 h-6 rounded bg-[#1e2a3a] flex-shrink-0" />
                )}
                <span className="text-white text-[11px] truncate flex-1 min-w-0">{label}</span>
                <span className="text-[10px] tabular-nums flex-shrink-0" style={{ color }}>{(e.winRate * 100).toFixed(0)}%</span>
                <span className="text-[#5a6a80] text-[9px] tabular-nums flex-shrink-0 w-7 text-right">{e.games}</span>
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
