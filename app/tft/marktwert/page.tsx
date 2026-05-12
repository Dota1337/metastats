'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, Cell,
} from 'recharts';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import TftHero from '../../components/tft/TftHero';
import { useI18n, LOCALE_MAP, type Lang } from '../../lib/i18n';

// Region list mirrors app/components/tft/StatsFilterBar.tsx — the marketvalue
// crawler runs across the same regions.
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

const TIER_COLORS: Record<string, string> = {
  MASTER: '#9d48e0', GRANDMASTER: '#e44040', CHALLENGER: '#f0c040',
};

const TABS = ['top', 'movers', 'distribution'] as const;
type Tab = typeof TABS[number];

interface LeaderboardPlayer {
  puuid: string;
  gameName: string | null;
  tagLine: string | null;
  tier: string;
  rank: string | null;
  lp: number;
  ladderRank: number | null;
  baseValue: number;
  multiplier: number;
  finalValue: number;
  sampleSize: number;
  snapshotDate: string;
}

interface Mover {
  puuid: string;
  gameName: string | null;
  tagLine: string | null;
  tier: string;
  rank: string | null;
  lp: number;
  currentValue: number;
  previousValue: number;
  delta: number;
  deltaPct: number;
}

function fmtEur(value: number, lang: Lang): string {
  return new Intl.NumberFormat(LOCALE_MAP[lang], {
    style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
  }).format(value);
}

function playerSlug(p: { gameName: string | null; tagLine: string | null }) {
  if (!p.gameName) return null;
  return `${encodeURIComponent(p.gameName)}--${encodeURIComponent(p.tagLine || 'EUW')}`;
}

export default function TftMarktwertPage() {
  const { t, lang } = useI18n();
  const [region, setRegion] = useState('euw1');
  const [tab, setTab] = useState<Tab>('top');
  const [tierFilter, setTierFilter] = useState<string>(''); // '' = all
  const [moverDirection, setMoverDirection] = useState<'up' | 'down'>('up');
  const [moverWindow, setMoverWindow] = useState<number>(7);

  const [leaderboard, setLeaderboard] = useState<LeaderboardPlayer[]>([]);
  const [movers, setMovers] = useState<Mover[]>([]);
  const [loading, setLoading] = useState(false);
  const [moversLoading, setMoversLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Leaderboard fetch — drives the Top tab and the Distribution tab (we
  // derive the histogram client-side from the leaderboard data).
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setLeaderboard([]);
    const tierQ = tierFilter ? `&tier=${tierFilter}` : '';
    fetch(`/api/tft/marktwert/leaderboard?region=${region}&limit=100${tierQ}`)
      .then(async r => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then(d => {
        if (cancelled) return;
        setLeaderboard(d.players || []);
        setLoading(false);
      })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [region, tierFilter]);

  // Movers fetch — only when the Movers tab is active so we don't waste
  // round-trips when the user is on Top / Distribution.
  useEffect(() => {
    if (tab !== 'movers') return;
    let cancelled = false;
    setMoversLoading(true); setMovers([]);
    fetch(`/api/tft/marktwert/movers?region=${region}&direction=${moverDirection}&window=${moverWindow}&limit=20`)
      .then(r => r.ok ? r.json() : { movers: [] })
      .then(d => { if (!cancelled) { setMovers(d.movers || []); setMoversLoading(false); } })
      .catch(() => { if (!cancelled) { setMovers([]); setMoversLoading(false); } });
    return () => { cancelled = true; };
  }, [tab, region, moverDirection, moverWindow]);

  // Histogram derived from leaderboard. 10 fixed bins from min→max — gives
  // a quick "where does each Master+ player land" picture.
  const histogram = useMemo(() => {
    if (leaderboard.length === 0) return [];
    const values = leaderboard.map(p => p.finalValue);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const bins = 10;
    const step = (max - min) / bins || 1;
    const buckets = Array.from({ length: bins }, (_, i) => ({
      lo: min + step * i,
      hi: min + step * (i + 1),
      count: 0,
    }));
    for (const v of values) {
      const idx = Math.min(bins - 1, Math.floor((v - min) / step));
      buckets[idx].count++;
    }
    return buckets.map(b => ({
      label: `${Math.round(b.lo / 1000)}–${Math.round(b.hi / 1000)}k`,
      count: b.count,
      midpoint: (b.lo + b.hi) / 2,
    }));
  }, [leaderboard]);

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="marktwert" />
      <TftHero pageTitle={t('nav.marketvalue')} />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-2 pb-6">
        <p className="text-[#8a9bb0] text-sm mb-4">{t('tft.marketValue.pageHint')}</p>

        {/* Region selector — all 17 regions, scrollable horizontally on mobile */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {REGIONS.map(r => (
            <button
              key={r.value}
              onClick={() => setRegion(r.value)}
              className={`px-2.5 py-1 rounded text-xs font-medium ${
                region === r.value
                  ? 'bg-[#7B61FF] text-white'
                  : 'bg-[#141c2e] text-[#8a9bb0] hover:text-white'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* Tab strip */}
        <div className="flex gap-1 border-b border-[#1e2a3a] mb-4">
          {TABS.map(tt => (
            <button
              key={tt}
              onClick={() => setTab(tt)}
              className={`px-4 py-2 text-xs font-medium uppercase tracking-widest ${
                tab === tt
                  ? 'text-white border-b-2 border-[#7B61FF]'
                  : 'text-[#8a9bb0] hover:text-white'
              }`}
            >
              {t(`tft.marketValue.tab.${tt}` as const)}
            </button>
          ))}
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded p-4 text-red-400 text-sm mb-4">
            {error}
          </div>
        )}

        {tab === 'top' && (
          <TopTab
            players={leaderboard}
            loading={loading}
            region={region}
            tierFilter={tierFilter}
            onTierFilter={setTierFilter}
            lang={lang}
            t={t}
          />
        )}

        {tab === 'movers' && (
          <MoversTab
            movers={movers}
            loading={moversLoading}
            region={region}
            direction={moverDirection}
            setDirection={setMoverDirection}
            window_={moverWindow}
            setWindow={setMoverWindow}
            lang={lang}
            t={t}
          />
        )}

        {tab === 'distribution' && (
          <DistributionTab
            data={histogram}
            count={leaderboard.length}
            loading={loading}
            lang={lang}
            t={t}
          />
        )}
      </div>
      <Footer />
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Top tab
// ─────────────────────────────────────────────────────────────────────────────

function TopTab({
  players, loading, region, tierFilter, onTierFilter, lang, t,
}: {
  players: LeaderboardPlayer[];
  loading: boolean;
  region: string;
  tierFilter: string;
  onTierFilter: (v: string) => void;
  lang: Lang;
  t: (k: any) => string;
}) {
  const tierOptions = ['', 'CHALLENGER', 'GRANDMASTER', 'MASTER'];
  return (
    <>
      <div className="flex flex-wrap gap-1 mb-3">
        {tierOptions.map(tr => (
          <button
            key={tr}
            onClick={() => onTierFilter(tr)}
            className={`px-3 py-1.5 rounded text-xs font-medium ${
              tierFilter === tr
                ? 'bg-[#7B61FF] text-white'
                : 'bg-[#141c2e] text-[#8a9bb0] hover:text-white'
            }`}
          >
            {tr || t('tft.filter.allRanks')}
          </button>
        ))}
      </div>

      {loading && <SkeletonRows count={10} />}

      {!loading && players.length === 0 && (
        <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6 text-center text-[#8a9bb0] text-sm">
          {t('tft.marketValue.empty')}
        </div>
      )}

      {!loading && players.length > 0 && (
        <div className="bg-[#0d1526] border border-[#1e2a3a] rounded overflow-hidden">
          <div className="grid grid-cols-[3rem_1fr_5rem_4rem_8rem] gap-2 px-4 py-2 text-[10px] uppercase text-[#4a5a70] bg-[#0a0e1a]">
            <div className="text-right">#</div>
            <div>{t('tft.marketValue.col.player')}</div>
            <div className="text-right">LP</div>
            <div className="text-right">×</div>
            <div className="text-right">{t('tft.marketValue')}</div>
          </div>
          {players.map((p, i) => {
            const slug = playerSlug(p);
            return (
              <a
                key={p.puuid}
                href={slug ? `/tft/player/${slug}?region=${region}` : '#'}
                className="grid grid-cols-[3rem_1fr_5rem_4rem_8rem] gap-2 px-4 py-2 items-center text-xs hover:bg-white/5 border-t border-[#1e2a3a]"
              >
                <div className="text-right text-[#8a9bb0] tabular-nums">{i + 1}</div>
                <div className="text-white truncate">
                  {p.gameName || <span className="text-[#4a5a70]">unbekannt</span>}
                  {p.tagLine && <span className="text-[#4a5a70] text-[10px]"> #{p.tagLine}</span>}
                  <span
                    className="ml-2 text-[10px] uppercase tracking-widest"
                    style={{ color: TIER_COLORS[p.tier] || '#8a9bb0' }}
                  >
                    {p.tier.slice(0, 4)}
                  </span>
                </div>
                <div className="text-right text-white tabular-nums">{p.lp}</div>
                <div className="text-right text-[#8a9bb0] tabular-nums">{p.multiplier.toFixed(2)}</div>
                <div className="text-right">
                  <span className="text-[#7B61FF] font-medium tabular-nums">
                    {fmtEur(p.finalValue, lang)}
                  </span>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Movers tab
// ─────────────────────────────────────────────────────────────────────────────

function MoversTab({
  movers, loading, region, direction, setDirection, window_, setWindow, lang, t,
}: {
  movers: Mover[];
  loading: boolean;
  region: string;
  direction: 'up' | 'down';
  setDirection: (v: 'up' | 'down') => void;
  window_: number;
  setWindow: (v: number) => void;
  lang: Lang;
  t: (k: any) => string;
}) {
  return (
    <>
      <div className="flex flex-wrap gap-3 mb-3">
        <div className="flex gap-1">
          <button
            onClick={() => setDirection('up')}
            className={`px-3 py-1.5 rounded text-xs font-medium ${
              direction === 'up' ? 'bg-[#3ecf8e]/20 text-[#3ecf8e] border border-[#3ecf8e]/40'
                                 : 'bg-[#141c2e] text-[#8a9bb0] hover:text-white'
            }`}
          >
            ▲ {t('tft.marketValue.movers.gainers')}
          </button>
          <button
            onClick={() => setDirection('down')}
            className={`px-3 py-1.5 rounded text-xs font-medium ${
              direction === 'down' ? 'bg-[#e44040]/20 text-[#e44040] border border-[#e44040]/40'
                                   : 'bg-[#141c2e] text-[#8a9bb0] hover:text-white'
            }`}
          >
            ▼ {t('tft.marketValue.movers.losers')}
          </button>
        </div>
        <div className="flex gap-1">
          {[7, 30].map(w => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              className={`px-3 py-1.5 rounded text-xs font-medium ${
                window_ === w ? 'bg-[#7B61FF] text-white' : 'bg-[#141c2e] text-[#8a9bb0] hover:text-white'
              }`}
            >
              {w}d
            </button>
          ))}
        </div>
      </div>

      {loading && <SkeletonRows count={6} />}

      {!loading && movers.length === 0 && (
        <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6 text-center text-[#8a9bb0] text-sm">
          {t('tft.marketValue.movers.notEnoughHistory')}
        </div>
      )}

      {!loading && movers.length > 0 && (
        <div className="bg-[#0d1526] border border-[#1e2a3a] rounded overflow-hidden">
          <div className="grid grid-cols-[3rem_1fr_7rem_5rem_6rem] gap-2 px-4 py-2 text-[10px] uppercase text-[#4a5a70] bg-[#0a0e1a]">
            <div className="text-right">#</div>
            <div>{t('tft.marketValue.col.player')}</div>
            <div className="text-right">{t('tft.marketValue.col.now')}</div>
            <div className="text-right">{window_}d</div>
            <div className="text-right">Δ</div>
          </div>
          {movers.map((m, i) => {
            const slug = playerSlug(m);
            const color = direction === 'up' ? '#3ecf8e' : '#e44040';
            const sign = direction === 'up' ? '+' : '';
            return (
              <a
                key={m.puuid}
                href={slug ? `/tft/player/${slug}?region=${region}` : '#'}
                className="grid grid-cols-[3rem_1fr_7rem_5rem_6rem] gap-2 px-4 py-2 items-center text-xs hover:bg-white/5 border-t border-[#1e2a3a]"
              >
                <div className="text-right text-[#8a9bb0] tabular-nums">{i + 1}</div>
                <div className="text-white truncate">
                  {m.gameName || <span className="text-[#4a5a70]">unbekannt</span>}
                  {m.tagLine && <span className="text-[#4a5a70] text-[10px]"> #{m.tagLine}</span>}
                  <span
                    className="ml-2 text-[10px] uppercase tracking-widest"
                    style={{ color: TIER_COLORS[m.tier] || '#8a9bb0' }}
                  >
                    {m.tier.slice(0, 4)}
                  </span>
                </div>
                <div className="text-right text-white tabular-nums">{fmtEur(m.currentValue, lang)}</div>
                <div className="text-right text-[#8a9bb0] tabular-nums text-[10px]">{fmtEur(m.previousValue, lang)}</div>
                <div className="text-right tabular-nums font-medium" style={{ color }}>
                  {sign}{fmtEur(m.delta, lang)}
                  <div className="text-[10px] opacity-80">{m.deltaPct >= 0 ? '+' : ''}{m.deltaPct.toFixed(1)}%</div>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Distribution tab
// ─────────────────────────────────────────────────────────────────────────────

function DistributionTab({
  data, count, loading, lang, t,
}: {
  data: { label: string; count: number; midpoint: number }[];
  count: number;
  loading: boolean;
  lang: Lang;
  t: (k: any) => string;
}) {
  if (loading) {
    return <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-8 h-72 animate-pulse" />;
  }
  if (data.length === 0) {
    return (
      <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6 text-center text-[#8a9bb0] text-sm">
        {t('tft.marketValue.empty')}
      </div>
    );
  }
  return (
    <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[#8a9bb0] text-xs uppercase tracking-widest">
          {t('tft.marketValue.distribution.title')}
        </div>
        <div className="text-[#4a5a70] text-[10px]">
          {t('tft.marketValue.distribution.basedOn').replace('{n}', String(count))}
        </div>
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 24, left: 8 }}>
            <XAxis
              dataKey="label"
              stroke="#4a5a70"
              fontSize={10}
              tick={{ fill: '#8a9bb0' }}
              angle={-25}
              textAnchor="end"
              height={50}
            />
            <YAxis stroke="#4a5a70" fontSize={10} tick={{ fill: '#8a9bb0' }} />
            <RechartsTooltip
              contentStyle={{
                backgroundColor: '#0d1526',
                border: '1px solid #1e2a3a',
                borderRadius: 6,
                fontSize: 12,
              }}
              labelStyle={{ color: '#8a9bb0' }}
              formatter={(value: any) => [value, t('tft.marketValue.distribution.players')]}
            />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {data.map((_, i) => (
                <Cell key={i} fill={`hsl(${250 + i * 6}, 60%, ${45 + i * 3}%)`} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="text-[#4a5a70] text-[10px] mt-2 text-center">
        {t('tft.marketValue.distribution.xAxisHint')}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// shared
// ─────────────────────────────────────────────────────────────────────────────

function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="bg-[#0d1526] border border-[#1e2a3a] rounded overflow-hidden">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="px-4 py-2 border-t border-[#1e2a3a] first:border-t-0">
          <div className="h-4 bg-[#1e2a3a] rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}
