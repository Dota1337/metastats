'use client';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip as RechartsTooltip, Legend,
} from 'recharts';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import { useI18n, LOCALE_MAP, type Lang } from '../../lib/i18n';
import TftHero from '../../components/tft/TftHero';
import { formatTier } from '../../lib/rank-format';
import { loadTftAssets, tftIconUrl, tftChampionTileUrl, type TftAssetsBundle } from '../../lib/tft-cdragon';

const CompareRadar = dynamic(() => import('../../components/CompareRadar'), { ssr: false });

const REGIONS: { value: string; label: string }[] = [
  { value: 'euw1', label: 'EUW' }, { value: 'eun1', label: 'EUNE' },
  { value: 'kr',   label: 'KR'  }, { value: 'na1',  label: 'NA' },
  { value: 'br1',  label: 'BR'  }, { value: 'jp1',  label: 'JP' },
  { value: 'la1',  label: 'LAN' }, { value: 'la2',  label: 'LAS' },
  { value: 'oc1',  label: 'OCE' }, { value: 'tr1',  label: 'TR' },
  { value: 'ru',   label: 'RU'  }, { value: 'me1',  label: 'ME' },
  { value: 'ph2',  label: 'PH'  }, { value: 'sg2',  label: 'SG' },
  { value: 'th2',  label: 'TH'  }, { value: 'tw2',  label: 'TW' },
  { value: 'vn2',  label: 'VN'  },
];

const SERIES_COLORS = ['#7B61FF', '#3ecf8e'] as const;
const TIER_NUM: Record<string, number> = {
  IRON: 1, BRONZE: 2, SILVER: 3, GOLD: 4, PLATINUM: 5, EMERALD: 6,
  DIAMOND: 7, MASTER: 8, GRANDMASTER: 9, CHALLENGER: 10,
};

interface AgentBreakdown { agent: string; multiplier: number; delta: number }
interface PlayerSummary {
  name: string;
  puuid: string;
  tier: string | null;
  rank: string | null;
  lp: number | null;
  marketValue: number | null;
  rated: boolean;
  multiplier: number | null;
  agents: AgentBreakdown[];
  // From /api/tft/player-stats
  totalMatches: number;
  avgPlacement: number;
  top4Rate: number;
  top1Rate: number;
  placementDistribution: number[];   // [count@1, count@2, …, count@8]
  averages: { level: number; goldLeft: number; eliminations: number; damage: number; lastRound: number };
  topUnits: { characterId: string; games: number; avgPlacement: number; top4Rate: number }[];
  // 'season_aggregate' = headline numbers from the synced aggregate table
  //  only, no per-match detail yet. Triggers the background refresh.
  // 'live' = full match-level data available.
  statsSource?: 'live' | 'season_aggregate';
  refreshing?: boolean;
}

interface HistoryPoint { date: string; finalValue: number }

function rankEmblemUrl(tier: string | null): string | null {
  if (!tier) return null;
  return `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-emblem/emblem-${tier.toLowerCase()}.png`;
}

// Build square + splash URLs for a unit. Square is the in-shop HUD tile;
// splash is the wider portrait used when the square doesn't exist for that
// unit (Rhaast / other Kayn-variants have their square stored under a
// transformed filename like `tft17_kayn_slay_square` instead of
// `tft17_rhaast_square`). The render-time onError swaps from square →
// splash so both cases render correctly.
function tftUnitIconUrls(characterId: string, assets: TftAssetsBundle | null): { square: string; splash: string | null } {
  const champ = assets?.champions[characterId];
  const tile = tftChampionTileUrl(assets, champ);
  const splash = tftIconUrl(assets, champ?.icon);
  // Fallback when assets aren't loaded yet: best-guess square URL from the
  // characterId itself. Same shape as before so existing units keep working.
  const fallbackSquare = `https://raw.communitydragon.org/latest/game/assets/characters/${characterId.toLowerCase()}/hud/${characterId.toLowerCase()}_square.tft_set17.png`;
  return { square: tile || fallbackSquare, splash };
}

function rankNum(tier: string | null, lp: number | null): number {
  if (!tier) return 0;
  return (TIER_NUM[tier] || 0) * 1000 + (lp || 0);
}

function countCategoryWins(s1: PlayerSummary, s2: PlayerSummary): { p1: number; p2: number } {
  // Lower is better for avg-placement → invert. Others: higher = better.
  const cats: Array<[number, number]> = [
    [rankNum(s1.tier, s1.lp), rankNum(s2.tier, s2.lp)],
    [s1.marketValue || 0, s2.marketValue || 0],
    [s1.multiplier || 0, s2.multiplier || 0],
    [-s1.avgPlacement, -s2.avgPlacement],
    [s1.top4Rate, s2.top4Rate],
    [s1.top1Rate, s2.top1Rate],
    [s1.totalMatches, s2.totalMatches],
  ];
  let p1 = 0, p2 = 0;
  for (const [a, b] of cats) {
    if (a > b) p1++;
    else if (b > a) p2++;
  }
  return { p1, p2 };
}

export default function TftComparePage() {
  const { t, lang } = useI18n();
  const [inputs, setInputs] = useState<string[]>(['', '']);
  const [region, setRegion] = useState('euw1');
  const [results, setResults] = useState<(PlayerSummary | { error: string } | null)[]>([null, null]);
  const [histories, setHistories] = useState<HistoryPoint[][]>([[], []]);
  const [loading, setLoading] = useState(false);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);

  const compare = async () => {
    setLoading(true);
    const next: (PlayerSummary | { error: string } | null)[] = inputs.map(() => null);
    setResults(next);
    setHistories([[], []]);

    await Promise.all(inputs.map(async (raw, i) => {
      const name = raw.trim();
      if (!name) { next[i] = null; setResults([...next]); return; }
      try {
        // 1) Marktwert snapshot
        const r = await fetch(`/api/tft/marktwert?name=${encodeURIComponent(name)}&region=${region}`);
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          next[i] = { error: j.error || `HTTP ${r.status}` };
          setResults([...next]);
          return;
        }
        const d = await r.json();
        const puuid = d.summoner?.puuid || '';
        // 2) Season-aggregated stats — only if rated (no point otherwise)
        let stats: any = null;
        if (puuid && d.marketValue?.rated) {
          const sr = await fetch(`/api/tft/player-stats?puuid=${puuid}&region=${region}`);
          stats = sr.ok ? await sr.json() : null;
        }
        const statsSource = stats?.statsSource === 'season_aggregate' ? 'season_aggregate' : 'live';
        next[i] = {
          name: d.summoner?.name || name,
          puuid,
          tier: d.summoner?.tier || null,
          rank: d.summoner?.rank || null,
          lp: d.summoner?.lp ?? null,
          marketValue: d.marketValue?.finalValue ?? null,
          rated: !!d.marketValue?.rated,
          multiplier: d.marketValue?.multiplier ?? null,
          agents: (d.marketValue?.agents || []).map((a: any) => ({
            agent: a.agent, multiplier: a.multiplier, delta: a.delta,
          })),
          totalMatches: stats?.totalMatches ?? d.marketValue?.sampleSize ?? 0,
          avgPlacement: stats?.avgPlacement ?? 0,
          top4Rate: stats?.top4Rate ?? 0,
          top1Rate: stats?.top1Rate ?? 0,
          placementDistribution: stats?.placementDistribution ?? [0,0,0,0,0,0,0,0],
          averages: stats?.averages ?? { level: 0, goldLeft: 0, eliminations: 0, damage: 0, lastRound: 0 },
          topUnits: stats?.topUnits ?? [],
          statsSource,
          refreshing: statsSource === 'season_aggregate' && !!puuid,
        };
        // 3) Background-fetch 30d history
        if ((next[i] as PlayerSummary).rated && puuid) {
          fetch(`/api/tft/marktwert/history?puuid=${puuid}&region=${region}&days=30`)
            .then(r => r.ok ? r.json() : { series: [] })
            .then(h => setHistories(prev => prev.map((p, idx) => idx === i ? (h.series || []) : p)))
            .catch(() => {});
        }
        // 4) Auto-refresh — if the player's per-match cache wasn't ready
        //    in Supabase, trigger the Hetzner refresh API and re-fetch
        //    player-stats once it lands. The refresh API has its own
        //    60s per-puuid rate limit; if we hit 429 we keep the
        //    season-aggregate view (better than nothing).
        const cur = next[i] as PlayerSummary;
        if (cur.statsSource === 'season_aggregate' && cur.puuid) {
          autoRefreshPlayer(i, cur.puuid).catch(() => {});
        }
      } catch (e: any) {
        next[i] = { error: e.message };
      }
      setResults([...next]);
    }));
    setLoading(false);
  };

  const autoRefreshPlayer = async (index: number, puuid: string) => {
    try {
      const refreshRes = await fetch('/api/tft/marktwert/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ puuid, region }),
      });
      // 200 = refresh ran, 429 = recently refreshed (back-off applies).
      // In both cases the Supabase cache should now be hot enough to
      // re-fetch player-stats.
      if (!refreshRes.ok && refreshRes.status !== 429) return;
      const sr = await fetch(`/api/tft/player-stats?puuid=${puuid}&region=${region}`);
      if (!sr.ok) return;
      const stats = await sr.json();
      setResults(prev => prev.map((p, idx) => {
        if (idx !== index || !p || 'error' in p) return p;
        return {
          ...(p as PlayerSummary),
          totalMatches: stats.totalMatches ?? (p as PlayerSummary).totalMatches,
          avgPlacement: stats.avgPlacement ?? (p as PlayerSummary).avgPlacement,
          top4Rate: stats.top4Rate ?? (p as PlayerSummary).top4Rate,
          top1Rate: stats.top1Rate ?? (p as PlayerSummary).top1Rate,
          placementDistribution: stats.placementDistribution ?? (p as PlayerSummary).placementDistribution,
          averages: stats.averages ?? (p as PlayerSummary).averages,
          topUnits: stats.topUnits ?? (p as PlayerSummary).topUnits,
          statsSource: stats.statsSource === 'season_aggregate' ? 'season_aggregate' : 'live',
          refreshing: false,
        };
      }));
    } finally {
      setResults(prev => prev.map((p, idx) => {
        if (idx !== index || !p || 'error' in p) return p;
        return { ...(p as PlayerSummary), refreshing: false };
      }));
    }
  };

  const chartData = mergeHistories(histories);
  const bothLoaded = results.every(r => r && !('error' in r));
  const s1 = bothLoaded ? (results[0] as PlayerSummary) : null;
  const s2 = bothLoaded ? (results[1] as PlayerSummary) : null;
  const score = s1 && s2 ? countCategoryWins(s1, s2) : null;

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="analyse" />
      <TftHero pageTitle={t('nav.analyse')} />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-2 pb-6">

        <div className="flex flex-wrap gap-1.5 mb-3">
          {REGIONS.map(r => (
            <button
              key={r.value}
              onClick={() => setRegion(r.value)}
              className={`px-2.5 py-1 rounded text-xs font-medium ${
                region === r.value
                  ? 'bg-[#7B61FF] text-white'
                  : 'bg-[#141c2e] text-[#a0b0c5] hover:text-white'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          {inputs.map((v, i) => (
            <input
              key={i}
              type="text"
              value={v}
              onChange={e => setInputs(prev => prev.map((p, idx) => idx === i ? e.target.value : p))}
              placeholder={`${t('tft.compare.player')} ${i + 1} (Name#Tag)`}
              className="bg-[#141c2e] border border-[#1e2a3a] rounded px-3 py-2 text-white text-sm outline-none focus:border-[#7B61FF]/60"
            />
          ))}
        </div>
        <button
          onClick={compare}
          disabled={loading}
          className="bg-[#7B61FF] hover:bg-[#7B61FF]/80 text-white text-sm px-4 py-2 rounded mb-5 disabled:opacity-50"
        >
          {loading ? t('tft.compare.comparing') : t('tft.compare.button')}
        </button>

        {/* Player cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          {results.map((r, i) => {
            if (!r) return (
              <div key={i} className="bg-[#0d1526] border border-[#1e2a3a] rounded p-5 text-[#7a8aa0] text-sm text-center">
                {t('tft.compare.player')} {i + 1}
              </div>
            );
            if ('error' in r) return (
              <div key={i} className="bg-red-500/10 border border-red-500/30 rounded p-4 text-red-400 text-sm">
                {r.error}
              </div>
            );
            const emblem = rankEmblemUrl(r.tier);
            return (
              <div
                key={i}
                className="bg-[#0d1526] border-l-4 rounded p-5 flex items-start gap-3"
                style={{ borderLeftColor: SERIES_COLORS[i] }}
              >
                {emblem && <img src={emblem} alt={r.tier || ''} className="w-14 h-14 object-contain shrink-0" />}
                <div className="flex-1 min-w-0">
                  {(() => {
                    const [gn, tl] = r.name.split('#');
                    const slug = `${encodeURIComponent(gn)}--${encodeURIComponent(tl || region.replace(/\d+$/, '').toUpperCase())}`;
                    return (
                      <a href={`/tft/player/${slug}?region=${region}`} className="text-white text-base font-medium hover:text-[#7B61FF] transition-colors block truncate">
                        {r.name}
                      </a>
                    );
                  })()}
                  <div className="text-[#a0b0c5] text-xs mb-2">
                    {r.tier ? formatTier(r.tier, r.rank) : 'Unranked'}{r.lp != null ? ` · ${r.lp} LP` : ''}
                  </div>
                  <div className="text-[#7B61FF] text-xl font-semibold tabular-nums">
                    {r.rated && r.marketValue != null
                      ? new Intl.NumberFormat(LOCALE_MAP[lang], { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(r.marketValue)
                      : '—'}
                  </div>
                  <div className="text-[#a0b0c5] text-[10px]">
                    ×{r.multiplier?.toFixed(2) ?? '—'} · {r.totalMatches} Matches
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Head-to-Head + visuals only when both players resolved */}
        {s1 && s2 && score && (
          <>
            <HeadToHeadBanner p1={score.p1} p2={score.p2} name1={s1.name.split('#')[0]} name2={s2.name.split('#')[0]} />

            {/* Agent-Multiplier-Radar — 6 axes from marketvalue pipeline */}
            <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4 mb-4">
              <div className="text-center text-[#a0b0c5] text-xs uppercase tracking-widest mb-2">Performance-Radar</div>
              {(() => {
                const agentOrder = ['performance', 'metaAdaptation', 'highRoll', 'consistency', 'flexMastery', 'gameSense'];
                const agentLabels: Record<string, string> = {
                  performance: 'Performance',
                  metaAdaptation: 'Meta',
                  highRoll: 'High-Roll',
                  consistency: 'Konsistenz',
                  flexMastery: 'Flex',
                  gameSense: 'Game-Sense',
                };
                // Normalise each agent's multiplier to a 0..100 scale using its
                // known range so all six axes are comparable. Ranges match
                // app/lib/tft-marketvalue/agents/*.
                const ranges: Record<string, [number, number]> = {
                  performance:    [0.45, 1.40],
                  metaAdaptation: [0.85, 1.18],
                  highRoll:       [0.90, 1.12],
                  consistency:    [0.88, 1.10],
                  flexMastery:    [0.90, 1.12],
                  gameSense:      [0.94, 1.10],
                };
                const normalize = (agent: string, m: number) => {
                  const [lo, hi] = ranges[agent] || [0.5, 1.5];
                  return Math.max(0, Math.min(100, ((m - lo) / (hi - lo)) * 100));
                };
                const data = agentOrder.map(a => {
                  const a1 = s1.agents.find(x => x.agent === a);
                  const a2 = s2.agents.find(x => x.agent === a);
                  return {
                    stat: agentLabels[a],
                    p1: a1 ? normalize(a, a1.multiplier) : 0,
                    p2: a2 ? normalize(a, a2.multiplier) : 0,
                  };
                });
                return <CompareRadar data={data} name1={s1.name.split('#')[0]} name2={s2.name.split('#')[0]} />;
              })()}
            </div>

            {/* Color-coded stat bars — only render the bars where at least
               one player has a non-zero value so fallback paths (season
               aggregate without per-match detail) don't spam "0 vs 0" rows */}
            <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4 mb-4">
              <CompareStatBar label="Ø Platz (niedriger = besser)" v1={s1.avgPlacement} v2={s2.avgPlacement} fmt1={s1.avgPlacement.toFixed(2)} fmt2={s2.avgPlacement.toFixed(2)} lowerIsBetter />
              <CompareStatBar label="Top-4-Quote" v1={s1.top4Rate} v2={s2.top4Rate} fmt1={`${(s1.top4Rate * 100).toFixed(0)}%`} fmt2={`${(s2.top4Rate * 100).toFixed(0)}%`} />
              <CompareStatBar label="Sieg-Quote" v1={s1.top1Rate} v2={s2.top1Rate} fmt1={`${(s1.top1Rate * 100).toFixed(0)}%`} fmt2={`${(s2.top1Rate * 100).toFixed(0)}%`} />
              {(s1.averages.damage > 0 || s2.averages.damage > 0) && (
                <CompareStatBar label="Ø Schaden" v1={s1.averages.damage} v2={s2.averages.damage} fmt1={Math.round(s1.averages.damage).toLocaleString(LOCALE_MAP[lang])} fmt2={Math.round(s2.averages.damage).toLocaleString(LOCALE_MAP[lang])} />
              )}
              {(s1.averages.lastRound > 0 || s2.averages.lastRound > 0) && (
                <CompareStatBar label="Ø Endrunde" v1={s1.averages.lastRound} v2={s2.averages.lastRound} fmt1={s1.averages.lastRound.toFixed(1)} fmt2={s2.averages.lastRound.toFixed(1)} />
              )}
              {(s1.averages.level > 0 || s2.averages.level > 0) && (
                <CompareStatBar label="Ø Level" v1={s1.averages.level} v2={s2.averages.level} fmt1={s1.averages.level.toFixed(1)} fmt2={s2.averages.level.toFixed(1)} />
              )}
              <CompareStatBar label="Multiplikator" v1={s1.multiplier || 0} v2={s2.multiplier || 0} fmt1={`×${(s1.multiplier || 0).toFixed(2)}`} fmt2={`×${(s2.multiplier || 0).toFixed(2)}`} />
            </div>

            {/* Placement Distribution — render either real data or a loading
               skeleton while the background refresh is fetching match
               details. Once at least one player has data, the histogram
               shows up. */}
            {(s1.placementDistribution.some(c => c > 0) || s2.placementDistribution.some(c => c > 0) || s1.refreshing || s2.refreshing) && (
              <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4 mb-4">
                <div className="text-center text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">
                  Platzierungs-Verteilung
                  {(s1.refreshing || s2.refreshing) && <span className="ml-2 text-[#7B61FF]">· wird geladen…</span>}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {s1.placementDistribution.some(c => c > 0)
                    ? <PlacementHistogram dist={s1.placementDistribution} color={SERIES_COLORS[0]} />
                    : s1.refreshing
                      ? <PlacementSkeleton />
                      : <div className="text-[#7a8aa0] text-xs text-center self-center">noch keine Match-Details</div>}
                  {s2.placementDistribution.some(c => c > 0)
                    ? <PlacementHistogram dist={s2.placementDistribution} color={SERIES_COLORS[1]} />
                    : s2.refreshing
                      ? <PlacementSkeleton />
                      : <div className="text-[#7a8aa0] text-xs text-center self-center">noch keine Match-Details</div>}
                </div>
              </div>
            )}

            {/* Top units — hidden if neither player has unit-level data */}
            {(s1.topUnits.length > 0 || s2.topUnits.length > 0) && (
              <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4 mb-4">
                <div className="text-center text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">Meist-gespielte Units</div>
                <div className="grid grid-cols-2 gap-4">
                  {[s1, s2].map((s, i) => (
                    <div key={i}>
                      {s.topUnits.length === 0 ? (
                        <div className="text-[#7a8aa0] text-xs text-center py-3">noch keine Match-Details</div>
                      ) : (
                        <div className="flex gap-1.5 flex-wrap">
                          {s.topUnits.slice(0, 8).map(u => {
                            const urls = tftUnitIconUrls(u.characterId, assets);
                            return (
                              <div key={u.characterId} title={`${u.characterId} · ${u.games}× · Ø ${u.avgPlacement.toFixed(1)}`} className="flex flex-col items-center gap-0.5">
                                <img
                                  src={urls.square}
                                  alt={u.characterId}
                                  className="w-9 h-9 rounded border border-[#1e2a3a] object-cover"
                                  onError={(e) => {
                                    const t = e.target as HTMLImageElement;
                                    // 1st failure: try the splash variant. 2nd failure: dim out.
                                    if (t.dataset.fallback !== 'splash' && urls.splash) {
                                      t.dataset.fallback = 'splash';
                                      t.src = urls.splash;
                                    } else {
                                      t.style.opacity = '0.3';
                                    }
                                  }}
                                />
                                <span className="text-[9px] text-[#a0b0c5] tabular-nums">{u.games}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {chartData.length >= 2 && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4">
            <div className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">
              {t('tft.compare.chartTitle')}
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
                  <XAxis
                    dataKey="date"
                    stroke="#7a8aa0"
                    fontSize={10}
                    tick={{ fill: '#a0b0c5' }}
                    tickFormatter={(d) => new Date(d).toLocaleDateString(LOCALE_MAP[lang], { month: 'short', day: 'numeric' })}
                  />
                  <YAxis
                    stroke="#7a8aa0"
                    fontSize={10}
                    tick={{ fill: '#a0b0c5' }}
                    tickFormatter={(v) => `${Math.round(v / 1000)}k`}
                  />
                  <RechartsTooltip
                    contentStyle={{ backgroundColor: '#0d1526', border: '1px solid #1e2a3a', borderRadius: 6, fontSize: 12 }}
                    labelStyle={{ color: '#a0b0c5' }}
                    formatter={(value: any) => [
                      new Intl.NumberFormat(LOCALE_MAP[lang], { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(value)),
                      '',
                    ]}
                    labelFormatter={(d) => typeof d === 'string' ? new Date(d).toLocaleDateString(LOCALE_MAP[lang]) : ''}
                  />
                  <Legend wrapperStyle={{ fontSize: 10, color: '#a0b0c5' }} />
                  {results.map((r, i) =>
                    !r || 'error' in r ? null : (
                      <Line
                        key={i}
                        type="monotone"
                        dataKey={`p${i}`}
                        name={r.name}
                        stroke={SERIES_COLORS[i]}
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                      />
                    )
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}

function HeadToHeadBanner({ p1, p2, name1, name2 }: { p1: number; p2: number; name1: string; name2: string }) {
  const total = p1 + p2 || 1;
  const w1 = (p1 / total) * 100;
  return (
    <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4 mb-4">
      <div className="flex items-center justify-between text-xs mb-2">
        <span className={`font-semibold truncate ${p1 > p2 ? 'text-[#7B61FF]' : 'text-[#a0b0c5]'}`}>{name1}</span>
        <span className="text-[#7a8aa0] uppercase tracking-widest">Head-to-Head</span>
        <span className={`font-semibold truncate ${p2 > p1 ? 'text-[#3ecf8e]' : 'text-[#a0b0c5]'}`}>{name2}</span>
      </div>
      <div className="relative h-2.5 rounded-full bg-[#1e2a3a] overflow-hidden">
        <div
          className="absolute left-0 top-0 h-full bg-gradient-to-r from-[#7B61FF] to-[#9d48e0] transition-all duration-700"
          style={{ width: `${w1}%`, boxShadow: '0 0 8px rgba(123,97,255,0.45)' }}
        />
        <div
          className="absolute right-0 top-0 h-full bg-gradient-to-l from-[#3ecf8e] to-[#2bb47a] transition-all duration-700"
          style={{ width: `${100 - w1}%`, boxShadow: '0 0 8px rgba(62,207,142,0.45)' }}
        />
      </div>
      <div className="flex items-center justify-between text-[10px] mt-1.5 tabular-nums">
        <span className={p1 > p2 ? 'text-[#7B61FF] font-bold' : 'text-[#7a8aa0]'}>{p1} {p1 === 1 ? 'Kategorie' : 'Kategorien'}</span>
        <span className={p2 > p1 ? 'text-[#3ecf8e] font-bold' : 'text-[#7a8aa0]'}>{p2} {p2 === 1 ? 'Kategorie' : 'Kategorien'}</span>
      </div>
    </div>
  );
}

function CompareStatBar({ label, v1, v2, fmt1, fmt2, lowerIsBetter = false }: { label: string; v1: number; v2: number; fmt1: string; fmt2: string; lowerIsBetter?: boolean }) {
  const c1 = lowerIsBetter ? (v1 < v2 ? '#7B61FF' : '#3a4a64') : (v1 > v2 ? '#7B61FF' : '#3a4a64');
  const c2 = lowerIsBetter ? (v2 < v1 ? '#3ecf8e' : '#3a4a64') : (v2 > v1 ? '#3ecf8e' : '#3a4a64');
  const p1Wins = lowerIsBetter ? v1 < v2 : v1 > v2;
  const p2Wins = lowerIsBetter ? v2 < v1 : v2 > v1;
  const maxAbs = Math.max(Math.abs(v1), Math.abs(v2)) || 1;
  const pct1 = (Math.abs(v1) / maxAbs) * 100;
  const pct2 = (Math.abs(v2) / maxAbs) * 100;
  return (
    <div className="mb-3">
      <div className="text-center text-[#a0b0c5] text-[10px] uppercase tracking-widest mb-1">{label}</div>
      <div className="flex items-center gap-2">
        <span className={`text-xs sm:text-sm w-20 sm:w-28 text-right shrink-0 tabular-nums font-medium ${p1Wins ? 'text-[#7B61FF]' : 'text-white'}`}>{fmt1}</span>
        <div className="flex-1 flex gap-1">
          <div className="flex-1 flex justify-end">
            <div className="h-4 rounded-l transition-all duration-500" style={{ width: `${pct1}%`, backgroundColor: c1, boxShadow: p1Wins ? '0 0 10px rgba(123,97,255,0.45)' : 'none' }} />
          </div>
          <div className="flex-1 flex justify-start">
            <div className="h-4 rounded-r transition-all duration-500" style={{ width: `${pct2}%`, backgroundColor: c2, boxShadow: p2Wins ? '0 0 10px rgba(62,207,142,0.45)' : 'none' }} />
          </div>
        </div>
        <span className={`text-xs sm:text-sm w-20 sm:w-28 shrink-0 tabular-nums font-medium ${p2Wins ? 'text-[#3ecf8e]' : 'text-white'}`}>{fmt2}</span>
      </div>
    </div>
  );
}

function PlacementSkeleton() {
  return (
    <div className="flex items-end gap-1 h-24 animate-pulse">
      {[1,2,3,4,5,6,7,8].map(i => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1">
          <div className="text-[9px] text-[#1e2a3a]">·</div>
          <div className="w-full rounded-sm bg-[#1e2a3a]" style={{ height: `${30 + i * 5}%` }} />
          <div className="text-[9px] text-[#7a8aa0]">{i}</div>
        </div>
      ))}
    </div>
  );
}

function PlacementHistogram({ dist, color }: { dist: number[]; color: string }) {
  const max = Math.max(...dist) || 1;
  // Placements 1..4 in success-green hues, 5..8 in red — same visual logic
  // as the player-page placement distribution chart.
  return (
    <div className="flex items-end gap-1 h-24">
      {dist.map((count, i) => {
        const place = i + 1;
        const isTop4 = place <= 4;
        const heightPct = (count / max) * 100;
        return (
          <div key={place} className="flex-1 flex flex-col items-center gap-1">
            <div className="text-[9px] text-[#a0b0c5] tabular-nums">{count}</div>
            <div
              className="w-full rounded-sm transition-all duration-500"
              style={{
                height: `${heightPct}%`,
                minHeight: count > 0 ? '4px' : '2px',
                backgroundColor: isTop4 ? color : '#3a4a64',
                opacity: count > 0 ? 1 : 0.3,
              }}
              title={`Platz ${place}: ${count}`}
            />
            <div className="text-[9px] text-[#7a8aa0] tabular-nums">{place}</div>
          </div>
        );
      })}
    </div>
  );
}

// Merge two newest-last time-series into a Recharts row shape {date, p0, p1}.
function mergeHistories(histories: HistoryPoint[][]): { date: string; p0?: number; p1?: number }[] {
  const dates = new Set<string>();
  for (const series of histories) for (const p of series) dates.add(p.date);
  const sorted = [...dates].sort();
  const lookups = histories.map(series => {
    const m = new Map<string, number>();
    for (const p of series) m.set(p.date, p.finalValue);
    return m;
  });
  return sorted.map(date => ({
    date,
    p0: lookups[0].get(date),
    p1: lookups[1].get(date),
  }));
}
