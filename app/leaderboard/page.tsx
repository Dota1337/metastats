'use client';
import { useState, useEffect } from 'react';
import Nav from '../components/Nav';
import Footer from '../components/Footer';
import PageHero from '../components/PageHero';
import { useI18n } from '../lib/i18n';

export default function Leaderboard() {
  const { t } = useI18n();

  const REGIONS = [
    { value: 'all', label: t('lb.allRegions') },
    { value: 'euw1', label: 'EUW' },
    { value: 'eun1', label: 'EUNE' },
    { value: 'na1', label: 'NA' },
    { value: 'kr', label: 'KR' },
  ];

  const TIERS = [
    { value: 'CHALLENGER', label: t('tier.challenger'), color: '#f0c040' },
    { value: 'GRANDMASTER', label: t('tier.grandmaster'), color: '#e44040' },
    { value: 'MASTER', label: t('tier.master'), color: '#9d48e0' },
  ];

  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [region, setRegion] = useState('all');
  const [tier, setTier] = useState('CHALLENGER');
  const [search, setSearch] = useState('');
  const [searchTimeout, setSearchTimeout] = useState<any>(null);
  const [source, setSource] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!search.trim()) {
      fetchLeaderboard();
    }
  }, [region, tier]);

  useEffect(() => {
    if (searchTimeout) clearTimeout(searchTimeout);
    if (search.trim().length >= 2) {
      const t = setTimeout(() => fetchSearch(search), 400);
      setSearchTimeout(t);
    } else if (!search.trim()) {
      fetchLeaderboard();
    }
  }, [search]);

  const fetchLeaderboard = async () => {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch(`/api/leaderboard?tier=${tier}&region=${region}`);
      const data = await res.json();
      setEntries(data.entries || []);
      setSource(data.source || '');
      setMessage(data.message || '');
    } catch {
      setEntries([]);
    }
    setLoading(false);
  };

  const fetchSearch = async (q: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/leaderboard?search=${encodeURIComponent(q)}&region=${region}`);
      const data = await res.json();
      setEntries(data.entries || []);
      setSource('search');
    } catch {
      setEntries([]);
    }
    setLoading(false);
  };

  const formatValue = (v: number | null) => {
    if (!v) return '-';
    return '$' + v.toLocaleString('de-DE');
  };

  const tierColor = TIERS.find(t => t.value === tier)?.color || '#c89b3c';

  const makePlayerLink = (name: string, playerRegion?: string) => {
    if (!name || name === 'Unbekannt') return '#';
    const parts = name.split('#');
    return '/player/' + encodeURIComponent(parts[0]) + '--' + encodeURIComponent(parts[1] || 'EUW') + '?region=' + (playerRegion || region || 'euw1');
  };

  return (
    <main className="min-h-screen bg-[#080c18]">
      <Nav active="leaderboard" />

      <PageHero title={t('lb.title')} subtitle={t('lb.subtitle')} leftChampion="Ahri" rightChampion="DrMundo">
        <div className="flex justify-center gap-1 mt-4">
          {REGIONS.map(r => (
            <button
              key={r.value}
              onClick={() => setRegion(r.value)}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                region === r.value ? 'bg-[#c89b3c] text-[#0a0e1a]' : 'bg-[#141c2e] text-[#8a9bb0] hover:text-white'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </PageHero>

      <div className="max-w-6xl mx-auto px-6 pb-8">
        {/* Search */}
        <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4 mb-4">
          <input
            type="text"
            placeholder={t('lb.searchPlaceholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-[#141c2e] border border-[#2a3a50] rounded px-4 py-2.5 text-white text-sm outline-none placeholder-[#4a5a70]"
          />
        </div>

        {/* Tier Tabs */}
        {!search.trim() && (
          <div className="flex gap-1 mb-4">
            {TIERS.map(t => (
              <button
                key={t.value}
                onClick={() => setTier(t.value)}
                className={`px-5 py-2.5 rounded text-sm font-medium transition-colors flex-1 ${
                  tier === t.value
                    ? 'text-[#0a0e1a]'
                    : 'bg-[#141c2e] text-[#8a9bb0] hover:text-white'
                }`}
                style={tier === t.value ? { backgroundColor: t.color } : {}}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {/* Search indicator */}
        {search.trim() && source === 'search' && (
          <div className="bg-[#141c2e] border border-[#2a3a50] rounded p-3 mb-4 flex items-center justify-between">
            <span className="text-[#8a9bb0] text-xs">
              {t('lb.searchResult')} "{search}" — {entries.length} {t('lb.playersFound')}
            </span>
            <button onClick={() => setSearch('')} className="text-[#c89b3c] text-xs hover:text-white">
              {t('lb.clearSearch')}
            </button>
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="text-center text-[#8a9bb0] py-20">{t('lb.loading')}</div>
        ) : message && entries.length === 0 ? (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-8 text-center">
            <div className="text-[#8a9bb0] text-sm mb-2">{message}</div>
            <div className="text-[#4a5a70] text-xs">
              {t('champ.statsCollecting')}
            </div>
          </div>
        ) : entries.length === 0 ? (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-8 text-center">
            <div className="text-[#8a9bb0] text-sm">{t('lb.noPlayers')}</div>
          </div>
        ) : (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded overflow-hidden">
            {/* Table Header */}
            <div className="grid grid-cols-[3rem_2.5rem_1fr_5rem_5rem_5rem_6rem] gap-3 px-4 py-2.5 border-b border-[#1e2a3a] bg-[#0a0e1a]">
              <div className="text-[#8a9bb0] text-xs">#</div>
              <div />
              <div className="text-[#8a9bb0] text-xs">{t('lb.player')}</div>
              <div className="text-[#8a9bb0] text-xs text-right">{t('player.rank')}</div>
              <div className="text-[#8a9bb0] text-xs text-right">{t('home.winrate')}</div>
              <div className="text-[#8a9bb0] text-xs text-right">{t('lb.region')}</div>
              <div className="text-[#8a9bb0] text-xs text-right">{t('lb.marketValue')}</div>
            </div>

            {/* Rows */}
            {entries.map((entry, i) => (
              <a
                key={i}
                href={makePlayerLink(entry.summonerName, entry.region)}
                className="grid grid-cols-[3rem_2.5rem_1fr_5rem_5rem_5rem_6rem] gap-3 px-4 py-3 border-b border-[#1e2a3a]/30 hover:bg-[#141c2e] transition-colors items-center"
              >
                <div className={`text-sm font-medium ${
                  entry.rank === 1 ? 'text-yellow-400' :
                  entry.rank === 2 ? 'text-gray-300' :
                  entry.rank === 3 ? 'text-amber-600' :
                  'text-[#4a5a70]'
                }`}>
                  {entry.rank}
                </div>
                <div>
                  {entry.profileIcon ? (
                    <img
                      src={`https://ddragon.leagueoflegends.com/cdn/14.1.1/img/profileicon/${entry.profileIcon}.png`}
                      alt=""
                      className="w-8 h-8 rounded-full border border-[#2a3a50]"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-[#1a2438] border border-[#2a3a50] flex items-center justify-center text-[#4a5a70] text-xs">
                      ?
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-white text-sm font-medium">{entry.summonerName}</div>
                  <div className="text-[#4a5a70] text-xs">Level {entry.level || '?'}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-medium" style={{ color: TIERS.find(t => t.value === entry.tier)?.color || '#8a9bb0' }}>
                    {entry.tier}
                  </div>
                  <div className="text-[#4a5a70] text-xs">{entry.playerRank}{entry.leaguePoints ? ` ${entry.leaguePoints}LP` : ''}</div>
                </div>
                <div className="text-right">
                  <span className={`text-sm font-medium ${
                    entry.winrate >= 55 ? 'text-green-400' :
                    entry.winrate >= 50 ? 'text-white' :
                    'text-red-400'
                  }`}>
                    {entry.winrate}%
                  </span>
                </div>
                <div className="text-[#8a9bb0] text-xs text-right">
                  {(entry.region || '').toUpperCase().replace('1', '')}
                </div>
                <div className="text-right">
                  <span className="text-[#c89b3c] text-sm font-medium">
                    {formatValue(entry.marketValue)}
                  </span>
                </div>
              </a>
            ))}
          </div>
        )}

        <Footer />
      </div>
    </main>
  );
}
