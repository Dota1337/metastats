'use client';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis,
  Tooltip as RechartsTooltip,
} from 'recharts';
import { useI18n } from '../../lib/i18n';
import { formatStage } from '../../lib/tft-stage';

// Econ-ROI Bar+Line-Chart als Lazy-Load-Komponente.

interface ChartData {
  label: string;
  share: number;
  avgRound: number | null;
  avgStage: string;
}

export default function CompEconChart({
  chartData,
}: {
  chartData: ChartData[];
}) {
  const { t } = useI18n();
  return (
    <section className="mt-5 bg-surface-base border border-border-subtle rounded p-4">
      <h2 className="text-fg-secondary text-xs uppercase tracking-widest mb-3">{t('tft.comp.econRoi')}</h2>
      <div className="bg-surface-raised border border-border-subtle rounded p-3">
        <div style={{ width: '100%', height: 200 }}>
          <ResponsiveContainer>
            <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
              <XAxis
                dataKey="label"
                tick={{ fill: '#5a6a80', fontSize: 10 }}
                axisLine={{ stroke: '#1e2a3a' }}
                tickLine={false}
              />
              <YAxis
                yAxisId="left"
                tick={{ fill: '#5a6a80', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={28}
                tickFormatter={(v: any) => `${v}%`}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fill: '#3ecf8e', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={36}
                tickFormatter={(v: any) => formatStage(Number(v))}
                domain={[(dataMin: number) => Math.max(8, dataMin - 2), (dataMax: number) => dataMax + 2]}
              />
              <RechartsTooltip
                contentStyle={{ backgroundColor: '#0d1526', border: '1px solid #1e2a3a', borderRadius: 4, fontSize: 11 }}
                labelStyle={{ color: '#a0b0c5' }}
                formatter={(value: any, name: any, item: any): any => {
                  if (name === 'share') return [`${value}%`, t('tft.comp.levelShare')];
                  if (name === 'avgRound') {
                    const stage = item?.payload?.avgStage;
                    return [stage, t('tft.comp.avgLastRound')];
                  }
                  return [value, name];
                }}
              />
              <Bar yAxisId="left" dataKey="share" fill="#7B61FF" radius={[2, 2, 0, 0]} />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="avgRound"
                stroke="#3ecf8e"
                strokeWidth={2}
                dot={{ r: 3, fill: '#3ecf8e' }}
                activeDot={{ r: 5, fill: '#3ecf8e' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="flex justify-between text-[9px] text-fg-faint mt-1.5">
          <span><span className="inline-block w-2 h-2 bg-accent rounded-sm mr-1"/>{t('tft.comp.levelShare')}</span>
          <span><span className="inline-block w-2 h-2 bg-[#3ecf8e] rounded-sm mr-1"/>{t('tft.comp.avgLastRound')}</span>
        </div>
      </div>
    </section>
  );
}
