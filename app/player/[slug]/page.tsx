'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

export default function PlayerPage() {
  const { slug } = useParams();
  const [player, setPlayer] = useState<any>(null);
  const [matches, setMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ddVersion, setDdVersion] = useState('14.1.1');

  useEffect(() => {
    if (!slug) return;
    const parts = (slug as string).split('-');
    const tag = parts[parts.length - 1];
    const name = parts.slice(0, -1).join(' ');
    loadPlayer(name, tag);
  }, [slug]);

  const loadPlayer = async (name: string, tag: string) => {
    setLoading(true);
    try {
      const versionRes = await fetch('/api/version');
      const versionData = await versionRes.json();
      setDdVersion(versionData.version);

      const res = await fetch(`/api/summoner?name=${encodeURIComponent(name + '#' + tag)}&region=euw1`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPlayer(data);

      const matchRes = await fetch(`/api/matches?puuid=${encodeURIComponent(data.summoner.puuid)}&region=euw1`);
      const matchData = await matchRes.json();
      if (matchRes.ok) setMatches(matchData.matches || []);
    } catch (e: any) {
      setError(e.message || 'Spieler nicht gefunden');
    } finally {
      setLoading(false);
    }
  };

  const ranked = Array.isArray(player?.ranked)
    ? player.ranked.find((r: any) => r.queueType === 'RANKED_SOLO_5x5')
    : null;

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const kda = matches.length > 0
    ? (matches.reduce((acc, m) => acc + m.kills + m.assists, 0) / Math.max(matches.reduce((acc, m) => acc + m.deaths, 0), 1)).toFixed(2)
    : null;

  const winrate = matches.length > 0
    ? Math.round((matches.filter(m => m.win).length / matches.length) * 100)
    : null;

  return (
    <main className="min-h-screen bg-[#080c18]">
      <nav className="bg-[#0a0e1a] border-b border-[#1e2a3a] px-6 py-3 flex items-center justify-between">
        <a href="/" className="text-[#c89b3c] text-lg font-medium">
          meta<span className="text-white">stats</span>.gg
        </a>
        <div className="flex gap-6">
          <a href="/" className="text-[#8a9bb0] text-sm hover:text-white">Spielersuche</a>
          <a href="#" className="text-[#8a9bb0] text-sm hover:text-white">Rangliste</a>
          <a href="#" className="text-[#8a9bb0] text-sm hover:text-white">Champions</a>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {loading && (
          <div className="text-center text-[#8a9bb0] mt-20">Lade Spielerprofil...</div>
        )}

        {error && (
          <div className="text-center text-red-400 mt-20">{error}</div>
        )}

        {player && !loading && (
          <>
            {/* Header */}
            <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6 mb-4">
              <div className="flex items-center gap-6">
                <img
                  src={`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/profileicon/${player.summoner.profileIconId}.png`}
                  alt="icon"
                  className="w-20 h-20 rounded-full border-2 border-[#c89b3c]"
                />
                <div className="flex-1">
                  <h1 className="text-white text-2xl font-medium">{player.summoner.name}</h1>
                  <div className="text-[#8a9bb0] text-sm">Level {player.summoner.summonerLevel} · EUW</div>
                </div>
              </div>

              {/* Schnellstats */}
              <div className="grid grid-cols-4 gap-3 mt-6">
                <div className="bg-[#141c2e] rounded p-4 text-center">
                  <div className="text-[#8a9bb0] text-xs mb-1">Rang</div>
                  <div className="text-white font-medium text-sm">
                    {ranked ? `${ranked.tier} ${ranked.rank}` : 'Unranked'}
                  </div>
                  {ranked && <div className="text-[#c89b3c] text-xs">{ranked.leaguePoints} LP</div>}
                </div>
                <div className="bg-[#141c2e] rounded p-4 text-center">
                  <div className="text-[#8a9bb0] text-xs mb-1">Winrate (10 Spiele)</div>
                  <div className={`font-medium text-sm ${winrate && winrate >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                    {winrate !== null ? `${winrate}%` : '-'}
                  </div>
                </div>
                <div className="bg-[#141c2e] rounded p-4 text-center">
                  <div className="text-[#8a9bb0] text-xs mb-1">Ø KDA</div>
                  <div className="text-white font-medium text-sm">{kda || '-'}</div>
                </div>
                <div className="bg-[#141c2e] rounded p-4 text-center">
                  <div className="text-[#8a9bb0] text-xs mb-1">KI-Marktwert</div>
                  <div className="text-[#c89b3c] font-medium text-sm">Bald verfügbar</div>
                </div>
              </div>
            </div>

            {/* Match History */}
            {matches.length > 0 && (
              <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6">
                <div className="text-[#8a9bb0] text-xs uppercase tracking-widest mb-4">Match History</div>
                <div className="flex flex-col gap-2">
                  {matches.map((match, i) => (
                    <div key={i} className={`flex items-center gap-4 p-3 rounded border-l-4 ${match.win ? 'border-green-500 bg-[#0a1f0a]' : 'border-red-500 bg-[#1f0a0a]'}`}>
                      <img
                        src={`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/champion/${match.champion}.png`}
                        alt={match.champion}
                        className="w-10 h-10 rounded flex-shrink-0"
                      />
                      <div className="flex-1">
                        <div className="text-white text-sm font-medium">{match.champion}</div>
                        <div className="text-[#8a9bb0] text-xs">{match.gameMode} · {formatDuration(match.gameDuration)}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-white text-sm font-medium">{match.kills}/{match.deaths}/{match.assists}</div>
                        <div className="text-[#8a9bb0] text-xs">KDA</div>
                      </div>
                      <div className="text-center">
                        <div className="text-white text-sm font-medium">{match.cs}</div>
                        <div className="text-[#8a9bb0] text-xs">CS</div>
                      </div>
                      <div className={`text-sm font-medium w-20 text-right ${match.win ? 'text-green-400' : 'text-red-400'}`}>
                        {match.win ? 'Sieg' : 'Niederlage'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}