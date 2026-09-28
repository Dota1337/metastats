'use client';
import { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useI18n, LANGUAGES } from '../lib/i18n';
import { detectGameFromPath } from '../lib/games';
import { TFT_COACH_ENABLED, TFT_PROS_ENABLED } from '../lib/feature-flags';
import { useAuth } from '../lib/auth-context';
import { tftProfileHref, tftRankLabel, tftRegionLabel, type TftAccountHit } from '../lib/tft-player-search';

interface NavProps {
  active?:
    | 'search' | 'leaderboard' | 'champions' | 'marktwert' | 'analyse' | 'teams' | 'ligen'
    | 'units' | 'items' | 'augments' | 'comps' | 'traits' | 'tournaments' | 'saved' | 'builder' | 'pros' | 'regions'
    | 'onetricks' | 'rising' | 'patch' | 'community' | 'coach' | 'explorer' | 'tools';
}

interface SearchResult {
  // 'account' = echter Treffer aus dem TFT-Namensverzeichnis (mit Region),
  // 'none' = Name ohne Tag und kein Treffer. 'player' = freie Eingabe.
  type: 'player' | 'champion' | 'account' | 'none';
  name: string;
  id?: string;
  image?: string;
  href?: string;
  sub?: string;
}


// Die Meta-Seiten stehen als zweite Zeile unter der TFT-Hauptleiste (vorher
// ein Klappmenue). Eine Liste fuer Desktop-Zeile und Handy-Menue.
const TFT_META_LINKS = [
  { href: '/tft/meta-pulse', label: 'nav.metaPulse', pulse: true },
  { href: '/tft/comps', label: 'nav.comps' },
  { href: '/tft/units', label: 'nav.units' },
  { href: '/tft/items', label: 'nav.items' },
  { href: '/tft/augments', label: 'nav.augments' },
  { href: '/tft/tools/tables', label: 'nav.tables', base: '/tft/tools/tables' },
  { href: '/tft/traits', label: 'nav.traits' },
  { href: '/tft/rising', label: 'nav.rising' },
  { href: '/tft/regions', label: 'nav.regions' },
  { href: '/tft/patch/winners', label: 'nav.patchWinners', base: '/tft/patch' },
  { href: '/tft/explorer', label: 'nav.explorer' },
  { href: '/tft/tools/odds', label: 'nav.rollOdds', base: '/tft/tools/odds' },
] as const;

// Aktiv nach Adresse statt nach dem `active`-Wert: mehrere Seiten (Meta-Pulse,
// Regionen, Patch, Builder, Community) geben "comps" mit. Laengster passender
// Pfad gewinnt; die Community-Comps gehoeren zur Hauptleiste, nicht zu Comps.
function activeMetaHref(pathname: string): string | null {
  if (pathname === '/tft/comps/community' || pathname.startsWith('/tft/comps/community/')) return null;
  let best: { href: string; len: number } | null = null;
  for (const l of TFT_META_LINKS) {
    const base = 'base' in l ? l.base : l.href;
    if ((pathname === base || pathname.startsWith(base + '/')) && (!best || base.length > best.len)) {
      best = { href: l.href, len: base.length };
    }
  }
  return best?.href ?? null;
}

export default function Nav({ active }: NavProps) {
  const { lang, setLang, t } = useI18n();
  const { user, signOut } = useAuth();
  const pathname = usePathname() || '/';
  const game = detectGameFromPath(pathname);
  const [langOpen, setLangOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [champions, setChampions] = useState<{ id: string; name: string }[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  // TFT: Treffer ueber alle Server. null = noch keine Antwort fuer die
  // aktuelle Eingabe (dann keine Spielerzeile, statt kurz "keine Treffer").
  const [tftHits, setTftHits] = useState<{ q: string; hits: TftAccountHit[] } | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  // Eigene Markierung fuer die Handy-Suchleiste. Frueher hing searchRef an
  // beiden Bloecken; die (unsichtbare) Handy-Leiste ueberschrieb ihn, und ein
  // Klick auf einen Desktop-Treffer galt als "Klick daneben" — die Liste
  // schloss sich, bevor der Klick ankam.
  const mobileSearchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const linkClass = (key: NavProps['active']) =>
    key === active ? 'text-white text-sm' : 'text-fg-secondary text-sm hover:text-white';

  const metaHref = activeMetaHref(pathname);
  const metaLinkClass = (l: (typeof TFT_META_LINKS)[number]) =>
    'pulse' in l ? 'text-sm text-[#3ecf8e]' : l.href === metaHref ? 'text-white text-sm' : 'text-fg-secondary text-sm hover:text-white';

  const currentLang = LANGUAGES.find(l => l.code === lang) || LANGUAGES[0];

  // Load champion list once for autocomplete
  useEffect(() => {
    fetch('https://ddragon.leagueoflegends.com/api/versions.json')
      .then(r => r.json())
      .then(versions => fetch(`https://ddragon.leagueoflegends.com/cdn/${versions[0]}/data/en_US/champion.json`))
      .then(r => r.json())
      .then(data => {
        const list = Object.values(data.data).map((c: any) => ({ id: c.id, name: c.name }));
        setChampions(list);
      })
      .catch(() => {});
  }, []);

  // Close search on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const inside = searchRef.current?.contains(target) || mobileSearchRef.current?.contains(target);
      if (searchRef.current && !inside) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // TFT: Namenssuche ueber alle Server, kurz entprellt. Ab 3 Zeichen im Namen
  // (ohne Leerzeichen) — darunter antwortet die Route ohnehin leer.
  useEffect(() => {
    if (game !== 'tft') return;
    const q = searchQuery.trim();
    if (q.split('#')[0].replace(/\s/g, '').length < 3) { setTftHits(null); return; }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/tft/search-players?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: { players?: TftAccountHit[] }) => setTftHits({ q, hits: d.players || [] }))
        .catch(() => { if (!ctrl.signal.aborted) setTftHits(null); });
    }, 150);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [searchQuery, game]);

  // Filter results as user types
  useEffect(() => {
    if (!searchQuery.trim()) { setResults([]); return; }
    const q = searchQuery.toLowerCase();
    const champMatches = champions
      .filter(c => c.name.toLowerCase().includes(q))
      .slice(0, 5)
      .map(c => ({ type: 'champion' as const, name: c.name, id: c.id }));

    // If input looks like a player name (or has #), show player suggestion
    const playerResults: SearchResult[] = [];
    if (game === 'tft') {
      playerResults.push(...tftPlayerResults(searchQuery.trim()));
    } else if (searchQuery.trim().length >= 2) {
      playerResults.push({ type: 'player', name: searchQuery.trim() });
    }

    setResults([...playerResults, ...champMatches]);
  }, [searchQuery, champions, game, tftHits]);

  const playerHref = (raw: string) => {
    const parts = raw.split('#');
    const gameName = parts[0].trim();
    const tag = parts[1]?.trim() || 'EUW';
    const slug = encodeURIComponent(gameName) + '--' + encodeURIComponent(tag);
    // TFT: ohne Region — die Profilseite findet den Server selbst.
    if (game === 'tft') return `/tft/player/${slug}`;
    return `/player/${slug}?region=euw1`;
  };

  // Spielerzeilen fuer TFT: echte Treffer mit Region · Rang. Ohne Treffer:
  // mit Tag die freie Eingabe (Profil sucht den Server selbst), ohne Tag
  // "Keine Spieler gefunden". Solange die Antwort fehlt, keine Spielerzeile.
  const tftPlayerResults = (q: string): SearchResult[] => {
    const hasTag = q.includes('#') && q.split('#')[1].trim().length > 0;
    if (!tftHits || tftHits.q !== q) return hasTag ? [{ type: 'player', name: q }] : [];
    if (tftHits.hits.length > 0) {
      return tftHits.hits.map(h => {
        const regionLabel = tftRegionLabel(h.region);
        const rank = tftRankLabel(h, l => t(`tier.${l}` as Parameters<typeof t>[0]));
        return {
          type: 'account' as const,
          name: `${h.gameName}#${h.tagLine}`,
          href: tftProfileHref(h),
          sub: rank ? `${regionLabel} · ${rank}` : regionLabel,
        };
      });
    }
    return hasTag ? [{ type: 'player', name: q }] : [{ type: 'none', name: t('lb.noPlayers') }];
  };

  const navigateToResult = (result: SearchResult) => {
    if (result.type === 'none') return;
    if (result.type === 'account' && result.href) {
      window.location.href = result.href;
    } else if (result.type === 'champion') {
      // No champion-detail route in TFT — send the user to the units list
      window.location.href = game === 'tft' ? '/tft/units' : `/champions/${result.id}`;
    } else {
      window.location.href = playerHref(result.name);
    }
    setSearchOpen(false);
    setSearchQuery('');
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
      const q = searchQuery.trim();
      const hasTag = q.includes('#') && q.split('#')[1].trim().length > 0;
      if (game === 'tft' && !hasTag) {
        // Ohne Tag ist der Name mehrdeutig: Liste aller Konten mit diesem
        // Namen samt Region, bei genau einem direkt weiter (/tft/search).
        window.location.href = `/tft/search?q=${encodeURIComponent(q.split('#')[0].trim())}`;
        setSearchOpen(false);
        setSearchQuery('');
        return;
      }
      const first = results[0];
      if (first?.type === 'none') return;
      window.location.href = first?.type === 'account' && first.href ? first.href : playerHref(searchQuery);
      setSearchOpen(false);
      setSearchQuery('');
    }
    if (e.key === 'Escape') {
      setSearchOpen(false);
      setSearchQuery('');
    }
  };

  const homeHref = game === 'tft' ? '/tft/comps' : '/';

  return (
    // Kein data-game mehr: der Accent-Anker ist app/tft/layout.tsx, der den
    // kompletten /tft-Baum inkl. dieser Nav umschliesst. Das Attribut hier hat
    // denselben Wert nur ein zweites Mal gesetzt.
    <nav className="bg-surface-sunken border-b border-border-subtle px-4 sm:px-6 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center flex-1">
          {/* text-accent statt zweier hartkodierter Hexe — das war die dritte
              unabhängige Stelle, an der beide Spielfarben standen. */}
          <a href={homeHref} className="text-accent text-lg font-medium flex-shrink-0">
            meta<span className="text-white">stats</span>.gg
          </a>
        </div>

        {/* Desktop nav */}
        {/* Drei Zonen: Logo und Utilities je flex-1, die Reiter dazwischen ohne
            Wachstum — dadurch stehen sie exakt in der Seitenmitte statt rechts. */}
        <div className="hidden lg:flex items-center gap-4 flex-shrink-0">
          {game === 'tft' ? (
            <>
              <a href="/tft/leaderboard" className={linkClass('leaderboard')}>{t('nav.leaderboard')}</a>
              <a href="/tft/tournaments" className={linkClass('tournaments')}>{t('nav.leagues')}</a>
              {TFT_PROS_ENABLED && (
                <a href="/tft/pros" className={linkClass('pros')}>{t('nav.tftPros')}</a>
              )}
              <a href="/tft/compare" className={linkClass('analyse')}>{t('nav.analyse')}</a>
              <a href="/tft/builder" className={linkClass('builder')}>{t('tft.builderTitle')}</a>
              <a href="/tft/comps/community" className={linkClass('community')}>{t('nav.community')}</a>
              {TFT_COACH_ENABLED && (
                <a href="/tft/coach" className={linkClass('coach')}>{t('nav.coach')}</a>
              )}
              <a href="/tft/saved" className={linkClass('saved')} title={t('tft.savedTitle')}>★</a>
            </>
          ) : (
            <>
              <a href="/" className={linkClass('search')}>{t('nav.search')}</a>
              <a href="/leaderboard" className={linkClass('leaderboard')}>{t('nav.leaderboard')}</a>
              <a href="/champions" className={linkClass('champions')}>{t('nav.champions')}</a>
              <a href="/marktwert" className={linkClass('marktwert')}>{t('nav.marketvalue')}</a>
              <a href="/teams" className={linkClass('teams')}>{t('nav.proTeams')}</a>
              <a href="/ligen" className={linkClass('ligen')}>{t('nav.leagues')}</a>
              <a href="/compare" className={linkClass('analyse')}>{t('nav.analyse')}</a>
            </>
          )}

        </div>

        {/* Utilities rechts */}
        <div className="hidden lg:flex items-center gap-4 flex-1 justify-end min-w-0">
          {/* Global Search */}
          <div ref={searchRef} className="relative min-w-0">
            <div className="flex items-center bg-surface-raised border border-border-default rounded px-2.5 py-1 gap-2 min-w-0 hover:border-[#c89b3c]/50 transition-colors focus-within:border-[#c89b3c]">
              <svg className="w-3.5 h-3.5 text-fg-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                placeholder={t('nav.searchPlaceholder')}
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setSearchOpen(true); }}
                onFocus={() => searchQuery && setSearchOpen(true)}
                onKeyDown={handleSearchKeyDown}
                className="bg-transparent text-white text-xs outline-none placeholder-fg-muted w-36 min-w-0"
              />
            </div>

            {/* Dropdown */}
            {searchOpen && results.length > 0 && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-surface-base border border-border-subtle rounded shadow-xl overflow-hidden min-w-[260px]">
                {results.map((r, i) => r.type === 'none' ? (
                  <div key={`none-${i}`} className="px-3 py-2 text-fg-muted text-xs">{r.name}</div>
                ) : (
                  <button
                    key={`${r.type}-${r.name}-${i}`}
                    onClick={() => navigateToResult(r)}
                    className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-surface-raised transition-colors"
                  >
                    {r.type === 'champion' ? (
                      <img
                        src={`https://ddragon.leagueoflegends.com/cdn/14.1.1/img/champion/${r.id}.png`}
                        alt=""
                        className="w-6 h-6 rounded"
                      />
                    ) : (
                      <div className="w-6 h-6 rounded bg-surface-overlay flex items-center justify-center">
                        <svg className="w-3.5 h-3.5 text-fg-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-xs font-medium truncate">{r.name}</div>
                      <div className="text-fg-muted text-[10px]">
                        {r.type === 'champion' ? t('nav.champion') : r.type === 'account' ? r.sub : t('nav.searchPlayer')}
                      </div>
                    </div>
                    <svg className="w-3 h-3 text-fg-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* User menu / Login */}
          <div className="relative" ref={userMenuRef}>
            {user ? (
              <>
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center gap-1.5 bg-surface-raised border border-border-default rounded px-2 py-1 text-xs hover:border-brand transition-colors"
                  title={user.email || ''}
                >
                  {user.avatarUrl ? (
                    <img src={user.avatarUrl} alt="" className="w-5 h-5 rounded-full object-cover" />
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-brand text-white text-[10px] flex items-center justify-center font-medium">
                      {(user.name || user.email || '?').slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <span className="text-white max-w-[8rem] truncate">{user.name || user.email}</span>
                </button>
                {userMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setUserMenuOpen(false)} />
                    <div className="absolute right-0 top-full mt-1 z-40 bg-surface-base border border-border-subtle rounded shadow-lg min-w-[160px]">
                      <button
                        onClick={async () => { await signOut(); setUserMenuOpen(false); }}
                        className="w-full text-left px-3 py-2 text-xs text-fg-secondary hover:text-white hover:bg-surface-raised"
                      >{t('nav.logout')}</button>
                    </div>
                  </>
                )}
              </>
            ) : (
              <a
                href={`/auth/login?next=${encodeURIComponent(pathname)}`}
                className="bg-surface-raised border border-border-default rounded px-2.5 py-1 text-xs text-fg-secondary hover:text-white hover:border-brand transition-colors"
              >{t('nav.login')}</a>
            )}
          </div>

          {/* Language Dropdown */}
          <div className="relative">
            <button
              onClick={() => setLangOpen(!langOpen)}
              className="flex items-center gap-1.5 bg-surface-raised border border-border-default rounded px-2.5 py-1 text-xs font-medium text-fg-secondary hover:text-white hover:border-[#c89b3c] transition-colors"
            >
              <img src={currentLang.flagUrl} alt="" className="w-4 h-3 object-cover rounded-sm" />
              <span className="text-white">{currentLang.code.toUpperCase()}</span>
              <svg className={`w-3 h-3 transition-transform ${langOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {langOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setLangOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-40 bg-surface-base border border-border-subtle rounded shadow-lg overflow-hidden min-w-[150px]">
                  {LANGUAGES.map(l => (
                    <button
                      key={l.code}
                      onClick={() => {
                        setLang(l.code);
                        setLangOpen(false);
                        // Hard reload so server-rendered metadata (tab title, OG tags) update for the new language
                        if (l.code !== lang) window.location.reload();
                      }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors ${
                        lang === l.code
                          ? 'bg-[#c89b3c]/10 text-[#c89b3c]'
                          : 'text-fg-secondary hover:text-white hover:bg-surface-raised'
                      }`}
                    >
                      <img src={l.flagUrl} alt="" className="w-5 h-3.5 object-cover rounded-sm" />
                      <span className={`font-medium flex-1 text-left ${lang === l.code ? 'text-[#c89b3c]' : 'text-white'}`}>
                        {l.label}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Mobile: search icon + hamburger */}
        <div className="flex items-center gap-2 lg:hidden">
          <button
            onClick={() => { setSearchOpen(!searchOpen); setMenuOpen(false); }}
            className="text-fg-secondary hover:text-white p-1"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
          <button
            onClick={() => { setMenuOpen(!menuOpen); setSearchOpen(false); }}
            className="text-fg-secondary hover:text-white p-1"
          >
            {menuOpen ? (
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* TFT, Desktop: zweite Zeile mit den Meta-Seiten (ohne Beschriftung). Wird es zu schmal,
          wischt die Zeile seitlich statt umzubrechen. */}
      {game === 'tft' && (
        <div className="hidden lg:block mt-3 pt-3 border-t border-border-subtle overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex items-center gap-4 w-max mx-auto whitespace-nowrap">
            {TFT_META_LINKS.map(l => (
              <a key={l.href} href={l.href} className={metaLinkClass(l)}>
                {'pulse' in l ? `⚡ ${t(l.label)}` : t(l.label)}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Mobile search bar */}
      {searchOpen && (
        <div className="lg:hidden mt-3 pt-3 border-t border-border-subtle" ref={mobileSearchRef}>
          <div className="flex items-center bg-surface-raised border border-border-default rounded px-3 py-2 gap-2">
            <svg className="w-4 h-4 text-fg-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder={t('nav.searchPlaceholder')}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              autoFocus
              className="bg-transparent text-white text-sm outline-none placeholder-fg-muted flex-1"
            />
          </div>
          {results.length > 0 && (
            <div className="mt-1 bg-surface-base border border-border-subtle rounded overflow-hidden">
              {results.map((r, i) => r.type === 'none' ? (
                <div key={`m-none-${i}`} className="px-3 py-2.5 text-fg-muted text-sm">{r.name}</div>
              ) : (
                <button
                  key={`m-${r.type}-${r.name}-${i}`}
                  onClick={() => navigateToResult(r)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-raised transition-colors"
                >
                  {r.type === 'champion' ? (
                    <img
                      src={`https://ddragon.leagueoflegends.com/cdn/14.1.1/img/champion/${r.id}.png`}
                      alt=""
                      className="w-7 h-7 rounded"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded bg-surface-overlay flex items-center justify-center">
                      <svg className="w-4 h-4 text-fg-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm font-medium truncate">{r.name}</div>
                    <div className="text-fg-muted text-xs">
                      {r.type === 'champion' ? t('nav.champion') : r.type === 'account' ? r.sub : t('nav.searchPlayer')}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Mobile menu */}
      {menuOpen && (
        <div className="lg:hidden mt-3 pt-3 border-t border-border-subtle flex flex-col gap-3">
          {game === 'tft' ? (
            <>
              <div className="text-fg-muted text-[10px] uppercase tracking-widest">{t('nav.meta')}</div>
              {TFT_META_LINKS.map(l => (
                <a key={l.href} href={l.href} className={`pl-3 ${metaLinkClass(l)}`} onClick={() => setMenuOpen(false)}>
                  {'pulse' in l ? `⚡ ${t(l.label)}` : t(l.label)}
                </a>
              ))}
              <a href="/tft/leaderboard" className={linkClass('leaderboard')} onClick={() => setMenuOpen(false)}>{t('nav.leaderboard')}</a>
              <a href="/tft/tournaments" className={linkClass('tournaments')} onClick={() => setMenuOpen(false)}>{t('nav.leagues')}</a>
              {TFT_PROS_ENABLED && (
                <a href="/tft/pros" className={linkClass('pros')} onClick={() => setMenuOpen(false)}>{t('nav.tftPros')}</a>
              )}
              <a href="/tft/compare" className={linkClass('analyse')} onClick={() => setMenuOpen(false)}>{t('nav.analyse')}</a>
              <a href="/tft/builder" className={linkClass('builder')} onClick={() => setMenuOpen(false)}>{t('tft.builderTitle')}</a>
              <a href="/tft/saved" className={linkClass('saved')} onClick={() => setMenuOpen(false)}>★ {t('tft.savedTitle')}</a>
            </>
          ) : (
            <>
              <a href="/" className={linkClass('search')} onClick={() => setMenuOpen(false)}>{t('nav.search')}</a>
              <a href="/leaderboard" className={linkClass('leaderboard')} onClick={() => setMenuOpen(false)}>{t('nav.leaderboard')}</a>
              <a href="/champions" className={linkClass('champions')} onClick={() => setMenuOpen(false)}>{t('nav.champions')}</a>
              <a href="/marktwert" className={linkClass('marktwert')} onClick={() => setMenuOpen(false)}>{t('nav.marketvalue')}</a>
              <a href="/teams" className={linkClass('teams')} onClick={() => setMenuOpen(false)}>{t('nav.proTeams')}</a>
              <a href="/ligen" className={linkClass('ligen')} onClick={() => setMenuOpen(false)}>{t('nav.leagues')}</a>
              <a href="/compare" className={linkClass('analyse')} onClick={() => setMenuOpen(false)}>{t('nav.analyse')}</a>
            </>
          )}

          {/* Language selector mobile */}
          <div className="flex flex-wrap gap-1.5 pt-2 border-t border-border-subtle">
            {LANGUAGES.map(l => (
              <button
                key={l.code}
                onClick={() => {
                  setLang(l.code);
                  setMenuOpen(false);
                  if (l.code !== lang) window.location.reload();
                }}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-xs ${
                  lang === l.code ? 'bg-[#c89b3c]/10 text-[#c89b3c]' : 'text-fg-secondary'
                }`}
              >
                <img src={l.flagUrl} alt="" className="w-5 h-3.5 object-cover rounded-sm" />
                <span>{l.code.toUpperCase()}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
