'use client';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import TierFilter, { type TierBucket } from '../../../components/tft/TierFilter';
import EmptyData from '../../../components/tft/EmptyData';
import CompCard from '../../../components/tft/CompCard';
import { useI18n } from '../../../lib/i18n';
import { loadTftAssets, tftIconUrl, tftChampionTileUrl, type TftAssetsBundle } from '../../../lib/tft-cdragon';
import PositionHeatmap from '../../../components/tft/PositionHeatmap';

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
      fetch(`/api/tft/comps?region=euw1&bucket=${bucket}&slug=${encodeURIComponent(slug)}`).then(r => r.json()),
      fetch(`/api/tft/comps?region=all&bucket=pro_pool&slug=${encodeURIComponent(slug)}&minGames=5`).then(r => r.ok ? r.json() : { comp: null }),
    ]).then(([normal, pro]) => {
      setHasData(!!normal.hasData);
      setComp(normal.comp || null);
      setProComp(pro.comp || null);
    }).catch(() => { setHasData(false); setComp(null); });
  }, [bucket, slug]);

  // Pull augment-by-slot stats so we can show each typical augment's likely
  // offer slot (2-1 / 3-2 / 4-2). Done in parallel with the comp fetch so
  // the slot pills land as the comp data renders.
  useEffect(() => {
    Promise.all([0, 1, 2].map(slot =>
      fetch(`/api/tft/augments?region=euw1&bucket=${bucket}&slot=${slot}`)
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
  }, [bucket]);

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
              <section className="mt-5 bg-[#0d1526] border border-[#1e2a3a] rounded p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat label={t('tft.comp.avgLevel')} value={comp.avgLevel != null ? comp.avgLevel.toFixed(1) : '—'} />
                <Stat label={t('tft.comp.avgLastRound')} value={comp.avgLastRound != null ? formatStage(comp.avgLastRound) : '—'} />
                <Stat label={t('tft.comp.tempo')} value={tempoLabel(comp.avgLevel, comp.avgLastRound, t)} />
                <Stat label={t('tft.gamesShort')} value={String(comp.games)} />
              </section>
            )}

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

            {/* Counters from KG */}
            {comp.counters && (comp.counters.beats?.length > 0 || comp.counters.losesTo?.length > 0) && (
              <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <h3 className="text-green-400 text-xs uppercase tracking-widest mb-2">{t('tft.comp.strongAgainst')}</h3>
                  <div className="space-y-1.5">
                    {(comp.counters.beats || []).length === 0 && <div className="text-[#7a8aa0] text-xs">{t('tft.comp.noSignificantData')}</div>}
                    {(comp.counters.beats || []).map((c: any, i: number) => (
                      <a key={i} href={`/tft/comps/${encodeURIComponent(c.b)}?bucket=${bucket}`}
                         className="flex items-center justify-between bg-[#0d1526] border border-[#1e2a3a] rounded px-3 py-2 hover:border-green-500/40">
                        <span className="text-white text-xs truncate">{prettyComp(c.b)}</span>
                        <span className="text-green-400 text-xs">{Math.round(c.aWinRate * 100)}% · {c.games} {t('tft.gamesShort')}</span>
                      </a>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="text-red-400 text-xs uppercase tracking-widest mb-2">{t('tft.comp.weakAgainst')}</h3>
                  <div className="space-y-1.5">
                    {(comp.counters.losesTo || []).length === 0 && <div className="text-[#7a8aa0] text-xs">{t('tft.comp.noSignificantData')}</div>}
                    {(comp.counters.losesTo || []).map((c: any, i: number) => (
                      <a key={i} href={`/tft/comps/${encodeURIComponent(c.a)}?bucket=${bucket}`}
                         className="flex items-center justify-between bg-[#0d1526] border border-[#1e2a3a] rounded px-3 py-2 hover:border-red-500/40">
                        <span className="text-white text-xs truncate">{prettyComp(c.a)}</span>
                        <span className="text-red-400 text-xs">{Math.round(c.aWinRate * 100)}% · {c.games} {t('tft.gamesShort')}</span>
                      </a>
                    ))}
                  </div>
                </div>
              </div>
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

// Stage-round formatter mirrors the MatchCard formatStage logic so users
// see "5-1" instead of an opaque last_round=33.
function formatStage(round: number): string {
  if (round <= 0) return '—';
  if (round <= 4) return `1-${Math.round(round)}`;
  const offset = round - 4;
  const stage = Math.floor((offset - 1) / 7) + 2;
  const r = ((offset - 1) % 7) + 1;
  return `${stage}-${Math.round(r)}`;
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
