'use client';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer,
} from 'recharts';

interface RadarDataPoint {
  stat: string;
  p1: number;
  p2: number;
}

interface CompareRadarProps {
  data: RadarDataPoint[];
  name1: string;
  name2: string;
}

export default function CompareRadar({ data, name1, name2 }: CompareRadarProps) {
  return (
    <div className="mb-6">
      <div className="text-center text-[#a0b0c5] text-xs mb-2">Performance Radar</div>
      <div className="flex justify-center items-center gap-4 mb-2">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[#c89b3c]" />
          <span className="text-[#a0b0c5] text-xs truncate max-w-[80px] sm:max-w-none">{name1}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[#4488ee]" />
          <span className="text-[#a0b0c5] text-xs truncate max-w-[80px] sm:max-w-none">{name2}</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <RadarChart data={data} cx="50%" cy="50%" outerRadius="70%">
          <PolarGrid stroke="#1e2a3a" />
          <PolarAngleAxis dataKey="stat" tick={{ fill: '#a0b0c5', fontSize: 11 }} />
          <Radar name={name1} dataKey="p1" stroke="#c89b3c" fill="#c89b3c" fillOpacity={0.2} strokeWidth={2} />
          <Radar name={name2} dataKey="p2" stroke="#4488ee" fill="#4488ee" fillOpacity={0.2} strokeWidth={2} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
