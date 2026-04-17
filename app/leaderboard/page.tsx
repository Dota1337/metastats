'use client';
import { useState, useEffect } from 'react';
import Nav from '../components/Nav';
import Footer from '../components/Footer';
import PageHero from '../components/PageHero';
import { useI18n, LOCALE_MAP } from '../lib/i18n';
import { usePageTitle } from '../lib/use-page-title';
import { loadProLookup, lookupPro, type ProPlayer } from '../lib/pro-players';

export default function Leaderboard() {
  usePageTitle('pageTitle.leaderboard');
  const { t, lang } = useI18n();
  const numLocale = LOCALE_MAP[lang];

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
    { value: 'CHALLENGER', label: t('tier.challenger'), color: '#f0c040' },
    { value: 'GRANDMASTER', label: t('tier.grandmaster'), color: '#e44040' },
    { value: 'MASTER', label: t('tier.master'), color: '#9d48e0' },
    { value: 'DIAMOND', label: t('tier.diamond'), color: '#576cce' },
    { value: 'EMERALD', label: t('tier.emerald'), color: '#00a86b' },
    { value: 'PLATINUM', label: t('tier.platinum'), color: '#209e85' },
    { value: 'GOLD', label: t('tier.gold'), color: '#c89b3c' },
    { value: 'SILVER', label: t('tier.silver'), color: '#8fa0a8' },
    { value: 'BRONZE', label: t('tier.bronze'), color: '#a0652a' },
    { value: 'IRON', label: t('tier.iron'), color: '#6b6b6b' },
  ];

  const APEX_TIERS = ['CHALLENGER', 'GRANDMASTER', 'MASTER'];
  const DIVISIONS = ['I', 'II', 'III', 'IV'];

  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [region, setRegion] = useState('euw1');
  const [tier, setTier] = useState('CHALLENGER');
  const [division, setDivision] = useState('I');
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [totalPlayers, setTotalPlayers] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [searchTimeout, setSearchTimeout] = useState<any>(null);
  const [source, setSource] = useState('');
  const [message, setMessage] = useState('');
  const [proLookup, setProLookup] = useState<Map<string, ProPlayer>>(new Map());

  useEffect(() => {
    loadProLookup().then(setProLookup);
  }, []);

  useEffect(() => {
    if (!search.trim()) {
      fetchLeaderboard();
    }
  }, [region, tier, division, page]);

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
      const divParam = !APEX_TIERS.includes(tier) ? `&division=${division}` : '';
      const res = await fetch(`/api/leaderboard?tier=${tier}&region=${region}${divParam}&page=${page}`);
      const data = await res.json();
      setEntries(data.entries || []);
      setSource(data.source || '');
      setMessage(data.message || '');
      setHasNextPage(data.hasNextPage || false);
      setTotalPlayers(data.totalPlayers || null);
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

  const pageSize = APEX_TIERS.includes(tier) ? 100 : 205;
  const totalPages = totalPlayers ? Math.ceil(totalPlayers / pageSize) : null;

  const PaginationBar = () => {
    if (search.trim() || entries.length === 0 || (page <= 1 && !hasNextPage)) return null;

    // Build page numbers to show: first, last, current +-2, with ellipsis
    const getVisiblePages = (): (number | '...')[] => {
      if (!totalPages || totalPages <= 7) {
        return Array.from({ length: totalPages || 1 }, (_, i) => i + 1);
      }
      const pages: (number | '...')[] = [];
      pages.push(1);
      if (page > 3) pages.push('...');
      for (let i = Math.max(2, page - 1); i <= Math.min((totalPages || 1) - 1, page + 1); i++) {
        pages.push(i);
      }
      if (page < (totalPages || 1) - 2) pages.push('...');
      pages.push(totalPages || 1);
      return pages;
    };

    return (
      <div className="flex items-center justify-center gap-2 bg-[#0d1526] border border-[#1e2a3a] rounded px-3 sm:px-4 py-3">
        <button
          onClick={() => setPage(p => Math.max(1, p - 1))}
          disabled={page <= 1}
          className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            page <= 1
              ? 'bg-[#141c2e] text-[#4a5a70] cursor-not-allowed'
              : 'bg-[#141c2e] text-[#8a9bb0] hover:text-white hover:bg-[#1a2438]'
          }`}
        >
          {t('team.prev')}
        </button>

        {/* Page numbers — desktop */}
        {totalPages && totalPages > 1 && (
          <div className="hidden sm:flex items-center gap-1">
            {getVisiblePages().map((p, i) =>
              p === '...' ? (
                <span key={`e${i}`} className="text-[#4a5a70] text-xs px-1">...</span>
              ) : (
                <button
                  key={p}
                  onClick={() => setPage(p as number)}
                  className={`min-w-[2rem] px-2 py-1 rounded text-xs font-medium transition-colors ${
                    page === p
                      ? 'bg-[#c89b3c]/15 text-[#c89b3c] border border-[#c89b3c]/30'
                      : 'text-[#8a9bb0] hover:text-white hover:bg-[#141c2e]'
                  }`}
                >
                  {p}
                </button>
              )
            )}
          </div>
        )}

        {/* Page dropdown */}
        <select
          value={page}
          onChange={e => setPage(Number(e.target.value))}
          className="bg-[#141c2e] border border-[#2a3a50] rounded px-2 py-1 text-white text-xs outline-none"
        >
          {Array.from({ length: totalPages || Math.max(page + 1, 1) }, (_, i) => i + 1).map(p => (
            <option key={p} value={p}>{t('team.page')} {p}</option>
          ))}
        </select>

        {totalPlayers && (
          <span className="text-[#4a5a70] text-xs hidden sm:inline">({totalPlayers.toLocaleString(numLocale)})</span>
        )}

        <button
          onClick={() => setPage(p => p + 1)}
          disabled={!hasNextPage}
          className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            !hasNextPage
              ? 'bg-[#141c2e] text-[#4a5a70] cursor-not-allowed'
              : 'bg-[#141c2e] text-[#8a9bb0] hover:text-white hover:bg-[#1a2438]'
          }`}
        >
          {t('team.next')}
        </button>
      </div>
    );
  };

  const makePlayerLink = (name: string | null, playerRegion?: string) => {
    if (!name) return '#';
    const parts = name.split('#');
    return '/player/' + encodeURIComponent(parts[0]) + '--' + encodeURIComponent(parts[1] || 'EUW') + '?region=' + (playerRegion || region || 'euw1');
  };

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="leaderboard" />

      <PageHero title={t('lb.title')} subtitle={t('lb.subtitle')} leftChampion="Ahri" rightChampion="DrMundo">
        <div className="flex justify-center gap-1 mt-4 flex-wrap px-2">
          {REGIONS.map(r => (
            <button
              key={r.value}
              onClick={() => { setRegion(r.value); setPage(1); }}
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
          <div className="flex flex-wrap gap-1 mb-4">
            {TIERS.map(tr => {
              const isApex = APEX_TIERS.includes(tr.value);
              const isActive = tier === tr.value;
              const isDropdownOpen = openDropdown === tr.value;

              return (
                <div key={tr.value} className="relative">
                  <button
                    onClick={() => {
                      if (tier !== tr.value) setPage(1);
                      setTier(tr.value);
                      if (!isApex) {
                        setOpenDropdown(isDropdownOpen ? null : tr.value);
                        if (!isActive) { setDivision('I'); setPage(1); }
                      } else {
                        setOpenDropdown(null);
                      }
                    }}
                    className={`px-3 py-2 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                      isActive
                        ? 'text-[#0a0e1a]'
                        : 'bg-[#141c2e] text-[#8a9bb0] hover:text-white'
                    }`}
                    style={isActive ? { backgroundColor: tr.color } : {}}
                  >
                    {tr.label}
                    {!isApex && isActive && (
                      <span className="text-[10px] opacity-70">{division}</span>
                    )}
                    {!isApex && (
                      <svg className={`w-3 h-3 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    )}
                  </button>

                  {/* Division Dropdown */}
                  {!isApex && isDropdownOpen && (
                    <div className="absolute top-full left-0 mt-1 z-20 bg-[#0d1526] border border-[#1e2a3a] rounded shadow-lg overflow-hidden min-w-[80px]">
                      {DIVISIONS.map(div => (
                        <button
                          key={div}
                          onClick={() => {
                            setTier(tr.value);
                            setDivision(div);
                            setPage(1);
                            setOpenDropdown(null);
                          }}
                          className={`w-full px-3 py-1.5 text-xs text-left transition-colors ${
                            tier === tr.value && division === div
                              ? 'text-[#0a0e1a] font-medium'
                              : 'text-[#8a9bb0] hover:text-white hover:bg-[#141c2e]'
                          }`}
                          style={tier === tr.value && division === div ? { backgroundColor: tr.color } : {}}
                        >
                          {tr.label} {div}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
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

        {/* Pagination Top */}
        {!loading && <div className="mb-2"><PaginationBar /></div>}

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
            {/* Table Header — Desktop */}
            <div className="hidden md:grid grid-cols-[3rem_2.5rem_1fr_5rem_4rem_5rem_5rem_6rem] gap-3 px-4 py-2.5 border-b border-[#1e2a3a] bg-[#0a0e1a]">
              <div className="text-[#8a9bb0] text-xs">#</div>
              <div />
              <div className="text-[#8a9bb0] text-xs">{t('lb.player')}</div>
              <div className="text-[#8a9bb0] text-xs text-right">LP</div>
              <div className="text-[#8a9bb0] text-xs text-right">W/L</div>
              <div className="text-[#8a9bb0] text-xs text-right">{t('home.winrate')}</div>
              <div className="text-[#8a9bb0] text-xs text-right">{t('lb.region')}</div>
              <div className="text-[#8a9bb0] text-xs text-right">{t('lb.marketValue')}</div>
            </div>

            {/* Rows */}
            {entries.map((entry, i) => (
              <a
                key={i}
                href={makePlayerLink(entry.summonerName, entry.region)}
                className="block md:grid md:grid-cols-[3rem_2.5rem_1fr_5rem_4rem_5rem_5rem_6rem] gap-3 px-4 py-3 border-b border-[#1e2a3a]/30 hover:bg-[#141c2e] transition-colors items-center"
              >
                {/* Mobile layout */}
                <div className="md:hidden flex items-center gap-3">
                  <div className={`text-sm font-medium w-6 flex-shrink-0 ${
                    entry.rank === 1 ? 'text-yellow-400' :
                    entry.rank === 2 ? 'text-gray-300' :
                    entry.rank === 3 ? 'text-amber-600' :
                    'text-[#4a5a70]'
                  }`}>
                    {entry.rank}
                  </div>
                  {entry.profileIcon ? (
                    <img
                      src={`https://ddragon.leagueoflegends.com/cdn/14.1.1/img/profileicon/${entry.profileIcon}.png`}
                      alt=""
                      className="w-8 h-8 rounded-full border border-[#2a3a50] flex-shrink-0"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-[#1a2438] border border-[#2a3a50] flex items-center justify-center text-[#4a5a70] text-xs flex-shrink-0">?</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm font-medium flex items-center gap-1.5 truncate">
                      {entry.summonerName || <span className="text-[#4a5a70]">#{entry.rank}</span>}
                      {entry.summonerName && lookupPro(proLookup, entry.summonerName) && (
                        <span className="inline-flex items-center bg-[#c89b3c]/15 text-[#c89b3c] text-[10px] font-bold px-1.5 py-0 rounded-full border border-[#c89b3c]/40 leading-4">PRO</span>
                      )}
                    </div>
                    <div className="text-[#4a5a70] text-xs">{entry.leaguePoints != null ? entry.leaguePoints + ' LP' : ''} · {entry.winrate}%</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className="text-[#c89b3c] text-sm font-medium">{formatValue(entry.marketValue)}</span>
                  </div>
                </div>
                {/* Desktop layout */}
                <div className="hidden md:contents">
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
                    <div className="text-white text-sm font-medium flex items-center gap-1.5">
                      {entry.summonerName || <span className="text-[#4a5a70]">{t('lb.unknownPlayer')} #{entry.rank}</span>}
                      {entry.summonerName && lookupPro(proLookup, entry.summonerName) && (
                        <span className="inline-flex items-center bg-[#c89b3c]/15 text-[#c89b3c] text-[10px] font-bold px-1.5 py-0 rounded-full border border-[#c89b3c]/40 leading-4">
                          PRO
                        </span>
                      )}
                    </div>
                    {entry.summonerName && (() => {
                      const pro = lookupPro(proLookup, entry.summonerName);
                      return pro
                        ? <div className="text-[#c89b3c] text-xs">{pro.proName} · {pro.team}</div>
                        : <div className="text-[#4a5a70] text-xs">Level {entry.level || '?'}</div>;
                    })()}
                  </div>
                  <div className="text-right">
                    <div className="text-[#c89b3c] text-sm font-medium">
                      {entry.leaguePoints != null ? entry.leaguePoints : '-'} LP
                    </div>
                    {entry.playerRank && !['CHALLENGER', 'GRANDMASTER', 'MASTER'].includes(entry.tier) && (
                      <div className="text-[#4a5a70] text-xs">{entry.tier} {entry.playerRank}</div>
                    )}
                  </div>
                  <div className="text-[#8a9bb0] text-xs text-right">
                    {entry.wins != null ? `${entry.wins}W ${entry.losses}L` : '-'}
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
                </div>
              </a>
            ))}
          </div>
        )}

        {/* Pagination Bottom */}
        <div className="mt-2"><PaginationBar /></div>

        <Footer />
      </div>
    </main>
  );
}
