'use client';
import { useState, useEffect } from 'react';

const TIERS = [
  { value: 'all', label: 'Alle Ränge' },
  { value: 'IRON', label: 'Iron' },
  { value: 'BRONZE', label: 'Bronze' },
  { value: 'SILVER', label: 'Silver' },
  { value: 'GOLD', label: 'Gold' },
  { value: 'PLATINUM', label: 'Platinum' },
  { value: 'EMERALD', label: 'Emerald' },
  { value: 'DIAMOND', label: 'Diamond' },
  { value: 'MASTER', label: 'Master' },
  { value: 'GRANDMASTER', label: 'Grandmaster' },
  { value: 'CHALLENGER', label: 'Challenger' },
];

const ROLES = [
  { value: 'all', label: 'Alle Rollen', icon: '⊕' },
  { value: 'top', label: 'Top', icon: '⊤' },
  { value: 'jungle', label: 'Jungle', icon: '⊙' },
  { value: 'mid', label: 'Mid', icon: '◆' },
  { value: 'adc', label: 'ADC', icon: '⊳' },
  { value: 'support', label: 'Support', icon: '✚' },
];

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

  useEffect(() => {
    fetchChampions();
  }, [tier, role]);

  const fetchChampions = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/champions?tier=${tier}&role=${role}`);
      const data = await res.json();
      if (data.champions) {
        setChampions(data.champions);
        setVersion(data.version);
        setHasStats(data.hasStats);
      }
    } catch {
      setChampions([]);
    }
    setLoading(false);
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
    IRON: '#6b6b6b',
    BRONZE: '#a0652a',
    SILVER: '#8fa0a8',
    GOLD: '#c89b3c',
    PLATINUM: '#209e85',
    EMERALD: '#00a86b',
    DIAMOND: '#576cce',
    MASTER: '#9d48e0',
    GRANDMASTER: '#e44040',
    CHALLENGER: '#f0c040',
  };

  const roleLabels: Record<string, string> = {
    TOP: 'Top',
    JUNGLE: 'Jungle',
    MIDDLE: 'Mid',
    BOTTOM: 'ADC',
    SUPPORT: 'Support',
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

  return (
    <main className="min-h-screen bg-[#080c18]">
      <nav className="bg-[#0a0e1a] border-b border-[#1e2a3a] px-6 py-3 flex items-center justify-between">
        <a href="/" className="text-[#c89b3c] text-lg font-medium">
          meta<span className="text-white">stats</span>.gg
        </a>
        <div className="flex gap-6">
          <a href="/" className="text-[#8a9bb0] text-sm hover:text-white">Spielersuche</a>
          <a href="/leaderboard" className="text-[#8a9bb0] text-sm hover:text-white">Rangliste</a>
          <a href="/champions" className="text-white text-sm">Champions</a>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-white text-2xl font-medium mb-1">Champion-Statistiken</h1>
          <p className="text-[#8a9bb0] text-sm">
            Winrate, Pickrate & Banrate aller Champions nach Rang
          </p>
        </div>

        {/* Filters */}
        <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4 mb-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Tier Filter */}
            <div>
              <div className="text-[#8a9bb0] text-xs mb-2">Rang</div>
              <div className="flex flex-wrap gap-1">
                {TIERS.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setTier(t.value)}
                    className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                      tier === t.value
                        ? 'bg-[#c89b3c] text-[#0a0e1a]'
                        : 'bg-[#141c2e] text-[#8a9bb0] hover:text-white hover:bg-[#1a2438]'
                    }`}
                    style={tier === t.value && t.value !== 'all' ? { backgroundColor: tierColors[t.value] || '#c89b3c' } : {}}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Role Filter */}
            <div>
              <div className="text-[#8a9bb0] text-xs mb-2">Rolle</div>
              <div className="flex gap-1">
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

            {/* Search */}
            <div className="ml-auto">
              <div className="text-[#8a9bb0] text-xs mb-2">Suche</div>
              <input
                type="text"
                placeholder="Champion suchen..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-[#141c2e] border border-[#2a3a50] rounded px-3 py-1.5 text-white text-xs outline-none placeholder-[#4a5a70] w-48"
              />
            </div>
          </div>
        </div>

        {/* Info Banner if no stats */}
        {!hasStats && !loading && (
          <div className="bg-[#141c2e] border border-[#2a3a50] rounded p-3 mb-4 text-center">
            <div className="text-[#8a9bb0] text-xs">
              Statistiken werden gesammelt, wenn Spieler gesucht werden. Suche Spieler um Daten aufzubauen.
            </div>
          </div>
        )}

        {/* Stats Summary */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-3 text-center">
            <div className="text-[#8a9bb0] text-xs">Champions</div>
            <div className="text-white text-xl font-medium">{sorted.length}</div>
          </div>
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-3 text-center">
            <div className="text-[#8a9bb0] text-xs">Rang</div>
            <div className="text-xl font-medium" style={{ color: tierColors[tier] || '#c89b3c' }}>
              {TIERS.find((t) => t.value === tier)?.label || 'Alle'}
            </div>
          </div>
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-3 text-center">
            <div className="text-[#8a9bb0] text-xs">Mit Daten</div>
            <div className="text-white text-xl font-medium">
              {sorted.filter((c) => c.games > 0).length}
            </div>
          </div>
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-3 text-center">
            <div className="text-[#8a9bb0] text-xs">Rolle</div>
            <div className="text-white text-xl font-medium">
              {ROLES.find((r) => r.value === role)?.label || 'Alle'}
            </div>
          </div>
        </div>

        {/* Champion Table */}
        <div className="bg-[#0d1526] border border-[#1e2a3a] rounded overflow-hidden">
          {/* Table Header */}
          <div className="grid grid-cols-[3rem_3rem_1fr_5rem_5rem_5rem_5rem_5rem_4rem] gap-2 px-4 py-3 border-b border-[#1e2a3a] bg-[#0a0e1a]">
            <div className="text-[#8a9bb0] text-xs uppercase tracking-wider">#</div>
            <div />
            <SortHeader label="Champion" sKey="name" />
            <div className="text-[#8a9bb0] text-xs uppercase tracking-wider">Rolle</div>
            <SortHeader label="Winrate" sKey="winRate" className="justify-end" />
            <SortHeader label="Pickrate" sKey="pickRate" className="justify-end" />
            <SortHeader label="Banrate" sKey="banRate" className="justify-end" />
            <SortHeader label="KDA" sKey="avgKDA" className="justify-end" />
            <SortHeader label="Spiele" sKey="games" className="justify-end" />
          </div>

          {loading ? (
            <div className="text-center text-[#8a9bb0] py-20">Lade Champion-Daten...</div>
          ) : sorted.length === 0 ? (
            <div className="text-center text-[#4a5a70] py-20">Keine Champions gefunden</div>
          ) : (
            <div className="divide-y divide-[#1e2a3a]/50">
              {sorted.map((champ, i) => {
                const winColor = champ.winRate === null ? 'text-[#4a5a70]'
                  : champ.winRate >= 53 ? 'text-green-400'
                  : champ.winRate >= 50 ? 'text-blue-400'
                  : champ.winRate >= 48 ? 'text-[#8a9bb0]'
                  : 'text-red-400';

                return (
                  <div
                    key={champ.key}
                    className="grid grid-cols-[3rem_3rem_1fr_5rem_5rem_5rem_5rem_5rem_4rem] gap-2 px-4 py-2 items-center hover:bg-[#141c2e] transition-colors"
                  >
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
                );
              })}
            </div>
          )}
        </div>

        {/* Tier Distribution Info */}
        <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4 mt-4">
          <div className="text-[#8a9bb0] text-xs uppercase tracking-widest mb-3">Rang-Verteilung</div>
          <div className="grid grid-cols-5 gap-2">
            {[
              { tier: 'Iron', pct: '5.6%', color: '#6b6b6b' },
              { tier: 'Bronze', pct: '19.0%', color: '#a0652a' },
              { tier: 'Silver', pct: '22.7%', color: '#8fa0a8' },
              { tier: 'Gold', pct: '24.1%', color: '#c89b3c' },
              { tier: 'Platinum', pct: '14.4%', color: '#209e85' },
              { tier: 'Emerald', pct: '9.1%', color: '#00a86b' },
              { tier: 'Diamond', pct: '3.5%', color: '#576cce' },
              { tier: 'Master', pct: '0.95%', color: '#9d48e0' },
              { tier: 'Grandmaster', pct: '0.04%', color: '#e44040' },
              { tier: 'Challenger', pct: '0.01%', color: '#f0c040' },
            ].map((t) => (
              <div key={t.tier} className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: t.color }} />
                <span className="text-xs" style={{ color: t.color }}>{t.tier}</span>
                <span className="text-[#4a5a70] text-xs ml-auto">{t.pct}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="text-center text-[#4a5a70] text-xs mt-8 pt-6 border-t border-[#1e2a3a]">
          metastats.gg · Nicht offiziell mit Riot Games verbunden · <a href="/datenschutz" className="hover:text-white">Datenschutz</a> · <a href="/impressum" className="hover:text-white">Impressum</a>
        </div>
      </div>
    </main>
  );
}
