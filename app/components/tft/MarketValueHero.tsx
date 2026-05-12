'use client';
import { useEffect, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, YAxis, Tooltip as RechartsTooltip } from 'recharts';
import { useI18n, LOCALE_MAP, type Lang } from '../../lib/i18n';

interface MarketValueResponse {
  summoner: { name: string; puuid: string; tier?: string; rank?: string; lp?: number };
  marketValue: {
    baseValue: number;
    multiplier: number;
    finalValue: number;
    rated: boolean;
    notRatedReason?: string;
    sampleSize: number;
    damping: number;
    agents: AgentScore[];
  };
  source: 'snapshot' | 'live';
  snapshotDate?: string;
  region: string;
}

interface AgentScore {
  agent: string;
  multiplier: number;
  delta: number;
  notes: { label: string; impact: number; detail?: string }[];
}

interface HistoryPoint {
  date: string;
  finalValue: number;
  multiplier: number;
  tier: string;
  lp: number;
}

interface MarketValueHeroProps {
  fullName: string;            // 'gameName#tagLine'
  region: string;
  lang: Lang;
}

function formatEuro(value: number, lang: Lang): string {
  return new Intl.NumberFormat(LOCALE_MAP[lang], {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value);
}

function pickHistoryDelta(series: HistoryPoint[]): { abs: number; pct: number } | null {
  if (series.length < 2) return null;
  const newest = series[series.length - 1];
  // Pick the snapshot closest to (newest - 7 days) — defaults to oldest if
  // the series is shorter than 7d.
  const target = new Date(newest.date).getTime() - 7 * 24 * 60 * 60 * 1000;
  let prev = series[0];
  for (const p of series) {
    if (new Date(p.date).getTime() <= target) prev = p;
  }
  if (prev === newest) return null;
  const abs = newest.finalValue - prev.finalValue;
  const pct = prev.finalValue > 0 ? (abs / prev.finalValue) * 100 : 0;
  return { abs, pct };
}

export default function MarketValueHero({ fullName, region, lang }: MarketValueHeroProps) {
  const { t } = useI18n();
  const [data, setData] = useState<MarketValueResponse | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);
    setHistory([]);
    fetch(`/api/tft/marktwert?name=${encodeURIComponent(fullName)}&region=${region}`)
      .then(async r => {
        if (!r.ok) throw new Error('Marktwert nicht verfügbar');
        return r.json();
      })
      .then(j => {
        if (cancelled) return;
        setData(j);
        setLoading(false);
        // Kick off history fetch only if rated — unrated players have no
        // snapshots to query.
        if (j.marketValue?.rated && j.summoner?.puuid) {
          setHistoryLoading(true);
          fetch(`/api/tft/marktwert/history?puuid=${j.summoner.puuid}&region=${region}&days=30`)
            .then(r => r.ok ? r.json() : { series: [] })
            .then(h => { if (!cancelled) { setHistory(h.series || []); setHistoryLoading(false); } })
            .catch(() => { if (!cancelled) setHistoryLoading(false); });
        }
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fullName, region]);

  // Loading skeleton — keeps the layout shape stable so the page doesn't jump
  // once the value lands.
  if (loading) {
    return (
      <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-5 mb-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[#8a9bb0] text-xs uppercase tracking-widest mb-2">{t('tft.marketValue')}</div>
            <div className="h-9 w-32 bg-[#1e2a3a] rounded animate-pulse" />
            <div className="h-3 w-20 bg-[#1e2a3a] rounded animate-pulse mt-2" />
          </div>
          <div className="h-12 w-40 bg-[#1e2a3a] rounded animate-pulse" />
        </div>
      </div>
    );
  }

  // Unrated path — Iron–Diamond + Unranked. Surface honestly, don't fake a value.
  const rated = data?.marketValue.rated === true;
  if (!data || !rated) {
    const reason = data?.marketValue.notRatedReason || 'unrated';
    return (
      <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-5 mb-5">
        <div className="text-[#8a9bb0] text-xs uppercase tracking-widest mb-2">{t('tft.marketValue')}</div>
        <div className="text-[#8a9bb0] text-base">
          {reason === 'below_master' ? t('tft.marketValue.belowMaster') : t('tft.marketValue.notRated')}
        </div>
      </div>
    );
  }

  const mv = data.marketValue;
  const delta = pickHistoryDelta(history);
  const isUp = (delta?.abs ?? 0) > 0;
  const isFlat = (delta?.abs ?? 0) === 0;
  const lineColor = !delta || isFlat ? '#7B61FF' : isUp ? '#3ecf8e' : '#e44040';

  return (
    <div className="bg-gradient-to-br from-[#0d1526] to-[#0e1830] border border-[#1e2a3a] rounded-lg p-5 mb-5 relative overflow-hidden">
      {/* Accent stripe to make the hero visually distinct from the other cards */}
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-[#7B61FF] via-[#9d48e0] to-[#f0c040]" />

      <div className="flex items-stretch justify-between gap-6 flex-wrap">
        {/* Left: Big EUR value + 7d delta */}
        <div className="flex flex-col justify-between min-w-[180px]">
          <div>
            <div className="text-[#8a9bb0] text-xs uppercase tracking-widest mb-1.5">{t('tft.marketValue')}</div>
            <div className="text-white text-4xl sm:text-5xl font-semibold tabular-nums leading-tight">
              {formatEuro(mv.finalValue, lang)}
            </div>
          </div>
          {delta != null && (
            <div className="mt-2 flex items-center gap-2 text-sm">
              <span
                className="font-medium tabular-nums"
                style={{ color: isFlat ? '#8a9bb0' : isUp ? '#3ecf8e' : '#e44040' }}
              >
                {isUp ? '▲' : isFlat ? '–' : '▼'}{' '}
                {formatEuro(Math.abs(delta.abs), lang)} ({delta.pct >= 0 ? '+' : ''}{delta.pct.toFixed(1)}%)
              </span>
              <span className="text-[#4a5a70] text-xs">· {t('tft.marketValue.last7d')}</span>
            </div>
          )}
        </div>

        {/* Middle: Multiplier + sample size */}
        <div className="flex flex-col justify-between min-w-[140px]">
          <div>
            <div className="text-[#8a9bb0] text-xs uppercase tracking-widest mb-1.5">{t('tft.marketValue.multiplier')}</div>
            <div className="text-white text-2xl font-medium tabular-nums">
              ×{mv.multiplier.toFixed(2)}
            </div>
            <div className="text-[#8a9bb0] text-xs mt-1">
              {t('tft.marketValue.basedOn').replace('{n}', String(mv.sampleSize))}
            </div>
          </div>
          <button
            onClick={() => setShowDetails(d => !d)}
            className="mt-2 text-[10px] text-[#7B61FF] hover:text-[#a892ff] uppercase tracking-widest text-left"
          >
            {t('tft.marketValue.howCalculated')} {showDetails ? '▲' : '▼'}
          </button>
        </div>

        {/* Right: 30d sparkline (if we have history) */}
        <div className="flex-1 min-w-[200px] max-w-md">
          <div className="text-[#8a9bb0] text-xs uppercase tracking-widest mb-1.5 text-right">
            {t('tft.marketValue.last30d')}
          </div>
          <div className="h-20">
            {historyLoading ? (
              <div className="h-full w-full bg-[#1e2a3a] rounded animate-pulse" />
            ) : history.length >= 2 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                  <YAxis hide domain={['dataMin', 'dataMax']} />
                  <RechartsTooltip
                    contentStyle={{
                      backgroundColor: '#0d1526',
                      border: '1px solid #1e2a3a',
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                    labelStyle={{ color: '#8a9bb0' }}
                    formatter={(value: any) => [formatEuro(Number(value), lang), t('tft.marketValue')]}
                    labelFormatter={(d) => typeof d === 'string' ? new Date(d).toLocaleDateString(LOCALE_MAP[lang]) : ''}
                  />
                  <Line
                    type="monotone"
                    dataKey="finalValue"
                    stroke={lineColor}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : null}
          </div>
        </div>
      </div>

      {/* Expandable agent breakdown */}
      {showDetails && (
        <div className="mt-4 pt-4 border-t border-[#1e2a3a] grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-xs">
          {mv.agents.map(a => (
            <AgentRow key={a.agent} agent={a} />
          ))}
        </div>
      )}
    </div>
  );
}

function AgentRow({ agent }: { agent: AgentScore }) {
  const { t } = useI18n();
  const label = (() => {
    switch (agent.agent) {
      case 'performance':    return t('tft.marketValue.agent.performance');
      case 'metaAdaptation': return t('tft.marketValue.agent.metaAdaptation');
      case 'highRoll':       return t('tft.marketValue.agent.highRoll');
      case 'consistency':    return t('tft.marketValue.agent.consistency');
      default:               return agent.agent;
    }
  })();
  const positive = agent.delta > 0;
  const negative = agent.delta < 0;
  const color = positive ? '#3ecf8e' : negative ? '#e44040' : '#8a9bb0';
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-white font-medium">{label}</div>
        <div className="text-[#4a5a70] text-[10px] mt-0.5">
          {agent.notes.length > 0
            ? agent.notes.map(n => `${n.label}${n.detail ? ` (${n.detail})` : ''}`).join(' · ')
            : t('tft.marketValue.agent.noImpact')}
        </div>
      </div>
      <div className="tabular-nums font-medium whitespace-nowrap" style={{ color }}>
        ×{agent.multiplier.toFixed(2)}
      </div>
    </div>
  );
}
