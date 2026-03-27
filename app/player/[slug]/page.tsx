'use client';
import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { calculateMarketValue, type BreakdownItem } from '../../lib/marketvalue';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import { useI18n } from '../../lib/i18n';

export default function PlayerPage() {
  const { slug } = useParams();
  const searchParams = useSearchParams();
  const [player, setPlayer] = useState<any>(null);
  const [matches, setMatches] = useState<any[]>([]);
  const [statsOverview, setStatsOverview] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ddVersion, setDdVersion] = useState('14.1.1');
  const [masteries, setMasteries] = useState<any[]>([]);
  const [liveGame, setLiveGame] = useState<{ inGame: boolean; gameData?: any }>({ inGame: false });
  const [championMap, setChampionMap] = useState<Record<number, { id: string; name: string }>>({});
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [isPremium] = useState(false); // TODO: connect to auth system
  const region = searchParams.get('region') || 'euw1';
  const { t } = useI18n();

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

      // Use matches from summoner response (fresh), fallback to /api/matches (cached)
      if (data.matches && data.matches.length > 0) {
        setMatches(data.matches);
        if (data.statsOverview) setStatsOverview(data.statsOverview);
      } else {
        const matchRes = await fetch(`/api/matches?puuid=${encodeURIComponent(data.summoner.puuid)}&region=${region}`);
        const matchData = await matchRes.json();
        if (matchRes.ok) {
          setMatches(matchData.matches || []);
          if (matchData.statsOverview) setStatsOverview(matchData.statsOverview);
        }
      }

      // Champion map from ddragon
      const champRes = await fetch(`https://ddragon.leagueoflegends.com/cdn/${versionData.version}/data/en_US/champion.json`);
      if (champRes.ok) {
        const champData = await champRes.json();
        const map: Record<number, { id: string; name: string }> = {};
        Object.values(champData.data).forEach((c: any) => { map[Number(c.key)] = { id: c.id, name: c.name }; });
        setChampionMap(map);
      }

      // Parallel fetch: mastery + live game
      const puuid = encodeURIComponent(data.summoner.puuid);
      const [masteryRes, liveRes] = await Promise.all([
        fetch(`/api/mastery?puuid=${puuid}&region=${region}`),
        fetch(`/api/live-game?puuid=${puuid}&region=${region}`),
      ]);

      if (masteryRes.ok) {
        const masteryData = await masteryRes.json();
        setMasteries(masteryData.masteries || []);
      }
      if (liveRes.ok) {
        const liveData = await liveRes.json();
        setLiveGame(liveData);
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

  const flex = Array.isArray(player?.ranked)
    ? player.ranked.find((r: any) => r.queueType === 'RANKED_FLEX_SR')
    : null;

  // Use stored market value from Supabase when available (cached responses),
  // only recalculate when we have fresh match data
  const calculatedMarketValue = calculateMarketValue(
    ranked ? {
      tier: ranked.tier,
      rank: ranked.rank,
      leaguePoints: ranked.leaguePoints,
      wins: ranked.wins,
      losses: ranked.losses,
    } : null,
    matches
  );

  const marketValue = (player?.storedMarketValue && matches.length === 0)
    ? {
        ...calculatedMarketValue,
        value: player.storedMarketValue,
        formatted: '$' + player.storedMarketValue.toLocaleString('de-DE'),
        rated: true,
      }
    : calculatedMarketValue;

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

  const queueLabels: Record<number, string> = {
    420: 'Solo/Duo',
    440: 'Flex',
    450: 'ARAM',
    400: 'Normal Draft',
    430: 'Normal Blind',
    490: 'Normal (Quickplay)',
    700: 'Clash',
    720: 'ARAM: Clash',
    900: 'ARURF',
    1020: 'One for All',
    1300: 'Nexus Blitz',
    1400: 'Ultimate Spellbook',
    1700: 'Arena',
    1710: 'Arena',
    1900: 'Pick URF',
    2000: 'Tutorial 1',
    2010: 'Tutorial 2',
    2020: 'Tutorial 3',
    1090: 'TFT Normal',
    1100: 'TFT Ranked',
    1130: 'TFT Hyper Roll',
    1160: 'TFT Double Up',
  };

  const getQueueName = (match: any) => {
    if (match.queueId && queueLabels[match.queueId]) return queueLabels[match.queueId];
    if (match.gameMode === 'ARAM') return 'ARAM';
    if (match.gameMode === 'CLASSIC') return 'Normal';
    return match.gameMode || '-';
  };

  return (
    <main className="min-h-screen bg-[#080c18]">
      <Nav />

      <div className="max-w-5xl mx-auto px-6 py-8">
        {loading && (
          <div className="text-center text-[#8a9bb0] mt-20">{t('player.loading')}</div>
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
                  <div className="text-[#8a9bb0] text-xs mb-1">{t('player.aiMarketValue')}</div>
                  {marketValue.rated ? (
                    <div className="text-[#c89b3c] text-3xl font-medium">{marketValue.formatted}</div>
                  ) : (
                    <div className="text-[#4a5a70] text-lg">Not Rated</div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-5 gap-3">
                <div className="bg-[#141c2e] rounded p-4 text-center">
                  <div className="text-[#8a9bb0] text-xs mb-1">Solo/Duo</div>
                  <div className="text-white font-medium text-sm">
                    {ranked ? ranked.tier + ' ' + ranked.rank : t('player.unranked')}
                  </div>
                  {ranked && <div className="text-[#c89b3c] text-xs mt-1">{ranked.leaguePoints} LP</div>}
                </div>
                <div className="bg-[#141c2e] rounded p-4 text-center">
                  <div className="text-[#8a9bb0] text-xs mb-1">Flex</div>
                  <div className="text-white font-medium text-sm">
                    {flex ? flex.tier + ' ' + flex.rank : t('player.unranked')}
                  </div>
                  {flex && <div className="text-[#c89b3c] text-xs mt-1">{flex.leaguePoints} LP</div>}
                </div>
                <div className="bg-[#141c2e] rounded p-4 text-center">
                  <div className="text-[#8a9bb0] text-xs mb-1">{t('player.winrate30')}</div>
                  <div className={`font-medium text-sm ${winrate && winrate >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                    {winrate !== null ? winrate + '%' : '-'}
                  </div>
                </div>
                <div className="bg-[#141c2e] rounded p-4 text-center">
                  <div className="text-[#8a9bb0] text-xs mb-1">{t('player.avgKDA')}</div>
                  <div className="text-white font-medium text-sm">{kda || '-'}</div>
                </div>
                <div className="bg-[#141c2e] rounded p-4 text-center">
                  <div className="text-[#8a9bb0] text-xs mb-1">{t('player.mainRole')}</div>
                  <div className="text-white font-medium text-sm">{roleLabels[marketValue.role] || '-'}</div>
                </div>
              </div>
            </div>

            {/* Market Value Breakdown */}
            {marketValue.rated && marketValue.breakdown.length > 0 && (
              <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6 mb-4">
                <div className="text-[#8a9bb0] text-xs uppercase tracking-widest mb-4">
                  {t('player.marketBreakdown')}
                </div>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="bg-[#141c2e] rounded p-3 text-center">
                    <div className="text-[#8a9bb0] text-xs mb-1">{t('player.baseValue')} ({ranked?.tier} {ranked?.rank})</div>
                    <div className="text-white text-lg font-medium">
                      ${marketValue.baseValue.toLocaleString('de-DE')}
                    </div>
                  </div>
                  <div className="bg-[#141c2e] rounded p-3 text-center">
                    <div className="text-[#8a9bb0] text-xs mb-1">{t('player.multiplier')}</div>
                    <div className={`text-lg font-medium ${marketValue.multiplier >= 1 ? 'text-green-400' : 'text-red-400'}`}>
                      x{marketValue.multiplier.toFixed(3)}
                    </div>
                  </div>
                  <div className="bg-[#141c2e] rounded p-3 text-center">
                    <div className="text-[#8a9bb0] text-xs mb-1">{t('player.finalValue')}</div>
                    <div className="text-[#c89b3c] text-lg font-medium">{marketValue.formatted}</div>
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  {[...marketValue.breakdown]
                    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
                    .map((item: BreakdownItem, i: number) => (
                    <div key={i} className="flex items-center gap-3 py-1.5 px-2 rounded hover:bg-[#141c2e]">
                      <div className="w-16 text-xs text-[#4a5a70]">{item.category}</div>
                      <div className="w-36 text-xs text-white">{item.label}</div>
                      <div className="flex-1 h-2 bg-[#141c2e] rounded overflow-hidden">
                        {item.positive ? (
                          <div className="h-full bg-green-500/60 rounded" style={{ width: `${Math.min(Math.abs(item.impact) / 0.175 * 100, 100)}%` }} />
                        ) : (
                          <div className="h-full bg-red-500/60 rounded" style={{ width: `${Math.min(Math.abs(item.impact) / 0.175 * 100, 100)}%` }} />
                        )}
                      </div>
                      <div className={`w-14 text-xs font-medium text-right ${item.positive ? 'text-green-400' : 'text-red-400'}`}>
                        {item.positive ? '+' : ''}{(item.impact * 100).toFixed(1)}%
                      </div>
                      <div className="w-36 text-xs text-[#8a9bb0] text-right">{item.stat}</div>
                    </div>
                  ))}
                </div>
                {marketValue.stats.gamesAnalyzed > 0 && (
                  <div className="mt-4 pt-3 border-t border-[#1e2a3a] grid grid-cols-6 gap-2">
                    <div className="text-center">
                      <div className="text-[#8a9bb0] text-xs">{t('player.games')}</div>
                      <div className="text-white text-sm">{marketValue.stats.gamesAnalyzed}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[#8a9bb0] text-xs">Winrate</div>
                      <div className="text-white text-sm">{marketValue.stats.winrate.toFixed(1)}%</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[#8a9bb0] text-xs">KDA</div>
                      <div className="text-white text-sm">{marketValue.stats.kda.toFixed(2)}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[#8a9bb0] text-xs">CS/Min</div>
                      <div className="text-white text-sm">{marketValue.stats.csPerMin.toFixed(1)}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[#8a9bb0] text-xs">DMG/Min</div>
                      <div className="text-white text-sm">{marketValue.stats.damagePerMin.toFixed(0)}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[#8a9bb0] text-xs">Vision</div>
                      <div className="text-white text-sm">{marketValue.stats.visionScore.toFixed(1)}</div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 20 Stat Categories */}
            {statsOverview && statsOverview.categories && statsOverview.categories.length > 0 && (
              <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6 mb-4">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="text-[#8a9bb0] text-xs uppercase tracking-widest">
                      {t('stats.title')}
                    </div>
                    <div className="text-[#4a5a70] text-xs mt-1">
                      {t('stats.subtitle')} {statsOverview.gamesAnalyzed} {t('stats.games')}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[#8a9bb0] text-xs">{t('stats.overallScore')}</div>
                    <div className="text-2xl font-medium" style={{
                      color: statsOverview.overallScore >= 70 ? '#4ade80' :
                             statsOverview.overallScore >= 50 ? '#c89b3c' :
                             statsOverview.overallScore >= 30 ? '#f59e0b' : '#ef4444'
                    }}>
                      {statsOverview.overallScore}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {statsOverview.categories.map((cat: any) => (
                    <div
                      key={cat.id}
                      className="bg-[#141c2e] rounded p-3 cursor-pointer hover:bg-[#1a2540] transition-colors"
                      onClick={() => setExpandedCategory(expandedCategory === cat.id ? null : cat.id)}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-lg w-7 text-center">{cat.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-white text-sm font-medium truncate">{cat.name}</span>
                            {cat.trend > 5 && <span className="text-green-400 text-xs">&#9650;</span>}
                            {cat.trend < -5 && <span className="text-red-400 text-xs">&#9660;</span>}
                          </div>
                          <div className="text-[#6a7a90] text-xs truncate">{cat.summary}</div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <div className="w-16 h-2 bg-[#0d1526] rounded overflow-hidden">
                            <div
                              className="h-full rounded transition-all"
                              style={{
                                width: `${cat.score}%`,
                                backgroundColor: cat.score >= 70 ? '#4ade80' :
                                                 cat.score >= 50 ? '#c89b3c' :
                                                 cat.score >= 30 ? '#f59e0b' : '#ef4444',
                              }}
                            />
                          </div>
                          <span className="text-white text-sm font-medium w-8 text-right">{cat.score}</span>
                        </div>
                      </div>

                      {/* Expanded: Premium detail stats */}
                      {expandedCategory === cat.id && (
                        <div className="mt-3 pt-3 border-t border-[#1e2a3a]">
                          {isPremium ? (
                            <div className="grid grid-cols-2 gap-2">
                              {cat.details.map((d: any, j: number) => (
                                <div key={j} className="flex justify-between items-baseline">
                                  <span className="text-[#6a7a90] text-xs">{d.name}</span>
                                  <span className="text-white text-xs font-medium">
                                    {typeof d.value === 'number' ? d.value.toLocaleString() : d.value}{d.unit ? ` ${d.unit}` : ''}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-center py-2">
                              <div className="flex items-center justify-center gap-2 mb-2">
                                {cat.details.slice(0, 2).map((d: any, j: number) => (
                                  <span key={j} className="text-[#6a7a90] text-xs">
                                    {d.name}: <span className="text-white">{typeof d.value === 'number' ? d.value.toLocaleString() : d.value}{d.unit ? ` ${d.unit}` : ''}</span>
                                  </span>
                                ))}
                              </div>
                              {cat.details.length > 2 && (
                                <div className="relative">
                                  <div className="grid grid-cols-2 gap-1 opacity-20 blur-[2px] select-none pointer-events-none">
                                    {cat.details.slice(2, 6).map((d: any, j: number) => (
                                      <div key={j} className="flex justify-between">
                                        <span className="text-[#6a7a90] text-xs">{d.name}</span>
                                        <span className="text-white text-xs">***</span>
                                      </div>
                                    ))}
                                  </div>
                                  <div className="absolute inset-0 flex items-center justify-center">
                                    <span className="bg-[#c89b3c]/10 border border-[#c89b3c]/30 text-[#c89b3c] text-xs px-3 py-1 rounded-full">
                                      +{cat.details.length - 2} Stats — {t('stats.premiumBadge')}
                                    </span>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {!isPremium && (
                  <div className="mt-4 pt-3 border-t border-[#1e2a3a] text-center">
                    <div className="text-[#6a7a90] text-xs mb-2">{t('stats.premiumHint')}</div>
                    <button className="bg-gradient-to-r from-[#c89b3c] to-[#a07830] text-black text-xs font-bold px-6 py-2 rounded hover:brightness-110 transition">
                      {t('stats.unlockDetails')}
                    </button>
                  </div>
                )}
              </div>
            )}

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

            {/* Match History — letzte 30 Spiele mit ausführlichen Stats */}
            {matches.length > 0 && (
              <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6">
                <div className="text-[#8a9bb0] text-xs uppercase tracking-widest mb-4">
                  Match History ({t('player.lastGames')} {matches.length} {t('player.gamesLabel')})
                </div>
                <div className="flex flex-col gap-2">
                  {matches.map((match, i) => {
                    const kdaVal = match.deaths > 0
                      ? ((match.kills + match.assists) / match.deaths).toFixed(2)
                      : 'Perfect';
                    const csPerMin = match.gameDuration > 0
                      ? (match.cs / (match.gameDuration / 60)).toFixed(1)
                      : '0';
                    const dmgPerMin = match.gameDuration > 0
                      ? Math.round(match.damageDealt / (match.gameDuration / 60))
                      : 0;
                    const killParticipation = match.teamKills > 0
                      ? Math.round(((match.kills + match.assists) / match.teamKills) * 100)
                      : 0;
                    const dmgShare = match.teamDamage > 0
                      ? Math.round((match.damageDealt / match.teamDamage) * 100)
                      : 0;
                    const goldShare = match.teamGold > 0
                      ? Math.round((match.goldEarned / match.teamGold) * 100)
                      : 0;

                    return (
                      <div key={i} className={'rounded border-l-4 overflow-hidden ' + (match.win ? 'border-green-500 bg-[#0a1f0a]' : 'border-red-500 bg-[#1f0a0a]')}>
                        {/* Main row */}
                        <div className="flex items-center gap-3 p-3">
                          <img
                            src={'https://ddragon.leagueoflegends.com/cdn/' + ddVersion + '/img/champion/' + match.champion + '.png'}
                            alt={match.champion}
                            className="w-10 h-10 rounded flex-shrink-0"
                          />
                          <div className="w-24">
                            <div className="text-white text-sm font-medium">{match.champion}</div>
                            <div className="text-[#8a9bb0] text-xs">{getQueueName(match)} · {formatDuration(match.gameDuration)}</div>
                          </div>
                          <div className="text-center w-20">
                            <div className="text-white text-sm font-medium">{match.kills}/{match.deaths}/{match.assists}</div>
                            <div className="text-[#8a9bb0] text-xs">{kdaVal} KDA</div>
                          </div>
                          <div className="text-center w-14">
                            <div className="text-white text-sm font-medium">{match.cs}</div>
                            <div className="text-[#8a9bb0] text-xs">{csPerMin}/m</div>
                          </div>
                          <div className="text-center w-16">
                            <div className="text-white text-sm font-medium">{(match.damageDealt / 1000).toFixed(1)}k</div>
                            <div className="text-[#8a9bb0] text-xs">{dmgPerMin}/m</div>
                          </div>
                          <div className="text-center w-12">
                            <div className="text-white text-sm font-medium">{match.visionScore}</div>
                            <div className="text-[#8a9bb0] text-xs">Vis</div>
                          </div>
                          <div className="text-center w-12">
                            <div className="text-white text-sm font-medium">{killParticipation}%</div>
                            <div className="text-[#8a9bb0] text-xs">KP</div>
                          </div>
                          <div className="text-center w-14">
                            <div className="text-white text-sm font-medium">{(match.goldEarned / 1000).toFixed(1)}k</div>
                            <div className="text-[#8a9bb0] text-xs">Gold</div>
                          </div>
                          <div className={'text-sm font-medium w-16 text-right ' + (match.win ? 'text-green-400' : 'text-red-400')}>
                            {match.win ? t('player.win') : t('player.loss')}
                          </div>
                        </div>
                        {/* Detail row */}
                        <div className="flex items-center gap-4 px-3 pb-2 text-xs text-[#6a7a90]">
                          <span>{roleLabels[match.role] || '-'}</span>
                          <span>DMG-Anteil: {dmgShare}%</span>
                          <span>Gold-Anteil: {goldShare}%</span>
                          <span>Wards: {match.wardsPlaced}</span>
                          <span>Ctrl Wards: {match.controlWardsPlaced}</span>
                          {match.soloKills > 0 && <span>Solo Kills: {match.soloKills}</span>}
                          {match.doubleKills > 0 && <span>Double: {match.doubleKills}</span>}
                          {match.tripleKills > 0 && <span className="text-[#c89b3c]">Triple: {match.tripleKills}</span>}
                          {match.quadraKills > 0 && <span className="text-[#c89b3c]">Quadra: {match.quadraKills}</span>}
                          {match.pentaKills > 0 && <span className="text-[#f0c040] font-bold">PENTA!</span>}
                          {match.turretKills > 0 && <span>Turrets: {match.turretKills}</span>}
                          {match.firstBloodKill && <span className="text-red-400">First Blood</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {!player && !loading && (
          <div className="text-center text-[#4a5a70] text-sm mt-12">
            {t('player.enterName')}
          </div>
        )}

        <Footer />
      </div>
    </main>
  );
}