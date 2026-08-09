'use client';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis,
  Tooltip as RechartsTooltip, Cell,
} from 'recharts';
import { useI18n } from '../../lib/i18n';
import { formatStage } from '../../lib/tft-stage';

// Death-Round Detail-Chart als Lazy-Load-Komponente. Liegt in collapsible
// <details> der Death-Round-Section.

export default function CompDeathChart({
  roundHistogram,
  survivalToTop4,
}: {
  roundHistogram: { round: number; games: number; top4: number }[];
  survivalToTop4: { round: number; atLeast: number; top4Rate: number | null }[];
}) {
  const { t } = useI18n();
  const survByRound = new Map(survivalToTop4.map(s => [s.round, s]));
  const chartData = roundHistogram.map(p => ({
    round: p.round,
    stage: formatStage(p.round),
    games: p.games,
    top4Rate: p.games > 0 ? (p.top4 / p.games) * 100 : 0,
    survivalRate: (survByRound.get(p.round)?.top4Rate ?? 0) * 100,
  }));
  return (
    <>
      <div style={{ width: '100%', height: 200 }}>
        <ResponsiveContainer>
          <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
            <XAxis dataKey="stage" tick={{ fill: '#5a6a80', fontSize: 10 }} axisLine={{ stroke: '#1e2a3a' }} tickLine={false} interval="preserveStartEnd" />
            <YAxis yAxisId="left" tick={{ fill: '#5a6a80', fontSize: 10 }} axisLine={false} tickLine={false} width={28} />
            <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fill: '#3ecf8e', fontSize: 10 }} axisLine={false} tickLine={false} width={32} tickFormatter={v => `${v}%`} />
            <RechartsTooltip
              contentStyle={{ backgroundColor: '#0d1526', border: '1px solid #1e2a3a', borderRadius: 4, fontSize: 11 }}
              labelStyle={{ color: '#a0b0c5' }}
              formatter={(value: any, name: any): any => {
                if (name === 'games') return [value, t('tft.comp.dieHere')];
                if (name === 'survivalRate') return [`${Number(value).toFixed(0)}%`, t('tft.comp.survivalChart')];
                return [value, name];
              }}
            />
            <Bar yAxisId="left" dataKey="games" radius={[2, 2, 0, 0]}>
              {chartData.map((d, idx) => {
                const hue = Math.round(120 * (d.top4Rate / 100));
                return <Cell key={idx} fill={`hsl(${hue}, 60%, 45%)`} />;
              })}
            </Bar>
            <Line yAxisId="right" type="monotone" dataKey="survivalRate" stroke="#3ecf8e" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#3ecf8e' }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex justify-between text-[9px] text-fg-faint mt-1.5">
        <span><span className="inline-block w-2 h-2 bg-[#e44040] rounded-sm mr-1"/>{t('tft.comp.dieHere')}</span>
        <span><span className="inline-block w-2 h-2 bg-[#3ecf8e] rounded-sm mr-1"/>{t('tft.comp.survivalChart')}</span>
      </div>
    </>
  );
}
