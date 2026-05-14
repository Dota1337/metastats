'use client';
import { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useI18n, LOCALE_MAP } from '../lib/i18n';
import { detectGameFromPath, type Game } from '../lib/games';

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

// TFT tournaments come from our own Liquipedia-backed crawler (no team-vs-
// team matches like LoL). Different shape, separate rendering branch.
interface TftTournament {
  id: string;
  name: string;
  tier: string | null;
  region: string | null;
  set_number: number | null;
  start_date: string | null;
  end_date: string | null;
  status: 'upcoming' | 'live' | 'past';
  prize_pool_usd: number | null;
  twitch_channel: string | null;
}

type Tab = 'patches' | 'tournaments';
type TournamentFilter = 'all' | 'upcoming' | 'live';

export default function SideDrawer() {
  const { t, lang } = useI18n();
  const locale = LOCALE_MAP[lang];
  const pathname = usePathname() || '/';
  // Game detection is the only thing that switches the drawer's data source.
  // LoL → /api/tournaments (Riot Esports API).
  // TFT → /api/tft/tournaments (Liquipedia-backed).
  const game: Game = detectGameFromPath(pathname);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('tournaments');
  const [patches, setPatches] = useState<PatchNote[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [tftTournaments, setTftTournaments] = useState<TftTournament[]>([]);
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

  // Load data when drawer opens — split by game so we only hit the API the
  // user actually needs for the page they're on.
  useEffect(() => {
    if (!open) return;
    if (tab === 'patches' && patches.length === 0) fetchPatches();
    if (tab === 'tournaments') {
      if (game === 'tft' && tftTournaments.length === 0) fetchTftTournaments();
      if (game === 'lol' && tournaments.length === 0) fetchTournaments();
    }
  }, [open, tab, game]);

  // Reset patches when the active game changes — otherwise the drawer keeps
  // showing the previous game's patches (LoL on a TFT page after switching).
  // The cached states for tournaments stay because each game has its own
  // state variable, but patches share one slot.
  useEffect(() => {
    setPatches([]);
  }, [game]);

  // Re-fetch tournaments when filter changes (only the LoL path has filters;
  // TFT drawer shows the unfiltered live + upcoming list).
  useEffect(() => {
    if (open && tab === 'tournaments' && game === 'lol') fetchTournaments();
  }, [tournamentFilter, leagueFilter]);

  // Live-count badge — counts the live ones for the active game so the
  // pulsing dot is in-context.
  useEffect(() => {
    if (game === 'tft') {
      fetch('/api/tft/tournaments?status=live')
        .then(r => r.json())
        .then(d => setLiveCount((d.tournaments || []).length))
        .catch(() => {});
    } else {
      fetch('/api/tournaments?filter=live')
        .then(r => r.json())
        .then(d => setLiveCount(d.totalMatches || 0))
        .catch(() => {});
    }
  }, [game]);

  const fetchTftTournaments = async () => {
    setLoading(true);
    try {
      // Drawer surfaces what's actually relevant right now — live + upcoming.
      // Past events live on the /tft/tournaments full page if a user wants
      // to browse history.
      const [live, upcoming] = await Promise.all([
        fetch('/api/tft/tournaments?status=live').then(r => r.json()).catch(() => ({ tournaments: [] })),
        fetch('/api/tft/tournaments?status=upcoming&limit=20').then(r => r.json()).catch(() => ({ tournaments: [] })),
      ]);
      setTftTournaments([
        ...(live.tournaments || []),
        ...(upcoming.tournaments || []),
      ]);
    } catch {} finally {
      setLoading(false);
    }
  };

  const fetchPatches = async () => {
    setLoading(true);
    try {
      // Game-aware patch source: TFT pulls from our own crawl_meta-derived
      // list (URLs point to teamfighttactics.lol...); LoL keeps the existing
      // DDragon-driven endpoint.
      const endpoint = game === 'tft' ? '/api/tft/patch-notes' : '/api/patch-notes';
      const res = await fetch(endpoint);
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
            <span className="text-[#a0b0c5] text-[9px] font-medium [writing-mode:vertical-lr] group-hover:text-white transition-colors">
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
            <button onClick={() => setOpen(false)} className="text-[#7a8aa0] hover:text-white transition-colors">
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
                  : 'text-[#a0b0c5] hover:text-white'
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
                  : 'text-[#a0b0c5] hover:text-white'
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
            // Game-aware split: the LoL drawer renders the existing Riot-
            // Esports schedule view; the TFT drawer renders a simpler
            // "Liquipedia-tournament-card list" since TFT esports has no
            // team-vs-team matches like LoL does.
            game === 'tft' ? (
              <TftTournamentsContent tournaments={tftTournaments} locale={locale} t={t} />
            ) : (
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
            )
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
                  : 'text-[#a0b0c5] hover:text-white hover:bg-[#141c2e]'
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
        <div className="px-4 py-8 text-center text-[#7a8aa0] text-xs">
          {t('drawer.noMatches')}
        </div>
      ) : (
        Object.entries(groupedByDate).map(([date, matches]) => (
          <div key={date}>
            <div className="px-4 py-1.5 bg-[#0d1526] border-y border-[#1e2a3a] sticky top-0 z-10">
              <span className="text-[#a0b0c5] text-[10px] font-medium uppercase tracking-wider">{date}</span>
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
            <span className="text-[#7a8aa0] text-[10px]">· {match.blockName}</span>
          )}
        </div>
        <span className={`text-[10px] ${isLive ? 'text-red-400 font-bold' : isUpcoming ? 'text-[#a0b0c5]' : 'text-[#7a8aa0]'}`}>
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
              team1.outcome === 'loss' ? 'text-[#7a8aa0]' : 'text-white'
            }`}>
              {team1.name}
            </span>
          </div>

          {/* Score */}
          <div className="flex items-center gap-1 px-2">
            <span className={`text-xs font-bold ${team1.outcome === 'win' ? 'text-green-400' : 'text-[#a0b0c5]'}`}>
              {match.state !== 'unstarted' ? team1.gameWins : '-'}
            </span>
            <span className="text-[#7a8aa0] text-[10px]">:</span>
            <span className={`text-xs font-bold ${team2.outcome === 'win' ? 'text-green-400' : 'text-[#a0b0c5]'}`}>
              {match.state !== 'unstarted' ? team2.gameWins : '-'}
            </span>
          </div>

          <div className="flex-1 flex items-center justify-end gap-2 min-w-0">
            <span className={`text-xs truncate ${
              team2.outcome === 'win' ? 'text-green-400 font-medium' :
              team2.outcome === 'loss' ? 'text-[#7a8aa0]' : 'text-white'
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

/* ── TFT Tournaments Tab ── */
// Compact card list of Liquipedia-sourced TFT tournaments — live ones
// pinned at the top with a pulsing red dot, then upcoming, then a few
// recent past ones. Click → /tft/tournaments/[slug].
function TftTournamentsContent({
  tournaments, locale, t,
}: { tournaments: TftTournament[]; locale: string; t: (key: any) => string }) {
  const tierColor = (tier: string | null) => {
    if (tier === 'S') return '#e0c75a';
    if (tier === 'A') return '#7B61FF';
    if (tier === 'B') return '#3a8ddc';
    return '#5a6a80';
  };
  const dateFmt = (s: string | null) => s ? new Date(s).toLocaleDateString(locale, { day: '2-digit', month: 'short' }) : '—';

  if (tournaments.length === 0) {
    return <div className="px-4 py-8 text-center text-[#7a8aa0] text-xs">{t('drawer.noMatches')}</div>;
  }

  // Group by status — live first (pulsing red header), then upcoming. Past
  // events are filtered out at the fetch layer so they never appear in the
  // drawer.
  const live = tournaments.filter(x => x.status === 'live');
  const upcoming = tournaments.filter(x => x.status === 'upcoming');

  return (
    <div>
      {live.length > 0 && (
        <SectionHeader label={t('drawer.live')} count={live.length} accent="#e44040" pulse />
      )}
      {live.map(tournament => (
        <TftTournamentRow key={tournament.id} tournament={tournament} dateFmt={dateFmt} tierColor={tierColor} />
      ))}
      {upcoming.length > 0 && (
        <SectionHeader label={t('drawer.planned')} count={upcoming.length} accent="#3ecf8e" />
      )}
      {upcoming.map(tournament => (
        <TftTournamentRow key={tournament.id} tournament={tournament} dateFmt={dateFmt} tierColor={tierColor} />
      ))}
    </div>
  );
}

function SectionHeader({ label, count, accent, pulse }: { label: string; count: number; accent: string; pulse?: boolean }) {
  return (
    <div className="px-4 py-1.5 bg-[#0d1526] border-y border-[#1e2a3a] sticky top-0 z-10 flex items-center gap-2">
      <span className="relative flex h-2 w-2">
        {pulse && <span className="absolute inset-0 rounded-full opacity-75 animate-ping" style={{ backgroundColor: accent }} />}
        <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: accent }} />
      </span>
      <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: accent }}>
        {label} <span className="opacity-60">({count})</span>
      </span>
    </div>
  );
}

function TftTournamentRow({
  tournament, dateFmt, tierColor,
}: { tournament: TftTournament; dateFmt: (s: string | null) => string; tierColor: (t: string | null) => string }) {
  const color = tierColor(tournament.tier);
  return (
    <a
      href={`/tft/tournaments/${encodeURIComponent(tournament.id)}`}
      className="block px-4 py-2.5 border-b border-[#141c2e] hover:bg-[#0d1526] transition-colors"
    >
      <div className="flex items-start gap-2.5">
        {tournament.tier && (
          <div
            className="flex items-center justify-center w-7 h-7 rounded text-[10px] font-bold flex-shrink-0"
            style={{ color, backgroundColor: `${color}20`, border: `1px solid ${color}55` }}
          >
            {tournament.tier}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-white text-xs font-medium truncate">{cleanTournamentName(tournament.name)}</div>
          <div className="text-[#7a8aa0] text-[10px] mt-0.5">
            {dateFmt(tournament.start_date)} – {dateFmt(tournament.end_date)}
            {tournament.region && ` · ${tournament.region}`}
          </div>
        </div>
        {tournament.prize_pool_usd != null && (
          <div className="text-[#7B61FF] text-[10px] font-medium tabular-nums flex-shrink-0">
            ${(tournament.prize_pool_usd / 1000).toFixed(0)}k
          </div>
        )}
      </div>
    </a>
  );
}

// Strip the Liquipedia set-codename baked into tournament names — same
// helper used on the list + detail pages. Single source of truth could
// live in a shared file, but the function is 3 lines so duplicating it
// keeps SideDrawer self-contained.
function cleanTournamentName(raw: string): string {
  let name = raw;
  name = name.replace(/\s*\([^)]+\)\s*$/, '');
  name = name.replace(/^[^/]+\/(.+)$/, '$1');
  name = name.replace(/\//g, ' ');
  return name.trim();
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
              <span className="text-[#7a8aa0] text-[10px]">{patch.date}</span>
            </div>
            {patch.highlights.length > 0 && (
              <div className="mt-1.5 space-y-0.5">
                {patch.highlights.map((h, j) => (
                  <div key={j} className="text-[#a0b0c5] text-[11px] flex items-start gap-1.5">
                    <span className="text-[#c89b3c] mt-0.5">·</span>
                    {h}
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-1 mt-1.5 text-[#7a8aa0] text-[10px]">
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
