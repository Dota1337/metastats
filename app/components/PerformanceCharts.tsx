'use client';
import { useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, CartesianGrid,
} from 'recharts';

interface Props {
  matches: any[];
  ddVersion: string;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#0d1526] border border-[#1e2a3a] rounded px-3 py-2 text-xs shadow-lg">
      <div className="text-[#8a9bb0] mb-1">{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-white">{p.name}: <b>{typeof p.value === 'number' ? p.value.toFixed(1) : p.value}</b></span>
        </div>
      ))}
    </div>
  );
};

export default function PerformanceCharts({ matches, ddVersion }: Props) {
  // Build data points from oldest to newest (reversed)
  const chartData = useMemo(() => {
    const reversed = [...matches].reverse();
    let wins = 0;
    return reversed.map((m, i) => {
      if (m.win) wins++;
      const wr = ((wins / (i + 1)) * 100);
      const kda = m.deaths > 0 ? (m.kills + m.assists) / m.deaths : m.kills + m.assists;
      const csMin = m.gameDuration > 0 ? m.cs / (m.gameDuration / 60) : 0;
      return {
        game: i + 1,
        label: `Spiel ${i + 1}`,
        champion: m.champion,
        wr: +wr.toFixed(1),
        kda: +kda.toFixed(2),
        csMin: +csMin.toFixed(1),
        dmgMin: m.gameDuration > 0 ? Math.round(m.damageDealt / (m.gameDuration / 60)) : 0,
        win: m.win ? 1 : 0,
      };
    });
  }, [matches]);

  // Rolling averages (5-game window)
  const rollingData = useMemo(() => {
    return chartData.map((d, i) => {
      const window = chartData.slice(Math.max(0, i - 4), i + 1);
      return {
        ...d,
        rollingWR: +(window.reduce((s, w) => s + w.win, 0) / window.length * 100).toFixed(1),
        rollingKDA: +(window.reduce((s, w) => s + w.kda, 0) / window.length).toFixed(2),
        rollingCS: +(window.reduce((s, w) => s + w.csMin, 0) / window.length).toFixed(1),
      };
    });
  }, [chartData]);

  if (matches.length < 3) return null;

  return (
    <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6 mb-4">
      <div className="text-[#8a9bb0] text-xs uppercase tracking-widest mb-4">
        Performance-Verlauf
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Winrate Trend */}
        <div>
          <div className="text-white text-sm font-medium mb-2">Winrate-Verlauf</div>
          <div className="text-[#4a5a70] text-xs mb-3">Kumulativ + 5-Spiele-Schnitt</div>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={rollingData}>
              <defs>
                <linearGradient id="wrGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4ade80" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#4ade80" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1e2a3a" strokeDasharray="3 3" />
              <XAxis dataKey="game" tick={{ fill: '#4a5a70', fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis domain={[0, 100]} tick={{ fill: '#4a5a70', fontSize: 10 }} tickLine={false} axisLine={false} unit="%" />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="wr" stroke="#4ade8080" strokeWidth={1} fill="none" name="Kumulativ" dot={false} />
              <Area type="monotone" dataKey="rollingWR" stroke="#4ade80" strokeWidth={2} fill="url(#wrGrad)" name="5-Spiele WR" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* KDA Trend */}
        <div>
          <div className="text-white text-sm font-medium mb-2">KDA-Verlauf</div>
          <div className="text-[#4a5a70] text-xs mb-3">5-Spiele-Durchschnitt</div>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={rollingData}>
              <defs>
                <linearGradient id="kdaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#c89b3c" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#c89b3c" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1e2a3a" strokeDasharray="3 3" />
              <XAxis dataKey="game" tick={{ fill: '#4a5a70', fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: '#4a5a70', fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="kda" stroke="#c89b3c50" strokeWidth={1} fill="none" name="KDA" dot={false} />
              <Area type="monotone" dataKey="rollingKDA" stroke="#c89b3c" strokeWidth={2} fill="url(#kdaGrad)" name="5-Spiele KDA" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* CS/Min Trend */}
        <div>
          <div className="text-white text-sm font-medium mb-2">CS/Min-Verlauf</div>
          <div className="text-[#4a5a70] text-xs mb-3">5-Spiele-Durchschnitt</div>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={rollingData}>
              <defs>
                <linearGradient id="csGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1e2a3a" strokeDasharray="3 3" />
              <XAxis dataKey="game" tick={{ fill: '#4a5a70', fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: '#4a5a70', fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="csMin" stroke="#60a5fa50" strokeWidth={1} fill="none" name="CS/Min" dot={false} />
              <Area type="monotone" dataKey="rollingCS" stroke="#60a5fa" strokeWidth={2} fill="url(#csGrad)" name="5-Spiele CS/Min" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Win/Loss per Game Bar Chart */}
        <div>
          <div className="text-white text-sm font-medium mb-2">Siege & Niederlagen</div>
          <div className="text-[#4a5a70] text-xs mb-3">Pro Spiel</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData.map(d => ({ ...d, winBar: d.win ? 1 : 0, lossBar: d.win ? 0 : 1 }))}>
              <CartesianGrid stroke="#1e2a3a" strokeDasharray="3 3" />
              <XAxis dataKey="game" tick={{ fill: '#4a5a70', fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis domain={[0, 1]} tick={false} axisLine={false} />
              <Tooltip content={({ active, payload }: any) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]?.payload;
                return (
                  <div className="bg-[#0d1526] border border-[#1e2a3a] rounded px-3 py-2 text-xs shadow-lg">
                    <div className="text-white">{d?.champion}</div>
                    <div className={d?.win ? 'text-green-400' : 'text-red-400'}>
                      {d?.win ? 'Sieg' : 'Niederlage'}
                    </div>
                  </div>
                );
              }} />
              <Bar dataKey="winBar" stackId="wl" fill="#4ade80" radius={[2, 2, 0, 0]} name="Sieg" opacity={0.7} />
              <Bar dataKey="lossBar" stackId="wl" fill="#ef4444" radius={[2, 2, 0, 0]} name="Niederlage" opacity={0.7} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
