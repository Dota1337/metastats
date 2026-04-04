'use client';
import { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';

/* ── Types ── */
interface PatchNote {
  version: string;
  date: string;
  url: string;
  highlights: string[];
  isNew: boolean;
}

interface Team {
  name: string;
  code: string;
  image?: string;
  outcome?: string;
  gameWins?: number;
}

interface Tournament {
  league: string;
  leagueSlug: string;
  region: string;
  blockName: string;
  startTime: string;
  state: 'completed' | 'inProgress' | 'unstarted';
  teams?: Team[];
}

interface LeagueInfo {
  slug: string;
  name: string;
  region: string;
  image: string;
  priority?: number;
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
  region: string;
  logo: string;
}

type Tab = 'tournaments' | 'leagues' | 'patches';
type CalendarView = 'week' | 'month';

export default function SideDrawer() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('tournaments');
  const [patches, setPatches] = useState<PatchNote[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [tournamentFilter, setTournamentFilter] = useState<'all' | 'upcoming' | 'live'>('all');
  const [leagueFilter, setLeagueFilter] = useState('');
  const [sortedLeagues, setSortedLeagues] = useState<string[]>([]);
  const [leagueMap, setLeagueMap] = useState<Record<string, { name: string; region: string }>>({});
  const [loading, setLoading] = useState(false);
  const [liveCount, setLiveCount] = useState(0);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Leagues & Wettbewerbe state
  const [allLeagues, setAllLeagues] = useState<LeagueInfo[]>([]);
  const [selectedLeague, setSelectedLeague] = useState<string | null>(null);
  const [leagueDetail, setLeagueDetail] = useState<LeagueDetail | null>(null);
  const [calendarView, setCalendarView] = useState<CalendarView>('week');
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [leaguesLoading, setLeaguesLoading] = useState(false);

  // Pro data for linking
  const [proPlayers, setProPlayers] = useState<ProPlayer[]>([]);
  const [proTeams, setProTeams] = useState<ProTeam[]>([]);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (open && drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        const target = e.target as HTMLElement;
        if (target.closest('[data-drawer-toggle]')) return;
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedLeague) { setSelectedLeague(null); setLeagueDetail(null); }
        else setOpen(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [selectedLeague]);

  // Load data when drawer opens
  useEffect(() => {
    if (!open) return;
    if (tab === 'patches' && patches.length === 0) fetchPatches();
    if (tab === 'tournaments' && tournaments.length === 0) fetchTournaments();
    if (tab === 'leagues' && allLeagues.length === 0) fetchLeagues();
  }, [open, tab]);

  // Re-fetch tournaments when filter changes
  useEffect(() => {
    if (open && tab === 'tournaments') fetchTournaments();
  }, [tournamentFilter, leagueFilter]);

  // Check for live matches on mount (for badge)
  useEffect(() => {
    fetch('/api/tournaments?filter=live')
      .then(r => r.json())
      .then(d => setLiveCount(d.totalMatches || 0))
      .catch(() => {});
  }, []);

  // Load pro data once
  useEffect(() => {
    if (proPlayers.length > 0) return;
    fetch('/pro-players.json')
      .then(r => r.json())
      .then(d => setProPlayers(d.players || []))
      .catch(() => {});
    fetch('/pro-teams.json')
      .then(r => r.json())
      .then(d => setProTeams(d.teams || []))
      .catch(() => {});
  }, []);

  const fetchPatches = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/patch-notes');
      const data = await res.json();
      if (data.patches) setPatches(data.patches);
    } catch {} finally { setLoading(false); }
  };

  const fetchTournaments = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (tournamentFilter !== 'all') params.set('filter', tournamentFilter);
      if (leagueFilter) params.set('league', leagueFilter);
      const res = await fetch(`/api/tournaments?${params}`);
      const data = await res.json();
      if (data.tournaments) setTournaments(data.tournaments);
      if (data.sortedLeagues) setSortedLeagues(data.sortedLeagues);
      if (data.leagueMap) setLeagueMap(data.leagueMap);
    } catch {} finally { setLoading(false); }
  };

  const fetchLeagues = async () => {
    setLeaguesLoading(true);
    try {
      const res = await fetch('/api/tournaments/standings');
      const data = await res.json();
      if (data.leagues) setAllLeagues(data.leagues);
    } catch {} finally { setLeaguesLoading(false); }
  };

  const fetchLeagueDetail = async (slug: string) => {
    setLeaguesLoading(true);
    setSelectedLeague(slug);
    try {
      const res = await fetch(`/api/tournaments/standings?league=${slug}`);
      const data = await res.json();
      if (data.league) setLeagueDetail(data);
      else setLeagueDetail(null);
    } catch { setLeagueDetail(null); } finally { setLeaguesLoading(false); }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  };

  const relativeTime = (dateStr: string) => {
    const now = new Date();
    const d = new Date(dateStr);
    const diffMs = d.getTime() - now.getTime();
    const diffH = Math.round(diffMs / (1000 * 60 * 60));
    if (diffH > 0 && diffH < 24) return `in ${diffH}h`;
    if (diffH >= 24) return `in ${Math.round(diffH / 24)}d`;
    return formatTime(dateStr);
  };

  // Group tournaments by date
  const groupedByDate = tournaments.reduce<Record<string, Tournament[]>>((acc, t) => {
    const date = formatDate(t.startTime);
    if (!acc[date]) acc[date] = [];
    acc[date].push(t);
    return acc;
  }, {});

  // Helper: find team link
  const getTeamLink = (teamName: string, teamCode: string): string | null => {
    const t = proTeams.find(pt =>
      pt.name.toLowerCase() === teamName.toLowerCase() ||
      pt.short.toLowerCase() === teamCode.toLowerCase()
    );
    return t ? `/teams/${t.id}` : null;
  };

  // Helper: find player link
  const getPlayerSlug = (playerName: string): string | null => {
    const p = proPlayers.find(pp => pp.proName.toLowerCase() === playerName.toLowerCase());
    if (!p || p.accounts.length === 0) return null;
    return `/player/${encodeURIComponent(p.accounts[0])}`;
  };

  return (
    <>
      {/* Toggle Button */}
      <button
        data-drawer-toggle
        onClick={() => setOpen(!open)}
        className={`fixed left-0 z-50 flex items-center gap-1.5 px-2 py-3 rounded-r-lg transition-all duration-300 ${
          open ? 'translate-x-[340px] sm:translate-x-[380px]' : 'translate-x-0'
        } bg-[#0d1526] border border-l-0 border-[#1e2a3a] hover:border-[#c89b3c]/50 group`}
        style={{ top: '50%', transform: `translateY(-50%) ${open ? 'translateX(340px)' : 'translateX(0)'}` }}
        title={open ? 'Menü schließen' : 'Spiele & Ligen'}
      >
        <div className="flex flex-col items-center gap-2">
          {liveCount > 0 && !open && (
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          )}
          <svg className={`w-4 h-4 text-[#c89b3c] transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d={open ? 'M15 19l-7-7 7-7' : 'M9 5l7 7-7 7'} />
          </svg>
          {!open && (
            <span className="text-[#8a9bb0] text-[9px] font-medium [writing-mode:vertical-lr] group-hover:text-white transition-colors">
              LIVE
            </span>
          )}
        </div>
      </button>

      {/* Backdrop */}
      {open && (
        <div className="fixed inset-0 bg-black/40 z-40 backdrop-blur-sm transition-opacity" onClick={() => setOpen(false)} />
      )}

      {/* Drawer */}
      <div
        ref={drawerRef}
        className={`fixed left-0 top-0 bottom-0 z-40 w-[340px] sm:w-[380px] bg-[#0a0e1a] border-r border-[#1e2a3a] transform transition-transform duration-300 ease-in-out ${
          open ? 'translate-x-0' : '-translate-x-full'
        } flex flex-col overflow-hidden`}
      >
        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b border-[#1e2a3a]">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[#c89b3c] text-sm font-medium">
              meta<span className="text-white">stats</span>
            </span>
            <button onClick={() => setOpen(false)} className="text-[#4a5a70] hover:text-white transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Tabs — 3 tabs now */}
          <div className="flex gap-1 bg-[#141c2e] rounded-lg p-0.5">
            <button
              onClick={() => setTab('tournaments')}
              className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-all ${
                tab === 'tournaments' ? 'bg-[#1e2a3a] text-white shadow-sm' : 'text-[#8a9bb0] hover:text-white'
              }`}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Spiele
              {liveCount > 0 && (
                <span className="bg-red-500/20 text-red-400 text-[9px] px-1 py-0.5 rounded-full font-bold">
                  {liveCount}
                </span>
              )}
            </button>
            <button
              onClick={() => { setTab('leagues'); if (allLeagues.length === 0) fetchLeagues(); }}
              className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-all ${
                tab === 'leagues' ? 'bg-[#1e2a3a] text-white shadow-sm' : 'text-[#8a9bb0] hover:text-white'
              }`}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              Ligen
            </button>
            <button
              onClick={() => setTab('patches')}
              className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-all ${
                tab === 'patches' ? 'bg-[#1e2a3a] text-white shadow-sm' : 'text-[#8a9bb0] hover:text-white'
              }`}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Patches
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {tab === 'tournaments' ? (
            loading ? <Spinner /> : (
              <TournamentsContent
                tournaments={tournaments}
                groupedByDate={groupedByDate}
                tournamentFilter={tournamentFilter}
                setTournamentFilter={setTournamentFilter}
                leagueFilter={leagueFilter}
                setLeagueFilter={setLeagueFilter}
                sortedLeagues={sortedLeagues}
                leagueMap={leagueMap}
                formatTime={formatTime}
                relativeTime={relativeTime}
                getTeamLink={getTeamLink}
              />
            )
          ) : tab === 'leagues' ? (
            leaguesLoading ? <Spinner /> : selectedLeague && leagueDetail ? (
              <LeagueDetailView
                detail={leagueDetail}
                onBack={() => { setSelectedLeague(null); setLeagueDetail(null); }}
                formatDate={formatDate}
                formatTime={formatTime}
                getTeamLink={getTeamLink}
                getPlayerSlug={getPlayerSlug}
                proPlayers={proPlayers}
              />
            ) : (
              <LeaguesCalendarContent
                leagues={allLeagues}
                tournaments={tournaments.length > 0 ? tournaments : []}
                calendarView={calendarView}
                setCalendarView={setCalendarView}
                calendarDate={calendarDate}
                setCalendarDate={setCalendarDate}
                onLeagueClick={fetchLeagueDetail}
                allTournaments={tournaments}
              />
            )
          ) : (
            loading ? <Spinner /> : <PatchesContent patches={patches} />
          )}
        </div>
      </div>
    </>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="w-5 h-5 border-2 border-[#c89b3c] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

/* ── Tournaments/Spiele Tab ── */
function TournamentsContent({
  tournaments, groupedByDate, tournamentFilter, setTournamentFilter,
  leagueFilter, setLeagueFilter, sortedLeagues, leagueMap, formatTime, relativeTime, getTeamLink,
}: {
  tournaments: Tournament[];
  groupedByDate: Record<string, Tournament[]>;
  tournamentFilter: 'all' | 'upcoming' | 'live';
  setTournamentFilter: (f: 'all' | 'upcoming' | 'live') => void;
  leagueFilter: string;
  setLeagueFilter: (l: string) => void;
  sortedLeagues: string[];
  leagueMap: Record<string, { name: string; region: string }>;
  formatTime: (d: string) => string;
  relativeTime: (d: string) => string;
  getTeamLink: (name: string, code: string) => string | null;
}) {
  const filters: { key: 'all' | 'upcoming' | 'live'; label: string }[] = [
    { key: 'all', label: 'Alle' },
    { key: 'live', label: 'Live' },
    { key: 'upcoming', label: 'Geplant' },
  ];

  return (
    <div>
      <div className="px-4 pt-3 pb-2 space-y-2">
        <div className="flex gap-1">
          {filters.map(f => (
            <button
              key={f.key}
              onClick={() => setTournamentFilter(f.key)}
              className={`px-2.5 py-1 rounded text-[10px] font-medium transition-colors ${
                tournamentFilter === f.key
                  ? 'bg-[#c89b3c]/20 text-[#c89b3c]'
                  : 'text-[#8a9bb0] hover:text-white hover:bg-[#141c2e]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <select
          value={leagueFilter}
          onChange={e => setLeagueFilter(e.target.value)}
          className="w-full bg-[#141c2e] border border-[#1e2a3a] rounded px-2 py-1.5 text-xs text-white outline-none focus:border-[#c89b3c]/50"
        >
          <option value="">Alle Ligen</option>
          {sortedLeagues.map(slug => (
            <option key={slug} value={slug}>
              {leagueMap[slug]?.name || slug} — {leagueMap[slug]?.region || ''}
            </option>
          ))}
        </select>
      </div>

      {tournaments.length === 0 ? (
        <div className="px-4 py-8 text-center text-[#4a5a70] text-xs">
          Keine Matches gefunden
        </div>
      ) : (
        Object.entries(groupedByDate).map(([date, matches]) => (
          <div key={date}>
            <div className="px-4 py-1.5 bg-[#0d1526] border-y border-[#1e2a3a] sticky top-0 z-10">
              <span className="text-[#8a9bb0] text-[10px] font-medium uppercase tracking-wider">{date}</span>
            </div>
            {matches.map((match, i) => (
              <MatchCard key={`${match.startTime}-${i}`} match={match} formatTime={formatTime} relativeTime={relativeTime} getTeamLink={getTeamLink} />
            ))}
          </div>
        ))
      )}
    </div>
  );
}

function MatchCard({ match, formatTime, relativeTime, getTeamLink }: {
  match: Tournament;
  formatTime: (d: string) => string;
  relativeTime: (d: string) => string;
  getTeamLink: (name: string, code: string) => string | null;
}) {
  const isLive = match.state === 'inProgress';
  const isUpcoming = match.state === 'unstarted';
  const team1 = match.teams?.[0];
  const team2 = match.teams?.[1];

  const TeamName = ({ team, align }: { team: Team; align: 'left' | 'right' }) => {
    const link = getTeamLink(team.name, team.code);
    const cls = `text-xs truncate ${
      team.outcome === 'win' ? 'text-green-400 font-medium' :
      team.outcome === 'loss' ? 'text-[#4a5a70]' : 'text-white'
    }`;

    return link ? (
      <Link href={link} className={`${cls} hover:underline`}>{team.name}</Link>
    ) : (
      <span className={cls}>{team.name}</span>
    );
  };

  return (
    <div className={`px-4 py-2.5 border-b border-[#141c2e] hover:bg-[#0d1526] transition-colors ${isLive ? 'bg-red-500/5' : ''}`}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          {isLive && <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />}
          <span className={`text-[10px] font-medium ${isLive ? 'text-red-400' : 'text-[#c89b3c]'}`}>
            {match.league}
          </span>
          {match.blockName && (
            <span className="text-[#4a5a70] text-[10px]">· {match.blockName}</span>
          )}
        </div>
        <span className={`text-[10px] ${isLive ? 'text-red-400 font-bold' : isUpcoming ? 'text-[#8a9bb0]' : 'text-[#4a5a70]'}`}>
          {isLive ? 'LIVE' : isUpcoming ? relativeTime(match.startTime) : formatTime(match.startTime)}
        </span>
      </div>

      {team1 && team2 && (
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 min-w-0">
            {team1.image && <img src={team1.image} alt="" className="w-5 h-5 rounded" />}
            <TeamName team={team1} align="left" />
          </div>
          <div className="flex items-center gap-1 px-2">
            <span className={`text-xs font-bold ${team1.outcome === 'win' ? 'text-green-400' : 'text-[#8a9bb0]'}`}>
              {match.state !== 'unstarted' ? team1.gameWins : '-'}
            </span>
            <span className="text-[#4a5a70] text-[10px]">:</span>
            <span className={`text-xs font-bold ${team2.outcome === 'win' ? 'text-green-400' : 'text-[#8a9bb0]'}`}>
              {match.state !== 'unstarted' ? team2.gameWins : '-'}
            </span>
          </div>
          <div className="flex-1 flex items-center justify-end gap-2 min-w-0">
            <TeamName team={team2} align="right" />
            {team2.image && <img src={team2.image} alt="" className="w-5 h-5 rounded" />}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Leagues & Calendar Tab ── */
function LeaguesCalendarContent({
  leagues, calendarView, setCalendarView, calendarDate, setCalendarDate, onLeagueClick, allTournaments,
}: {
  leagues: LeagueInfo[];
  tournaments: Tournament[];
  calendarView: CalendarView;
  setCalendarView: (v: CalendarView) => void;
  calendarDate: Date;
  setCalendarDate: (d: Date) => void;
  onLeagueClick: (slug: string) => void;
  allTournaments: Tournament[];
}) {
  // Build calendar data from tournaments
  const calendarEvents = useMemo(() => {
    const events: Record<string, Set<string>> = {};
    for (const t of allTournaments) {
      const dateKey = new Date(t.startTime).toISOString().split('T')[0];
      if (!events[dateKey]) events[dateKey] = new Set();
      events[dateKey].add(t.leagueSlug);
    }
    return events;
  }, [allTournaments]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Week view: get days of the current week
  const getWeekDays = (baseDate: Date) => {
    const start = new Date(baseDate);
    const day = start.getDay();
    const diff = day === 0 ? -6 : 1 - day; // Monday start
    start.setDate(start.getDate() + diff);
    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }
    return days;
  };

  // Month view: get all days of the month grid
  const getMonthDays = (baseDate: Date) => {
    const year = baseDate.getFullYear();
    const month = baseDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startOffset = (firstDay.getDay() + 6) % 7; // Monday start
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

  const weekDays = calendarView === 'week' ? getWeekDays(calendarDate) : [];
  const monthDays = calendarView === 'month' ? getMonthDays(calendarDate) : [];

  const dayNames = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const monthNames = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

  // Find league name by slug
  const getLeagueName = (slug: string) => {
    const l = leagues.find(l => l.slug === slug);
    return l?.name || slug;
  };

  const headerLabel = calendarView === 'week'
    ? `${weekDays[0]?.toLocaleDateString('de-DE', { day: '2-digit', month: 'short' })} – ${weekDays[6]?.toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' })}`
    : `${monthNames[calendarDate.getMonth()]} ${calendarDate.getFullYear()}`;

  return (
    <div>
      {/* View toggle + navigation */}
      <div className="px-4 pt-3 pb-2 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex gap-1 bg-[#141c2e] rounded p-0.5">
            <button
              onClick={() => setCalendarView('week')}
              className={`px-2.5 py-1 rounded text-[10px] font-medium transition-colors ${
                calendarView === 'week' ? 'bg-[#c89b3c]/20 text-[#c89b3c]' : 'text-[#8a9bb0] hover:text-white'
              }`}
            >
              Woche
            </button>
            <button
              onClick={() => setCalendarView('month')}
              className={`px-2.5 py-1 rounded text-[10px] font-medium transition-colors ${
                calendarView === 'month' ? 'bg-[#c89b3c]/20 text-[#c89b3c]' : 'text-[#8a9bb0] hover:text-white'
              }`}
            >
              Monat
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => navigateCalendar(-1)} className="p-1 text-[#8a9bb0] hover:text-white transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            </button>
            <button
              onClick={() => setCalendarDate(new Date())}
              className="px-2 py-0.5 text-[10px] text-[#c89b3c] hover:text-white transition-colors font-medium"
            >
              Heute
            </button>
            <button onClick={() => navigateCalendar(1)} className="p-1 text-[#8a9bb0] hover:text-white transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>
        </div>
        <div className="text-center text-xs text-white font-medium">{headerLabel}</div>
      </div>

      {/* Calendar Grid */}
      {calendarView === 'week' ? (
        <div className="px-4 pb-3">
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {dayNames.map(d => (
              <div key={d} className="text-center text-[9px] text-[#4a5a70] font-medium py-1">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {weekDays.map((day, i) => {
              const key = day.toISOString().split('T')[0];
              const events = calendarEvents[key];
              const isToday = day.toDateString() === today.toDateString();
              return (
                <div
                  key={i}
                  className={`rounded-lg p-1 min-h-[60px] border transition-colors ${
                    isToday ? 'border-[#c89b3c]/50 bg-[#c89b3c]/5' : 'border-[#1e2a3a] bg-[#0d1526]'
                  }`}
                >
                  <div className={`text-[10px] font-medium mb-1 ${isToday ? 'text-[#c89b3c]' : 'text-[#8a9bb0]'}`}>
                    {day.getDate()}
                  </div>
                  {events && Array.from(events).slice(0, 3).map(slug => (
                    <button
                      key={slug}
                      onClick={() => onLeagueClick(slug)}
                      className="block w-full text-left text-[8px] text-[#c89b3c] hover:text-white truncate leading-tight mb-0.5 transition-colors"
                      title={getLeagueName(slug)}
                    >
                      {getLeagueName(slug)}
                    </button>
                  ))}
                  {events && events.size > 3 && (
                    <span className="text-[8px] text-[#4a5a70]">+{events.size - 3}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="px-4 pb-3">
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {dayNames.map(d => (
              <div key={d} className="text-center text-[9px] text-[#4a5a70] font-medium py-1">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {monthDays.map((day, i) => {
              if (!day) return <div key={`empty-${i}`} className="min-h-[36px]" />;
              const key = day.toISOString().split('T')[0];
              const events = calendarEvents[key];
              const isToday = day.toDateString() === today.toDateString();
              return (
                <div
                  key={i}
                  className={`rounded p-0.5 min-h-[36px] border transition-colors ${
                    isToday ? 'border-[#c89b3c]/50 bg-[#c89b3c]/5' : events ? 'border-[#1e2a3a] bg-[#0d1526]' : 'border-transparent'
                  }`}
                >
                  <div className={`text-[9px] font-medium ${isToday ? 'text-[#c89b3c]' : 'text-[#8a9bb0]'}`}>
                    {day.getDate()}
                  </div>
                  {events && Array.from(events).slice(0, 2).map(slug => (
                    <button
                      key={slug}
                      onClick={() => onLeagueClick(slug)}
                      className="block w-full text-left text-[7px] text-[#c89b3c] hover:text-white truncate leading-tight transition-colors"
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
        </div>
      )}

      {/* League list */}
      <div className="border-t border-[#1e2a3a]">
        <div className="px-4 py-2 bg-[#0d1526]">
          <span className="text-[10px] text-[#8a9bb0] font-medium uppercase tracking-wider">Alle Ligen & Wettbewerbe</span>
        </div>
        {leagues.length === 0 ? (
          <div className="px-4 py-6 text-center text-[#4a5a70] text-xs">Keine Ligen gefunden</div>
        ) : (
          leagues.map(league => (
            <button
              key={league.slug}
              onClick={() => onLeagueClick(league.slug)}
              className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-[#0d1526] border-b border-[#141c2e] transition-colors text-left"
            >
              {league.image && (
                <img src={league.image} alt="" className="w-6 h-6 rounded object-contain bg-[#141c2e]" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-xs text-white font-medium truncate">{league.name}</div>
                {league.region && <div className="text-[10px] text-[#4a5a70]">{league.region}</div>}
              </div>
              <svg className="w-3.5 h-3.5 text-[#4a5a70]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/* ── League Detail View ── */
function LeagueDetailView({
  detail, onBack, formatDate, formatTime, getTeamLink, getPlayerSlug, proPlayers,
}: {
  detail: LeagueDetail;
  onBack: () => void;
  formatDate: (d: string) => string;
  formatTime: (d: string) => string;
  getTeamLink: (name: string, code: string) => string | null;
  getPlayerSlug: (name: string) => string | null;
  proPlayers: ProPlayer[];
}) {
  const [detailTab, setDetailTab] = useState<'standings' | 'matches'>('standings');

  // Get roster for a team
  const getTeamRoster = (teamCode: string): ProPlayer[] => {
    return proPlayers.filter(p =>
      p.team.toLowerCase().includes(teamCode.toLowerCase()) &&
      ['Top', 'Jungle', 'Mid', 'Bot', 'Support'].includes(p.role)
    );
  };

  // Split matches into results and upcoming
  const pastMatches = detail.matches.filter(m => m.state === 'completed').reverse();
  const upcomingMatches = detail.matches.filter(m => m.state === 'unstarted' || m.state === 'inProgress');

  return (
    <div>
      {/* Header with back button */}
      <div className="px-4 pt-3 pb-2 border-b border-[#1e2a3a]">
        <button onClick={onBack} className="flex items-center gap-1.5 text-[#8a9bb0] hover:text-white transition-colors mb-2">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          <span className="text-[10px] font-medium">Zurück</span>
        </button>
        <div className="flex items-center gap-3">
          {detail.league.image && (
            <img src={detail.league.image} alt="" className="w-8 h-8 rounded object-contain bg-[#141c2e]" />
          )}
          <div>
            <div className="text-sm text-white font-bold">{detail.league.name}</div>
            <div className="text-[10px] text-[#4a5a70]">
              {detail.league.region}
              {detail.tournament && ` · ${detail.tournament.name}`}
            </div>
          </div>
        </div>

        {/* Sub-tabs */}
        <div className="flex gap-1 mt-3">
          <button
            onClick={() => setDetailTab('standings')}
            className={`px-3 py-1 rounded text-[10px] font-medium transition-colors ${
              detailTab === 'standings' ? 'bg-[#c89b3c]/20 text-[#c89b3c]' : 'text-[#8a9bb0] hover:text-white hover:bg-[#141c2e]'
            }`}
          >
            Tabelle
          </button>
          <button
            onClick={() => setDetailTab('matches')}
            className={`px-3 py-1 rounded text-[10px] font-medium transition-colors ${
              detailTab === 'matches' ? 'bg-[#c89b3c]/20 text-[#c89b3c]' : 'text-[#8a9bb0] hover:text-white hover:bg-[#141c2e]'
            }`}
          >
            Spiele ({detail.matches.length})
          </button>
        </div>
      </div>

      {/* Detail content */}
      {detailTab === 'standings' ? (
        <div className="px-4 py-3">
          {detail.standings.length === 0 ? (
            <div className="py-6 text-center text-[#4a5a70] text-xs">Keine Standings verfügbar</div>
          ) : (
            <div className="space-y-1">
              {/* Table header */}
              <div className="flex items-center gap-2 px-2 py-1 text-[9px] text-[#4a5a70] font-medium uppercase tracking-wider">
                <span className="w-5 text-center">#</span>
                <span className="flex-1">Team</span>
                <span className="w-8 text-center">S</span>
                <span className="w-8 text-center">N</span>
                <span className="w-10 text-center">WR</span>
              </div>

              {detail.standings.map((entry) =>
                entry.teams.map((team) => {
                  const link = getTeamLink(team.name, team.code);
                  const total = team.wins + team.losses;
                  const wr = total > 0 ? Math.round((team.wins / total) * 100) : 0;
                  const roster = getTeamRoster(team.code);

                  return (
                    <div key={`${entry.ordinal}-${team.code}`} className="group">
                      <div className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#141c2e] transition-colors">
                        <span className="w-5 text-center text-[10px] text-[#4a5a70] font-medium">{entry.ordinal}</span>
                        <div className="flex-1 flex items-center gap-2 min-w-0">
                          {team.image && <img src={team.image} alt="" className="w-5 h-5 rounded" />}
                          {link ? (
                            <Link href={link} className="text-xs text-white font-medium truncate hover:text-[#c89b3c] transition-colors">
                              {team.name}
                            </Link>
                          ) : (
                            <span className="text-xs text-white font-medium truncate">{team.name}</span>
                          )}
                        </div>
                        <span className="w-8 text-center text-xs text-green-400 font-medium">{team.wins}</span>
                        <span className="w-8 text-center text-xs text-red-400 font-medium">{team.losses}</span>
                        <span className={`w-10 text-center text-[10px] font-bold ${wr >= 60 ? 'text-green-400' : wr >= 40 ? 'text-[#8a9bb0]' : 'text-red-400'}`}>
                          {wr}%
                        </span>
                      </div>

                      {/* Player roster (expandable on hover) */}
                      {roster.length > 0 && (
                        <div className="hidden group-hover:block ml-9 mb-1 pl-2 border-l border-[#1e2a3a]">
                          {roster.map(player => {
                            const playerLink = getPlayerSlug(player.proName);
                            return (
                              <div key={player.proName} className="flex items-center gap-1.5 py-0.5">
                                <span className="text-[9px] text-[#4a5a70] w-8">{player.role}</span>
                                {playerLink ? (
                                  <Link href={playerLink} className="text-[10px] text-[#8a9bb0] hover:text-[#c89b3c] transition-colors">
                                    {player.proName}
                                  </Link>
                                ) : (
                                  <span className="text-[10px] text-[#8a9bb0]">{player.proName}</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      ) : (
        <div>
          {/* Upcoming matches */}
          {upcomingMatches.length > 0 && (
            <>
              <div className="px-4 py-1.5 bg-[#0d1526] border-y border-[#1e2a3a] sticky top-0 z-10">
                <span className="text-[10px] text-[#8a9bb0] font-medium uppercase tracking-wider">Kommende Spiele</span>
              </div>
              {upcomingMatches.map((match, i) => (
                <DetailMatchRow key={`up-${i}`} match={match} formatDate={formatDate} formatTime={formatTime} getTeamLink={getTeamLink} />
              ))}
            </>
          )}

          {/* Past results */}
          {pastMatches.length > 0 && (
            <>
              <div className="px-4 py-1.5 bg-[#0d1526] border-y border-[#1e2a3a] sticky top-0 z-10">
                <span className="text-[10px] text-[#8a9bb0] font-medium uppercase tracking-wider">Bisherige Ergebnisse</span>
              </div>
              {pastMatches.map((match, i) => (
                <DetailMatchRow key={`past-${i}`} match={match} formatDate={formatDate} formatTime={formatTime} getTeamLink={getTeamLink} />
              ))}
            </>
          )}

          {upcomingMatches.length === 0 && pastMatches.length === 0 && (
            <div className="px-4 py-6 text-center text-[#4a5a70] text-xs">Keine Spiele verfügbar</div>
          )}
        </div>
      )}
    </div>
  );
}

function DetailMatchRow({ match, formatDate, formatTime, getTeamLink }: {
  match: { startTime: string; state: string; blockName: string; teams?: Team[] };
  formatDate: (d: string) => string;
  formatTime: (d: string) => string;
  getTeamLink: (name: string, code: string) => string | null;
}) {
  const team1 = match.teams?.[0];
  const team2 = match.teams?.[1];
  const isLive = match.state === 'inProgress';

  return (
    <div className={`px-4 py-2 border-b border-[#141c2e] hover:bg-[#0d1526] transition-colors ${isLive ? 'bg-red-500/5' : ''}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] text-[#4a5a70]">
          {formatDate(match.startTime)} · {formatTime(match.startTime)}
          {match.blockName && ` · ${match.blockName}`}
        </span>
        {isLive && <span className="text-[9px] text-red-400 font-bold">LIVE</span>}
      </div>
      {team1 && team2 && (
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 min-w-0">
            {team1.image && <img src={team1.image} alt="" className="w-4 h-4 rounded" />}
            {(() => {
              const link = getTeamLink(team1.name, team1.code);
              const cls = `text-[11px] truncate ${team1.outcome === 'win' ? 'text-green-400 font-medium' : team1.outcome === 'loss' ? 'text-[#4a5a70]' : 'text-white'}`;
              return link ? <Link href={link} className={`${cls} hover:underline`}>{team1.name}</Link> : <span className={cls}>{team1.name}</span>;
            })()}
          </div>
          <div className="flex items-center gap-1 px-1.5">
            <span className={`text-[11px] font-bold ${team1.outcome === 'win' ? 'text-green-400' : 'text-[#8a9bb0]'}`}>
              {match.state !== 'unstarted' ? team1.gameWins : '-'}
            </span>
            <span className="text-[#4a5a70] text-[9px]">:</span>
            <span className={`text-[11px] font-bold ${team2.outcome === 'win' ? 'text-green-400' : 'text-[#8a9bb0]'}`}>
              {match.state !== 'unstarted' ? team2.gameWins : '-'}
            </span>
          </div>
          <div className="flex-1 flex items-center justify-end gap-2 min-w-0">
            {(() => {
              const link = getTeamLink(team2.name, team2.code);
              const cls = `text-[11px] truncate ${team2.outcome === 'win' ? 'text-green-400 font-medium' : team2.outcome === 'loss' ? 'text-[#4a5a70]' : 'text-white'}`;
              return link ? <Link href={link} className={`${cls} hover:underline`}>{team2.name}</Link> : <span className={cls}>{team2.name}</span>;
            })()}
            {team2.image && <img src={team2.image} alt="" className="w-4 h-4 rounded" />}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Patches Tab ── */
function PatchesContent({ patches }: { patches: PatchNote[] }) {
  return (
    <div className="px-4 py-3 space-y-2">
      {patches.map((patch, i) => (
        <a
          key={patch.version}
          href={patch.url}
          target="_blank"
          rel="noopener noreferrer"
          className={`block rounded-lg border transition-all hover:border-[#c89b3c]/50 hover:bg-[#141c2e] ${
            i === 0 ? 'border-[#c89b3c]/30 bg-[#c89b3c]/5' : 'border-[#1e2a3a] bg-[#0d1526]'
          }`}
        >
          <div className="px-3 py-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`text-sm font-bold ${i === 0 ? 'text-[#c89b3c]' : 'text-white'}`}>
                  Patch {patch.version}
                </span>
                {patch.isNew && (
                  <span className="bg-[#c89b3c]/20 text-[#c89b3c] text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase">
                    Aktuell
                  </span>
                )}
              </div>
              <span className="text-[#4a5a70] text-[10px]">{patch.date}</span>
            </div>
            {patch.highlights.length > 0 && (
              <div className="mt-1.5 space-y-0.5">
                {patch.highlights.map((h, j) => (
                  <div key={j} className="text-[#8a9bb0] text-[11px] flex items-start gap-1.5">
                    <span className="text-[#c89b3c] mt-0.5">·</span>
                    {h}
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-1 mt-1.5 text-[#4a5a70] text-[10px]">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Offizielle Patch Notes
            </div>
          </div>
        </a>
      ))}
    </div>
  );
}
