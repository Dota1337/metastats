'use client';
import { useState, useEffect, useMemo } from 'react';
import Nav from '../components/Nav';
import Footer from '../components/Footer';
import PageHero from '../components/PageHero';
import { useI18n } from '../lib/i18n';
import { usePageTitle } from '../lib/use-page-title';

interface TeamResult {
  event: string;
  place: string | number;
  date: string;
  prizeUSD: number;
  trophy: string | null;
}

interface TeamSummary {
  id: string;
  name: string;
  short: string;
  region: string;
  logo: string | null;
  roster: any[];
  results: TeamResult[];
  trophies: { event: string; place: string; trophy: string; date: string }[];
  totalPrizeMoney: number;
}

type SortKey = 'prize' | 'name' | 'trophies' | 'seasonPrize' | 'roster';

const TROPHY_ICONS: Record<string, string> = {
  gold: '#f0c040',
  silver: '#c0c0c0',
  bronze: '#cd7f32',
};

const REGION_FILTERS = [
  { value: 'all', label: 'Alle' },
  { value: 'Korea', label: 'KR' },
  { value: 'China', label: 'CN' },
  { value: 'Europe', label: 'EU' },
  { value: 'North America', label: 'NA' },
  { value: 'Southeast Asia', label: 'SEA' },
  { value: 'Brazil', label: 'BR' },
  { value: 'Japan', label: 'JP' },
  { value: 'Turkey', label: 'TR' },
];

function getSeasonYears(teams: TeamSummary[]): string[] {
  const years = new Set<string>();
  for (const t of teams) {
    for (const r of t.results || []) {
      if (r.date) years.add(r.date.slice(0, 4));
    }
  }
  return ['all', ...Array.from(years).sort((a, b) => b.localeCompare(a))];
}

function getSeasonPrize(team: TeamSummary, season: string): number {
  if (season === 'all') return team.totalPrizeMoney;
  return (team.results || [])
    .filter(r => r.date?.startsWith(season))
    .reduce((s, r) => s + (r.prizeUSD || 0), 0);
}

export default function TeamsPage() {
  usePageTitle('pageTitle.teams');
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [regionFilter, setRegionFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('prize');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [season, setSeason] = useState('all');
  const { t } = useI18n();

  useEffect(() => {
    fetch('/pro-teams.json')
      .then(r => r.ok ? r.json() : { teams: [] })
      .then(data => { setTeams(data.teams || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const seasonYears = useMemo(() => getSeasonYears(teams), [teams]);

  const filtered = useMemo(() => {
    let result = teams.filter(t => {
      if (regionFilter !== 'all' && !t.region.toLowerCase().includes(regionFilter.toLowerCase())) return false;
      if (search && !t.name.toLowerCase().includes(search.toLowerCase()) && !t.short.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });

    result.sort((a, b) => {
      const dir = sortDir === 'desc' ? -1 : 1;
      switch (sortKey) {
        case 'prize':
          return (a.totalPrizeMoney - b.totalPrizeMoney) * dir;
        case 'name':
          return a.name.localeCompare(b.name) * dir;
        case 'trophies':
          return (a.trophies.length - b.trophies.length) * dir;
        case 'seasonPrize':
          return (getSeasonPrize(a, season) - getSeasonPrize(b, season)) * dir;
        case 'roster':
          return (a.roster.filter(m => m.isPlayer).length - b.roster.filter(m => m.isPlayer).length) * dir;
        default:
          return 0;
      }
    });

    return result;
  }, [teams, regionFilter, search, sortKey, sortDir, season]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
      if (key === 'seasonPrize' && season === 'all' && seasonYears.length > 1) {
        setSeason(seasonYears[1]); // default to latest year
      }
    }
  };

  const formatPrize = (v: number) => {
    if (v >= 1_000_000) return '$' + (v / 1_000_000).toFixed(2) + 'M';
    if (v >= 1_000) return '$' + (v / 1_000).toFixed(0) + 'k';
    if (v > 0) return '$' + v.toLocaleString('de-DE');
    return '-';
  };

  const SortBtn = ({ label, sKey }: { label: string; sKey: SortKey }) => (
    <button
      onClick={() => handleSort(sKey)}
      className={`px-3 py-1.5 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
        sortKey === sKey
          ? 'bg-[#c89b3c]/15 text-[#c89b3c] border border-[#c89b3c]/30'
          : 'bg-[#141c2e] text-[#8a9bb0] hover:text-white hover:bg-[#1a2438]'
      }`}
    >
      {label}
      {sortKey === sKey && (
        <span className="text-[10px]">{sortDir === 'desc' ? '\u25BC' : '\u25B2'}</span>
      )}
    </button>
  );

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav />

      <PageHero title={t('teams.title')} subtitle={t('teams.subtitle')} leftChampion="Jayce" rightChampion="Viktor" />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {/* Filters */}
        <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4 mb-4">
          <div className="flex flex-wrap items-start gap-4">
            <div>
              <div className="text-[#8a9bb0] text-xs mb-2">Region</div>
              <div className="flex flex-wrap gap-1">
                {REGION_FILTERS.map(r => (
                  <button
                    key={r.value}
                    onClick={() => setRegionFilter(r.value)}
                    className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                      regionFilter === r.value
                        ? 'bg-[#c89b3c] text-[#0a0e1a]'
                        : 'bg-[#141c2e] text-[#8a9bb0] hover:text-white hover:bg-[#1a2438]'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="sm:ml-auto">
              <div className="text-[#8a9bb0] text-xs mb-2">{t('teams.search')}</div>
              <input
                type="text"
                placeholder={t('teams.searchPlaceholder')}
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="bg-[#141c2e] border border-[#2a3a50] rounded px-3 py-1.5 text-white text-xs outline-none placeholder-[#4a5a70] w-48"
              />
            </div>
          </div>
        </div>

        {/* Sort controls */}
        <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4 mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-[#8a9bb0] text-xs mr-1">{t('teams.sort')}:</div>
            <SortBtn label={t('teams.prizeTotal')} sKey="prize" />
            <SortBtn label={t('teams.prizeSeason')} sKey="seasonPrize" />
            <SortBtn label={t('teams.trophies')} sKey="trophies" />
            <SortBtn label={t('teams.name')} sKey="name" />
            <SortBtn label={t('teams.roster')} sKey="roster" />

            {/* Season picker — shown when sorting by season */}
            {sortKey === 'seasonPrize' && (
              <div className="flex items-center gap-2 ml-2">
                <span className="text-[#4a5a70] text-xs">{t('teams.season')}:</span>
                <select
                  value={season}
                  onChange={e => setSeason(e.target.value)}
                  className="bg-[#141c2e] border border-[#2a3a50] rounded px-2 py-1 text-white text-xs outline-none"
                >
                  {seasonYears.map(y => (
                    <option key={y} value={y}>{y === 'all' ? t('teams.allSeasons') : y}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-3 text-center">
            <div className="text-[#8a9bb0] text-xs">{t('teams.count')}</div>
            <div className="text-white text-xl font-medium">{filtered.length}</div>
          </div>
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-3 text-center">
            <div className="text-[#8a9bb0] text-xs">{t('teams.withRoster')}</div>
            <div className="text-white text-xl font-medium">{filtered.filter(t => t.roster.length > 0).length}</div>
          </div>
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-3 text-center">
            <div className="text-[#8a9bb0] text-xs">{t('teams.withTitles')}</div>
            <div className="text-white text-xl font-medium">{filtered.filter(t => t.trophies.length > 0).length}</div>
          </div>
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-3 text-center">
            <div className="text-[#8a9bb0] text-xs">{t('teams.totalPrize')}</div>
            <div className="text-[#c89b3c] text-xl font-medium">{formatPrize(filtered.reduce((s, t) => s + t.totalPrizeMoney, 0))}</div>
          </div>
        </div>

        {/* Teams List */}
        {loading ? (
          <div className="text-center text-[#8a9bb0] py-20">{t('teams.loading')}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-[#4a5a70] py-20">{t('teams.noTeams')}</div>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map((team, idx) => {
              const players = team.roster.filter(m => m.isPlayer);
              const staff = team.roster.filter(m => !m.isPlayer);
              const seasonPrize = sortKey === 'seasonPrize' && season !== 'all' ? getSeasonPrize(team, season) : null;
              const goldCount = team.trophies.filter(t => t.trophy === 'gold').length;
              const silverCount = team.trophies.filter(t => t.trophy === 'silver').length;
              const bronzeCount = team.trophies.filter(t => t.trophy === 'bronze').length;

              return (
                <a
                  key={team.id}
                  href={`/teams/${team.id}`}
                  className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4 hover:border-[#c89b3c]/40 transition-colors group"
                >
                  <div className="flex items-center gap-3 sm:gap-4">
                    {/* Rank */}
                    <div className={`text-sm font-medium w-8 text-center flex-shrink-0 ${
                      idx === 0 ? 'text-yellow-400' : idx === 1 ? 'text-gray-300' : idx === 2 ? 'text-amber-600' : 'text-[#4a5a70]'
                    }`}>
                      {idx + 1}
                    </div>

                    {/* Logo */}
                    {team.logo ? (
                      <img src={team.logo} alt={team.short} className="w-10 h-10 rounded object-contain bg-[#141c2e] p-1 flex-shrink-0" />
                    ) : (
                      <div className="w-10 h-10 rounded bg-[#141c2e] flex items-center justify-center text-[#c89b3c] text-sm font-bold flex-shrink-0">
                        {team.short}
                      </div>
                    )}

                    {/* Name + Region */}
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-sm font-medium group-hover:text-[#c89b3c] transition-colors truncate">{team.name}</div>
                      <div className="text-[#4a5a70] text-xs">{team.region} · {players.length} {t('teams.players')}{staff.length > 0 ? ` · ${staff.length} ${t('team.staff')}` : ''}</div>
                    </div>

                    {/* Trophies compact */}
                    <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
                      {goldCount > 0 && (
                        <span className="flex items-center gap-0.5 text-xs" style={{ color: '#f0c040' }}>
                          <span className="text-sm">{'\u2605'}</span>{goldCount}
                        </span>
                      )}
                      {silverCount > 0 && (
                        <span className="flex items-center gap-0.5 text-xs" style={{ color: '#c0c0c0' }}>
                          <span className="text-sm">{'\u2606'}</span>{silverCount}
                        </span>
                      )}
                      {bronzeCount > 0 && (
                        <span className="flex items-center gap-0.5 text-xs" style={{ color: '#cd7f32' }}>
                          <span className="text-sm">{'\u25CF'}</span>{bronzeCount}
                        </span>
                      )}
                    </div>

                    {/* Prize */}
                    <div className="text-right flex-shrink-0">
                      <div className="text-[#c89b3c] text-sm font-medium">
                        {formatPrize(team.totalPrizeMoney)}
                      </div>
                      {seasonPrize !== null && seasonPrize > 0 && (
                        <div className="text-[#8a9bb0] text-xs">
                          {season}: {formatPrize(seasonPrize)}
                        </div>
                      )}
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        )}

        <Footer />
      </div>
    </main>
  );
}
