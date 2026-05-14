'use client';
import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import Nav from '../components/Nav';
import Footer from '../components/Footer';
import { useI18n, LOCALE_MAP } from '../lib/i18n';
import { usePageTitle } from '../lib/use-page-title';

interface LeagueInfo {
  slug: string;
  name: string;
  region: string;
  image: string;
}

interface Team {
  name: string;
  code: string;
  image?: string;
  outcome?: string;
  gameWins?: number;
}

interface StandingTeam {
  name: string;
  code: string;
  image: string;
  wins: number;
  losses: number;
}

interface StandingEntry {
  ordinal: number;
  teams: StandingTeam[];
}

interface LeagueDetail {
  league: { slug: string; name: string; region: string; image: string };
  tournament: { name: string; startDate: string; endDate: string } | null;
  standings: StandingEntry[];
  matches: {
    startTime: string;
    state: string;
    blockName: string;
    teams?: Team[];
  }[];
}

interface ScheduleEvent {
  league: string;
  leagueSlug: string;
  startTime: string;
  state: string;
  teams?: Team[];
}

interface ProPlayer {
  proName: string;
  team: string;
  role: string;
  accounts: string[];
}

interface ProTeam {
  id: string;
  name: string;
  short: string;
}

type CalendarView = 'week' | 'month';

export default function LigenPage() {
  usePageTitle('pageTitle.ligen');
  const { t, lang } = useI18n();
  const locale = LOCALE_MAP[lang];
  const searchParams = useSearchParams();
  const initialLeagueSlug = searchParams.get('league');
  const [leagues, setLeagues] = useState<LeagueInfo[]>([]);
  const [schedule, setSchedule] = useState<ScheduleEvent[]>([]);
  const [selectedLeague, setSelectedLeague] = useState<string | null>(null);
  const [leagueDetail, setLeagueDetail] = useState<LeagueDetail | null>(null);
  const [calendarView, setCalendarView] = useState<CalendarView>('week');
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<'standings' | 'results' | 'upcoming'>('standings');
  const [proPlayers, setProPlayers] = useState<ProPlayer[]>([]);
  const [proTeams, setProTeams] = useState<ProTeam[]>([]);

  // Load leagues + schedule on mount
  useEffect(() => {
    const load = async () => {
      try {
        const [leagueRes, scheduleRes] = await Promise.all([
          fetch('/api/tournaments/standings').then(r => r.json()).catch(() => ({ leagues: [] })),
          fetch('/api/tournaments?window=full').then(r => r.json()).catch(() => ({ tournaments: [] })),
        ]);
        setLeagues(leagueRes.leagues || []);
        setSchedule((scheduleRes.tournaments || []).map((t: any) => ({
          league: t.league,
          leagueSlug: t.leagueSlug,
          startTime: t.startTime,
          state: t.state,
          teams: t.teams,
        })));
      } catch {}

      // Load pro data separately (large files, non-blocking)
      fetch('/pro-players.json').then(r => r.json()).then(d => setProPlayers(d.players || [])).catch(() => {});
      fetch('/pro-teams.json').then(r => r.json()).then(d => setProTeams(d.teams || [])).catch(() => {});

      setLoading(false);
    };
    load();
  }, []);

  // Open league detail automatically when arriving via ?league=SLUG (e.g. from SideDrawer match click)
  useEffect(() => {
    if (initialLeagueSlug && !selectedLeague) {
      fetchLeagueDetail(initialLeagueSlug);
      // Smooth scroll to detail view once rendered
      setTimeout(() => {
        document.getElementById('league-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 400);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLeagueSlug]);

  const fetchLeagueDetail = async (slug: string) => {
    setSelectedLeague(slug);
    setDetailLoading(true);
    setDetailTab('standings');
    try {
      const res = await fetch(`/api/tournaments/standings?league=${slug}`);
      const data = await res.json();
      if (data.league) setLeagueDetail(data);
      else setLeagueDetail(null);
    } catch { setLeagueDetail(null); }
    finally { setDetailLoading(false); }
  };

  // Calendar helpers
  const calendarEvents = useMemo(() => {
    const events: Record<string, Set<string>> = {};
    for (const t of schedule) {
      const dateKey = new Date(t.startTime).toISOString().split('T')[0];
      if (!events[dateKey]) events[dateKey] = new Set();
      events[dateKey].add(t.leagueSlug);
    }
    return events;
  }, [schedule]);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const getWeekDays = (baseDate: Date) => {
    const start = new Date(baseDate);
    const day = start.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + diff);
    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }
    return days;
  };

  const getMonthDays = (baseDate: Date) => {
    const year = baseDate.getFullYear();
    const month = baseDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startOffset = (firstDay.getDay() + 6) % 7;
    const days: (Date | null)[] = [];
    for (let i = 0; i < startOffset; i++) days.push(null);
    for (let d = 1; d <= lastDay.getDate(); d++) {
      days.push(new Date(year, month, d));
    }
    return days;
  };

  const navigateCalendar = (direction: number) => {
    const d = new Date(calendarDate);
    if (calendarView === 'week') d.setDate(d.getDate() + direction * 7);
    else d.setMonth(d.getMonth() + direction);
    setCalendarDate(d);
  };

  const getLeagueName = (slug: string) => leagues.find(l => l.slug === slug)?.name || slug;

  const getTeamLink = (teamName: string, teamCode: string): string | null => {
    if (!teamName && !teamCode) return null;
    const t = proTeams.find(pt =>
      (teamName && pt.name.toLowerCase() === teamName.toLowerCase()) ||
      (teamCode && pt.short.toLowerCase() === teamCode.toLowerCase())
    );
    return t ? `/teams/${t.id}` : null;
  };

  const getPlayerSlug = (playerName: string): string | null => {
    if (!playerName) return null;
    const p = proPlayers.find(pp => pp.proName.toLowerCase() === playerName.toLowerCase());
    if (!p || !p.accounts || p.accounts.length === 0) return null;
    // Only link if account has proper Riot ID with #tag
    const riotId = p.accounts.find(a => a.includes('#'));
    if (!riotId) return null;
    const [gameName, tag] = riotId.split('#');
    return `/player/${encodeURIComponent(gameName)}--${encodeURIComponent(tag)}?region=euw1`;
  };

  const getTeamRoster = (teamName: string): ProPlayer[] => {
    if (!teamName) return [];
    const name = teamName.toLowerCase();
    return proPlayers.filter(p =>
      typeof p.team === 'string' && p.team.toLowerCase() === name &&
      ['Top', 'Jungle', 'Mid', 'Bot', 'Support'].includes(p.role)
    );
  };

  const dayNames = [...Array(7)].map((_, i) => {
    const d = new Date(2024, 0, i + 1); // 2024-01-01 is a Monday
    return d.toLocaleDateString(locale, { weekday: 'short' }).substring(0, 2);
  });
  const monthNames = [...Array(12)].map((_, i) => {
    return new Date(2024, i, 1).toLocaleDateString(locale, { month: 'long' });
  });

  const weekDays = calendarView === 'week' ? getWeekDays(calendarDate) : [];
  const monthDays = calendarView === 'month' ? getMonthDays(calendarDate) : [];

  const headerLabel = calendarView === 'week'
    ? `${weekDays[0]?.toLocaleDateString(locale, { day: '2-digit', month: 'short' })} – ${weekDays[6]?.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })}`
    : `${monthNames[calendarDate.getMonth()]} ${calendarDate.getFullYear()}`;

  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const formatTime = (dateStr: string) => new Date(dateStr).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const formatTournamentName = (slug: string) => {
    return slug
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
      .replace(/\b(Lec|Lck|Lpl|Lcs|Lta|Vcs|Pcs|Ljl|Nacl)\b/gi, m => m.toUpperCase())
      .replace(/\bSplit\b/g, 'Split')
      .replace(/\b(\d{4})\b/g, '$1');
  };

  // Split detail matches
  const pastMatches = (leagueDetail?.matches || []).filter(m => m.state === 'completed').reverse();
  const upcomingMatches = (leagueDetail?.matches || []).filter(m => m.state === 'unstarted' || m.state === 'inProgress');

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white">
      <Nav active="ligen" />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {/* Page Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold">
            <span className="text-[#c89b3c]">{t('ligen.title1')}</span> {t('ligen.title2')}
          </h1>
          <p className="text-[#a0b0c5] text-sm mt-1">{t('ligen.subtitle')}</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-[#c89b3c] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : selectedLeague ? (
          /* ── League Detail View ── */
          <div id="league-detail">
            <button
              onClick={() => { setSelectedLeague(null); setLeagueDetail(null); }}
              className="flex items-center gap-2 text-[#a0b0c5] hover:text-white transition-colors mb-4"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              <span className="text-sm">{t('ligen.back')}</span>
            </button>

            {detailLoading ? (
              <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 border-2 border-[#c89b3c] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : !leagueDetail ? (
              <div className="bg-[#0d1526] rounded-xl border border-[#1e2a3a] py-12 text-center text-[#7a8aa0]">
                {t('ligen.loadError')}
              </div>
            ) : (
              <>
                {/* League header */}
                <div className="flex items-center gap-4 mb-6 bg-gradient-to-r from-[#0d1526] to-[#0a0e1a] rounded-xl border border-[#1e2a3a] p-5">
                  {leagueDetail.league.image && (
                    <img src={leagueDetail.league.image} alt="" className="w-14 h-14 rounded-xl object-contain bg-[#141c2e] p-1.5 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <h2 className="text-xl font-bold truncate">{leagueDetail.league.name}</h2>
                    <p className="text-[#a0b0c5] text-sm">
                      {leagueDetail.league.region}
                      {leagueDetail.tournament && ` · ${formatTournamentName(leagueDetail.tournament.name)}`}
                    </p>
                  </div>
                  {/* Quick stats */}
                  <div className="hidden sm:flex gap-4">
                    <div className="text-center">
                      <div className="text-lg font-bold text-white">{(leagueDetail.standings || []).flatMap(s => s.teams || []).length}</div>
                      <div className="text-[10px] text-[#7a8aa0] uppercase tracking-wider">Teams</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-white">{(leagueDetail.matches || []).length}</div>
                      <div className="text-[10px] text-[#7a8aa0] uppercase tracking-wider">Spiele</div>
                    </div>
                  </div>
                </div>

                {/* Sub-tabs */}
                <div className="flex gap-1 bg-[#0d1526] rounded-xl border border-[#1e2a3a] p-1 mb-5">
                  {[
                    { key: 'standings' as const, label: t('ligen.standings'), icon: 'M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z' },
                    { key: 'upcoming' as const, label: `${t('ligen.upcoming')} (${upcomingMatches.length})`, icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
                    { key: 'results' as const, label: `${t('ligen.results')} (${pastMatches.length})`, icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
                  ].map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => setDetailTab(tab.key)}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
                        detailTab === tab.key
                          ? 'bg-[#1e2a3a] text-[#c89b3c] shadow-sm'
                          : 'text-[#a0b0c5] hover:text-white'
                      }`}
                    >
                      <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d={tab.icon} />
                      </svg>
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Standings */}
                {detailTab === 'standings' && (
                  <div className="bg-[#0d1526] rounded-xl border border-[#1e2a3a] overflow-hidden">
                    {!leagueDetail.standings || leagueDetail.standings.length === 0 ? (
                      <div className="py-12 text-center text-[#7a8aa0]">{t('ligen.noStandings')}</div>
                    ) : (
                      <table className="w-full">
                        <thead>
                          <tr className="border-b-2 border-[#1e2a3a] text-[#7a8aa0] text-[10px] uppercase tracking-widest">
                            <th className="px-3 sm:px-4 py-3 text-center w-10">#</th>
                            <th className="px-3 sm:px-4 py-3 text-left">Team</th>
                            <th className="px-2 py-3 text-center w-12">S</th>
                            <th className="px-2 py-3 text-center w-12">N</th>
                            <th className="px-2 py-3 text-center w-16">{t('ligen.record')}</th>
                            <th className="px-3 sm:px-4 py-3 text-left hidden md:table-cell">{t('teams.players')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            let rank = 0;
                            return (leagueDetail.standings || []).map((entry) =>
                              (entry.teams || []).map((team) => {
                                rank++;
                                const link = getTeamLink(team.name, team.code);
                                const total = team.wins + team.losses;
                                const wr = total > 0 ? Math.round((team.wins / total) * 100) : 0;
                                const wrBar = total > 0 ? (team.wins / total) * 100 : 50;
                                const roster = getTeamRoster(team.name);
                                const isTop3 = rank <= 3;
                                const isBottom2 = rank > (leagueDetail.standings || []).flatMap(s => s.teams || []).length - 2;

                                return (
                                  <tr
                                    key={`${entry.ordinal}-${team.code}`}
                                    className={`border-b border-[#141c2e] hover:bg-[#141c2e]/80 transition-colors ${
                                      isTop3 ? 'bg-[#c89b3c]/[0.03]' : isBottom2 ? 'bg-red-500/[0.02]' : ''
                                    }`}
                                  >
                                    <td className="px-3 sm:px-4 py-3 text-center">
                                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                                        rank === 1 ? 'bg-[#c89b3c]/20 text-[#c89b3c]' :
                                        rank === 2 ? 'bg-[#a0b0c5]/20 text-[#a0b0c5]' :
                                        rank === 3 ? 'bg-[#b87333]/20 text-[#b87333]' :
                                        'text-[#7a8aa0]'
                                      }`}>
                                        {rank}
                                      </div>
                                    </td>
                                    <td className="px-3 sm:px-4 py-3">
                                      <div className="flex items-center gap-3">
                                        {team.image ? (
                                          <img src={team.image} alt="" className="w-8 h-8 rounded-md object-contain bg-[#141c2e] p-0.5 flex-shrink-0" />
                                        ) : (
                                          <div className="w-8 h-8 rounded-md bg-[#141c2e] flex-shrink-0" />
                                        )}
                                        <div className="min-w-0">
                                          {link ? (
                                            <Link href={link} className="text-sm font-semibold text-white hover:text-[#c89b3c] transition-colors block truncate">
                                              {team.name}
                                            </Link>
                                          ) : (
                                            <span className="text-sm font-semibold text-white block truncate">{team.name}</span>
                                          )}
                                          <span className="text-[10px] text-[#7a8aa0] hidden sm:inline">{team.code}</span>
                                        </div>
                                      </div>
                                    </td>
                                    <td className="px-2 py-3 text-center">
                                      <span className="text-sm font-bold text-green-400">{team.wins}</span>
                                    </td>
                                    <td className="px-2 py-3 text-center">
                                      <span className="text-sm font-bold text-red-400">{team.losses}</span>
                                    </td>
                                    <td className="px-2 py-3">
                                      <div className="flex flex-col items-center gap-1">
                                        <span className={`text-xs font-bold ${wr >= 60 ? 'text-green-400' : wr >= 40 ? 'text-[#a0b0c5]' : 'text-red-400'}`}>
                                          {total > 0 ? `${wr}%` : '—'}
                                        </span>
                                        {total > 0 && (
                                          <div className="w-full h-1 bg-red-400/30 rounded-full overflow-hidden">
                                            <div className="h-full bg-green-400/80 rounded-full" style={{ width: `${wrBar}%` }} />
                                          </div>
                                        )}
                                      </div>
                                    </td>
                                    <td className="px-3 sm:px-4 py-3 hidden md:table-cell">
                                      <div className="flex gap-1.5 flex-wrap">
                                        {roster.map(player => {
                                          const playerLink = getPlayerSlug(player.proName);
                                          const roleColors: Record<string, string> = {
                                            Top: 'text-blue-400', Jungle: 'text-green-400', Mid: 'text-purple-400',
                                            Bot: 'text-red-400', Support: 'text-yellow-400',
                                          };
                                          return (
                                            <span key={player.proName} className="inline-flex items-center gap-0.5">
                                              <span className={`text-[9px] ${roleColors[player.role] || 'text-[#7a8aa0]'}`}>●</span>
                                              {playerLink ? (
                                                <Link href={playerLink} className="text-[11px] text-[#a0b0c5] hover:text-[#c89b3c] transition-colors">
                                                  {player.proName}
                                                </Link>
                                              ) : (
                                                <span className="text-[11px] text-[#7a8aa0]">{player.proName}</span>
                                              )}
                                            </span>
                                          );
                                        })}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })
                            );
                          })()}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}

                {/* Upcoming Matches */}
                {detailTab === 'upcoming' && (
                  <div className="space-y-2">
                    {upcomingMatches.length === 0 ? (
                      <div className="bg-[#0d1526] rounded-xl border border-[#1e2a3a] py-12 text-center text-[#7a8aa0]">
                        {t('ligen.noUpcoming')}
                      </div>
                    ) : upcomingMatches.map((match, i) => (
                      <MatchRow key={`up-${i}`} match={match} formatDate={formatDate} formatTime={formatTime} getTeamLink={getTeamLink} />
                    ))}
                  </div>
                )}

                {/* Past Results */}
                {detailTab === 'results' && (
                  <div className="space-y-2">
                    {pastMatches.length === 0 ? (
                      <div className="bg-[#0d1526] rounded-xl border border-[#1e2a3a] py-12 text-center text-[#7a8aa0]">
                        {t('ligen.noResults')}
                      </div>
                    ) : pastMatches.map((match, i) => (
                      <MatchRow key={`past-${i}`} match={match} formatDate={formatDate} formatTime={formatTime} getTeamLink={getTeamLink} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          /* ── Calendar + League List ── */
          <>
            {/* Calendar */}
            <div className="bg-[#0d1526] rounded-xl border border-[#1e2a3a] p-4 mb-6">
              {/* Calendar header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex gap-1 bg-[#141c2e] rounded-lg p-0.5">
                  <button
                    onClick={() => setCalendarView('week')}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      calendarView === 'week' ? 'bg-[#c89b3c]/20 text-[#c89b3c]' : 'text-[#a0b0c5] hover:text-white'
                    }`}
                  >
                    {t('cal.week')}
                  </button>
                  <button
                    onClick={() => setCalendarView('month')}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      calendarView === 'month' ? 'bg-[#c89b3c]/20 text-[#c89b3c]' : 'text-[#a0b0c5] hover:text-white'
                    }`}
                  >
                    {t('cal.month')}
                  </button>
                </div>

                <div className="text-sm font-medium text-white">{headerLabel}</div>

                <div className="flex items-center gap-2">
                  <button onClick={() => navigateCalendar(-1)} className="p-1.5 text-[#a0b0c5] hover:text-white transition-colors rounded hover:bg-[#141c2e]">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                  </button>
                  <button
                    onClick={() => setCalendarDate(new Date())}
                    className="px-3 py-1 text-xs text-[#c89b3c] hover:text-white transition-colors font-medium rounded hover:bg-[#141c2e]"
                  >
                    {t('cal.today')}
                  </button>
                  <button onClick={() => navigateCalendar(1)} className="p-1.5 text-[#a0b0c5] hover:text-white transition-colors rounded hover:bg-[#141c2e]">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                  </button>
                </div>
              </div>

              {/* Day headers */}
              <div className="grid grid-cols-7 gap-1 mb-1">
                {dayNames.map(d => (
                  <div key={d} className="text-center text-[10px] text-[#7a8aa0] font-medium py-1">{d}</div>
                ))}
              </div>

              {/* Calendar grid */}
              {calendarView === 'week' ? (
                <div className="grid grid-cols-7 gap-1">
                  {weekDays.map((day, i) => {
                    const key = day.toISOString().split('T')[0];
                    const events = calendarEvents[key];
                    const isToday = day.toDateString() === today.toDateString();
                    return (
                      <div
                        key={i}
                        className={`rounded-lg p-2 min-h-[80px] border transition-colors ${
                          isToday ? 'border-[#c89b3c]/50 bg-[#c89b3c]/5' : 'border-[#1e2a3a] bg-[#0a0e1a]'
                        }`}
                      >
                        <div className={`text-xs font-medium mb-1.5 ${isToday ? 'text-[#c89b3c]' : 'text-[#a0b0c5]'}`}>
                          {day.getDate()}. {day.toLocaleDateString(locale, { month: 'short' })}
                        </div>
                        {events && Array.from(events).map(slug => (
                          <button
                            key={slug}
                            onClick={() => fetchLeagueDetail(slug)}
                            className="block w-full text-left text-[10px] text-[#c89b3c] hover:text-white truncate leading-relaxed transition-colors"
                            title={getLeagueName(slug)}
                          >
                            {getLeagueName(slug)}
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-7 gap-1">
                  {monthDays.map((day, i) => {
                    if (!day) return <div key={`empty-${i}`} className="min-h-[48px]" />;
                    const key = day.toISOString().split('T')[0];
                    const events = calendarEvents[key];
                    const isToday = day.toDateString() === today.toDateString();
                    return (
                      <div
                        key={i}
                        className={`rounded p-1.5 min-h-[48px] border transition-colors ${
                          isToday ? 'border-[#c89b3c]/50 bg-[#c89b3c]/5' : events ? 'border-[#1e2a3a] bg-[#0a0e1a]' : 'border-transparent'
                        }`}
                      >
                        <div className={`text-[10px] font-medium ${isToday ? 'text-[#c89b3c]' : 'text-[#a0b0c5]'}`}>
                          {day.getDate()}
                        </div>
                        {events && Array.from(events).map(slug => (
                          <button
                            key={slug}
                            onClick={() => fetchLeagueDetail(slug)}
                            className="block w-full text-left text-[11px] text-[#c89b3c] hover:text-white truncate leading-snug mt-0.5 transition-colors"
                            title={getLeagueName(slug)}
                          >
                            {getLeagueName(slug)}
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* League list */}
            <h2 className="text-lg font-bold mb-3">{t('ligen.allLeagues')}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[...leagues].sort((a, b) => a.name.localeCompare(b.name)).map(league => (
                <button
                  key={league.slug}
                  onClick={() => fetchLeagueDetail(league.slug)}
                  className="flex items-center gap-3 p-4 bg-[#0d1526] rounded-xl border border-[#1e2a3a] hover:border-[#c89b3c]/50 transition-all text-left group"
                >
                  {league.image ? (
                    <img src={league.image} alt="" className="w-10 h-10 rounded-lg object-contain bg-[#141c2e] p-1 flex-shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-[#141c2e] flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-[#7a8aa0]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white group-hover:text-[#c89b3c] transition-colors truncate">{league.name}</div>
                    {league.region && <div className="text-xs text-[#7a8aa0]">{league.region}</div>}
                  </div>
                  <svg className="w-4 h-4 text-[#7a8aa0] group-hover:text-[#c89b3c] transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              ))}
            </div>
          </>
        )}
      </main>

      <Footer />
    </div>
  );
}

/* ── Match Row Component ── */
function MatchRow({ match, formatDate, formatTime, getTeamLink }: {
  match: { startTime: string; state: string; blockName: string; teams?: Team[] };
  formatDate: (d: string) => string;
  formatTime: (d: string) => string;
  getTeamLink: (name: string, code: string) => string | null;
}) {
  const team1 = match.teams?.[0];
  const team2 = match.teams?.[1];
  const isLive = match.state === 'inProgress';

  return (
    <div className={`flex items-center gap-4 p-4 bg-[#0d1526] rounded-xl border transition-colors ${
      isLive ? 'border-red-500/30 bg-red-500/5' : 'border-[#1e2a3a]'
    }`}>
      {/* Date/Time */}
      <div className="text-center flex-shrink-0 w-16">
        <div className="text-[10px] text-[#7a8aa0]">{formatDate(match.startTime)}</div>
        <div className={`text-xs font-medium ${isLive ? 'text-red-400' : 'text-[#a0b0c5]'}`}>
          {isLive ? 'LIVE' : formatTime(match.startTime)}
        </div>
        {match.blockName && <div className="text-[9px] text-[#7a8aa0] mt-0.5">{match.blockName}</div>}
      </div>

      {/* Teams */}
      {team1 && team2 && (
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="flex-1 flex items-center gap-2 justify-end min-w-0">
            <TeamLink team={team1} getTeamLink={getTeamLink} />
            {team1.image && <img src={team1.image} alt="" className="w-6 h-6 rounded flex-shrink-0" />}
          </div>

          <div className="flex items-center gap-1.5 px-3 flex-shrink-0">
            <span className={`text-sm font-bold ${team1.outcome === 'win' ? 'text-green-400' : 'text-[#a0b0c5]'}`}>
              {match.state !== 'unstarted' ? team1.gameWins : '-'}
            </span>
            <span className="text-[#7a8aa0] text-xs">:</span>
            <span className={`text-sm font-bold ${team2.outcome === 'win' ? 'text-green-400' : 'text-[#a0b0c5]'}`}>
              {match.state !== 'unstarted' ? team2.gameWins : '-'}
            </span>
          </div>

          <div className="flex-1 flex items-center gap-2 min-w-0">
            {team2.image && <img src={team2.image} alt="" className="w-6 h-6 rounded flex-shrink-0" />}
            <TeamLink team={team2} getTeamLink={getTeamLink} />
          </div>
        </div>
      )}
    </div>
  );
}

function TeamLink({ team, getTeamLink }: { team: Team; getTeamLink: (name: string, code: string) => string | null }) {
  const link = getTeamLink(team.name, team.code);
  const cls = `text-sm truncate ${
    team.outcome === 'win' ? 'text-green-400 font-medium' :
    team.outcome === 'loss' ? 'text-[#7a8aa0]' : 'text-white'
  }`;

  return link ? (
    <Link href={link} className={`${cls} hover:text-[#c89b3c] transition-colors`}>{team.name}</Link>
  ) : (
    <span className={cls}>{team.name}</span>
  );
}
