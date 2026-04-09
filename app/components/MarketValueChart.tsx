'use client';
import { useState, useEffect, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';

interface Props {
  puuid: string;
  currentValue: number | null;
}

interface HistoryPoint {
  recorded_at: string;
  market_value: number;
}

export default function MarketValueChart({ puuid, currentValue }: Props) {
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [season, setSeason] = useState('current');

  useEffect(() => {
    if (!puuid) return;
    fetch(`/api/marktwert/history?puuid=${encodeURIComponent(puuid)}&season=${season}`)
      .then(r => r.ok ? r.json() : { history: [] })
      .then(data => {
        setHistory(data.history || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [puuid, season]);

  const chartData = useMemo(() => {
    if (history.length === 0 && currentValue) {
      return [{ date: 'Heute', value: currentValue, label: new Date().toLocaleDateString('de-DE') }];
    }

    // Deduplicate by date (keep latest per day)
    const byDate = new Map<string, HistoryPoint>();
    for (const h of history) {
      const date = new Date(h.recorded_at).toLocaleDateString('de-DE');
      byDate.set(date, h);
    }

    return [...byDate.entries()].map(([date, h]) => ({
      date,
      value: h.market_value,
      label: date,
    }));
  }, [history, currentValue]);

  const seasons = [
    { value: 'current', label: 'Aktuelle Season' },
    { value: '2025-s1', label: 'Season 2025 Split 1' },
    { value: '2024-s2', label: 'Season 2024 Split 2' },
    { value: 'all', label: 'Alle Daten' },
  ];

  // Don't render if we have less than 2 data points
  if (!loading && chartData.length < 2) return null;

  const minVal = Math.min(...chartData.map(d => d.value)) * 0.9;
  const maxVal = Math.max(...chartData.map(d => d.value)) * 1.1;
  const change = chartData.length >= 2
    ? chartData[chartData.length - 1].value - chartData[0].value
    : 0;
  const changePercent = chartData.length >= 2 && chartData[0].value > 0
    ? ((change / chartData[0].value) * 100).toFixed(1)
    : '0';

  return (
    <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4 sm:p-6 mb-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[#8a9bb0] text-xs uppercase tracking-widest">
            Marktwert-Verlauf
          </div>
          {chartData.length >= 2 && (
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-sm font-medium ${change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {change >= 0 ? '+' : ''}{changePercent}%
              </span>
              <span className="text-[#4a5a70] text-xs">
                ({change >= 0 ? '+' : ''}${Math.abs(change).toLocaleString('de-DE')})
              </span>
            </div>
          )}
        </div>
        <select
          value={season}
          onChange={e => setSeason(e.target.value)}
          className="bg-[#141c2e] border border-[#1e2a3a] rounded px-3 py-1.5 text-xs text-[#8a9bb0] focus:outline-none focus:border-[#c89b3c]/50"
        >
          {seasons.map(s => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="h-[200px] flex items-center justify-center text-[#4a5a70] text-xs">
          Lade Marktwert-Daten...
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="mvGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#c89b3c" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#c89b3c" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#1e2a3a" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tick={{ fill: '#4a5a70', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[minVal, maxVal]}
              tick={{ fill: '#4a5a70', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]?.payload;
                return (
                  <div className="bg-[#0d1526] border border-[#1e2a3a] rounded px-3 py-2 text-xs shadow-lg">
                    <div className="text-[#8a9bb0] mb-1">{d?.label}</div>
                    <div className="text-[#c89b3c] font-medium">
                      ${d?.value?.toLocaleString('de-DE')}
                    </div>
                  </div>
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke="#c89b3c"
              strokeWidth={2}
              fill="url(#mvGrad)"
              dot={{ fill: '#c89b3c', r: 3, strokeWidth: 0 }}
              activeDot={{ fill: '#c89b3c', r: 5, strokeWidth: 2, stroke: '#0d1526' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
