'use client';
import { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, Cell, ReferenceLine, XAxis, YAxis, Tooltip as RechartsTooltip } from 'recharts';
import { useI18n, LOCALE_MAP, type Lang, type TranslationKey } from '../../lib/i18n';
import SetTimeline, { type SetInfo } from './SetTimeline';
import Link from 'next/link';

interface MarketValueResponse {
  summoner: { name: string; puuid: string; tier?: string; rank?: string; lp?: number; ladderRank?: number | null };
  marketValue: {
    baseValue: number;
    multiplier: number;
    finalValue: number;
    rated: boolean;
    notRatedReason?: string;
    sampleSize: number;
    damping: number;
    agents: SkillSignal[];
  };
  source: 'snapshot' | 'live';
  snapshotDate?: string;
  region: string;
}

// New weighted skill-score signal shape (replaces the old {agent,multiplier,notes}).
interface SkillSignal {
  signal: string;
  z: number | null;
  weight: number;
  contribution: number;   // signed w·z/Σw — this signal's share of the skill score
  detail: string;
  available: boolean;
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
  const [setInfo, setSetInfo] = useState<SetInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [refreshState, setRefreshState] = useState<'idle' | 'busy' | 'cooldown' | 'error'>('idle');
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);

  const loadValue = (signal?: AbortSignal) => {
    setLoading(true);
    setData(null);
    setHistory([]);
    // Fetch marketvalue + current-set in parallel — the set's startDate
    // scopes the sparkline window so the chart shows only this set's data.
    return Promise.all([
      fetch(`/api/tft/marktwert?name=${encodeURIComponent(fullName)}&region=${region}`, { signal })
        .then(async r => {
          if (!r.ok) throw new Error(t('tft.marketvalue.unavailable'));
          return r.json();
        }),
      fetch('/api/tft/sets/current', { signal })
        .then(r => r.ok ? r.json() : null)
        .catch(() => null),
    ])
      .then(([j, s]) => {
        setData(j);
        const validSet = s && s.startDate && s.endDate && !s.error ? (s as SetInfo) : null;
        setSetInfo(validSet);
        setLoading(false);

        if (j.marketValue?.rated && j.summoner?.puuid) {
          setHistoryLoading(true);
          const historyUrl = validSet?.startDate
            ? `/api/tft/marktwert/history?puuid=${j.summoner.puuid}&region=${region}&from=${validSet.startDate}`
            : `/api/tft/marktwert/history?puuid=${j.summoner.puuid}&region=${region}&days=30`;
          fetch(historyUrl, { signal })
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

  // Pre-compute chart data here (before any early returns) so the order of
  // React hooks stays stable across renders — useMemo can't sit below the
  // `if (loading)` short-circuits.
  const chartData = useMemo(
    () => history.map(p => ({ ...p, dateMs: new Date(p.date + 'T00:00:00Z').getTime() })),
    [history],
  );

  // Loading skeleton — keeps the layout shape stable so the page doesn't jump
  // once the value lands.
  if (loading) {
    return (
      <div className="bg-surface-base border border-border-subtle rounded-lg p-5 mb-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-fg-secondary text-xs uppercase tracking-widest mb-2">{t('tft.marketValue')}</div>
            <div className="h-9 w-32 bg-surface-overlay rounded animate-pulse" />
            <div className="h-3 w-20 bg-surface-overlay rounded animate-pulse mt-2" />
          </div>
          <div className="h-12 w-40 bg-surface-overlay rounded animate-pulse" />
        </div>
      </div>
    );
  }

  // Unrated path — Iron–Diamond + Unranked. Surface honestly, don't fake a value.
  const rated = data?.marketValue.rated === true;
  if (!data || !rated) {
    const reason = data?.marketValue.notRatedReason || 'unrated';
    return (
      <div className="bg-surface-base border border-border-subtle rounded-lg p-5 mb-5">
        <div className="text-fg-secondary text-xs uppercase tracking-widest mb-2">{t('tft.marketValue')}</div>
        <div className="text-fg-secondary text-base">
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

  // Numeric x-axis pinned to [set-start, today] so the sparkline always
  // anchors to the set window — points land at their real position rather
  // than being stretched across the full width when we only have 2-3 days
  // of crawler history.
  const setStartMs = setInfo?.startDate
    ? new Date(setInfo.startDate + 'T00:00:00Z').getTime()
    : (chartData[0]?.dateMs ?? 0);
  const todayMs = new Date((setInfo?.today || new Date().toISOString().slice(0, 10)) + 'T00:00:00Z').getTime();

  return (
    <div className="bg-gradient-to-br from-surface-base to-[#0e1830] border border-border-subtle rounded-lg p-5 mb-5 relative overflow-hidden">
      {/* Accent stripe to make the hero visually distinct from the other cards */}
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-accent via-[#9d48e0] to-[#f0c040]" />

      <div className="flex items-stretch justify-between gap-6 flex-wrap">
        {/* Left: Big EUR value + 7d delta */}
        <div className="flex flex-col justify-between min-w-[180px]">
          <div>
            <div className="text-fg-secondary text-xs uppercase tracking-widest mb-1.5">{t('tft.marketValue')}</div>
            <div className="text-white text-4xl sm:text-5xl font-semibold tabular-nums leading-tight">
              {formatEuro(mv.finalValue, lang)}
            </div>
            {data.summoner.ladderRank != null && data.summoner.ladderRank > 0 && (
              <div className="text-fg-secondary text-xs mt-1.5 tabular-nums">
                {t('tft.marketValue.ladderRank').replace('{n}', String(data.summoner.ladderRank))}
              </div>
            )}
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
              <span className="text-fg-muted text-xs">· {t('tft.marketValue.last7d')}</span>
            </div>
          )}
        </div>

        {/* Middle: Multiplier + sample size */}
        <div className="flex flex-col justify-between min-w-[140px]">
          <div>
            <div className="text-fg-secondary text-xs uppercase tracking-widest mb-1.5">{t('tft.marketValue.multiplier')}</div>
            <div className="text-white text-2xl font-medium tabular-nums">
              ×{mv.multiplier.toFixed(2)}
            </div>
            <div className="text-fg-secondary text-xs mt-1">
              {t('tft.marketValue.basedOn').replace('{n}', String(mv.sampleSize))}
            </div>
          </div>
          <button
            onClick={() => setShowDetails(d => !d)}
            className="mt-2 text-[10px] text-accent hover:text-[#a892ff] uppercase tracking-widest text-left"
          >
            {t('tft.marketValue.howCalculated')} {showDetails ? '▲' : '▼'}
          </button>
        </div>

        {/* Right: value chart over the set window (grows into the free space) */}
        <div className="flex-1 min-w-[300px]">
          <div className="flex items-center justify-end gap-2 mb-1.5">
            <button
              onClick={triggerRefresh}
              disabled={refreshState === 'busy' || refreshState === 'cooldown'}
              className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-fg-secondary hover:text-white disabled:text-fg-muted disabled:cursor-not-allowed transition-colors"
              title={data.snapshotDate ? `${t('tft.marketValue.dataFrom')} ${new Date(data.snapshotDate).toLocaleDateString(LOCALE_MAP[lang])}` : ''}
            >
              <span className={refreshState === 'busy' ? 'inline-block animate-spin' : 'inline-block'}>↻</span>
              {refreshState === 'busy' ? t('tft.marketValue.refresh.busy') : t('tft.marketValue.refresh.button')}
            </button>
          </div>
          <div className="h-28">
            {historyLoading ? (
              <div className="h-full w-full bg-surface-overlay rounded animate-pulse" />
            ) : chartData.length >= 2 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                  <XAxis
                    type="number"
                    dataKey="dateMs"
                    domain={[setStartMs, todayMs]}
                    hide
                  />
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
                    labelFormatter={(ms) => typeof ms === 'number' ? new Date(ms).toLocaleDateString(LOCALE_MAP[lang]) : ''}
                  />
                  <Line
                    type="monotone"
                    dataKey="finalValue"
                    stroke={lineColor}
                    strokeWidth={2}
                    dot={chartData.length <= 6 ? { r: 3, fill: lineColor } : false}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : null}
          </div>
          {/* Timeline directly under the chart: patch-start → today (matches the chart's x-axis) */}
          {setInfo && <PatchTimeline info={setInfo} lang={lang} />}
        </div>
      </div>

      {/* Refresh feedback (cooldown / error) — only shown transiently */}
      {refreshMessage && (
        <div className="mt-2 text-[11px] text-fg-secondary" role="status">
          {refreshMessage}
        </div>
      )}

      {/* Compact set-remaining indicator */}
      {setInfo && <SetTimeline lang={lang} info={setInfo} />}

      {/* Expandable skill-score breakdown */}
      {showDetails && (
        <div className="mt-4 pt-4 border-t border-border-subtle">
          <div className="text-fg-secondary text-xs mb-3">
            {t('tft.marketValue.methodologyIntro').replace('{base}', formatEuro(mv.baseValue, lang))}
          </div>

          {/* Diverging contribution chart — each signal's signed share (w·z/Σw)
              of the skill score. Green pulls the multiplier above 1.0, red below.
              Makes the multiplier composition legible at a glance before the
              detailed rows below. */}
          <ContributionChart agents={mv.agents} />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-xs">
            {[...mv.agents]
              .filter(s => s && s.signal)   // skip legacy-shape rows during the transition day
              .sort((a, b) => Number(b.available) - Number(a.available) || Math.abs(b.contribution) - Math.abs(a.contribution))
              .map(s => <SignalRow key={s.signal} sig={s} />)}
          </div>
          <Link
            href="/tft/marktwert/methodik"
            className="inline-flex items-center gap-1 mt-3 text-[11px] text-accent hover:text-[#9d7bff] transition-colors"
          >
            <span aria-hidden>ⓘ</span> {t('tft.mv.method.link')}
          </Link>
        </div>
      )}
    </div>
  );
}

// A horizontal timeline directly under the chart, spanning the chart's x-axis
// window: patch/set start (left) → today (right).
function PatchTimeline({ info, lang }: { info: SetInfo; lang: Lang }) {
  const { t } = useI18n();
  if (!info.startDate) return null;
  const fmt = (d: string) =>
    new Date(d + 'T00:00:00Z').toLocaleDateString(LOCALE_MAP[lang], { day: '2-digit', month: 'short' });
  return (
    <div className="mt-2">
      <div className="relative h-1 rounded-full bg-surface-overlay">
        <span className="absolute left-0 -top-[3px] h-[7px] w-[7px] rounded-full bg-accent" />
        <span className="absolute right-0 -top-[3px] h-[7px] w-[7px] rounded-full bg-[#9d48e0]" />
      </div>
      <div className="flex items-center justify-between mt-1 text-[10px] text-fg-muted tabular-nums">
        <span>
          {t('tft.marketValue.timeline.start')}
          {info.currentPatch ? ` · ${info.currentPatch}` : ''} · {fmt(info.startDate)}
        </span>
        <span>{t('tft.setTimeline.today')} · {fmt(info.today)}</span>
      </div>
    </div>
  );
}

const SIGNAL_LABEL_KEYS: Record<string, string> = {
  performance:   'tft.marketValue.agent.performance',
  metaRelative:  'tft.marketValue.agent.metaRelative',
  consistency:   'tft.marketValue.agent.consistency',
  flexMastery:   'tft.marketValue.agent.flexMastery',
  gameSense:     'tft.marketValue.agent.gameSense',
  boardStrength: 'tft.marketValue.agent.boardStrength',
};

// Diverging horizontal bar chart of every available signal's signed
// contribution (w·z/Σw). Sorted strongest-positive → strongest-negative;
// green bars push the multiplier above 1.0, red below. Hidden when fewer
// than two signals are available (nothing to compare).
function ContributionChart({ agents }: { agents: SkillSignal[] }) {
  const { t } = useI18n();
  const rows = [...agents]
    .filter(s => s && s.signal && s.available)
    .sort((a, b) => b.contribution - a.contribution)
    .map(s => ({
      signal: s.signal,
      name: SIGNAL_LABEL_KEYS[s.signal] ? t(SIGNAL_LABEL_KEYS[s.signal] as TranslationKey) : s.signal,
      value: Number(s.contribution.toFixed(3)),
    }));
  if (rows.length < 2) return null;
  // Symmetric domain so the zero line sits dead-centre and bar lengths are
  // comparable left vs right. Floor at 0.05 so a near-flat profile doesn't
  // get amplified into misleadingly long bars.
  const max = Math.max(0.05, ...rows.map(r => Math.abs(r.value)));
  return (
    <div className="mb-4">
      <div className="text-fg-muted text-[10px] uppercase tracking-widest mb-1.5">{t('tft.marketValue.contributions')}</div>
      <div style={{ height: rows.length * 26 + 6 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 10, bottom: 0, left: 10 }}>
            <XAxis type="number" domain={[-max, max]} hide />
            <YAxis
              type="category"
              dataKey="name"
              width={104}
              tick={{ fontSize: 11, fill: '#a0b0c5' }}
              axisLine={false}
              tickLine={false}
            />
            <ReferenceLine x={0} stroke="#33445c" />
            <RechartsTooltip
              cursor={{ fill: 'rgba(123,97,255,0.08)' }}
              contentStyle={{ backgroundColor: '#0d1526', border: '1px solid #1e2a3a', borderRadius: 6, fontSize: 12 }}
              labelStyle={{ color: '#a0b0c5' }}
              formatter={(v: any) => [`${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(2)}`, t('tft.marketValue.contribution')]}
            />
            <Bar dataKey="value" radius={[2, 2, 2, 2]} barSize={12}>
              {rows.map(r => (
                <Cell key={r.signal} fill={r.value >= 0 ? '#3ecf8e' : '#e44040'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// One row of the skill-score breakdown: weight, z-score + detail, and the
// signed contribution (w·z/Σw) to the overall skill score.
function SignalRow({ sig }: { sig: SkillSignal }) {
  const { t } = useI18n();
  const known = !!SIGNAL_LABEL_KEYS[sig.signal];
  const label = known ? t(SIGNAL_LABEL_KEYS[sig.signal] as TranslationKey) : sig.signal;
  const weightPct = `${Math.round(sig.weight * 100)}%`;
  // Label deep-links to its explanation; hover shows the short description.
  const labelEl = known
    ? <Link href={`/tft/marktwert/methodik#${sig.signal}`} title={t(`tft.mv.method.sig.${sig.signal}` as TranslationKey)} className="hover:text-[#9d7bff] transition-colors">{label}</Link>
    : label;

  if (!sig.available) {
    return (
      <div className="flex items-start justify-between gap-3 opacity-50">
        <div className="flex-1 min-w-0">
          <div className="text-white font-medium">
            {labelEl} <span className="text-fg-muted font-normal">· {weightPct}</span>
          </div>
          <div className="text-fg-secondary text-xs mt-0.5">{t('tft.marketValue.agent.notRated')}</div>
        </div>
        <div className="text-fg-muted text-xs whitespace-nowrap flex-shrink-0">—</div>
      </div>
    );
  }

  const positive = sig.contribution > 0.0005;
  const negative = sig.contribution < -0.0005;
  const color = positive ? '#3ecf8e' : negative ? '#e44040' : '#a0b0c5';
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-white font-medium">
          {label} <span className="text-fg-muted font-normal">· {weightPct}</span>
        </div>
        <div className="text-fg-secondary text-xs mt-0.5 cursor-help" title={t('tft.mv.tip.z')}>
          z {sig.z != null ? (sig.z >= 0 ? '+' : '') + sig.z.toFixed(2) : '—'}
          {sig.detail ? ` · ${sig.detail}` : ''}
        </div>
      </div>
      <div className="tabular-nums font-medium whitespace-nowrap flex-shrink-0" style={{ color }}>
        {sig.contribution >= 0 ? '+' : ''}{sig.contribution.toFixed(2)}
      </div>
    </div>
  );
}
