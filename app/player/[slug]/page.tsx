'use client';
import { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useParams, useSearchParams } from 'next/navigation';
import { calculateMarketValue, type BreakdownItem } from '../../lib/marketvalue';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import ChampionBreakdown from '../../components/ChampionBreakdown';
import MatchDetail from '../../components/MatchDetail';
import LiveGameDetail from '../../components/LiveGameDetail';
import ApiUnavailable from '../../components/ApiUnavailable';
import { useI18n, LOCALE_MAP } from '../../lib/i18n';
import { useCustomPageTitle } from '../../lib/use-page-title';
import { loadProLookup, lookupPro, type ProPlayer } from '../../lib/pro-players';
import { formatTier } from '../../lib/rank-format';

const PerformanceCharts = dynamic(() => import('../../components/PerformanceCharts'), { ssr: false });
const RadarStats = dynamic(() => import('../../components/RadarStats'), { ssr: false });
const MarketValueChart = dynamic(() => import('../../components/MarketValueChart'), { ssr: false });
import AICoach from '../../components/AICoach';

export default function PlayerPage() {
  const { slug } = useParams();
  const searchParams = useSearchParams();
  const [player, setPlayer] = useState<any>(null);
  const [matches, setMatches] = useState<any[]>([]);
  const [statsOverview, setStatsOverview] = useState<any>(null);
  const [storedMarketValue, setStoredMarketValue] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ddVersion, setDdVersion] = useState('14.1.1');
  const [masteries, setMasteries] = useState<any[]>([]);
  const [liveGame, setLiveGame] = useState<{ inGame: boolean; gameData?: any }>({ inGame: false });
  const [liveGameUnavailable, setLiveGameUnavailable] = useState(false);
  const [championMap, setChampionMap] = useState<Record<number, { id: string; name: string }>>({});
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [expandedMatch, setExpandedMatch] = useState<number | null>(null);
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [proInfo, setProInfo] = useState<ProPlayer | null>(null);
  const [isPremium] = useState(false); // TODO: connect to auth system
  const [loadingMore, setLoadingMore] = useState(false);
  const [expandedSmurfs, setExpandedSmurfs] = useState(false);
  const [hasMoreMatches, setHasMoreMatches] = useState(true);
  const region = searchParams.get('region') || 'euw1';
  const { t, lang } = useI18n();
  const numLocale = LOCALE_MAP[lang];
  useCustomPageTitle(player?.summoner?.name || null);

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
      if (data.storedMarketValue) setStoredMarketValue(data.storedMarketValue);

      // Check if this player is a pro
      loadProLookup().then(lookup => {
        const pro = lookupPro(lookup, data.summoner?.name || '');
        if (pro) setProInfo(pro);
      });

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
        setLiveGameUnavailable(false);
      } else if (liveRes.status === 403 || liveRes.status === 401) {
        // Spectator API requires Production-level Riot API key
        setLiveGameUnavailable(true);
      }
    } catch (e: any) {
      setError(e.message || 'Spieler nicht gefunden');
    } finally {
      setLoading(false);
    }
  };

  const loadMoreMatches = async () => {
    if (!player?.summoner?.puuid || loadingMore) return;
    setLoadingMore(true);
    try {
      const start = matches.length;
      const res = await fetch(`/api/matches?puuid=${encodeURIComponent(player.summoner.puuid)}&region=${region}&start=${start}&count=30`);
      if (res.ok) {
        const data = await res.json();
        const newMatches = data.matches || [];
        if (newMatches.length === 0) {
          setHasMoreMatches(false);
        } else {
          setMatches(prev => [...prev, ...newMatches]);
          if (newMatches.length < 30) setHasMoreMatches(false);
        }
      }
    } catch {
      // silent fail
    } finally {
      setLoadingMore(false);
    }
  };

  const ranked = Array.isArray(player?.ranked)
    ? player.ranked.find((r: any) => r.queueType === 'RANKED_SOLO_5x5')
    : null;

  const flex = Array.isArray(player?.ranked)
    ? player.ranked.find((r: any) => r.queueType === 'RANKED_FLEX_SR')
    : null;

  // Format tier display: hide rank (I) for Challenger, Grandmaster, Master
  const formatRankedQueue = (q: any) => {
    if (!q) return null;
    return formatTier(q.tier, q.rank);
  };

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

  const marketValue = storedMarketValue
    ? {
        ...calculatedMarketValue,
        value: storedMarketValue,
        formatted: '$' + storedMarketValue.toLocaleString('de-DE'),
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

  const timeAgo = (timestamp: number) => {
    if (!timestamp) return '';
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    const weeks = Math.floor(diff / 604800000);
    const months = Math.floor(days / 30);
    if (minutes < 1) return 'Gerade eben';
    if (minutes < 60) return `Vor ${minutes} Min.`;
    if (hours < 24) return `Vor ${hours} Std.`;
    if (days === 1) return 'Vor 1 Tag';
    if (days < 7) return `Vor ${days} Tagen`;
    if (weeks <= 4) return `Vor ${weeks} Woche${weeks > 1 ? 'n' : ''}`;
    if (months === 1) return 'Vor 1 Monat';
    if (months < 12) return `Vor ${months} Monaten`;
    return `Vor über 1 Jahr`;
  };

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

  const filteredMatches = useMemo(() => {
    if (roleFilter === 'all') return matches;
    return matches.filter(m => m.role === roleFilter);
  }, [matches, roleFilter]);

  const availableRoles = useMemo(() => {
    const roles = new Set(matches.map(m => m.role).filter(r => r && r !== 'UNKNOWN'));
    return ['all', ...Array.from(roles)];
  }, [matches]);

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
        {loading && (
          <div className="text-center text-[#a0b0c5] mt-20">{t('player.loading')}</div>
        )}

        {error && (
          <div className="text-center text-red-400 mt-20">{error}</div>
        )}

        {player && !loading && (
          <>
            {/* Header */}
            <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4 sm:p-6 mb-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6 mb-6">
                <img
                  src={'https://ddragon.leagueoflegends.com/cdn/' + ddVersion + '/img/profileicon/' + player.summoner.profileIconId + '.png'}
                  alt="icon"
                  className="w-16 h-16 sm:w-20 sm:h-20 rounded-full border-2 border-[#c89b3c]"
                />
                <div className="flex-1 min-w-0">
                  <h1 className="text-white text-xl sm:text-2xl font-medium flex flex-wrap items-center gap-2 sm:gap-3">
                    <span className="truncate">{player.summoner.name}</span>
                    {proInfo && (
                      <span className="inline-flex items-center gap-1.5 bg-[#c89b3c]/15 text-[#c89b3c] text-xs font-bold px-2.5 py-0.5 rounded-full border border-[#c89b3c]/40">
                        PRO
                      </span>
                    )}
                    {liveGame.inGame && (
                      <span className="inline-flex items-center gap-1 bg-green-500/20 text-green-400 text-xs font-bold px-2 py-0.5 rounded-full border border-green-500/40">
                        <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                        LIVE
                      </span>
                    )}
                  </h1>
                  <div className="text-[#a0b0c5] text-sm mt-1">
                    {proInfo ? (
                      <span><span className="text-[#c89b3c]">{proInfo.proName}</span> · {proInfo.team}{proInfo.league ? ` · ${proInfo.league}` : ''} · </span>
                    ) : null}
                    Level {player.summoner.summonerLevel} · {region.toUpperCase().replace('1', '')} · {roleLabels[marketValue.role] || '-'}
                  </div>
                </div>
                <div className="sm:text-right">
                  <div className="text-[#a0b0c5] text-xs mb-1">{t('player.aiMarketValue')}</div>
                  {marketValue.rated ? (
                    <div className="text-[#c89b3c] text-2xl sm:text-3xl font-medium">{marketValue.formatted}</div>
                  ) : (
                    <div className="text-[#7a8aa0] text-lg">Not Rated</div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {proInfo && (
                  <div className="bg-[#141c2e] rounded p-4 text-center">
                    <div className="text-[#a0b0c5] text-xs mb-1">Team</div>
                    <div className="text-[#c89b3c] font-medium text-sm">{proInfo.team}</div>
                    <div className="text-[#7a8aa0] text-xs mt-1">{proInfo.role || ''}{proInfo.league ? ` · ${proInfo.league}` : ''}</div>
                  </div>
                )}
                <div className="bg-[#141c2e] rounded p-4 text-center">
                  <div className="text-[#a0b0c5] text-xs mb-1">Solo/Duo</div>
                  <div className="text-white font-medium text-sm">
                    {ranked ? formatRankedQueue(ranked) : t('player.unranked')}
                  </div>
                  {ranked && <div className="text-[#c89b3c] text-xs mt-1">{ranked.leaguePoints} LP</div>}
                  {ranked && (
                    <div className="text-[#7a8aa0] text-xs mt-1">
                      {ranked.wins + ranked.losses} Spiele
                      <span className="text-green-400/70 ml-1">{ranked.wins}W</span>
                      <span className="text-red-400/70 ml-1">{ranked.losses}L</span>
                    </div>
                  )}
                </div>
                <div className="bg-[#141c2e] rounded p-4 text-center">
                  <div className="text-[#a0b0c5] text-xs mb-1">Flex</div>
                  <div className="text-white font-medium text-sm">
                    {flex ? formatRankedQueue(flex) : t('player.unranked')}
                  </div>
                  {flex && <div className="text-[#c89b3c] text-xs mt-1">{flex.leaguePoints} LP</div>}
                  {flex && (
                    <div className="text-[#7a8aa0] text-xs mt-1">
                      {flex.wins + flex.losses} Spiele
                      <span className="text-green-400/70 ml-1">{flex.wins}W</span>
                      <span className="text-red-400/70 ml-1">{flex.losses}L</span>
                    </div>
                  )}
                </div>
                <div className="bg-[#141c2e] rounded p-4 text-center">
                  <div className="text-[#a0b0c5] text-xs mb-1">{t('player.winrate30')}</div>
                  <div className={`font-medium text-sm ${winrate && winrate >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                    {winrate !== null ? winrate + '%' : '-'}
                  </div>
                </div>
                <div className="bg-[#141c2e] rounded p-4 text-center">
                  <div className="text-[#a0b0c5] text-xs mb-1">{t('player.avgKDA')}</div>
                  <div className="text-white font-medium text-sm">{kda || '-'}</div>
                </div>
                <div className="bg-[#141c2e] rounded p-4 text-center">
                  <div className="text-[#a0b0c5] text-xs mb-1">{t('player.mainRole')}</div>
                  <div className="text-white font-medium text-sm">{roleLabels[marketValue.role] || '-'}</div>
                </div>
                {matches.length > 0 && (
                  <div className="bg-[#141c2e] rounded p-4 text-center">
                    <div className="text-[#a0b0c5] text-xs mb-1">DMG/Min</div>
                    <div className="text-white font-medium text-sm">
                      {Math.round(matches.reduce((s: number, m: any) => s + (m.gameDuration > 0 ? m.damageDealt / (m.gameDuration / 60) : 0), 0) / matches.length).toLocaleString(numLocale)}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Pro Accounts Box */}
            {proInfo && (proInfo.smurfs?.length || 0) > 0 && (
              <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4 sm:p-6 mb-4">
                <div className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">
                  Pro Accounts
                </div>
                <div className="space-y-2">
                  {/* Main Account */}
                  {proInfo.mainAccount && (
                    <div className="flex items-center gap-3 bg-[#141c2e] border border-[#c89b3c]/30 rounded p-3">
                      <div className="text-[10px] text-[#c89b3c] font-bold uppercase tracking-wider w-10 shrink-0">Main</div>
                      <a
                        href={`/player/${encodeURIComponent(proInfo.mainAccount.name)}--${encodeURIComponent(proInfo.mainAccount.tag)}?region=${proInfo.mainAccount.region === 'kr' ? 'kr' : proInfo.mainAccount.region === 'na' ? 'na1' : 'euw1'}`}
                        className="text-white hover:text-[#c89b3c] font-medium text-sm transition-colors"
                      >
                        {proInfo.mainAccount.name}<span className="text-[#7a8aa0]">#{proInfo.mainAccount.tag}</span>
                      </a>
                      {proInfo.mainAccount.rank && proInfo.mainAccount.rank !== 'Unknown' && proInfo.mainAccount.rank !== 'Unranked' && (
                        <span className="text-[#a0b0c5] text-xs ml-auto">{proInfo.mainAccount.rank}</span>
                      )}
                      <span className="text-[#7a8aa0] text-[10px] uppercase">{proInfo.mainAccount.region?.toUpperCase()}</span>
                    </div>
                  )}
                  {/* Smurf Accounts */}
                  {proInfo.smurfs?.slice(0, expandedSmurfs ? undefined : 5).map((smurf, i) => (
                    <div key={i} className="flex items-center gap-3 bg-[#141c2e] rounded p-3">
                      <div className="text-[10px] text-[#7a8aa0] font-bold uppercase tracking-wider w-10 shrink-0">Smurf</div>
                      <a
                        href={`/player/${encodeURIComponent(smurf.name)}--${encodeURIComponent(smurf.tag)}?region=${smurf.region === 'kr' ? 'kr' : smurf.region === 'na' ? 'na1' : 'euw1'}`}
                        className="text-[#a0b0c5] hover:text-white text-sm transition-colors"
                      >
                        {smurf.name}<span className="text-[#7a8aa0]">#{smurf.tag}</span>
                      </a>
                      {smurf.rank && smurf.rank !== 'Unknown' && smurf.rank !== 'Unranked' && (
                        <span className="text-[#7a8aa0] text-xs ml-auto">{smurf.rank}</span>
                      )}
                      <span className="text-[#7a8aa0] text-[10px] uppercase">{smurf.region?.toUpperCase()}</span>
                    </div>
                  ))}
                  {(proInfo.smurfs?.length || 0) > 5 && !expandedSmurfs && (
                    <button
                      onClick={() => setExpandedSmurfs(true)}
                      className="w-full text-center text-[#7a8aa0] hover:text-[#a0b0c5] text-xs py-2 transition-colors"
                    >
                      + {(proInfo.smurfs?.length || 0) - 5} weitere Accounts anzeigen
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Market Value Breakdown */}
            {marketValue.rated && marketValue.breakdown.length > 0 && (
              <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4 sm:p-6 mb-4">
                <div className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-4">
                  {t('player.marketBreakdown')}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                  <div className="bg-[#141c2e] rounded p-3 text-center">
                    <div className="text-[#a0b0c5] text-xs mb-1">{t('player.baseValue')} ({ranked ? formatRankedQueue(ranked) : '-'})</div>
                    <div className="text-white text-lg font-medium">
                      ${marketValue.baseValue.toLocaleString('de-DE')}
                    </div>
                  </div>
                  <div className="bg-[#141c2e] rounded p-3 text-center">
                    <div className="text-[#a0b0c5] text-xs mb-1">{t('player.multiplier')}</div>
                    <div className={`text-lg font-medium ${marketValue.multiplier >= 1 ? 'text-green-400' : 'text-red-400'}`}>
                      x{marketValue.multiplier.toFixed(3)}
                    </div>
                  </div>
                  <div className="bg-[#141c2e] rounded p-3 text-center">
                    <div className="text-[#a0b0c5] text-xs mb-1">{t('player.finalValue')}</div>
                    <div className="text-[#c89b3c] text-lg font-medium">{marketValue.formatted}</div>
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  {[...marketValue.breakdown]
                    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
                    .map((item: BreakdownItem, i: number) => (
                    <div key={i} className="flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-3 py-1.5 px-2 rounded hover:bg-[#141c2e]">
                      <div className="w-16 text-xs text-[#7a8aa0]">{item.category}</div>
                      <div className="w-full sm:w-36 text-xs text-white">{item.label}</div>
                      <div className="flex-1 h-2 bg-[#141c2e] rounded overflow-hidden min-w-[60px]">
                        {item.positive ? (
                          <div className="h-full bg-green-500/60 rounded" style={{ width: `${Math.min(Math.abs(item.impact) / 0.175 * 100, 100)}%` }} />
                        ) : (
                          <div className="h-full bg-red-500/60 rounded" style={{ width: `${Math.min(Math.abs(item.impact) / 0.175 * 100, 100)}%` }} />
                        )}
                      </div>
                      <div className={`w-14 text-xs font-medium text-right ${item.positive ? 'text-green-400' : 'text-red-400'}`}>
                        {item.positive ? '+' : ''}{(item.impact * 100).toFixed(1)}%
                      </div>
                      <div className="hidden sm:block w-36 text-xs text-[#a0b0c5] text-right">{item.stat}</div>
                    </div>
                  ))}
                </div>
                {marketValue.stats.gamesAnalyzed > 0 && (
                  <div className="mt-4 pt-3 border-t border-[#1e2a3a] grid grid-cols-3 sm:grid-cols-6 gap-2">
                    <div className="text-center">
                      <div className="text-[#a0b0c5] text-xs">{t('player.games')}</div>
                      <div className="text-white text-sm">{marketValue.stats.gamesAnalyzed}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[#a0b0c5] text-xs">Winrate</div>
                      <div className="text-white text-sm">{marketValue.stats.winrate.toFixed(1)}%</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[#a0b0c5] text-xs">KDA</div>
                      <div className="text-white text-sm">{marketValue.stats.kda.toFixed(2)}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[#a0b0c5] text-xs">CS/Min</div>
                      <div className="text-white text-sm">{marketValue.stats.csPerMin.toFixed(1)}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[#a0b0c5] text-xs">DMG/Min</div>
                      <div className="text-white text-sm">{marketValue.stats.damagePerMin.toFixed(0)}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[#a0b0c5] text-xs">Vision</div>
                      <div className="text-white text-sm">{marketValue.stats.visionScore.toFixed(1)}</div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Market Value History Chart */}
            {marketValue.rated && player?.summoner?.puuid && (
              <MarketValueChart puuid={player.summoner.puuid} currentValue={marketValue.value} />
            )}

            {/* AI Coach */}
            {matches.length > 0 && (
              <div className="mb-4">
                <AICoach
                  matches={matches}
                  tier={player?.ranked?.find((r: any) => r.queueType === 'RANKED_SOLO_5x5')?.tier || player?.summoner?.tier || player?.tier}
                  role={statsOverview?.role}
                />
              </div>
            )}

            {/* 20 Stat Categories */}
            {statsOverview && statsOverview.categories && statsOverview.categories.length > 0 && (
              <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-3 sm:p-6 mb-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-[#a0b0c5] text-xs uppercase tracking-widest">
                      {t('stats.title')}
                    </div>
                    <div className="text-[#7a8aa0] text-xs mt-1 truncate">
                      {t('stats.subtitle')} {statsOverview.gamesAnalyzed} {t('stats.games')}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[#a0b0c5] text-xs">{t('stats.overallScore')}</div>
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

            {/* Radar Stats */}
            {statsOverview?.categories?.length >= 4 && (
              <RadarStats categories={statsOverview.categories} />
            )}

            {/* Champion Mastery */}
            {masteries.length > 0 && (
              <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-3 sm:p-6 mb-4">
                <div className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-4">
                  Champion Mastery
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
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
                        <div className="text-[#a0b0c5] text-xs">{m.championPoints?.toLocaleString()} Punkte</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Live Game Detail */}
            {liveGame.inGame && liveGame.gameData && (
              <LiveGameDetail
                gameData={liveGame.gameData}
                ddVersion={ddVersion}
                championMap={championMap}
                region={region}
              />
            )}

            {/* Live Game unavailable notice (Spectator API requires Riot Production Key) */}
            {liveGameUnavailable && !liveGame.inGame && (
              <ApiUnavailable />
            )}

            {/* Performance Charts */}
            {matches.length > 0 && (
              <PerformanceCharts matches={matches} ddVersion={ddVersion} />
            )}

            {/* Champion Breakdown */}
            {matches.length > 0 && (
              <ChampionBreakdown matches={matches} ddVersion={ddVersion} />
            )}

            {/* Match History with Role Filter */}
            {matches.length > 0 && (
              <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-3 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                  <div className="text-[#a0b0c5] text-xs uppercase tracking-widest">
                    Match History ({t('player.lastGames')} {filteredMatches.length} {t('player.gamesLabel')})
                  </div>
                  {/* Role Filter */}
                  <div className="flex flex-wrap gap-1">
                    {availableRoles.map(r => (
                      <button
                        key={r}
                        onClick={() => setRoleFilter(r)}
                        className={`px-2.5 py-1 rounded text-xs transition-colors ${
                          roleFilter === r
                            ? 'bg-[#c89b3c]/20 text-[#c89b3c] border border-[#c89b3c]/30'
                            : 'text-[#7a8aa0] hover:text-[#a0b0c5]'
                        }`}
                      >
                        {r === 'all' ? 'Alle' : roleLabels[r] || r}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  {filteredMatches.map((match, i) => (
                    <MatchDetail
                      key={match.matchId || i}
                      match={match}
                      ddVersion={ddVersion}
                      isExpanded={expandedMatch === i}
                      onToggle={() => setExpandedMatch(expandedMatch === i ? null : i)}
                      formatDuration={formatDuration}
                      timeAgo={timeAgo}
                      getQueueName={getQueueName}
                      roleLabels={roleLabels}
                    />
                  ))}
                </div>
                {hasMoreMatches && roleFilter === 'all' && (
                  <button
                    onClick={loadMoreMatches}
                    disabled={loadingMore}
                    className="mt-4 w-full py-2.5 rounded bg-[#141c2e] border border-[#1e2a3a] text-[#a0b0c5] hover:text-white hover:border-[#c89b3c]/50 text-xs transition-colors disabled:opacity-50"
                  >
                    {loadingMore ? 'Lade...' : 'Mehr Matches laden'}
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {!player && !loading && (
          <div className="text-center text-[#7a8aa0] text-sm mt-12">
            {t('player.enterName')}
          </div>
        )}

        <Footer />
      </div>
    </main>
  );
}