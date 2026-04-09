'use client';
import { useState, useEffect } from 'react';
import Nav from '../components/Nav';
import Footer from '../components/Footer';
import PageHero from '../components/PageHero';
import { useI18n } from '../lib/i18n';

type SortKey = 'name' | 'winRate' | 'pickRate' | 'banRate' | 'games' | 'avgKDA';

interface Champion {
  id: string;
  key: string;
  name: string;
  title: string;
  tags: string[];
  image: string;
  role: string;
  winRate: number | null;
  pickRate: number | null;
  banRate: number | null;
  games: number;
  avgKDA: number | null;
}

export default function ChampionsPage() {
  const [champions, setChampions] = useState<Champion[]>([]);
  const [loading, setLoading] = useState(true);
  const [tier, setTier] = useState('all');
  const [role, setRole] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [version, setVersion] = useState('');
  const [hasStats, setHasStats] = useState(false);
  const [search, setSearch] = useState('');
  const [region, setRegion] = useState('euw1');
  const [collecting, setCollecting] = useState(false);
  const { t } = useI18n();

  const REGIONS = [
    { value: 'euw1', label: 'EUW' },
    { value: 'eun1', label: 'EUNE' },
    { value: 'na1', label: 'NA' },
    { value: 'kr', label: 'KR' },
    { value: 'br1', label: 'BR' },
    { value: 'la1', label: 'LAN' },
    { value: 'la2', label: 'LAS' },
    { value: 'oc1', label: 'OCE' },
    { value: 'tr1', label: 'TR' },
    { value: 'ru', label: 'RU' },
    { value: 'jp1', label: 'JP' },
    { value: 'ph2', label: 'PH' },
    { value: 'sg2', label: 'SG' },
    { value: 'th2', label: 'TH' },
    { value: 'tw2', label: 'TW' },
    { value: 'vn2', label: 'VN' },
    { value: 'me1', label: 'ME' },
  ];

  const TIERS = [
    { value: 'all', label: t('tier.all') },
    { value: 'IRON', label: t('tier.iron') },
    { value: 'BRONZE', label: t('tier.bronze') },
    { value: 'SILVER', label: t('tier.silver') },
    { value: 'GOLD', label: t('tier.gold') },
    { value: 'PLATINUM', label: t('tier.platinum') },
    { value: 'EMERALD', label: t('tier.emerald') },
    { value: 'DIAMOND', label: t('tier.diamond') },
    { value: 'MASTER', label: t('tier.master') },
    { value: 'GRANDMASTER', label: t('tier.grandmaster') },
    { value: 'CHALLENGER', label: t('tier.challenger') },
  ];

  const ROLES = [
    { value: 'all', label: t('role.all') },
    { value: 'top', label: t('role.top') },
    { value: 'jungle', label: t('role.jungle') },
    { value: 'mid', label: t('role.mid') },
    { value: 'adc', label: t('role.adc') },
    { value: 'support', label: t('role.support') },
  ];

  useEffect(() => {
    fetchChampions();
  }, [tier, role, region]);

  const fetchChampions = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/champions?tier=${tier}&role=${role}&region=${region}`);
      const data = await res.json();
      if (data.champions) {
        setChampions(data.champions);
        setVersion(data.version);
        setHasStats(data.hasStats);
      }
      // If no stats, trigger collection in background
      if (!data.hasStats) {
        triggerCollection();
      }
    } catch {
      setChampions([]);
    }
    setLoading(false);
  };

  const triggerCollection = async () => {
    setCollecting(true);
    try {
      const res = await fetch(`/api/champions/collect?region=${region}`);
      if (res.ok) {
        // Re-fetch champions with the new data
        const champRes = await fetch(`/api/champions?tier=${tier}&role=${role}&region=${region}`);
        const data = await champRes.json();
        if (data.champions) {
          setChampions(data.champions);
          setVersion(data.version);
          setHasStats(data.hasStats);
        }
      }
    } catch {
      // silent fail
    }
    setCollecting(false);
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };

  const sorted = [...champions]
    .filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortKey === 'name') return a.name.localeCompare(b.name) * dir;
      const av = a[sortKey] ?? -1;
      const bv = b[sortKey] ?? -1;
      return ((av as number) - (bv as number)) * dir;
    });

  const tierColors: Record<string, string> = {
    IRON: '#6b6b6b', BRONZE: '#a0652a', SILVER: '#8fa0a8', GOLD: '#c89b3c',
    PLATINUM: '#209e85', EMERALD: '#00a86b', DIAMOND: '#576cce',
    MASTER: '#9d48e0', GRANDMASTER: '#e44040', CHALLENGER: '#f0c040',
  };

  const roleLabels: Record<string, string> = {
    TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'ADC', SUPPORT: 'Support',
  };

  const SortHeader = ({ label, sKey, className }: { label: string; sKey: SortKey; className?: string }) => (
    <button
      onClick={() => handleSort(sKey)}
      className={`text-xs uppercase tracking-wider hover:text-white transition-colors flex items-center gap-1 ${className || ''} ${sortKey === sKey ? 'text-[#c89b3c]' : 'text-[#8a9bb0]'}`}
    >
      {label}
      {sortKey === sKey && (
        <span className="text-[10px]">{sortDir === 'asc' ? '▲' : '▼'}</span>
      )}
    </button>
  );

  const currentTierLabel = TIERS.find((tr) => tr.value === tier)?.label || t('tier.all');
  const currentRoleLabel = ROLES.find((r) => r.value === role)?.label || t('role.all');

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="champions" />

      <PageHero title={t('champ.title')} subtitle={t('champ.subtitle')} leftChampion="Lux" rightChampion="Teemo" />

      <div className="max-w-6xl mx-auto px-3 sm:px-6 pb-8">
        {/* Filters */}
        <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-3 sm:p-4 mb-4">
          <div className="flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center gap-3 sm:gap-4">
            {/* Tier Filter */}
            <div className="w-full sm:w-auto">
              <div className="text-[#8a9bb0] text-xs mb-2">{t('champ.rank')}</div>
              <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1">
                {TIERS.map((tr) => (
                  <button
                    key={tr.value}
                    onClick={() => setTier(tr.value)}
                    className={`px-3 py-1.5 rounded text-xs font-medium transition-colors flex-shrink-0 ${
                      tier === tr.value
                        ? 'bg-[#c89b3c] text-[#0a0e1a]'
                        : 'bg-[#141c2e] text-[#8a9bb0] hover:text-white hover:bg-[#1a2438]'
                    }`}
                    style={tier === tr.value && tr.value !== 'all' ? { backgroundColor: tierColors[tr.value] || '#c89b3c' } : {}}
                  >
                    {tr.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Role Filter */}
            <div className="w-full sm:w-auto">
              <div className="text-[#8a9bb0] text-xs mb-2">{t('champ.role')}</div>
              <div className="flex gap-1 overflow-x-auto pb-1">
                {ROLES.map((r) => (
                  <button
                    key={r.value}
                    onClick={() => setRole(r.value)}
                    className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                      role === r.value
                        ? 'bg-[#c89b3c] text-[#0a0e1a]'
                        : 'bg-[#141c2e] text-[#8a9bb0] hover:text-white hover:bg-[#1a2438]'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Region Filter */}
            <div className="w-full sm:w-auto">
              <div className="text-[#8a9bb0] text-xs mb-2">{t('champ.regionLabel')}</div>
              <div className="flex gap-1 overflow-x-auto pb-1">
                {REGIONS.map((r) => (
                  <button
                    key={r.value}
                    onClick={() => setRegion(r.value)}
                    className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                      region === r.value
                        ? 'bg-[#c89b3c] text-[#0a0e1a]'
                        : 'bg-[#141c2e] text-[#8a9bb0] hover:text-white hover:bg-[#1a2438]'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Search */}
            <div className="w-full sm:w-auto sm:ml-auto">
              <div className="text-[#8a9bb0] text-xs mb-2">{t('champ.search')}</div>
              <input
                type="text"
                placeholder={t('champ.searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-[#141c2e] border border-[#2a3a50] rounded px-3 py-1.5 text-white text-xs outline-none placeholder-[#4a5a70] w-full sm:w-48"
              />
            </div>
          </div>
        </div>

        {/* Info: no data for selected tier */}
        {tier !== 'all' && !loading && !hasStats && (
          <div className="bg-[#141c2e] border border-[#2a3a50] rounded p-3 mb-4 text-center">
            <div className="text-[#8a9bb0] text-xs">
              {t('champ.noDataFor')} <span className="text-white font-medium" style={{ color: tierColors[tier] }}>{currentTierLabel}</span> {t('champ.noDataAvailable')}
            </div>
          </div>
        )}

        {/* Info Banner if no stats at all */}
        {tier === 'all' && !hasStats && !loading && (
          <div className="bg-[#141c2e] border border-[#2a3a50] rounded p-3 mb-4 text-center">
            {collecting ? (
              <div className="flex items-center justify-center gap-2">
                <div className="w-3 h-3 border-2 border-[#c89b3c] border-t-transparent rounded-full animate-spin" />
                <div className="text-[#c89b3c] text-xs">{t('champ.loadFromApi')} ({REGIONS.find(r => r.value === region)?.label})...</div>
              </div>
            ) : (
              <div className="text-[#8a9bb0] text-xs">
                {t('champ.statsCollecting')}
                <button onClick={triggerCollection} className="ml-2 text-[#c89b3c] hover:underline">
                  {t('champ.loadNow')}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Stats Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-3 text-center">
            <div className="text-[#8a9bb0] text-xs">{t('nav.champions')}</div>
            <div className="text-white text-xl font-medium">{sorted.length}</div>
          </div>
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-3 text-center">
            <div className="text-[#8a9bb0] text-xs">{t('champ.rank')}</div>
            <div className="text-xl font-medium" style={{ color: tierColors[tier] || '#c89b3c' }}>
              {currentTierLabel}
            </div>
          </div>
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-3 text-center">
            <div className="text-[#8a9bb0] text-xs">{t('champ.withData')}</div>
            <div className="text-white text-xl font-medium">
              {sorted.filter((c) => c.games > 0).length}
            </div>
          </div>
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-3 text-center">
            <div className="text-[#8a9bb0] text-xs">{t('champ.role')}</div>
            <div className="text-white text-xl font-medium">{currentRoleLabel}</div>
          </div>
        </div>

        {/* Champion Table */}
        <div className="bg-[#0d1526] border border-[#1e2a3a] rounded overflow-hidden">
          {/* Table Header — Desktop */}
          <div className="hidden md:grid grid-cols-[3rem_3rem_1fr_5rem_5rem_5rem_5rem_5rem_4rem] gap-2 px-4 py-3 border-b border-[#1e2a3a] bg-[#0a0e1a]">
            <div className="text-[#8a9bb0] text-xs uppercase tracking-wider">#</div>
            <div />
            <SortHeader label={t('champ.champion')} sKey="name" />
            <div className="text-[#8a9bb0] text-xs uppercase tracking-wider">{t('champ.role')}</div>
            <SortHeader label="Winrate" sKey="winRate" className="justify-end" />
            <SortHeader label="Pickrate" sKey="pickRate" className="justify-end" />
            <SortHeader label="Banrate" sKey="banRate" className="justify-end" />
            <SortHeader label="KDA" sKey="avgKDA" className="justify-end" />
            <SortHeader label={t('champ.games')} sKey="games" className="justify-end" />
          </div>
          {/* Mobile sort buttons */}
          <div className="md:hidden flex flex-wrap gap-1 px-3 py-2 border-b border-[#1e2a3a] bg-[#0a0e1a]">
            <SortHeader label="Name" sKey="name" />
            <SortHeader label="WR" sKey="winRate" />
            <SortHeader label="Pick" sKey="pickRate" />
            <SortHeader label="Ban" sKey="banRate" />
            <SortHeader label="KDA" sKey="avgKDA" />
          </div>

          {loading ? (
            <div className="text-center text-[#8a9bb0] py-20">{t('champ.loading')}</div>
          ) : sorted.length === 0 ? (
            <div className="text-center text-[#4a5a70] py-20">{t('champ.noChampions')}</div>
          ) : (
            <div className="divide-y divide-[#1e2a3a]/50">
              {sorted.map((champ, i) => {
                const winColor = champ.winRate === null ? 'text-[#4a5a70]'
                  : champ.winRate >= 53 ? 'text-green-400'
                  : champ.winRate >= 50 ? 'text-blue-400'
                  : champ.winRate >= 48 ? 'text-[#8a9bb0]'
                  : 'text-red-400';

                return (
                  <a
                    key={champ.key}
                    href={`/champions/${champ.id}`}
                    className="block md:grid md:grid-cols-[3rem_3rem_1fr_5rem_5rem_5rem_5rem_5rem_4rem] gap-2 px-4 py-2 items-center hover:bg-[#141c2e] transition-colors"
                  >
                    {/* Mobile layout */}
                    <div className="md:hidden flex items-center gap-3">
                      <span className="text-[#4a5a70] text-xs w-6">{i + 1}</span>
                      <img
                        src={`https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${champ.id}.png`}
                        alt={champ.name}
                        className="w-8 h-8 rounded"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-white text-sm font-medium">{champ.name}</div>
                        <div className="text-[#4a5a70] text-xs">{roleLabels[champ.role] || champ.tags.join(', ')}</div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className={`text-sm font-medium ${winColor}`}>
                          {champ.winRate !== null ? `${champ.winRate}%` : '-'}
                        </div>
                        <div className="text-[#4a5a70] text-xs">{champ.games > 0 ? champ.games.toLocaleString() + ' G' : '-'}</div>
                      </div>
                    </div>
                    {/* Desktop layout */}
                    <div className="hidden md:contents">
                      <div className="text-[#4a5a70] text-sm">{i + 1}</div>
                      <img
                        src={`https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${champ.id}.png`}
                        alt={champ.name}
                        className="w-8 h-8 rounded"
                      />
                      <div>
                        <div className="text-white text-sm font-medium">{champ.name}</div>
                        <div className="text-[#4a5a70] text-xs">{champ.tags.join(', ')}</div>
                      </div>
                      <div className="text-[#8a9bb0] text-xs">{roleLabels[champ.role] || '-'}</div>
                      <div className={`text-sm text-right font-medium ${winColor}`}>
                        {champ.winRate !== null ? `${champ.winRate}%` : '-'}
                      </div>
                      <div className="text-[#8a9bb0] text-sm text-right">
                        {champ.pickRate !== null ? `${champ.pickRate}%` : '-'}
                      </div>
                      <div className="text-sm text-right" style={{ color: champ.banRate !== null && champ.banRate > 10 ? '#e44040' : '#8a9bb0' }}>
                        {champ.banRate !== null ? `${champ.banRate}%` : '-'}
                      </div>
                      <div className="text-[#8a9bb0] text-sm text-right">
                        {champ.avgKDA !== null ? champ.avgKDA.toFixed(2) : '-'}
                      </div>
                      <div className="text-[#4a5a70] text-xs text-right">
                        {champ.games > 0 ? champ.games.toLocaleString() : '-'}
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </div>

        {/* Tier Distribution Chart */}
        <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4 mt-4">
          <div className="text-[#8a9bb0] text-xs uppercase tracking-widest mb-4">{t('champ.rankDistribution')}</div>
          <div className="flex items-end gap-2 h-40 mb-3">
            {[
              { tier: 'Iron', pct: 5.6, color: '#6b6b6b' },
              { tier: 'Bronze', pct: 19.0, color: '#a0652a' },
              { tier: 'Silver', pct: 22.7, color: '#8fa0a8' },
              { tier: 'Gold', pct: 24.1, color: '#c89b3c' },
              { tier: 'Plat', pct: 14.4, color: '#209e85' },
              { tier: 'Emerald', pct: 9.1, color: '#00a86b' },
              { tier: 'Dia', pct: 3.5, color: '#576cce' },
              { tier: 'Master', pct: 0.95, color: '#9d48e0' },
              { tier: 'GM', pct: 0.04, color: '#e44040' },
              { tier: 'Chall', pct: 0.01, color: '#f0c040' },
            ].map((item) => {
              const maxPct = 24.1;
              const barHeight = Math.max((item.pct / maxPct) * 100, 2);
              return (
                <div key={item.tier} className="flex-1 flex flex-col items-center gap-1">
                  <div className="text-[10px] font-medium" style={{ color: item.color }}>
                    {item.pct >= 1 ? item.pct.toFixed(1) + '%' : item.pct + '%'}
                  </div>
                  <div className="w-full relative" style={{ height: '120px' }}>
                    <div
                      className="absolute bottom-0 w-full rounded-t transition-all duration-500"
                      style={{
                        height: `${barHeight}%`,
                        backgroundColor: item.color,
                        opacity: 0.7,
                        boxShadow: `0 0 8px ${item.color}40`,
                      }}
                    />
                  </div>
                  <div className="text-[10px] text-center" style={{ color: item.color }}>
                    {item.tier}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="text-[#4a5a70] text-xs text-center mt-2">
            Ranked-Verteilung aller Spieler (EUW, Saison 2025)
          </div>
        </div>

        <Footer />
      </div>
    </main>
  );
}
