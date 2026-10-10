'use client';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  Tooltip as RechartsTooltip, ReferenceLine,
} from 'recharts';
import { useI18n } from '../../lib/i18n';

// Verlauf zweier Comps im Comp-Vergleich (User 2026-10-10). Lazy geladen wie
// CompTrendChart — Recharts gehoert nicht ins Start-Bundle.

export interface CompareTrendPoint { day: string; a: number | null; b: number | null }

export default function CompareTrendChart({
  points, nameA, nameB, colorA, colorB, patchBoundary,
}: {
  points: CompareTrendPoint[];
  nameA: string;
  nameB: string;
  colorA: string;
  colorB: string;
  patchBoundary: { day: string; patch: string } | null;
}) {
  const { t } = useI18n();
  return (
    <div style={{ width: '100%', height: 180 }}>
      <ResponsiveContainer>
        <LineChart data={points} margin={{ top: 14, right: 8, bottom: 0, left: -12 }}>
          <XAxis
            dataKey="day"
            tick={{ fill: 'var(--fg-muted)', fontSize: 10 }}
            tickFormatter={(d: string) => d.slice(5)}
            axisLine={{ stroke: 'var(--border-subtle)' }}
            tickLine={false}
          />
          <YAxis
            domain={['dataMin - 0.2', 'dataMax + 0.2']}
            reversed
            tick={{ fill: 'var(--fg-muted)', fontSize: 10 }}
            tickFormatter={(v: number) => v.toFixed(1)}
            axisLine={false}
            tickLine={false}
            width={34}
          />
          <RechartsTooltip
            contentStyle={{ backgroundColor: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)', borderRadius: 4, fontSize: 11 }}
            labelStyle={{ color: 'var(--fg-secondary)' }}
            formatter={(value: unknown, key: unknown) => [
              value == null ? '—' : `Ø ${Number(value).toFixed(2)}`,
              key === 'a' ? nameA : nameB,
            ]}
          />
          {/* Ohne Zeichen-Animation: sie blieb im Test bei zwei Dritteln stehen,
              sobald die Seite waehrenddessen neu zeichnete. */}
          <Line dataKey="a" stroke={colorA} strokeWidth={2} dot={{ fill: colorA, r: 3 }} connectNulls isAnimationActive={false} />
          <Line dataKey="b" stroke={colorB} strokeWidth={2} dot={{ fill: colorB, r: 3 }} connectNulls isAnimationActive={false} />
          {patchBoundary && (
            <ReferenceLine
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
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
