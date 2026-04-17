'use client';
import { useState, useEffect, useRef } from 'react';
import { useI18n, LOCALE_MAP } from '../lib/i18n';

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

type Tab = 'patches' | 'tournaments';
type TournamentFilter = 'all' | 'upcoming' | 'live';

export default function SideDrawer() {
  const { t, lang } = useI18n();
  const locale = LOCALE_MAP[lang];
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('tournaments');
  const [patches, setPatches] = useState<PatchNote[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [tournamentFilter, setTournamentFilter] = useState<TournamentFilter>('all');
  const [leagueFilter, setLeagueFilter] = useState('');
  const [sortedLeagues, setSortedLeagues] = useState<string[]>([]);
  const [leagueMap, setLeagueMap] = useState<Record<string, { name: string; region: string }>>({});
  const [loading, setLoading] = useState(false);
  const [liveCount, setLiveCount] = useState(0);
  const drawerRef = useRef<HTMLDivElement>(null);

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
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Load data when drawer opens
  useEffect(() => {
    if (!open) return;
    if (tab === 'patches' && patches.length === 0) fetchPatches();
    if (tab === 'tournaments' && tournaments.length === 0) fetchTournaments();
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

  const fetchPatches = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/patch-notes');
      const data = await res.json();
      if (data.patches) setPatches(data.patches);
    } catch {} finally {
      setLoading(false);
    }
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
    } catch {} finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
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

  return (
    <>
      {/* Toggle Button — fixed left side */}
      <button
        data-drawer-toggle
        onClick={() => setOpen(!open)}
        className={`fixed left-0 z-50 flex items-center gap-1.5 px-2 py-3 rounded-r-lg transition-all duration-300 ${
          open ? 'translate-x-[340px] sm:translate-x-[380px]' : 'translate-x-0'
        } bg-[#0d1526] border border-l-0 border-[#1e2a3a] hover:border-[#c89b3c]/50 group`}
        style={{ top: '50%', transform: `translateY(-50%) ${open ? 'translateX(340px)' : 'translateX(0)'}` }}
        title={open ? t('drawer.close') : t('drawer.open')}
      >
        <div className="flex flex-col items-center gap-2">
          {liveCount > 0 && !open && (
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" aria-hidden="true" />
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

          {/* Tabs */}
          <div className="flex gap-1 bg-[#141c2e] rounded-lg p-0.5">
            <button
              onClick={() => setTab('tournaments')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                tab === 'tournaments'
                  ? 'bg-[#1e2a3a] text-white shadow-sm'
                  : 'text-[#8a9bb0] hover:text-white'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {t('drawer.tournaments')}
              {liveCount > 0 && (
                <span className="bg-red-500/20 text-red-400 text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                  {liveCount} LIVE
                </span>
              )}
            </button>
            <button
              onClick={() => setTab('patches')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                tab === 'patches'
                  ? 'bg-[#1e2a3a] text-white shadow-sm'
                  : 'text-[#8a9bb0] hover:text-white'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              {t('drawer.patchNotes')}
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-5 h-5 border-2 border-[#c89b3c] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : tab === 'tournaments' ? (
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
              t={t}
            />
          ) : (
            <PatchesContent patches={patches} t={t} />
          )}
        </div>
      </div>
    </>
  );
}

/* ── Tournaments Tab ── */
function TournamentsContent({
  tournaments, groupedByDate, tournamentFilter, setTournamentFilter,
  leagueFilter, setLeagueFilter, sortedLeagues, leagueMap, formatTime, relativeTime, t,
}: {
  tournaments: Tournament[];
  groupedByDate: Record<string, Tournament[]>;
  tournamentFilter: TournamentFilter;
  setTournamentFilter: (f: TournamentFilter) => void;
  leagueFilter: string;
  setLeagueFilter: (l: string) => void;
  sortedLeagues: string[];
  leagueMap: Record<string, { name: string; region: string }>;
  formatTime: (d: string) => string;
  relativeTime: (d: string) => string;
  t: (key: any) => string;
}) {
  const filters: { key: TournamentFilter; label: string }[] = [
    { key: 'all', label: t('drawer.all') },
    { key: 'live', label: t('drawer.live') },
    { key: 'upcoming', label: t('drawer.planned') },
  ];

  return (
    <div>
      {/* Filters */}
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
          <option value="">{t('drawer.allLeagues')}</option>
          {sortedLeagues.map(slug => (
            <option key={slug} value={slug}>
              {leagueMap[slug]?.name || slug} — {leagueMap[slug]?.region || ''}
            </option>
          ))}
        </select>
      </div>

      {/* Match list */}
      {tournaments.length === 0 ? (
        <div className="px-4 py-8 text-center text-[#4a5a70] text-xs">
          {t('drawer.noMatches')}
        </div>
      ) : (
        Object.entries(groupedByDate).map(([date, matches]) => (
          <div key={date}>
            <div className="px-4 py-1.5 bg-[#0d1526] border-y border-[#1e2a3a] sticky top-0 z-10">
              <span className="text-[#8a9bb0] text-[10px] font-medium uppercase tracking-wider">{date}</span>
            </div>
            {matches.map((match, i) => (
              <MatchCard key={`${match.startTime}-${i}`} match={match} formatTime={formatTime} relativeTime={relativeTime} t={t} />
            ))}
          </div>
        ))
      )}
    </div>
  );
}

function MatchCard({ match, formatTime, relativeTime, t }: { match: Tournament; formatTime: (d: string) => string; relativeTime: (d: string) => string; t: (key: any) => string }) {
  const isLive = match.state === 'inProgress';
  const isUpcoming = match.state === 'unstarted';
  const team1 = match.teams?.[0];
  const team2 = match.teams?.[1];
  const href = match.leagueSlug ? `/ligen?league=${encodeURIComponent(match.leagueSlug)}` : '/ligen';

  return (
    <a
      href={href}
      title={t('drawer.viewTournament')}
      onClick={(e) => {
        // Allow Ctrl/Cmd-click to open in new tab, otherwise navigate same tab and let drawer close via route change
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        window.location.href = href;
        e.preventDefault();
      }}
      className={`block px-4 py-2.5 border-b border-[#141c2e] hover:bg-[#0d1526] transition-colors cursor-pointer ${isLive ? 'bg-red-500/5 hover:bg-red-500/10' : ''}`}
    >
      {/* League + Time */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          {isLive && <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" aria-hidden="true" />}
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

      {/* Teams */}
      {team1 && team2 && (
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 min-w-0">
            {team1.image && <img src={team1.image} alt="" className="w-5 h-5 rounded" />}
            <span className={`text-xs truncate ${
              team1.outcome === 'win' ? 'text-green-400 font-medium' :
              team1.outcome === 'loss' ? 'text-[#4a5a70]' : 'text-white'
            }`}>
              {team1.name}
            </span>
          </div>

          {/* Score */}
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
            <span className={`text-xs truncate ${
              team2.outcome === 'win' ? 'text-green-400 font-medium' :
              team2.outcome === 'loss' ? 'text-[#4a5a70]' : 'text-white'
            }`}>
              {team2.name}
            </span>
            {team2.image && <img src={team2.image} alt="" className="w-5 h-5 rounded" />}
          </div>
        </div>
      )}
    </a>
  );
}

/* ── Patches Tab ── */
function PatchesContent({ patches, t }: { patches: PatchNote[]; t: (key: any) => string }) {
  return (
    <div className="px-4 py-3 space-y-2">
      {patches.map((patch, i) => (
        <a
          key={patch.version}
          href={patch.url}
          target="_blank"
          rel="noopener noreferrer"
          className={`block rounded-lg border transition-all hover:border-[#c89b3c]/50 hover:bg-[#141c2e] ${
            i === 0
              ? 'border-[#c89b3c]/30 bg-[#c89b3c]/5'
              : 'border-[#1e2a3a] bg-[#0d1526]'
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
                    {t('drawer.current')}
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
              {t('drawer.officialNotes')}
            </div>
          </div>
        </a>
      ))}
    </div>
  );
}
