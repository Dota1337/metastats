'use client';
import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { calculateMarketValue } from '../../lib/marketvalue';

export default function PlayerPage() {
  const { slug } = useParams();
  const searchParams = useSearchParams();
  const [player, setPlayer] = useState<any>(null);
  const [matches, setMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ddVersion, setDdVersion] = useState('14.1.1');
  const [masteries, setMasteries] = useState<any[]>([]);
  const [liveGame, setLiveGame] = useState<{ inGame: boolean; gameData?: any }>({ inGame: false });
  const [challenges, setChallenges] = useState<any[]>([]);
  const [challengeConfig, setChallengeConfig] = useState<Record<number, { name: string; description: string; thresholds: Record<string, number> }>>({});
  const [championMap, setChampionMap] = useState<Record<number, { id: string; name: string }>>({});
  const region = searchParams.get('region') || 'euw1';

  useEffect(() => {
    if (!slug) return;
    const decoded = decodeURIComponent(slug as string);
    const separatorIndex = decoded.lastIndexOf('--');
    let name: string;
    let tag: string;
    if (separatorIndex !== -1) {
      name = decoded.slice(0, separatorIndex);
      tag = decoded.slice(separatorIndex + 2);
    } else {
      // Fallback for old-style URLs (name-tag)
      const parts = decoded.split('-');
      tag = parts[parts.length - 1];
      name = parts.slice(0, -1).join(' ');
    }
    loadPlayer(name, tag);
  }, [slug]);

  const loadPlayer = async (name: string, tag: string) => {
    setLoading(true);
    try {
      const versionRes = await fetch('/api/version');
      const versionData = await versionRes.json();
      setDdVersion(versionData.version);

      const res = await fetch(`/api/summoner?name=${encodeURIComponent(name + '#' + tag)}&region=${region}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPlayer(data);

      const matchRes = await fetch(`/api/matches?puuid=${encodeURIComponent(data.summoner.puuid)}&region=${region}`);
      const matchData = await matchRes.json();
      if (matchRes.ok) setMatches(matchData.matches || []);

      // Champion map from ddragon
      const champRes = await fetch(`https://ddragon.leagueoflegends.com/cdn/${versionData.version}/data/en_US/champion.json`);
      if (champRes.ok) {
        const champData = await champRes.json();
        const map: Record<number, { id: string; name: string }> = {};
        Object.values(champData.data).forEach((c: any) => { map[Number(c.key)] = { id: c.id, name: c.name }; });
        setChampionMap(map);
      }

      // Parallel fetch: mastery, live game, challenges
      const puuid = encodeURIComponent(data.summoner.puuid);
      const [masteryRes, liveRes, challengeRes] = await Promise.all([
        fetch(`/api/mastery?puuid=${puuid}&region=${region}`),
        fetch(`/api/live-game?puuid=${puuid}&region=${region}`),
        fetch(`/api/challenges?puuid=${puuid}&region=${region}`),
      ]);

      if (masteryRes.ok) {
        const masteryData = await masteryRes.json();
        setMasteries(masteryData.masteries || []);
      }
      if (liveRes.ok) {
        const liveData = await liveRes.json();
        setLiveGame(liveData);
      }
      if (challengeRes.ok) {
        const challengeData = await challengeRes.json();
        const allChallenges = challengeData.challenges?.challenges || [];
        const configMap = challengeData.configMap || {};
        setChallengeConfig(configMap);
        const levelOrder: Record<string, number> = { CHALLENGER: 5, GRANDMASTER: 4, MASTER: 3, DIAMOND: 2, PLATINUM: 1 };
        const sorted = allChallenges
          .filter((c: any) => levelOrder[c.level] >= 3)
          .sort((a: any, b: any) => (levelOrder[b.level] || 0) - (levelOrder[a.level] || 0))
          .slice(0, 3);
        setChallenges(sorted);
      }
    } catch (e: any) {
      setError(e.message || 'Spieler nicht gefunden');
    } finally {
      setLoading(false);
    }
  };

  const ranked = Array.isArray(player?.ranked)
    ? player.ranked.find((r: any) => r.queueType === 'RANKED_SOLO_5x5')
    : null;

  const marketValue = calculateMarketValue(
    ranked ? {
      tier: ranked.tier,
      rank: ranked.rank,
      leaguePoints: ranked.leaguePoints,
      wins: ranked.wins,
      losses: ranked.losses,
    } : null,
    matches
  );

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const winrate = matches.length > 0
    ? Math.round((matches.filter(m => m.win).length / matches.length) * 100)
    : null;

  const kda = matches.length > 0
    ? ((matches.reduce((s, m) => s + m.kills + m.assists, 0)) /
      Math.max(matches.reduce((s, m) => s + m.deaths, 0), 1)).toFixed(2)
    : null;

  const roleLabels: Record<string, string> = {
    TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid',
    BOTTOM: 'ADC', SUPPORT: 'Support', UNKNOWN: '-'
  };

  return (
    <main className="min-h-screen bg-[#080c18]">
      <nav className="bg-[#0a0e1a] border-b border-[#1e2a3a] px-6 py-3 flex items-center justify-between">
        <a href="/" className="text-[#c89b3c] text-lg font-medium">
          meta<span className="text-white">stats</span>.gg
        </a>
        <div className="flex gap-6">
          <a href="/" className="text-[#8a9bb0] text-sm hover:text-white">Spielersuche</a>
          <a href="/leaderboard" className="text-[#8a9bb0] text-sm hover:text-white">Rangliste</a>
          <a href="/champions" className="text-[#8a9bb0] text-sm hover:text-white">Champions</a>
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
              <div className="flex items-center gap-6 mb-6">
                <img
                  src={'https://ddragon.leagueoflegends.com/cdn/' + ddVersion + '/img/profileicon/' + player.summoner.profileIconId + '.png'}
                  alt="icon"
                  className="w-20 h-20 rounded-full border-2 border-[#c89b3c]"
                />
                <div className="flex-1">
                  <h1 className="text-white text-2xl font-medium flex items-center gap-3">
                    {player.summoner.name}
                    {liveGame.inGame && (
                      <span className="inline-flex items-center gap-1 bg-green-500/20 text-green-400 text-xs font-bold px-2 py-0.5 rounded-full border border-green-500/40">
                        <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                        LIVE
                      </span>
                    )}
                  </h1>
                  <div className="text-[#8a9bb0] text-sm mt-1">
                    Level {player.summoner.summonerLevel} · {region.toUpperCase().replace('1', '')} · {roleLabels[marketValue.role] || '-'}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[#8a9bb0] text-xs mb-1">KI-Marktwert</div>
                  {marketValue.rated ? (
                    <div className="text-[#c89b3c] text-3xl font-medium">{marketValue.formatted}</div>
                  ) : (
                    <div className="text-[#4a5a70] text-lg">Not Rated</div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-4 gap-3">
                <div className="bg-[#141c2e] rounded p-4 text-center">
                  <div className="text-[#8a9bb0] text-xs mb-1">Rang</div>
                  <div className="text-white font-medium text-sm">
                    {ranked ? ranked.tier + ' ' + ranked.rank : 'Unranked'}
                  </div>
                  {ranked && <div className="text-[#c89b3c] text-xs mt-1">{ranked.leaguePoints} LP</div>}
                </div>
                <div className="bg-[#141c2e] rounded p-4 text-center">
                  <div className="text-[#8a9bb0] text-xs mb-1">Winrate (30 Spiele)</div>
                  <div className={`font-medium text-sm ${winrate && winrate >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                    {winrate !== null ? winrate + '%' : '-'}
                  </div>
                </div>
                <div className="bg-[#141c2e] rounded p-4 text-center">
                  <div className="text-[#8a9bb0] text-xs mb-1">Ø KDA</div>
                  <div className="text-white font-medium text-sm">{kda || '-'}</div>
                </div>
                <div className="bg-[#141c2e] rounded p-4 text-center">
                  <div className="text-[#8a9bb0] text-xs mb-1">Hauptrolle</div>
                  <div className="text-white font-medium text-sm">{roleLabels[marketValue.role] || '-'}</div>
                </div>
              </div>
            </div>

            {/* Champion Mastery */}
            {masteries.length > 0 && (
              <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6 mb-4">
                <div className="text-[#8a9bb0] text-xs uppercase tracking-widest mb-4">
                  Champion Mastery
                </div>
                <div className="grid grid-cols-5 gap-3">
                  {masteries.slice(0, 5).map((m: any, i: number) => {
                    const champ = championMap[m.championId];
                    const champId = champ?.id || 'Unknown';
                    const champDisplayName = champ?.name || champId;
                    return (
                      <div key={i} className="bg-[#141c2e] rounded p-4 flex flex-col items-center gap-2">
                        <img
                          src={`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/champion/${champId}.png`}
                          alt={champDisplayName}
                          className="w-12 h-12 rounded-full border-2 border-[#c89b3c]"
                        />
                        <div className="text-white text-sm font-medium">{champDisplayName}</div>
                        <div className="text-[#c89b3c] text-xs font-bold">Level {m.championLevel}</div>
                        <div className="text-[#8a9bb0] text-xs">{m.championPoints?.toLocaleString()} Punkte</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Challenge Highlights */}
            {challenges.length > 0 && (
              <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6 mb-4">
                <div className="text-[#8a9bb0] text-xs uppercase tracking-widest mb-4">
                  Challenge Highlights
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {challenges.map((c: any, i: number) => {
                    const levelColors: Record<string, string> = {
                      CHALLENGER: 'text-[#f0c040] border-[#f0c040]',
                      GRANDMASTER: 'text-red-400 border-red-400',
                      MASTER: 'text-purple-400 border-purple-400',
                    };
                    const colorClass = levelColors[c.level] || 'text-[#8a9bb0] border-[#8a9bb0]';
                    const config = challengeConfig[c.challengeId];
                    const name = config?.name || `Challenge #${c.challengeId}`;
                    const threshold = config?.thresholds?.[c.level];
                    return (
                      <div key={i} className="bg-[#141c2e] rounded p-4 flex flex-col items-center gap-2 text-center">
                        <div className={`text-xs font-bold px-2 py-0.5 rounded border ${colorClass}`}>
                          {c.level}
                        </div>
                        <div className="text-white text-sm font-medium">{name}</div>
                        <div className="text-[#8a9bb0] text-xs">{c.value?.toLocaleString()}{threshold !== undefined ? ` / ${threshold.toLocaleString()}` : ''}</div>
                        <div className="text-[#c89b3c] text-xs">
                          Top {c.percentile !== undefined ? (c.percentile * 100).toFixed(1) : '?'}%
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Match History */}
            {matches.length > 0 && (
              <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6">
                <div className="text-[#8a9bb0] text-xs uppercase tracking-widest mb-4">
                  Match History (letzte {matches.length} Spiele)
                </div>
                <div className="flex flex-col gap-2">
                  {matches.map((match, i) => (
                    <div key={i} className={'flex items-center gap-4 p-3 rounded border-l-4 ' + (match.win ? 'border-green-500 bg-[#0a1f0a]' : 'border-red-500 bg-[#1f0a0a]')}>
                      <img
                        src={'https://ddragon.leagueoflegends.com/cdn/' + ddVersion + '/img/champion/' + match.champion + '.png'}
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
                      <div className="text-center">
                        <div className="text-white text-sm font-medium">{match.visionScore}</div>
                        <div className="text-[#8a9bb0] text-xs">Vision</div>
                      </div>
                      <div className={'text-sm font-medium w-20 text-right ' + (match.win ? 'text-green-400' : 'text-red-400')}>
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
            Gib einen Summoner-Namen ein um zu starten
          </div>
        )}

        <div className="text-center text-[#4a5a70] text-xs mt-8 pt-6 border-t border-[#1e2a3a]">
          metastats.gg · Nicht offiziell mit Riot Games verbunden · Datenschutz · Impressum
        </div>
      </div>
    </main>
  );
}