'use client';
import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip as RechartsTooltip, Legend,
} from 'recharts';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import { useI18n, LOCALE_MAP, type Lang } from '../../lib/i18n';
import TftHero from '../../components/tft/TftHero';
import { formatTier } from '../../lib/rank-format';

// Region list mirrors /tft/marktwert and /units pages — all crawled regions.
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

interface PlayerSummary {
  name: string;
  puuid: string;
  tier: string | null;
  rank: string | null;
  lp: number | null;
  marketValue: number | null;
  rated: boolean;
  multiplier: number | null;
  avgPlacement: number | null;
  top4Rate: number | null;
  matches: number;
}

interface HistoryPoint { date: string; finalValue: number }

export default function TftComparePage() {
  const { t, lang } = useI18n();
  const [inputs, setInputs] = useState<string[]>(['', '']);
  const [region, setRegion] = useState('euw1');
  const [results, setResults] = useState<(PlayerSummary | { error: string } | null)[]>([null, null]);
  const [histories, setHistories] = useState<HistoryPoint[][]>([[], []]);
  const [loading, setLoading] = useState(false);

  const compare = async () => {
    setLoading(true);
    const next: (PlayerSummary | { error: string } | null)[] = inputs.map(() => null);
    setResults(next);
    setHistories([[], []]);

    await Promise.all(inputs.map(async (raw, i) => {
      const name = raw.trim();
      if (!name) { next[i] = null; setResults([...next]); return; }
      try {
        const r = await fetch(`/api/tft/marktwert?name=${encodeURIComponent(name)}&region=${region}`);
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          next[i] = { error: j.error || `HTTP ${r.status}` };
        } else {
          const d = await r.json();
          const perf = d.marketValue?.agents?.find((a: any) => a.agent === 'performance');
          const avgNote = perf?.notes?.find((n: any) => n.label === 'avg-placement');
          const top4Note = perf?.notes?.find((n: any) => n.label === 'top-4 rate');
          next[i] = {
            name: d.summoner?.name || name,
            puuid: d.summoner?.puuid || '',
            tier: d.summoner?.tier || null,
            rank: d.summoner?.rank || null,
            lp: d.summoner?.lp ?? null,
            marketValue: d.marketValue?.finalValue ?? null,
            rated: !!d.marketValue?.rated,
            multiplier: d.marketValue?.multiplier ?? null,
            avgPlacement: avgNote?.detail ? Number(avgNote.detail) : null,
            top4Rate: top4Note?.detail ? Number(String(top4Note.detail).replace('%', '')) / 100 : null,
            matches: d.marketValue?.sampleSize ?? 0,
          };
          // Background-fetch the 30-day history for the chart overlay.
          if (next[i] && (next[i] as PlayerSummary).rated && (next[i] as PlayerSummary).puuid) {
            const puuid = (next[i] as PlayerSummary).puuid;
            fetch(`/api/tft/marktwert/history?puuid=${puuid}&region=${region}&days=30`)
              .then(r => r.ok ? r.json() : { series: [] })
              .then(h => setHistories(prev => prev.map((p, idx) => idx === i ? (h.series || []) : p)))
              .catch(() => {});
          }
        }
      } catch (e: any) {
        next[i] = { error: e.message };
      }
      setResults([...next]);
    }));
    setLoading(false);
  };

  // Merge the two histories into a single Recharts-ready array keyed by date,
  // so both players show up as overlaid lines.
  const chartData = mergeHistories(histories);

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
                  : 'bg-[#141c2e] text-[#8a9bb0] hover:text-white'
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          {results.map((r, i) => {
            if (!r) return (
              <div key={i} className="bg-[#0d1526] border border-[#1e2a3a] rounded p-5 text-[#4a5a70] text-sm text-center">
                {t('tft.compare.player')} {i + 1}
              </div>
            );
            if ('error' in r) return (
              <div key={i} className="bg-red-500/10 border border-red-500/30 rounded p-4 text-red-400 text-sm">
                {r.error}
              </div>
            );
            return (
              <div
                key={i}
                className="bg-[#0d1526] border-l-4 rounded p-5"
                style={{ borderLeftColor: SERIES_COLORS[i] }}
              >
                <div className="text-white text-base font-medium mb-1">{r.name}</div>
                <div className="text-[#8a9bb0] text-xs mb-3">
                  {r.tier ? formatTier(r.tier, r.rank) : 'Unranked'}
                  {r.lp != null ? ` · ${r.lp} LP` : ''}
                </div>
                <div className="space-y-1 text-xs">
                  <Row label={t('tft.avgPlacement')} value={r.avgPlacement?.toFixed(2) ?? '—'} />
                  <Row label={t('tft.top4')} value={r.top4Rate != null ? `${(r.top4Rate * 100).toFixed(0)}%` : '—'} />
                  <Row label={t('tft.gamesShort')} value={String(r.matches)} />
                  <Row label={t('tft.marketValue.multiplier')} value={r.multiplier != null ? `×${r.multiplier.toFixed(2)}` : '—'} />
                  <Row
                    label={t('tft.marketValue')}
                    value={r.rated && r.marketValue != null
                      ? new Intl.NumberFormat(LOCALE_MAP[lang], {
                          style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
                        }).format(r.marketValue)
                      : '—'
                    }
                    highlight
                  />
                </div>
              </div>
            );
          })}
        </div>

        {chartData.length >= 2 && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4">
            <div className="text-[#8a9bb0] text-xs uppercase tracking-widest mb-3">
              {t('tft.compare.chartTitle')}
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
                  <XAxis
                    dataKey="date"
                    stroke="#4a5a70"
                    fontSize={10}
                    tick={{ fill: '#8a9bb0' }}
                    tickFormatter={(d) => new Date(d).toLocaleDateString(LOCALE_MAP[lang], { month: 'short', day: 'numeric' })}
                  />
                  <YAxis
                    stroke="#4a5a70"
                    fontSize={10}
                    tick={{ fill: '#8a9bb0' }}
                    tickFormatter={(v) => `${Math.round(v / 1000)}k`}
                  />
                  <RechartsTooltip
                    contentStyle={{
                      backgroundColor: '#0d1526',
                      border: '1px solid #1e2a3a',
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                    labelStyle={{ color: '#8a9bb0' }}
                    formatter={(value: any) => [
                      new Intl.NumberFormat(LOCALE_MAP[lang], { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(value)),
                      '',
                    ]}
                    labelFormatter={(d) => typeof d === 'string' ? new Date(d).toLocaleDateString(LOCALE_MAP[lang]) : ''}
                  />
                  <Legend wrapperStyle={{ fontSize: 10, color: '#8a9bb0' }} />
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

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-[#4a5a70]">{label}</span>
      <span className={highlight ? 'text-[#7B61FF] font-medium' : 'text-white'}>{value}</span>
    </div>
  );
}

// Merge two newest-last time-series into a Recharts row shape {date, p0, p1}.
// Missing days for either player are simply absent in the source array; we
// emit a row for every date that appears in either series and let Recharts
// connectNulls bridge the gaps.
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
