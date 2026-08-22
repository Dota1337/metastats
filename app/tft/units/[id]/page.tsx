'use client';
import { useEffect, useState, Fragment } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  Tooltip as RechartsTooltip, ReferenceLine,
} from 'recharts';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import TierFilter, { type TierBucket } from '../../../components/tft/TierFilter';
import EmptyData from '../../../components/tft/EmptyData';
import { useI18n } from '../../../lib/i18n';
import { tftPatchLabel } from '../../../lib/tft-patch-label';
import { loadTftAssets, tftIconUrl, tftChampionTileUrl, tftTraitDisplayName, type TftAssetsBundle } from '../../../lib/tft-cdragon';
import { buildExplorerUrl } from '../../../lib/tft-explorer-url';
import { parseClusterKey } from '../../../lib/tft-cluster';

type ItemEntry = { item: string; games: number; avgPlacement: number | null; top4Rate: number | null };
type ItemSetEntry = { items: string[]; games: number; avgPlacement: number | null; top4Rate: number | null };
type DamageBin = { games: number; p50: number | null; p75: number | null; p95: number | null; p99: number | null; max: number | null };
type CarryPerfBin = { games: number; avgPlacement: number | null; top4Rate: number | null; top1Rate: number | null };
type SlotEntry = { item: string; count: number };

interface UnitDetail {
  characterId: string;
  games: number;
  avgPlacement: number | null;
  top4Rate: number | null;
  top1Rate: number | null;
  topItems: ItemEntry[];
  topItemSets: ItemSetEntry[];
  topItemsByTier: Record<string, ItemEntry[]> | null;
  topItemSetsByTier: Record<string, ItemSetEntry[]> | null;
  damageByTier: Record<string, Record<string, DamageBin>> | null;
  carryPlacementByTier: Record<string, Record<string, CarryPerfBin>> | null;
  itemSlotOrderByTier: Record<string, Record<string, SlotEntry[]>> | null;
}

type StarTier = 'all' | '1' | '2' | '3';
// Item-Count-Filter (0-3 Items pro Carry). null = kein Filter aktiv. Wird
// zusammen mit StarTier zum 2D-Filter auf der Carry-Heatmap.
type ItemCount = null | 0 | 1 | 2 | 3;

interface CompWithUnit {
  slug: string;
  clusterKey: string;
  games: number;
  avgPlacement: number | null;
  top4Rate: number | null;
}

export default function TftUnitDetailPage() {
  const { t } = useI18n();
  const params = useParams();
  const search = useSearchParams();
  const id = decodeURIComponent(String(params?.id || ''));
  const initialBucket = (search.get('bucket') as TierBucket) || 'master_plus';
  const [bucket, setBucket] = useState<TierBucket>(initialBucket);
  const [star, setStar] = useState<StarTier>('all');
  const [itemCount, setItemCount] = useState<ItemCount>(null);
  const [data, setData] = useState<UnitDetail | null | undefined>(undefined);
  const [hasData, setHasData] = useState<boolean | null>(null);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  const [comps, setComps] = useState<CompWithUnit[]>([]);
  const [timeline, setTimeline] = useState<Array<{ patch: string; avgPlacement: number; top4Rate: number; pickRate: number | null; games: number }>>([]);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);
  // Unit-Patch-Timeline (Sprint 5.2): avg_place across last 5 patches.
  useEffect(() => {
    fetch(`/api/tft/unit-history?characterId=${encodeURIComponent(id)}&bucket=${bucket}&patches=5`)
      .then(r => r.ok ? r.json() : { timeline: [] })
      .then(d => setTimeline(d.timeline || []))
      .catch(() => setTimeline([]));
  }, [id, bucket]);
  // Reset star-tier selector when switching units/buckets if the new snapshot
  // doesn't have per-tier data for the currently-selected tier.
  useEffect(() => {
    if (!data) return;
    const tierKeys = data.topItemsByTier ? Object.keys(data.topItemsByTier) : [];
    if (tierKeys.length === 0 && star !== 'all') setStar('all');
    else if (star !== 'all' && !data.topItemsByTier?.[star]?.length) setStar('all');
  }, [data, star]);
  useEffect(() => {
    fetch(`/api/tft/units?region=euw1&bucket=${bucket}&id=${encodeURIComponent(id)}`)
      .then(r => r.json())
      .then(d => { setHasData(!!d.hasData); setData(d.unit || null); })
      .catch(() => { setHasData(false); setData(null); });
    // Pull comps and filter client-side for ones containing this champion as
    // a typical unit. Pro-Frage „in welchen Comps spielt der Champion?" auf
    // der Detail-Seite ohne extra API surface.
    fetch(`/api/tft/comps?region=euw1&bucket=${bucket}&days=3&patch=current&source=data`)
      .then(r => r.json())
      .then(d => {
        const withUnit = (d.comps || [])
          .filter((c: any) => (c.typicalUnits || []).some((u: any) => u.characterId === id))
          .slice(0, 6)
          .map((c: any) => ({
            slug: c.slug,
            clusterKey: c.clusterKey,
            games: c.games,
            avgPlacement: c.avgPlacement,
            top4Rate: c.top4Rate,
          }));
        setComps(withUnit);
      })
      .catch(() => setComps([]));
  }, [bucket, id]);

  const champ = assets?.champions[id];

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav active="units" />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <div className="bg-surface-base border border-border-subtle rounded-lg p-5 mb-5">
          <a href="/tft/units" className="text-accent text-xs hover:underline">← {t('nav.units')}</a>
          <div className="flex items-center gap-4 mt-2">
            {tftChampionTileUrl(assets, champ) ? (
              <img src={tftChampionTileUrl(assets, champ)!} alt={champ!.name} className="w-16 h-16 rounded-lg border-2 border-accent object-cover" />
            ) : (
              <div className="w-16 h-16 rounded-lg bg-surface-overlay" />
            )}
            <div className="flex-1">
              <h1 className="text-white text-2xl font-medium">{champ?.name || prettyChar(id)}</h1>
              <div className="text-fg-secondary text-xs mt-0.5">
                {champ?.cost ? `${champ.cost}-Cost` : ''}
                {champ?.traits?.length ? (
                  <>
                    {' · '}
                    {champ.traits.map((tr, i) => (
                      <span key={tr}>
                        {i > 0 && ' · '}
                        <a
                          href={`/tft/traits/${encodeURIComponent(tr)}`}
                          className="hover:text-accent transition-colors"
                        >
                          {tftTraitDisplayName(assets, tr) || prettyChar(tr)}
                        </a>
                      </span>
                    ))}
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end items-center gap-2 mb-4">
          <a
            href={buildExplorerUrl({ units: [id], bucket })}
            className="px-2.5 py-1.5 rounded text-xs bg-surface-raised border border-border-subtle text-fg-secondary hover:text-white hover:border-accent-a60 transition-colors flex items-center gap-1.5"
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
        {data === null && hasData && (
          <div className="text-fg-secondary text-center py-8">{t('tft.unit.notFound')}</div>
        )}
        {data && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              <Stat label={t('tft.avgPlacement')} value={data.avgPlacement?.toFixed(2) ?? '—'} />
              <Stat label={t('tft.top4')} value={data.top4Rate != null ? `${(data.top4Rate * 100).toFixed(1)}%` : '—'} />
              <Stat label={t('tft.top1')} value={data.top1Rate != null ? `${(data.top1Rate * 100).toFixed(1)}%` : '—'} />
              <Stat label={t('tft.gamesShort')} value={data.games.toLocaleString('de-DE')} />
            </div>

            {/* Star-tier selector (BiS by star level). Hidden if the snapshot
                doesn't carry per-tier data yet (pre-rollout JSONs). */}
            {data.topItemsByTier && Object.keys(data.topItemsByTier).length > 0 && (
              <div className="flex items-center gap-2 mb-3">
                <span className="text-fg-muted text-[11px] uppercase tracking-widest">{t('tft.byStarLevel')}</span>
                <div className="flex gap-1">
                  {(['all','1','2','3'] as StarTier[]).map(k => {
                    const active = star === k;
                    const label = k === 'all' ? t('tft.starTierAll') : `${k}★`;
                    const disabled = k !== 'all' && !data.topItemsByTier?.[k]?.length;
                    return (
                      <button
                        key={k}
                        type="button"
                        disabled={disabled}
                        onClick={() => setStar(k)}
                        className={`px-2.5 py-1 text-[11px] rounded border transition-colors ${
                          active
                            ? 'bg-accent border-accent text-white'
                            : disabled
                            ? 'bg-surface-raised border-border-subtle text-[#3a4555] cursor-not-allowed'
                            : 'bg-surface-raised border-border-subtle text-fg-secondary hover:border-accent-a40'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Single-screen grid: Item-Sets, Single-Items, Comps with unit. */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {(() => {
                const itemSets = star === 'all'
                  ? data.topItemSets
                  : (data.topItemSetsByTier?.[star] || []);
                return itemSets.length > 0 && (
                  <Section title={t('tft.topBuilds')}>
                    <div className="space-y-2">
                      {itemSets.slice(0, 5).map((s, i) => (
                        <div key={i} className="flex items-center gap-3 bg-surface-raised border border-border-subtle rounded p-2.5">
                          <div className="flex gap-1">
                            {s.items.map((it, j) => <ItemIcon key={j} apiName={it} assets={assets} size={9} />)}
                          </div>
                          <div className="flex-1" />
                          <div className="text-right text-[11px] leading-tight">
                            <div className="text-white tabular-nums">Ø {s.avgPlacement?.toFixed(2) ?? '—'}</div>
                            <div className="text-fg-muted tabular-nums">
                              {s.top4Rate != null ? `${(s.top4Rate * 100).toFixed(0)}% T4` : ''}
                              <span className="text-fg-faint"> · {s.games}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Section>
                );
              })()}

              {(() => {
                const items = star === 'all'
                  ? data.topItems
                  : (data.topItemsByTier?.[star] || []);
                return items.length > 0 && (
                  <Section title={t('tft.mostUsedItems')}>
                    <div className="grid grid-cols-4 gap-1.5">
                      {items.slice(0, 12).map((it, i) => (
                        <div key={i} className="flex flex-col items-center gap-0.5 bg-surface-raised border border-border-subtle rounded p-1.5">
                          <ItemIcon apiName={it.item} assets={assets} size={9} />
                          <div className="text-[10px] text-white tabular-nums">Ø{it.avgPlacement?.toFixed(1) ?? '—'}</div>
                          <div className="text-[9px] text-fg-muted tabular-nums">{it.games}</div>
                        </div>
                      ))}
                    </div>
                  </Section>
                );
              })()}

              {(() => {
                const slotData = data.itemSlotOrderByTier;
                if (!slotData) return null;
                // Pick the active tier — fall back to the one with most data.
                const activeTier = star !== 'all' && slotData[star]
                  ? star
                  : (Object.keys(slotData).sort((a, b) => {
                      const an = Object.keys(slotData[a] || {}).length;
                      const bn = Object.keys(slotData[b] || {}).length;
                      return bn - an;
                    })[0] || null);
                if (!activeTier || !slotData[activeTier]) return null;
                const slots = slotData[activeTier];
                const slotIdxs = Object.keys(slots).sort();
                if (slotIdxs.length === 0) return null;
                return (
                  <Section title={`${t('tft.itemSlotOrder')} · ${activeTier}★`}>
                    <div className="space-y-2">
                      {slotIdxs.map(si => {
                        const entries = slots[si] || [];
                        const total = entries.reduce((s, e) => s + e.count, 0) || 1;
                        const label = si === '0' ? t('tft.slotFirst')
                          : si === '1' ? t('tft.slotSecond')
                          : t('tft.slotThird');
                        return (
                          <div key={si} className="bg-surface-raised border border-border-subtle rounded p-2.5">
                            <div className="text-fg-muted text-[10px] uppercase tracking-widest mb-1.5">{label}</div>
                            <div className="space-y-1">
                              {entries.slice(0, 3).map((e, i) => (
                                <div key={i} className="flex items-center gap-2">
                                  <ItemIcon apiName={e.item} assets={assets} size={9} />
                                  <div className="flex-1 h-1.5 bg-surface-overlay rounded overflow-hidden">
                                    <div className="h-full bg-accent" style={{ width: `${(e.count / total) * 100}%` }} />
                                  </div>
                                  <span className="text-[11px] text-fg-secondary tabular-nums w-10 text-right">{((e.count / total) * 100).toFixed(0)}%</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Section>
                );
              })()}

              {(() => {
                // Carry-Strength heatmap: avg placement when this unit is the
                // carry, per star × item-count. Cell colour = performance
                // (green better → red worse). Replaces the player-HP "damage
                // atlas" (TFT API has no per-unit combat damage). Renders once
                // the aggregator has populated carryPlacementByTier.
                //
                // Cells klickbar: setzt star + itemCount als 2D-Cross-Filter.
                // Identifiziert den fokussierten Bin durch Border-Highlight +
                // prominente Stat-Box oberhalb der Heatmap.
                const perf = data.carryPlacementByTier;
                if (!perf || Object.keys(perf).length === 0) return null;
                const tiers = Object.keys(perf).sort();
                const icSet = new Set<number>();
                for (const tr of tiers) for (const ic of Object.keys(perf[tr] || {})) icSet.add(Number(ic));
                const itemCounts = [...icSet].filter(n => Number.isFinite(n)).sort((a, b) => a - b);
                if (itemCounts.length === 0) return null;
                // Map avg placement → hue: 3.0 (great) green, 5.5 (poor) red.
                const colorFor = (place: number | null) => {
                  if (place == null) return '#0d1526';
                  const c = Math.max(3.0, Math.min(5.5, place));
                  const hue = Math.round(140 * (1 - (c - 3.0) / 2.5));
                  return `hsl(${hue}, 50%, 30%)`;
                };
                const focusedBin = (star !== 'all' && itemCount != null)
                  ? perf[star]?.[String(itemCount)] || null
                  : null;
                return (
                  <Section title={t('tft.carryStrength')}>
                    <div className="text-fg-muted text-[11px] mb-2">{t('tft.carryStrengthCaption')}</div>
                    {focusedBin && (
                      <div className="bg-accent-a10 border border-accent-a40 rounded p-2.5 mb-2 flex flex-wrap items-center gap-3 text-[11px] tabular-nums">
                        <span className="text-[#c39bff] font-medium">
                          {star}★ · {itemCount} {t('tft.itemsShort')}
                        </span>
                        <span className="text-white">Ø {focusedBin.avgPlacement?.toFixed(2) ?? '—'}</span>
                        <span className="text-[#3ecf8e]">{focusedBin.top4Rate != null ? `${(focusedBin.top4Rate * 100).toFixed(1)}% T4` : '—'}</span>
                        <span className="text-[#e0c75a]">{focusedBin.top1Rate != null ? `${(focusedBin.top1Rate * 100).toFixed(1)}% T1` : '—'}</span>
                        <span className="text-fg-muted">{focusedBin.games.toLocaleString('de-DE')} {t('tft.gamesShort')}</span>
                        <button
                          type="button"
                          onClick={() => { setStar('all'); setItemCount(null); }}
                          className="ml-auto text-fg-muted hover:text-white text-[11px]"
                        >× {t('tft.adv.reset')}</button>
                      </div>
                    )}
                    <div className="bg-surface-raised border border-border-subtle rounded p-3 overflow-x-auto">
                      <div
                        className="inline-grid gap-1 text-[11px] tabular-nums min-w-full"
                        style={{ gridTemplateColumns: `auto repeat(${itemCounts.length}, minmax(2.6rem, 1fr))` }}
                      >
                        <div className="text-fg-muted text-[10px] uppercase tracking-widest pr-2 flex items-end">{t('tft.itemsShort')} →</div>
                        {itemCounts.map(ic => (
                          <div key={`h-${ic}`} className="text-fg-secondary text-center pb-0.5">{ic}</div>
                        ))}
                        {tiers.map(tier => (
                          <Fragment key={tier}>
                            <div className="text-white pr-2 flex items-center whitespace-nowrap"><span className="text-[#e0c75a]">★</span>{tier}</div>
                            {itemCounts.map(ic => {
                              const e = perf[tier]?.[String(ic)];
                              const place = e?.avgPlacement ?? null;
                              const isFocused = star === tier && itemCount === ic;
                              const isClickable = e != null;
                              return (
                                <button
                                  type="button"
                                  key={`${tier}-${ic}`}
                                  disabled={!isClickable}
                                  onClick={() => {
                                    if (!isClickable) return;
                                    if (isFocused) {
                                      setStar('all');
                                      setItemCount(null);
                                    } else {
                                      setStar(tier as StarTier);
                                      setItemCount(ic as ItemCount);
                                    }
                                  }}
                                  className={`rounded text-center py-2 text-white transition-all ${
                                    isClickable ? 'cursor-pointer hover:brightness-125' : 'cursor-default'
                                  } ${isFocused ? 'ring-2 ring-[#c39bff] ring-offset-1 ring-offset-surface-raised' : ''}`}
                                  style={{ backgroundColor: colorFor(place) }}
                                  title={e ? `${tier}★ · ${ic} ${t('tft.itemsShort')} · Ø ${place?.toFixed(2)} · ${e.top4Rate != null ? `${(e.top4Rate * 100).toFixed(0)}% T4` : '—'} · ${e.games} ${t('tft.gamesShort')}` : undefined}
                                >
                                  {place != null ? place.toFixed(2) : '·'}
                                </button>
                              );
                            })}
                          </Fragment>
                        ))}
                      </div>
                    </div>
                  </Section>
                );
              })()}

              {(() => {
                // Fallback only — superseded by the Carry-Strength section above
                // once the aggregator re-run lands carryPlacementByTier.
                if (data.carryPlacementByTier && Object.keys(data.carryPlacementByTier).length > 0) return null;
                const damage = data.damageByTier;
                if (!damage) return null;
                const tiers = Object.keys(damage).sort();
                if (tiers.length === 0) return null;
                const fmt = (n: number | null) => n == null ? '—' : n >= 10000 ? `${(n/1000).toFixed(1)}k` : Math.round(n).toLocaleString('de-DE');
                // Find global max P95 to normalize bar widths across rows
                let globalMax = 0;
                for (const tier of tiers) {
                  for (const ic of Object.keys(damage[tier] || {})) {
                    const bin = damage[tier][ic];
                    if (bin?.p95 && bin.p95 > globalMax) globalMax = bin.p95;
                  }
                }
                return (
                  <Section title={t('tft.damageAtlas')}>
                    <div className="text-fg-muted text-[11px] mb-2">{t('tft.damageAtlasCaption')}</div>
                    <div className="bg-surface-raised border border-border-subtle rounded overflow-hidden">
                      <table className="w-full text-[11px] tabular-nums">
                        <thead>
                          <tr className="text-fg-muted border-b border-border-subtle">
                            <th className="text-left px-2 py-1.5 font-normal">{t('tft.stars')}</th>
                            <th className="text-left px-2 py-1.5 font-normal">{t('tft.itemsShort')}</th>
                            <th className="text-left px-2 py-1.5 font-normal" colSpan={2}>{t('tft.dmgTypical')}</th>
                            <th className="text-right px-2 py-1.5 font-normal">{t('tft.dmgPeak')}</th>
                            <th className="text-right px-2 py-1.5 font-normal">{t('tft.gamesShort')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tiers.flatMap(tier => {
                            const itemCountBins = damage[tier] || {};
                            const counts = Object.keys(itemCountBins).sort().reverse();
                            return counts.map(ic => {
                              const bin = itemCountBins[ic];
                              // Bar: from P50 → P95 visualised as a range bar.
                              // Single-color gradient (carry damage in TFT = always
                              // a "good signal"), brighter when range is tight.
                              const p50Pct = globalMax > 0 && bin.p50 ? (bin.p50 / globalMax) * 100 : 0;
                              const p95Pct = globalMax > 0 && bin.p95 ? (bin.p95 / globalMax) * 100 : 0;
                              const rangeWidth = Math.max(2, p95Pct - p50Pct);
                              return (
                                <tr key={`${tier}-${ic}`} className="border-b border-border-subtle/50 last:border-0">
                                  <td className="px-2 py-1.5 text-white"><span className="text-[#e0c75a]">★</span>{tier}</td>
                                  <td className="px-2 py-1.5 text-fg-secondary">{ic}</td>
                                  <td className="px-2 py-1.5 text-right text-white w-12">{fmt(bin.p50)}</td>
                                  <td className="px-2 py-1.5 w-32">
                                    <div className="relative h-2 bg-surface-base rounded overflow-hidden">
                                      <div
                                        className="absolute h-full"
                                        style={{
                                          left: `${p50Pct.toFixed(0)}%`,
                                          width: `${rangeWidth.toFixed(0)}%`,
                                          background: 'linear-gradient(to right, #7B61FF, #3ecf8e)',
                                        }}
                                      />
                                    </div>
                                  </td>
                                  <td className="px-2 py-1.5 text-right text-[#3ecf8e]">{fmt(bin.p95)}</td>
                                  <td className="px-2 py-1.5 text-right text-fg-muted">{bin.games}</td>
                                </tr>
                              );
                            });
                          })}
                        </tbody>
                      </table>
                    </div>
                  </Section>
                );
              })()}

              {timeline.length >= 2 && (
                <Section title={t('tft.unitTimeline')}>
                  <div className="bg-surface-raised border border-border-subtle rounded p-3" style={{ height: 180 }}>
                    <ResponsiveContainer>
                      <LineChart data={timeline} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                        <XAxis
                          dataKey="patch"
                          tickFormatter={(v: string) => tftPatchLabel(v)}
                          tick={{ fill: 'var(--fg-faint)', fontSize: 10 }}
                          axisLine={{ stroke: 'var(--border-subtle)' }}
                          tickLine={false}
                        />
                        <YAxis
                          domain={['dataMin - 0.2', 'dataMax + 0.2']}
                          reversed
                          tick={{ fill: 'var(--fg-faint)', fontSize: 10 }}
                          axisLine={false}
                          tickLine={false}
                          width={28}
                          tickFormatter={(v: number) => v.toFixed(2)}
                        />
                        <RechartsTooltip
                          contentStyle={{ backgroundColor: 'var(--surface-base)', border: '1px solid var(--border-subtle)', borderRadius: 4, fontSize: 11 }}
                          labelStyle={{ color: 'var(--fg-secondary)' }}
                          labelFormatter={(label: any) => tftPatchLabel(String(label))}
                          formatter={(v: any): any => [Number(v).toFixed(2), t('tft.avgPlacement')]}
                        />
                        <ReferenceLine y={4.5} stroke="var(--fg-faint)" strokeDasharray="3 3" strokeOpacity={0.4} />
                        <Line
                          type="monotone"
                          dataKey="avgPlacement"
                          stroke="var(--accent-tft)"
                          strokeWidth={2}
                          dot={{ r: 3, fill: 'var(--accent-tft)' }}
                          activeDot={{ r: 5, fill: 'var(--series-purple-soft)' }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </Section>
              )}

              {comps.length > 0 && (
                <Section title={t('tft.compsWithUnit')}>
                  <div className="space-y-1.5">
                    {comps.map(c => {
                      const parts = parseClusterKey(c.clusterKey);
                      const traitName = parts && assets?.traits[parts.trait]?.name
                        ? assets.traits[parts.trait].name
                        : parts ? prettyChar(parts.trait) : '';
                      const variant = parts ? extractTraitVariant(parts.trait, traitName) : null;
                      const carry = parts && assets ? assets.champions[parts.carry] : null;
                      const carryUrl = tftChampionTileUrl(assets, carry);
                      return (
                        <a
                          key={c.slug}
                          href={`/tft/comps/${encodeURIComponent(c.slug)}?bucket=${bucket}&region=euw1`}
                          className="flex items-center gap-2 bg-surface-raised border border-border-subtle rounded p-2 hover:border-accent-a40 transition-colors"
                        >
                          {carryUrl && (
                            <img src={carryUrl} alt="" className="w-8 h-8 rounded border border-[#c39bff]/60 object-cover flex-shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-white text-[11px] font-medium truncate leading-tight">
                              {traitName}
                              {variant && <span className="text-[#a892ff]"> · {variant}</span>}
                            </div>
                            <div className="text-[10px] text-fg-muted truncate">
                              {carry?.name || (parts ? prettyChar(parts.carry) : '')}
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
                </Section>
              )}
            </div>
          </>
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
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h2 className="text-fg-secondary text-xs uppercase tracking-widest mb-2">{title}</h2>
      {children}
    </div>
  );
}
function ItemIcon({ apiName, assets, size = 10 }: { apiName: string; assets: TftAssetsBundle | null; size?: number }) {
  const item = assets?.items[apiName];
  const sizeClass = size === 10 ? 'w-10 h-10' : 'w-9 h-9';
  const url = tftIconUrl(assets, item?.icon);
  const href = `/tft/items/${encodeURIComponent(apiName)}`;
  if (!url) {
    return (
      <a href={href} className={`${sizeClass} rounded bg-surface-overlay flex items-center justify-center text-[8px] text-fg-muted text-center px-0.5 hover:bg-[#2a3a52] transition-colors`} title={item?.name || apiName}>
        {prettyItem(apiName)}
      </a>
    );
  }
  return (
    <a href={href} title={item!.name} className="hover:scale-110 transition-transform inline-block">
      <img src={url} alt={item!.name} className={`${sizeClass} rounded`} />
    </a>
  );
}
function prettyItem(s: string) { return s.replace(/^TFT\d*_Item_/, '').slice(0, 8); }
function prettyChar(s: string) { return s.replace(/^TFT\d+_/, ''); }


function extractTraitVariant(traitApiName: string, traitDisplayName: string): string | null {
  const stripped = traitApiName.replace(/^TFT\d+_/, '');
  if (!stripped.includes('_')) return null;
  const variant = stripped.split('_').slice(1).join(' ');
  if (!variant) return null;
  if (variant.toLowerCase() === traitDisplayName.toLowerCase()) return null;
  return variant;
}
