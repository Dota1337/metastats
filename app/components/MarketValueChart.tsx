'use client';
import { useState, useEffect, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { useI18n, LOCALE_MAP } from '../lib/i18n';

interface Props {
  puuid: string;
  currentValue: number | null;
}

interface HistoryPoint {
  recorded_at: string;
  market_value: number;
}

interface SeasonEntry {
  id: string;
  label: string;
}

export default function MarketValueChart({ puuid, currentValue }: Props) {
  const { t, lang } = useI18n();
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [season, setSeason] = useState('current');
  const [pastSeasons, setPastSeasons] = useState<SeasonEntry[]>([]);

  useEffect(() => {
    fetch('/seasons.json')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.history) return;
        setPastSeasons(data.history.slice(0, 3).map((s: SeasonEntry) => ({ id: s.id, label: s.label })));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!puuid) return;
    // Beim Saison-Wechsel gewinnt die zuletzt angeforderte Antwort, nicht die zuletzt eintreffende.
    const ctl = new AbortController();
    fetch(`/api/marktwert/history?puuid=${encodeURIComponent(puuid)}&season=${season}`, { signal: ctl.signal })
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(data => {
        setHistory(data.history || []);
        setFailed(false);
        setLoading(false);
      })
      .catch(() => {
        if (ctl.signal.aborted) return;
        setHistory([]);
        setFailed(true);
        setLoading(false);
      });
    return () => ctl.abort();
  }, [puuid, season, reloadKey]);

  const chartData = useMemo(() => {
    const fmt = (d: Date) => d.toLocaleDateString(LOCALE_MAP[lang]);
    if (history.length === 0 && currentValue) {
      return [{ date: 'today', value: currentValue, label: fmt(new Date()) }];
    }

    // Ein Punkt pro Kalendertag (lokal), der letzte des Tages gewinnt. Der
    // Schluessel ist sprachunabhaengig; angezeigt wird label.
    const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const byDate = new Map<string, HistoryPoint>();
    for (const h of history) byDate.set(dayKey(new Date(h.recorded_at)), h);

    return [...byDate.entries()].map(([date, h]) => ({
      date,
      value: h.market_value,
      label: fmt(new Date(h.recorded_at)),
    }));
  }, [history, currentValue, lang]);

  const seasons = [
    { value: 'current', label: t('mvChart.currentSeason') },
    ...pastSeasons.map(s => ({ value: s.id, label: s.label })),
    { value: 'all', label: t('mvChart.allData') },
  ];

  // Don't render if we have less than 2 data points — ein Ausfall wird gezeigt, nicht versteckt.
  if (!loading && !failed && chartData.length < 2) return null;

  const minVal = Math.min(...chartData.map(d => d.value)) * 0.9;
  const maxVal = Math.max(...chartData.map(d => d.value)) * 1.1;
  const change = chartData.length >= 2
    ? chartData[chartData.length - 1].value - chartData[0].value
    : 0;
  const changePercent = chartData.length >= 2 && chartData[0].value > 0
    ? ((change / chartData[0].value) * 100).toFixed(1)
    : '0';

  return (
    <div className="bg-surface-base border border-border-subtle rounded p-4 sm:p-6 mb-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-fg-secondary text-xs uppercase tracking-widest">
            {t('mvChart.title')}
          </div>
          {chartData.length >= 2 && (
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-sm font-medium ${change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {change >= 0 ? '+' : ''}{changePercent}%
              </span>
              <span className="text-fg-muted text-xs">
                ({change >= 0 ? '+' : ''}${Math.abs(change).toLocaleString('de-DE')})
              </span>
            </div>
          )}
        </div>
        <select
          value={season}
          onChange={e => { setLoading(true); setSeason(e.target.value); }}
          className="bg-surface-raised border border-border-subtle rounded px-3 py-1.5 text-xs text-fg-secondary focus:outline-none focus:border-accent-a50"
        >
          {seasons.map(s => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="h-[200px] flex items-center justify-center text-fg-muted text-xs">
          {t('common.loading')}
        </div>
      ) : failed ? (
        <div className="h-[200px] flex flex-col items-center justify-center gap-3 text-center">
          <p className="text-fg-secondary text-sm">{t('error.temporarilyUnavailable')}</p>
          <button
            onClick={() => { setLoading(true); setReloadKey(k => k + 1); }}
            className="text-accent hover:text-[#d4a94a] text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 rounded px-2 py-1 transition-colors"
          >
            {t('error.retry')}
          </button>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="mvGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--accent-lol)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--accent-lol)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              tick={{ fill: 'var(--fg-muted)', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[minVal, maxVal]}
              tick={{ fill: 'var(--fg-muted)', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]?.payload;
                return (
                  <div className="bg-surface-base border border-border-subtle rounded px-3 py-2 text-xs shadow-lg">
                    <div className="text-fg-secondary mb-1">{d?.label}</div>
                    <div className="text-accent font-medium">
                      ${d?.value?.toLocaleString('de-DE')}
                    </div>
                  </div>
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke="var(--accent-lol)"
              strokeWidth={2}
              fill="url(#mvGrad)"
              dot={{ fill: 'var(--accent-lol)', r: 3, strokeWidth: 0 }}
              activeDot={{ fill: 'var(--accent-lol)', r: 5, strokeWidth: 2, stroke: 'var(--surface-base)' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
