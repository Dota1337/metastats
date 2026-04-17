'use client';
import { useMemo } from 'react';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip,
} from 'recharts';
import { useI18n } from '../lib/i18n';

interface Props {
  categories: { id: string; name: string; score: number; icon: string }[];
}

// Group stat categories into 6 radar axes
const RADAR_GROUPS: Record<string, { labelKey: 'radar.fighting' | 'radar.farming' | 'radar.vision' | 'radar.objectives' | 'radar.survival' | 'radar.teamplay'; ids: string[] }> = {
  fighting: { labelKey: 'radar.fighting', ids: ['kda_rating', 'damage_output', 'damage_share', 'clutch_factor', 'mechanics'] },
  farming: { labelKey: 'radar.farming', ids: ['farming', 'gold_efficiency'] },
  vision: { labelKey: 'radar.vision', ids: ['vision_control'] },
  objectives: { labelKey: 'radar.objectives', ids: ['objective_control'] },
  survival: { labelKey: 'radar.survival', ids: ['survivability', 'consistency'] },
  teamplay: { labelKey: 'radar.teamplay', ids: ['teamplay', 'comeback_strength', 'early_game'] },
};

export default function RadarStats({ categories }: Props) {
  const { t } = useI18n();
  const radarData = useMemo(() => {
    return Object.entries(RADAR_GROUPS).map(([key, group]) => {
      const matching = categories.filter(c =>
        group.ids.includes(c.id)
      );
      const score = matching.length > 0
        ? Math.round(matching.reduce((s, c) => s + c.score, 0) / matching.length)
        : 50;
      return { axis: t(group.labelKey), score, fullMark: 100 };
    });
  }, [categories, t]);

  if (categories.length < 4) return null;

  return (
    <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4 sm:p-6 mb-4">
      <div className="text-[#8a9bb0] text-xs uppercase tracking-widest mb-2">
        {t('radar.title')}
      </div>
      <div className="text-[#4a5a70] text-xs mb-4">{t('radar.subtitle')}</div>
      <ResponsiveContainer width="100%" height={280}>
        <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="75%">
          <PolarGrid stroke="#1e2a3a" />
          <PolarAngleAxis
            dataKey="axis"
            tick={{ fill: '#8a9bb0', fontSize: 11 }}
          />
          <PolarRadiusAxis
            angle={30}
            domain={[0, 100]}
            tick={{ fill: '#4a5a70', fontSize: 9 }}
            axisLine={false}
          />
          <Radar
            name="Score"
            dataKey="score"
            stroke="#c89b3c"
            fill="#c89b3c"
            fillOpacity={0.2}
            strokeWidth={2}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]?.payload;
              return (
                <div className="bg-[#0d1526] border border-[#1e2a3a] rounded px-3 py-2 text-xs shadow-lg">
                  <div className="text-white font-medium">{d?.axis}</div>
                  <div className="text-[#c89b3c]">Score: {d?.score}/100</div>
                </div>
              );
            }}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
