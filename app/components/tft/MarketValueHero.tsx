'use client';
import { useEffect, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, YAxis, Tooltip as RechartsTooltip } from 'recharts';
import { useI18n, LOCALE_MAP, type Lang } from '../../lib/i18n';
import SetTimeline from './SetTimeline';

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
  const [refreshState, setRefreshState] = useState<'idle' | 'busy' | 'cooldown' | 'error'>('idle');
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);

  const loadValue = (signal?: AbortSignal) => {
    setLoading(true);
    setData(null);
    setHistory([]);
    return fetch(`/api/tft/marktwert?name=${encodeURIComponent(fullName)}&region=${region}`, { signal })
      .then(async r => {
        if (!r.ok) throw new Error('Marktwert nicht verfügbar');
        return r.json();
      })
      .then(j => {
        setData(j);
        setLoading(false);
        if (j.marketValue?.rated && j.summoner?.puuid) {
          setHistoryLoading(true);
          fetch(`/api/tft/marktwert/history?puuid=${j.summoner.puuid}&region=${region}&days=30`, { signal })
            .then(r => r.ok ? r.json() : { series: [] })
            .then(h => { setHistory(h.series || []); setHistoryLoading(false); })
            .catch(() => setHistoryLoading(false));
        }
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    const ctrl = new AbortController();
    loadValue(ctrl.signal);
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullName, region]);

  // On-demand refresh: the Vercel API forwards to the Hetzner crawler box,
  // which re-fills the match cache for this puuid and pushes a fresh snapshot
  // to Supabase before responding. After 200 we re-read /api/tft/marktwert
  // and the user sees the new value.
  const triggerRefresh = async () => {
    if (!data?.summoner?.puuid || refreshState === 'busy') return;
    setRefreshState('busy');
    setRefreshMessage(null);
    try {
      const res = await fetch('/api/tft/marktwert/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ puuid: data.summoner.puuid, region }),
      });
      if (res.status === 429) {
        const j = await res.json().catch(() => ({}));
        const sec = j.retryAfter || 60;
        setRefreshState('cooldown');
        setRefreshMessage(t('tft.marketValue.refresh.cooldown').replace('{s}', String(sec)));
        setTimeout(() => { setRefreshState('idle'); setRefreshMessage(null); }, sec * 1000);
        return;
      }
      if (!res.ok) throw new Error(`refresh failed: ${res.status}`);
      await loadValue();
      setRefreshState('idle');
    } catch {
      setRefreshState('error');
      setRefreshMessage(t('tft.marketValue.refresh.failed'));
      setTimeout(() => { setRefreshState('idle'); setRefreshMessage(null); }, 5000);
    }
  };

  // Loading skeleton — keeps the layout shape stable so the page doesn't jump
  // once the value lands.
  if (loading) {
    return (
      <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-5 mb-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-2">{t('tft.marketValue')}</div>
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
        <div className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-2">{t('tft.marketValue')}</div>
        <div className="text-[#a0b0c5] text-base">
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
            <div className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-1.5">{t('tft.marketValue')}</div>
            <div className="text-white text-4xl sm:text-5xl font-semibold tabular-nums leading-tight">
              {formatEuro(mv.finalValue, lang)}
            </div>
          </div>
          {delta != null && (
            <div className="mt-2 flex items-center gap-2 text-sm">
              <span
                className="font-medium tabular-nums"
                style={{ color: isFlat ? '#a0b0c5' : isUp ? '#3ecf8e' : '#e44040' }}
              >
                {isUp ? '▲' : isFlat ? '–' : '▼'}{' '}
                {formatEuro(Math.abs(delta.abs), lang)} ({delta.pct >= 0 ? '+' : ''}{delta.pct.toFixed(1)}%)
              </span>
              <span className="text-[#7a8aa0] text-xs">· {t('tft.marketValue.last7d')}</span>
            </div>
          )}
        </div>

        {/* Middle: Multiplier + sample size */}
        <div className="flex flex-col justify-between min-w-[140px]">
          <div>
            <div className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-1.5">{t('tft.marketValue.multiplier')}</div>
            <div className="text-white text-2xl font-medium tabular-nums">
              ×{mv.multiplier.toFixed(2)}
            </div>
            <div className="text-[#a0b0c5] text-xs mt-1">
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
          <div className="flex items-center justify-end gap-2 mb-1.5">
            <button
              onClick={triggerRefresh}
              disabled={refreshState === 'busy' || refreshState === 'cooldown'}
              className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-[#a0b0c5] hover:text-white disabled:text-[#7a8aa0] disabled:cursor-not-allowed transition-colors"
              title={data.snapshotDate ? `${t('tft.marketValue.dataFrom')} ${new Date(data.snapshotDate).toLocaleDateString(LOCALE_MAP[lang])}` : ''}
            >
              <span className={refreshState === 'busy' ? 'inline-block animate-spin' : 'inline-block'}>↻</span>
              {refreshState === 'busy' ? t('tft.marketValue.refresh.busy') : t('tft.marketValue.refresh.button')}
            </button>
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
                    labelStyle={{ color: '#a0b0c5' }}
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

      {/* Refresh feedback (cooldown / error) — only shown transiently */}
      {refreshMessage && (
        <div className="mt-2 text-[11px] text-[#a0b0c5]" role="status">
          {refreshMessage}
        </div>
      )}

      {/* Season timeline — set start → today → set end with patch ticks */}
      <SetTimeline lang={lang} />

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

// Map stable agent-note label IDs to i18n keys. Agents emit short technical
// labels like 'placement stddev'; the user sees the localized phrase.
const NOTE_LABEL_KEYS: Record<string, string> = {
  'avg-placement':           'tft.marketValue.note.avgPlacement',
  'top-4 rate':              'tft.marketValue.note.top4Rate',
  'top-1 rate':              'tft.marketValue.note.top1Rate',
  'comp diversity':          'tft.marketValue.note.compDiversity',
  'meta picks':              'tft.marketValue.note.metaPicks',
  'one-trick penalty':       'tft.marketValue.note.oneTrickPenalty',
  'off-meta':                'tft.marketValue.note.offMeta',
  'item slam':               'tft.marketValue.note.itemSlam',
  'prismatic share':         'tft.marketValue.note.prismaticShare',
  'placement stddev':        'tft.marketValue.note.placementStddev',
  'top-4 streak':            'tft.marketValue.note.top4Streak',
  'bottom-4 share':          'tft.marketValue.note.bottom4Share',
  // flexMastery
  'flex mastery':            'tft.marketValue.note.flexMastery',
  'one-trick mastery':       'tft.marketValue.note.oneTrickMastery',
  'flex without substance':  'tft.marketValue.note.flexNoSubstance',
  'carry diversity':         'tft.marketValue.note.carryDiversity',
  'narrow carry pool':       'tft.marketValue.note.narrowCarryPool',
  // gameSense
  'late exit':               'tft.marketValue.note.lateExit',
  'early exit':              'tft.marketValue.note.earlyExit',
  'eco mastery':              'tft.marketValue.note.ecoMastery',
  'unspent gold':            'tft.marketValue.note.unspentGold',
  // catch-alls — any of these agent-emitted strings means "we couldn't score"
  'no matches':              'tft.marketValue.note.tooFewMatches',
  'sample too small':        'tft.marketValue.note.tooFewMatches',
};

// Translate fragments inside detail strings. Agents emit
// "6 in a row" / "67% recommended" / "53% in top-10" / "85% one comp" /
// "17 comps" — we pattern-replace the English tail with the localized one.
function localizeDetail(detail: string, t: (k: any) => string): string {
  if (!detail) return detail;
  return detail
    .replace(/\bin a row\b/i, t('tft.marketValue.note.detail.inARow'))
    .replace(/\brecommended\b/i, t('tft.marketValue.note.detail.recommended'))
    .replace(/\bin top-10\b/i, t('tft.marketValue.note.detail.inTop10'))
    .replace(/\bone comp\b/i, t('tft.marketValue.note.detail.oneComp'))
    .replace(/\bcomps\b/i, t('tft.marketValue.note.detail.compsUnit'))
    .replace(/\bleftover\b/i, t('tft.marketValue.note.detail.leftover'))
    .replace(/\bcarries\b/i, t('tft.marketValue.note.detail.carries'));
}

function AgentRow({ agent }: { agent: AgentScore }) {
  const { t } = useI18n();
  const label = (() => {
    switch (agent.agent) {
      case 'performance':    return t('tft.marketValue.agent.performance');
      case 'metaAdaptation': return t('tft.marketValue.agent.metaAdaptation');
      case 'highRoll':       return t('tft.marketValue.agent.highRoll');
      case 'consistency':    return t('tft.marketValue.agent.consistency');
      case 'flexMastery':    return t('tft.marketValue.agent.flexMastery');
      case 'gameSense':      return t('tft.marketValue.agent.gameSense');
      default:               return agent.agent;
    }
  })();
  const positive = agent.delta > 0;
  const negative = agent.delta < 0;
  const color = positive ? '#3ecf8e' : negative ? '#e44040' : '#a0b0c5';
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-white font-medium">{label}</div>
        <div className="text-[#a0b0c5] text-xs mt-0.5">
          {agent.notes.length > 0
            ? agent.notes.map(n => {
                const noteLabel = NOTE_LABEL_KEYS[n.label] ? t(NOTE_LABEL_KEYS[n.label] as any) : n.label;
                const detail = n.detail ? localizeDetail(n.detail, t) : '';
                return `${noteLabel}${detail ? ` (${detail})` : ''}`;
              }).join(' · ')
            : t('tft.marketValue.agent.noImpact')}
        </div>
      </div>
      <div className="tabular-nums font-medium whitespace-nowrap flex-shrink-0" style={{ color }}>
        ×{agent.multiplier.toFixed(2)}
      </div>
    </div>
  );
}
