'use client';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis,
  Tooltip as RechartsTooltip, ReferenceLine,
} from 'recharts';
import { useI18n } from '../../lib/i18n';

// Trend-Chart als Lazy-Load-Kandidat (perf-critic-Verdict 2026-06-21):
// Recharts kostet ~80-200ms Mount-Zeit pro Chart + ~95kB Bundle. Mit
// next/dynamic({ ssr: false }) wird der Recharts-Import vom initial-Bundle
// abgespalten und erst geladen wenn die Detail-Page rendert.

interface TrendPoint {
  day: string;
  games: number;
  avgPlacement: number | null;
  top4Rate: number | null;
  top1Rate: number | null;
  patch?: string | null;
}

export default function CompTrendChart({
  trendPoints,
  trendDays,
  onTrendDaysChange,
  patchBoundary,
}: {
  trendPoints: TrendPoint[];
  trendDays: 14 | 30;
  onTrendDaysChange: (d: 14 | 30) => void;
  patchBoundary: { day: string; patch: string } | null;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-5 bg-surface-base border border-border-subtle rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-white text-sm font-medium">{t('tft.trend.title')}</h3>
        <div className="flex gap-1 bg-surface-raised border border-border-subtle rounded p-0.5">
          {([14, 30] as const).map(d => (
            <button
              key={d}
              type="button"
              onClick={() => onTrendDaysChange(d)}
              className={`px-2.5 py-0.5 text-[11px] rounded ${
                trendDays === d
                  ? 'bg-[#7B61FF] text-white'
                  : 'text-fg-secondary hover:text-white'
              }`}
            >
              {t(d === 14 ? 'tft.trend.last14' : 'tft.trend.last30')}
            </button>
          ))}
        </div>
      </div>
      {trendPoints.length >= 2 ? (
        <div style={{ width: '100%', height: 180 }}>
          <ResponsiveContainer>
            <ComposedChart data={trendPoints} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
              <XAxis
                dataKey="day"
                tick={{ fill: '#7a8aa0', fontSize: 10 }}
                tickFormatter={(d: string) => d.slice(5)}
                axisLine={{ stroke: '#1e2a3a' }}
                tickLine={false}
              />
              <YAxis
                yAxisId="place"
                domain={[3, 6]}
                reversed
                tick={{ fill: '#7a8aa0', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={30}
              />
              <YAxis
                yAxisId="games"
                orientation="right"
                tick={{ fill: '#5a6a80', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={40}
              />
              <RechartsTooltip
                contentStyle={{ backgroundColor: '#0a0e1a', border: '1px solid #1e2a3a', borderRadius: 4, fontSize: 11 }}
                labelStyle={{ color: '#a0b0c5' }}
                formatter={(value: any, name: any) => {
                  if (name === 'avgPlacement') return [Number(value).toFixed(2), t('tft.avgPlacement')];
                  if (name === 'games') return [value, t('tft.gamesShort')];
                  return [value, String(name ?? '')];
                }}
              />
              <Bar yAxisId="games" dataKey="games" fill="#1e2a3a" radius={[2, 2, 0, 0]} />
              <Line
                yAxisId="place"
                dataKey="avgPlacement"
                stroke="#c39bff"
                strokeWidth={2}
                dot={{ fill: '#c39bff', r: 3 }}
                connectNulls
              />
              {patchBoundary && (
                <ReferenceLine
                  yAxisId="place"
                  x={patchBoundary.day}
                  stroke="#e0c75a"
                  strokeDasharray="3 3"
                  label={{
                    value: (t('tft.trend.patchLine') as string).replace('{p}', patchBoundary.patch),
                    position: 'top',
                    fill: '#e0c75a',
                    fontSize: 10,
                  }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="text-fg-faint text-xs text-center py-6">{t('tft.trend.empty')}</div>
      )}
    </div>
  );
}
