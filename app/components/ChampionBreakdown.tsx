'use client';
import { useMemo, useState } from 'react';

interface Props {
  matches: any[];
  ddVersion: string;
}

interface ChampStat {
  champion: string;
  games: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  damage: number;
  duration: number;
}

export default function ChampionBreakdown({ matches, ddVersion }: Props) {
  const [sortBy, setSortBy] = useState<'games' | 'wr' | 'kda'>('games');

  const champStats = useMemo(() => {
    const map: Record<string, ChampStat> = {};
    for (const m of matches) {
      if (!map[m.champion]) {
        map[m.champion] = { champion: m.champion, games: 0, wins: 0, kills: 0, deaths: 0, assists: 0, cs: 0, damage: 0, duration: 0 };
      }
      const s = map[m.champion];
      s.games++;
      if (m.win) s.wins++;
      s.kills += m.kills;
      s.deaths += m.deaths;
      s.assists += m.assists;
      s.cs += m.cs;
      s.damage += m.damageDealt;
      s.duration += m.gameDuration;
    }

    return Object.values(map).sort((a, b) => {
      if (sortBy === 'games') return b.games - a.games;
      if (sortBy === 'wr') return (b.wins / b.games) - (a.wins / a.games);
      // kda
      const kdaA = a.deaths > 0 ? (a.kills + a.assists) / a.deaths : a.kills + a.assists;
      const kdaB = b.deaths > 0 ? (b.kills + b.assists) / b.deaths : b.kills + b.assists;
      return kdaB - kdaA;
    });
  }, [matches, sortBy]);

  if (matches.length === 0) return null;

  return (
    <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6 mb-4">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[#8a9bb0] text-xs uppercase tracking-widest">
          Champion-Statistiken
        </div>
        <div className="flex gap-1">
          {([['games', 'Spiele'], ['wr', 'Winrate'], ['kda', 'KDA']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSortBy(key)}
              className={`px-3 py-1 rounded text-xs transition-colors ${
                sortBy === key
                  ? 'bg-[#c89b3c]/20 text-[#c89b3c] border border-[#c89b3c]/30'
                  : 'text-[#4a5a70] hover:text-[#8a9bb0]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[2.5rem_2.5rem_1fr_3.5rem_4.5rem_5rem_4rem_4rem] gap-2 px-2 py-1 text-[#4a5a70] text-xs uppercase">
        <div>#</div>
        <div />
        <div>Champion</div>
        <div className="text-center">Spiele</div>
        <div className="text-center">Winrate</div>
        <div className="text-center">KDA</div>
        <div className="text-center">CS/m</div>
        <div className="text-center">DMG/m</div>
      </div>

      <div className="flex flex-col gap-0.5 mt-1">
        {champStats.map((s, i) => {
          const wr = Math.round((s.wins / s.games) * 100);
          const kda = s.deaths > 0 ? ((s.kills + s.assists) / s.deaths) : s.kills + s.assists;
          const csMin = s.duration > 0 ? (s.cs / (s.duration / 60)) : 0;
          const dmgMin = s.duration > 0 ? Math.round(s.damage / (s.duration / 60)) : 0;
          const avgK = (s.kills / s.games).toFixed(1);
          const avgD = (s.deaths / s.games).toFixed(1);
          const avgA = (s.assists / s.games).toFixed(1);

          return (
            <div key={s.champion} className="grid grid-cols-[2.5rem_2.5rem_1fr_3.5rem_4.5rem_5rem_4rem_4rem] gap-2 px-2 py-1.5 rounded hover:bg-[#141c2e] items-center">
              <div className="text-[#4a5a70] text-sm">{i + 1}</div>
              <img
                src={`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/champion/${s.champion}.png`}
                alt={s.champion}
                className="w-7 h-7 rounded"
              />
              <div className="text-white text-sm font-medium truncate">{s.champion}</div>
              <div className="text-white text-sm text-center">{s.games}</div>
              <div className="text-center">
                <div className={`text-sm font-medium ${wr >= 60 ? 'text-green-400' : wr >= 50 ? 'text-blue-400' : 'text-red-400'}`}>
                  {wr}%
                </div>
                <div className="w-full h-1.5 bg-red-500/30 rounded overflow-hidden mt-1">
                  <div className="h-full bg-green-500/70 rounded" style={{ width: `${wr}%` }} />
                </div>
                <div className="text-[#4a5a70] text-xs mt-0.5">{s.wins}W {s.games - s.wins}L</div>
              </div>
              <div className="text-center">
                <div className={`text-sm font-medium ${kda >= 4 ? 'text-green-400' : kda >= 2.5 ? 'text-white' : 'text-red-400'}`}>
                  {kda.toFixed(2)}
                </div>
                <div className="text-[#4a5a70] text-xs">{avgK}/{avgD}/{avgA}</div>
              </div>
              <div className="text-[#8a9bb0] text-sm text-center">{csMin.toFixed(1)}</div>
              <div className="text-[#8a9bb0] text-sm text-center">{dmgMin}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
