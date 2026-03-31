'use client';
import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import { useI18n } from '../../lib/i18n';

const TROPHY_COLORS: Record<string, string> = {
  gold: '#f0c040',
  silver: '#c0c0c0',
  bronze: '#cd7f32',
};

const ROLE_ICONS: Record<string, string> = {
  Top: '\u2191',      // ↑
  Jungle: '\u2726',   // ✦
  Mid: '\u25C6',      // ◆
  ADC: '\u2694',      // ⚔
  Support: '\u271A',  // ✚
  Coach: '\u{1F4CB}', // clipboard
  Analyst: '\u{1F4CA}', // chart
  Manager: '\u{1F464}', // person
};

export default function TeamDetailPage() {
  const { id } = useParams();
  const { t } = useI18n();
  const [team, setTeam] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/pro-teams.json')
      .then(r => r.ok ? r.json() : { teams: [] })
      .then(data => {
        const found = (data.teams || []).find((t: any) => t.id === id);
        setTeam(found || null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <main className="min-h-screen bg-[#0e1525]">
        <Nav />
        <div className="text-center text-[#8a9bb0] py-20">{t('teams.loading')}</div>
      </main>
    );
  }

  if (!team) {
    return (
      <main className="min-h-screen bg-[#0e1525]">
        <Nav />
        <div className="max-w-4xl mx-auto px-6 py-20 text-center">
          <div className="text-red-400 text-xl mb-4">{t('team.notFound')}</div>
          <a href="/teams" className="text-[#c89b3c] text-sm hover:underline">&larr; {t('team.allTeams')}</a>
        </div>
      </main>
    );
  }

  const mainPlayers = (team.roster || []).filter((m: any) => m.status === 'main');
  const subs = (team.roster || []).filter((m: any) => m.status === 'sub');
  const staff = (team.roster || []).filter((m: any) => !m.isPlayer && m.status !== 'main' && m.status !== 'sub');

  const TEAM_REGION_MAP: Record<string, string> = {
    'Korea': 'kr', 'China': 'kr', // CN not available via Riot API, use KR as closest
    'Europe': 'euw1', 'North America': 'na1', 'Brazil': 'br1',
    'Japan': 'jp1', 'Turkey': 'tr1', 'Oceania': 'oc1',
    'Latin America North': 'la1', 'Latin America South': 'la2',
    'Southeast Asia': 'sg2', 'Taiwan': 'tw2', 'Vietnam': 'vn2',
    'Philippines': 'ph2', 'Thailand': 'th2', 'Russia': 'ru',
  };
  const DEFAULT_TAGS: Record<string, string> = {
    'kr': 'KR1', 'euw1': 'EUW', 'na1': 'NA1', 'br1': 'BR1',
    'jp1': 'JP1', 'tr1': 'TR1', 'oc1': 'OC1', 'la1': 'LAN',
    'la2': 'LAS', 'sg2': 'SG2', 'tw2': 'TW2', 'vn2': 'VN2',
    'ph2': 'PH2', 'th2': 'TH2', 'ru': 'RU',
  };
  const teamRiotRegion = TEAM_REGION_MAP[team.region] || 'euw1';

  const makePlayerLink = (m: any) => {
    if (!m.riotId) return null;
    const parts = m.riotId.split('#');
    const name = parts[0];
    const tag = parts[1] || DEFAULT_TAGS[teamRiotRegion] || 'EUW';
    return `/player/${encodeURIComponent(name)}--${encodeURIComponent(tag)}?region=${teamRiotRegion}`;
  };
  const formatPrize = (v: number) => {
    if (v >= 1_000_000) return '$' + (v / 1_000_000).toFixed(1) + 'M';
    if (v >= 1_000) return '$' + (v / 1_000).toFixed(0) + 'k';
    if (v > 0) return '$' + v.toLocaleString('de-DE');
    return '-';
  };

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav />

      {/* Hero */}
      <div className="bg-[#0d1526] border-b border-[#1e2a3a]">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <a href="/teams" className="text-[#8a9bb0] text-xs hover:text-white mb-4 inline-block">&larr; {t('team.allTeams')}</a>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6">
            {team.logo ? (
              <img src={team.logo} alt={team.short} className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg object-contain bg-[#141c2e] p-2" />
            ) : (
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg bg-[#141c2e] flex items-center justify-center text-[#c89b3c] text-xl sm:text-2xl font-bold">
                {team.short}
              </div>
            )}
            <div className="flex-1">
              <h1 className="text-white text-2xl sm:text-3xl font-bold">{team.name}</h1>
              <div className="text-[#8a9bb0] text-sm mt-1">{team.region} · {team.short}</div>
            </div>
            {team.totalPrizeMoney > 0 && (
              <div className="sm:text-right">
                <div className="text-[#8a9bb0] text-xs mb-1">{t('team.prizeMoney')}</div>
                <div className="text-[#c89b3c] text-xl sm:text-2xl font-medium">{formatPrize(team.totalPrizeMoney)}</div>
              </div>
            )}
          </div>

          {/* Trophies */}
          {team.trophies && team.trophies.length > 0 && (
            <div className="flex gap-2 mt-4 flex-wrap">
              {team.trophies.map((t: any, i: number) => (
                <div key={i} className="relative group">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-sm cursor-default"
                    style={{
                      backgroundColor: `${TROPHY_COLORS[t.trophy]}20`,
                      color: TROPHY_COLORS[t.trophy],
                      border: `1px solid ${TROPHY_COLORS[t.trophy]}40`,
                    }}
                  >
                    {t.trophy === 'gold' ? '\u2605' : t.trophy === 'silver' ? '\u2606' : '\u25CF'}
                  </div>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-[#0a0e1a] border border-[#1e2a3a] rounded text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-lg">
                    <div className="font-medium">{t.event}</div>
                    <div className="text-[#c89b3c]">{t.place}. Platz</div>
                    {t.date && <div className="text-[#4a5a70]">{t.date}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
        {/* Main Roster */}
        {mainPlayers.length > 0 && (
          <section className="mb-6">
            <h2 className="text-white text-lg font-semibold mb-4">{t('team.activeRoster')}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {mainPlayers.map((m: any, i: number) => {
                const link = makePlayerLink(m);
                const Card = link ? 'a' : 'div';
                return (
                  <Card key={i} href={link || undefined} className={`bg-[#0d1526] border border-[#1e2a3a] rounded p-4 text-center ${link ? 'hover:border-[#c89b3c]/40 transition-colors cursor-pointer' : ''}`}>
                    {m.image ? (
                      <img src={m.image} alt={m.name}
                        className="w-16 h-16 rounded-full mx-auto mb-2 object-cover border-2 border-[#1e2a3a] bg-[#141c2e]"
                        onError={(e: any) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                      />
                    ) : null}
                    <div className={`w-16 h-16 rounded-full mx-auto mb-2 bg-[#141c2e] border-2 border-[#1e2a3a] items-center justify-center text-[#4a5a70] text-xl ${m.image ? 'hidden' : 'flex'}`}>?</div>
                    <div className="text-white text-sm font-medium">{m.name}</div>
                    {m.firstName && <div className="text-[#4a5a70] text-[10px]">{m.firstName} {m.lastName}</div>}
                    <div className="text-[#c89b3c] text-xs mt-1">{m.role}</div>
                    {m.country && <div className="text-[#4a5a70] text-xs mt-0.5">{m.country}</div>}
                    {link && <div className="text-[#4a5a70] text-[10px] mt-1 hover:text-[#c89b3c]">{t('team.viewProfile')}</div>}
                  </Card>
                );
              })}
            </div>
          </section>
        )}

        {/* Subs */}
        {subs.length > 0 && (
          <section className="mb-6">
            <h2 className="text-white text-lg font-semibold mb-4">{t('team.subs')}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {subs.map((m: any, i: number) => {
                const link = makePlayerLink(m);
                const Card = link ? 'a' : 'div';
                return (
                  <Card key={i} href={link || undefined} className={`bg-[#0d1526] border border-[#1e2a3a] rounded p-3 flex items-center gap-3 ${link ? 'hover:border-[#c89b3c]/40 transition-colors cursor-pointer' : ''}`}>
                    <div className="w-10 h-10 rounded-full bg-[#141c2e] border border-[#1e2a3a] flex items-center justify-center text-[#4a5a70] text-sm flex-shrink-0">
                      ?
                    </div>
                    <div>
                      <div className="text-white text-sm font-medium">{m.name}</div>
                      <div className="text-[#8a9bb0] text-xs">{m.role} · Ersatz</div>
                      {m.country && <div className="text-[#4a5a70] text-xs">{m.country}</div>}
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>
        )}

        {/* Staff */}
        {staff.length > 0 && (
          <section className="mb-6">
            <h2 className="text-white text-lg font-semibold mb-4">{t('team.staff')}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {staff.map((m: any, i: number) => (
                <div key={i} className="bg-[#0d1526] border border-[#1e2a3a] rounded p-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#141c2e] border border-[#1e2a3a] flex items-center justify-center text-[#4a5a70] text-sm flex-shrink-0">
                    ?
                  </div>
                  <div>
                    <div className="text-white text-sm font-medium">{m.name}</div>
                    <div className="text-[#8a9bb0] text-xs">{m.role}</div>
                    {m.country && <div className="text-[#4a5a70] text-xs">{m.country}</div>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Tournament History */}
        {team.results && team.results.length > 0 && (
          <TournamentHistory results={team.results} formatPrize={formatPrize} />
        )}

        <Footer />
      </div>
    </main>
  );
}

const PAGE_SIZE = 15;

function TournamentHistory({ results, formatPrize }: { results: any[]; formatPrize: (v: number) => string }) {
  const { t } = useI18n();
  const [yearFilter, setYearFilter] = useState('all');
  const [page, setPage] = useState(1);

  const years = useMemo(() => {
    const s = new Set<string>();
    for (const r of results) {
      if (r.date) s.add(r.date.slice(0, 4));
    }
    return ['all', ...Array.from(s).sort((a, b) => b.localeCompare(a))];
  }, [results]);

  const filtered = useMemo(() => {
    if (yearFilter === 'all') return results;
    return results.filter(r => r.date?.startsWith(yearFilter));
  }, [results, yearFilter]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const totalPrize = filtered.reduce((s: number, r: any) => s + (r.prizeUSD || r.prize || 0), 0);
  const wins = filtered.filter((r: any) => String(r.place) === '1').length;

  // Reset page on filter change
  useEffect(() => { setPage(1); }, [yearFilter]);

  const placeColor = (place: any) => {
    const p = String(place);
    if (p === '1' || p === '1st') return 'text-[#f0c040]';
    if (p === '2' || p === '2nd') return 'text-[#c0c0c0]';
    if (p.startsWith('3')) return 'text-[#cd7f32]';
    return 'text-[#8a9bb0]';
  };

  return (
    <section className="mb-6">
      <h2 className="text-white text-lg font-semibold mb-4">{t('team.history')}</h2>

      {/* Year filter + stats */}
      <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-3 mb-2 flex flex-wrap items-center gap-3">
        <div className="text-[#8a9bb0] text-xs">{t('teams.season')}:</div>
        <div className="flex flex-wrap gap-1">
          {years.map(y => (
            <button
              key={y}
              onClick={() => setYearFilter(y)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                yearFilter === y
                  ? 'bg-[#c89b3c]/15 text-[#c89b3c] border border-[#c89b3c]/30'
                  : 'text-[#4a5a70] hover:text-[#8a9bb0]'
              }`}
            >
              {y === 'all' ? t('teams.allSeasons') : y}
            </button>
          ))}
        </div>
        <div className="sm:ml-auto flex gap-4 text-xs">
          <span className="text-[#8a9bb0]">{filtered.length} {t('team.tournaments')}</span>
          <span className="text-[#f0c040]">{wins}x {t('team.firstPlace')}</span>
          {totalPrize > 0 && <span className="text-[#c89b3c]">{formatPrize(totalPrize)}</span>}
        </div>
      </div>

      {/* Table */}
      <div className="bg-[#0d1526] border border-[#1e2a3a] rounded overflow-hidden">
        {/* Desktop header */}
        <div className="hidden sm:grid grid-cols-[2rem_1fr_5rem_6rem_5rem] gap-3 px-4 py-2 border-b border-[#1e2a3a] bg-[#0a0e1a] text-[#8a9bb0] text-xs">
          <div></div>
          <div>{t('team.tournament')}</div>
          <div className="text-center">{t('team.place')}</div>
          <div className="text-right">{t('team.prizeMoney')}</div>
          <div className="text-right">{t('team.date')}</div>
        </div>

        {paged.length === 0 ? (
          <div className="text-center text-[#4a5a70] text-sm py-8">{t('team.noResults')}</div>
        ) : (
          paged.map((r: any, i: number) => (
            <div key={i}>
              {/* Desktop row */}
              <div className="hidden sm:grid grid-cols-[2rem_1fr_5rem_6rem_5rem] gap-3 px-4 py-2 border-b border-[#1e2a3a]/30 items-center">
                <div>
                  {r.trophy ? (
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center text-xs"
                      style={{ backgroundColor: `${TROPHY_COLORS[r.trophy]}20`, color: TROPHY_COLORS[r.trophy] }}
                    >
                      {r.trophy === 'gold' ? '\u2605' : r.trophy === 'silver' ? '\u2606' : '\u25CF'}
                    </div>
                  ) : <div className="w-5" />}
                </div>
                <div className="text-white text-sm truncate">{r.event}</div>
                <div className={`text-center text-sm font-medium ${placeColor(r.place)}`}>
                  {r.place}
                </div>
                <div className="text-[#c89b3c] text-sm text-right" title={r.originalPrize || ''}>
                  {(r.prizeUSD || r.prize || 0) > 0 ? formatPrize(r.prizeUSD || r.prize) : '-'}
                </div>
                <div className="text-[#4a5a70] text-xs text-right">{r.date ? r.date.slice(0, 7) : '-'}</div>
              </div>
              {/* Mobile row */}
              <div className="sm:hidden flex items-center gap-2 px-3 py-2 border-b border-[#1e2a3a]/30">
                {r.trophy ? (
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center text-xs flex-shrink-0"
                    style={{ backgroundColor: `${TROPHY_COLORS[r.trophy]}20`, color: TROPHY_COLORS[r.trophy] }}
                  >
                    {r.trophy === 'gold' ? '\u2605' : r.trophy === 'silver' ? '\u2606' : '\u25CF'}
                  </div>
                ) : <div className="w-5 flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="text-white text-sm truncate">{r.event}</div>
                  <div className="text-[#4a5a70] text-xs">{r.date ? r.date.slice(0, 7) : '-'}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className={`text-sm font-medium ${placeColor(r.place)}`}>{r.place}.</div>
                  {(r.prizeUSD || r.prize || 0) > 0 && (
                    <div className="text-[#c89b3c] text-xs">{formatPrize(r.prizeUSD || r.prize)}</div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-2 bg-[#0d1526] border border-[#1e2a3a] rounded px-4 py-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              page <= 1 ? 'text-[#4a5a70] cursor-not-allowed' : 'text-[#8a9bb0] hover:text-white bg-[#141c2e]'
            }`}
          >
            {t('team.prev')}
          </button>
          <div className="text-[#8a9bb0] text-xs">
            {t('team.page')} <span className="text-white font-medium">{page}</span> / {totalPages}
            <span className="text-[#4a5a70] ml-2">({filtered.length} {t('team.results')})</span>
          </div>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              page >= totalPages ? 'text-[#4a5a70] cursor-not-allowed' : 'text-[#8a9bb0] hover:text-white bg-[#141c2e]'
            }`}
          >
            {t('team.next')}
          </button>
        </div>
      )}
    </section>
  );
}
