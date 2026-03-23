'use client';
import { useState } from 'react';

export default function Home() {
  const [name, setName] = useState('');
  const [region, setRegion] = useState('euw1');
  const [player, setPlayer] = useState<any>(null);
  const [matches, setMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [ddVersion, setDdVersion] = useState('14.1.1');

  const search = async () => {
    if (!name.trim()) return;
    setLoading(true);
    const versionRes = await fetch('/api/version');
    const versionData = await versionRes.json();
    setDdVersion(versionData.version);
    setError('');
    setPlayer(null);
    setMatches([]);
    try {
      const res = await fetch(`/api/summoner?name=${encodeURIComponent(name)}&region=${region}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPlayer(data);

      const matchRes = await fetch(`/api/matches?puuid=${encodeURIComponent(data.summoner.puuid)}&region=${region}`);
const matchText = await matchRes.text();
console.log('Match Response:', matchText);
const matchData = JSON.parse(matchText);
      if (matchRes.ok) setMatches(matchData.matches || []);
    } catch (e: any) {
      setError(e.message || 'Fehler beim Suchen');
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

  return (
    <main className="min-h-screen bg-[#080c18]">
      <nav className="bg-[#0a0e1a] border-b border-[#1e2a3a] px-6 py-3 flex items-center justify-between">
        <div className="text-[#c89b3c] text-lg font-medium">
          meta<span className="text-white">stats</span>.gg
        </div>
        <div className="flex gap-6">
          <a href="#" className="text-[#8a9bb0] text-sm hover:text-white">Spielersuche</a>
          <a href="#" className="text-[#8a9bb0] text-sm hover:text-white">Rangliste</a>
          <a href="#" className="text-[#8a9bb0] text-sm hover:text-white">Champions</a>
        </div>
      </nav>

      <div className="bg-[#0a0e1a] border-b border-[#1e2a3a] px-6 py-12 text-center">
        <h1 className="text-white text-2xl font-medium mb-2">
          League of Legends Statistiken & Marktwerte
        </h1>
        <p className="text-[#8a9bb0] text-sm mb-6">
          Echtzeit-Stats, Match History & KI-Marktwerte
        </p>
        <div className="flex max-w-lg mx-auto bg-[#141c2e] border border-[#2a3a50] rounded overflow-hidden">
          <select
            value={region}
            onChange={e => setRegion(e.target.value)}
            className="bg-[#1a2438] border-r border-[#2a3a50] text-[#8a9bb0] text-sm px-3 outline-none"
          >
            <option value="euw1">EUW</option>
            <option value="eun1">EUNE</option>
            <option value="na1">NA</option>
            <option value="kr">KR</option>
          </select>
          <input
            className="flex-1 bg-transparent text-white text-sm px-4 py-3 outline-none placeholder-[#4a5a70]"
            placeholder="Summoner-Name suchen... (z.B. Name#EUW)"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
          />
          <button
            onClick={search}
            className="bg-[#c89b3c] text-[#0a0e1a] text-sm font-medium px-5"
          >
            {loading ? '...' : 'Suchen'}
          </button>
        </div>
        {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">
        {player && (
          <>
            {/* Spielerprofil */}
            <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6 mb-4">
              <div className="flex items-center gap-4 mb-4">
                <img
                  src={`https://ddragon.leagueoflegends.com/cdn/14.1.1/img/profileicon/${player.summoner.profileIconId}.png`}
                  alt="icon"
                  className="w-16 h-16 rounded-full border-2 border-[#c89b3c]"
                />
                <div>
                  <div className="text-white text-xl font-medium">{player.summoner.name}</div>
                  <div className="text-[#8a9bb0] text-sm">Level {player.summoner.summonerLevel}</div>
                </div>
              </div>

              {ranked ? (
                <div className="grid grid-cols-4 gap-3">
                  <div className="bg-[#141c2e] rounded p-4">
                    <div className="text-[#8a9bb0] text-xs mb-1">Rang</div>
                    <div className="text-white font-medium">{ranked.tier} {ranked.rank}</div>
                    <div className="text-[#c89b3c] text-xs">{ranked.leaguePoints} LP</div>
                  </div>
                  <div className="bg-[#141c2e] rounded p-4">
                    <div className="text-[#8a9bb0] text-xs mb-1">Siege</div>
                    <div className="text-white font-medium">{ranked.wins}</div>
                  </div>
                  <div className="bg-[#141c2e] rounded p-4">
                    <div className="text-[#8a9bb0] text-xs mb-1">Niederlagen</div>
                    <div className="text-white font-medium">{ranked.losses}</div>
                  </div>
                  <div className="bg-[#141c2e] rounded p-4">
                    <div className="text-[#8a9bb0] text-xs mb-1">Winrate</div>
                    <div className="text-white font-medium">
                      {Math.round((ranked.wins / (ranked.wins + ranked.losses)) * 100)}%
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-[#8a9bb0] text-sm">Ranked Stats verfügbar sobald Production Key aktiv ist.</p>
              )}
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
                      <div className={`text-sm font-medium ${match.win ? 'text-green-400' : 'text-red-400'}`}>
                        {match.win ? 'Sieg' : 'Niederlage'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {!player && !loading && (
          <div className="text-center text-[#4a5a70] text-sm mt-12">
            Gib einen Summoner-Namen ein um zu starten (z.B. TFT Chillout#EUW)
          </div>
        )}

        <div className="text-center text-[#4a5a70] text-xs mt-8 pt-6 border-t border-[#1e2a3a]">
          metastats.gg · Nicht offiziell mit Riot Games verbunden · Datenschutz · Impressum
        </div>
      </div>
    </main>
  );
}