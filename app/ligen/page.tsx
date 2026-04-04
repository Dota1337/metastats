'use client';
import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import Nav from '../components/Nav';
import Footer from '../components/Footer';

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
    Promise.all([
      fetch('/api/tournaments/standings').then(r => r.json()),
      fetch('/api/tournaments').then(r => r.json()),
      fetch('/pro-players.json').then(r => r.json()),
      fetch('/pro-teams.json').then(r => r.json()),
    ]).then(([leagueData, scheduleData, playerData, teamData]) => {
      setLeagues(leagueData.leagues || []);
      setSchedule((scheduleData.tournaments || []).map((t: any) => ({
        league: t.league,
        leagueSlug: t.leagueSlug,
        startTime: t.startTime,
        state: t.state,
        teams: t.teams,
      })));
      setProPlayers(playerData.players || []);
      setProTeams(teamData.teams || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

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

  const today = new Date();
  today.setHours(0, 0, 0, 0);

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
    const t = proTeams.find(pt =>
      pt.name.toLowerCase() === teamName.toLowerCase() ||
      pt.short.toLowerCase() === teamCode.toLowerCase()
    );
    return t ? `/teams/${t.id}` : null;
  };

  const getPlayerSlug = (playerName: string): string | null => {
    const p = proPlayers.find(pp => pp.proName.toLowerCase() === playerName.toLowerCase());
    if (!p || p.accounts.length === 0) return null;
    return `/player/${encodeURIComponent(p.accounts[0])}`;
  };

  const getTeamRoster = (teamName: string): ProPlayer[] => {
    return proPlayers.filter(p =>
      p.team.toLowerCase() === teamName.toLowerCase() &&
      ['Top', 'Jungle', 'Mid', 'Bot', 'Support'].includes(p.role)
    );
  };

  const dayNames = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const monthNames = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

  const weekDays = calendarView === 'week' ? getWeekDays(calendarDate) : [];
  const monthDays = calendarView === 'month' ? getMonthDays(calendarDate) : [];

  const headerLabel = calendarView === 'week'
    ? `${weekDays[0]?.toLocaleDateString('de-DE', { day: '2-digit', month: 'short' })} – ${weekDays[6]?.toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' })}`
    : `${monthNames[calendarDate.getMonth()]} ${calendarDate.getFullYear()}`;

  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const formatTime = (dateStr: string) => new Date(dateStr).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

  // Split detail matches
  const pastMatches = leagueDetail?.matches.filter(m => m.state === 'completed').reverse() || [];
  const upcomingMatches = leagueDetail?.matches.filter(m => m.state === 'unstarted' || m.state === 'inProgress') || [];

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white">
      <Nav active="ligen" />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {/* Page Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold">
            <span className="text-[#c89b3c]">Ligen</span> & Wettbewerbe
          </h1>
          <p className="text-[#8a9bb0] text-sm mt-1">Kalender, Tabellen und Ergebnisse aller LoL Esports Ligen</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-[#c89b3c] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : selectedLeague && leagueDetail ? (
          /* ── League Detail View ── */
          <div>
            <button
              onClick={() => { setSelectedLeague(null); setLeagueDetail(null); }}
              className="flex items-center gap-2 text-[#8a9bb0] hover:text-white transition-colors mb-4"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              <span className="text-sm">Zurück zur Übersicht</span>
            </button>

            {/* League header */}
            <div className="flex items-center gap-4 mb-6 bg-[#0d1526] rounded-xl border border-[#1e2a3a] p-4">
              {leagueDetail.league.image && (
                <img src={leagueDetail.league.image} alt="" className="w-12 h-12 rounded-lg object-contain bg-[#141c2e] p-1" />
              )}
              <div>
                <h2 className="text-xl font-bold">{leagueDetail.league.name}</h2>
                <p className="text-[#8a9bb0] text-sm">
                  {leagueDetail.league.region}
                  {leagueDetail.tournament && ` · ${leagueDetail.tournament.name}`}
                </p>
              </div>
            </div>

            {detailLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-2 border-[#c89b3c] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <>
                {/* Sub-tabs */}
                <div className="flex gap-2 mb-4">
                  {[
                    { key: 'standings' as const, label: 'Tabelle', count: leagueDetail.standings.length },
                    { key: 'upcoming' as const, label: 'Kommende Spiele', count: upcomingMatches.length },
                    { key: 'results' as const, label: 'Ergebnisse', count: pastMatches.length },
                  ].map(t => (
                    <button
                      key={t.key}
                      onClick={() => setDetailTab(t.key)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        detailTab === t.key
                          ? 'bg-[#c89b3c]/20 text-[#c89b3c] border border-[#c89b3c]/30'
                          : 'text-[#8a9bb0] hover:text-white bg-[#0d1526] border border-[#1e2a3a] hover:border-[#c89b3c]/30'
                      }`}
                    >
                      {t.label} {t.count > 0 && <span className="text-xs ml-1 opacity-70">({t.count})</span>}
                    </button>
                  ))}
                </div>

                {/* Standings */}
                {detailTab === 'standings' && (
                  <div className="bg-[#0d1526] rounded-xl border border-[#1e2a3a] overflow-hidden">
                    {leagueDetail.standings.length === 0 ? (
                      <div className="py-12 text-center text-[#4a5a70]">Keine Standings verfügbar</div>
                    ) : (
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-[#1e2a3a] text-[#4a5a70] text-xs uppercase tracking-wider">
                            <th className="px-4 py-3 text-left w-10">#</th>
                            <th className="px-4 py-3 text-left">Team</th>
                            <th className="px-4 py-3 text-center w-16">S</th>
                            <th className="px-4 py-3 text-center w-16">N</th>
                            <th className="px-4 py-3 text-center w-20">WR</th>
                            <th className="px-4 py-3 text-left hidden sm:table-cell">Spieler</th>
                          </tr>
                        </thead>
                        <tbody>
                          {leagueDetail.standings.map((entry) =>
                            entry.teams.map((team) => {
                              const link = getTeamLink(team.name, team.code);
                              const total = team.wins + team.losses;
                              const wr = total > 0 ? Math.round((team.wins / total) * 100) : 0;
                              const roster = getTeamRoster(team.name);

                              return (
                                <tr key={`${entry.ordinal}-${team.code}`} className="border-b border-[#141c2e] hover:bg-[#141c2e] transition-colors">
                                  <td className="px-4 py-3">
                                    <span className={`text-sm font-bold ${entry.ordinal <= 3 ? 'text-[#c89b3c]' : 'text-[#4a5a70]'}`}>
                                      {entry.ordinal}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3">
                                    <div className="flex items-center gap-3">
                                      {team.image && <img src={team.image} alt="" className="w-7 h-7 rounded" />}
                                      {link ? (
                                        <Link href={link} className="text-sm font-medium text-white hover:text-[#c89b3c] transition-colors">
                                          {team.name}
                                        </Link>
                                      ) : (
                                        <span className="text-sm font-medium">{team.name}</span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 text-center text-sm text-green-400 font-medium">{team.wins}</td>
                                  <td className="px-4 py-3 text-center text-sm text-red-400 font-medium">{team.losses}</td>
                                  <td className="px-4 py-3 text-center">
                                    <span className={`text-sm font-bold ${wr >= 60 ? 'text-green-400' : wr >= 40 ? 'text-[#8a9bb0]' : 'text-red-400'}`}>
                                      {wr}%
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 hidden sm:table-cell">
                                    <div className="flex gap-2 flex-wrap">
                                      {roster.map(player => {
                                        const playerLink = getPlayerSlug(player.proName);
                                        return playerLink ? (
                                          <Link
                                            key={player.proName}
                                            href={playerLink}
                                            className="text-xs text-[#8a9bb0] hover:text-[#c89b3c] transition-colors"
                                            title={player.role}
                                          >
                                            {player.proName}
                                          </Link>
                                        ) : (
                                          <span key={player.proName} className="text-xs text-[#4a5a70]" title={player.role}>
                                            {player.proName}
                                          </span>
                                        );
                                      })}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}

                {/* Upcoming Matches */}
                {detailTab === 'upcoming' && (
                  <div className="space-y-2">
                    {upcomingMatches.length === 0 ? (
                      <div className="bg-[#0d1526] rounded-xl border border-[#1e2a3a] py-12 text-center text-[#4a5a70]">
                        Keine kommenden Spiele
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
                      <div className="bg-[#0d1526] rounded-xl border border-[#1e2a3a] py-12 text-center text-[#4a5a70]">
                        Keine Ergebnisse verfügbar
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
                      calendarView === 'week' ? 'bg-[#c89b3c]/20 text-[#c89b3c]' : 'text-[#8a9bb0] hover:text-white'
                    }`}
                  >
                    Woche
                  </button>
                  <button
                    onClick={() => setCalendarView('month')}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      calendarView === 'month' ? 'bg-[#c89b3c]/20 text-[#c89b3c]' : 'text-[#8a9bb0] hover:text-white'
                    }`}
                  >
                    Monat
                  </button>
                </div>

                <div className="text-sm font-medium text-white">{headerLabel}</div>

                <div className="flex items-center gap-2">
                  <button onClick={() => navigateCalendar(-1)} className="p-1.5 text-[#8a9bb0] hover:text-white transition-colors rounded hover:bg-[#141c2e]">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                  </button>
                  <button
                    onClick={() => setCalendarDate(new Date())}
                    className="px-3 py-1 text-xs text-[#c89b3c] hover:text-white transition-colors font-medium rounded hover:bg-[#141c2e]"
                  >
                    Heute
                  </button>
                  <button onClick={() => navigateCalendar(1)} className="p-1.5 text-[#8a9bb0] hover:text-white transition-colors rounded hover:bg-[#141c2e]">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                  </button>
                </div>
              </div>

              {/* Day headers */}
              <div className="grid grid-cols-7 gap-1 mb-1">
                {dayNames.map(d => (
                  <div key={d} className="text-center text-[10px] text-[#4a5a70] font-medium py-1">{d}</div>
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
                        <div className={`text-xs font-medium mb-1.5 ${isToday ? 'text-[#c89b3c]' : 'text-[#8a9bb0]'}`}>
                          {day.getDate()}. {day.toLocaleDateString('de-DE', { month: 'short' })}
                        </div>
                        {events && Array.from(events).slice(0, 4).map(slug => (
                          <button
                            key={slug}
                            onClick={() => fetchLeagueDetail(slug)}
                            className="block w-full text-left text-[10px] text-[#c89b3c] hover:text-white truncate leading-relaxed transition-colors"
                            title={getLeagueName(slug)}
                          >
                            {getLeagueName(slug)}
                          </button>
                        ))}
                        {events && events.size > 4 && (
                          <span className="text-[9px] text-[#4a5a70]">+{events.size - 4} weitere</span>
                        )}
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
                        <div className={`text-[10px] font-medium ${isToday ? 'text-[#c89b3c]' : 'text-[#8a9bb0]'}`}>
                          {day.getDate()}
                        </div>
                        {events && Array.from(events).slice(0, 2).map(slug => (
                          <button
                            key={slug}
                            onClick={() => fetchLeagueDetail(slug)}
                            className="block w-full text-left text-[8px] text-[#c89b3c] hover:text-white truncate leading-tight mt-0.5 transition-colors"
                            title={getLeagueName(slug)}
                          >
                            {getLeagueName(slug)}
                          </button>
                        ))}
                        {events && events.size > 2 && (
                          <span className="text-[7px] text-[#4a5a70]">+{events.size - 2}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* League list */}
            <h2 className="text-lg font-bold mb-3">Alle Ligen</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {leagues.map(league => (
                <button
                  key={league.slug}
                  onClick={() => fetchLeagueDetail(league.slug)}
                  className="flex items-center gap-3 p-4 bg-[#0d1526] rounded-xl border border-[#1e2a3a] hover:border-[#c89b3c]/50 transition-all text-left group"
                >
                  {league.image ? (
                    <img src={league.image} alt="" className="w-10 h-10 rounded-lg object-contain bg-[#141c2e] p-1 flex-shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-[#141c2e] flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-[#4a5a70]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white group-hover:text-[#c89b3c] transition-colors truncate">{league.name}</div>
                    {league.region && <div className="text-xs text-[#4a5a70]">{league.region}</div>}
                  </div>
                  <svg className="w-4 h-4 text-[#4a5a70] group-hover:text-[#c89b3c] transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
        <div className="text-[10px] text-[#4a5a70]">{formatDate(match.startTime)}</div>
        <div className={`text-xs font-medium ${isLive ? 'text-red-400' : 'text-[#8a9bb0]'}`}>
          {isLive ? 'LIVE' : formatTime(match.startTime)}
        </div>
        {match.blockName && <div className="text-[9px] text-[#4a5a70] mt-0.5">{match.blockName}</div>}
      </div>

      {/* Teams */}
      {team1 && team2 && (
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="flex-1 flex items-center gap-2 justify-end min-w-0">
            <TeamLink team={team1} getTeamLink={getTeamLink} />
            {team1.image && <img src={team1.image} alt="" className="w-6 h-6 rounded flex-shrink-0" />}
          </div>

          <div className="flex items-center gap-1.5 px-3 flex-shrink-0">
            <span className={`text-sm font-bold ${team1.outcome === 'win' ? 'text-green-400' : 'text-[#8a9bb0]'}`}>
              {match.state !== 'unstarted' ? team1.gameWins : '-'}
            </span>
            <span className="text-[#4a5a70] text-xs">:</span>
            <span className={`text-sm font-bold ${team2.outcome === 'win' ? 'text-green-400' : 'text-[#8a9bb0]'}`}>
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
    team.outcome === 'loss' ? 'text-[#4a5a70]' : 'text-white'
  }`;

  return link ? (
    <Link href={link} className={`${cls} hover:text-[#c89b3c] transition-colors`}>{team.name}</Link>
  ) : (
    <span className={cls}>{team.name}</span>
  );
}
