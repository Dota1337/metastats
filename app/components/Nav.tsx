'use client';
import { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useI18n, LANGUAGES } from '../lib/i18n';
import { detectGameFromPath } from '../lib/games';
import GameSwitcher from './GameSwitcher';

interface NavProps {
  active?:
    | 'search' | 'leaderboard' | 'champions' | 'marktwert' | 'analyse' | 'teams' | 'ligen'
    | 'units' | 'items' | 'augments' | 'comps' | 'traits';
}

interface SearchResult {
  type: 'player' | 'champion';
  name: string;
  id?: string;
  image?: string;
}

export default function Nav({ active }: NavProps) {
  const { lang, setLang, t } = useI18n();
  const pathname = usePathname() || '/';
  const game = detectGameFromPath(pathname);
  const [langOpen, setLangOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [champions, setChampions] = useState<{ id: string; name: string }[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const linkClass = (key: NavProps['active']) =>
    key === active ? 'text-white text-sm' : 'text-[#8a9bb0] text-sm hover:text-white';

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
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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
    if (searchQuery.trim().length >= 2) {
      playerResults.push({ type: 'player', name: searchQuery.trim() });
    }

    setResults([...playerResults, ...champMatches]);
  }, [searchQuery, champions]);

  const playerHref = (raw: string) => {
    const parts = raw.split('#');
    const gameName = parts[0].trim();
    const tag = parts[1]?.trim() || 'EUW';
    const slug = encodeURIComponent(gameName) + '--' + encodeURIComponent(tag);
    const prefix = game === 'tft' ? '/tft' : '';
    return `${prefix}/player/${slug}?region=euw1`;
  };

  const navigateToResult = (result: SearchResult) => {
    if (result.type === 'champion') {
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
      window.location.href = playerHref(searchQuery);
      setSearchOpen(false);
      setSearchQuery('');
    }
    if (e.key === 'Escape') {
      setSearchOpen(false);
      setSearchQuery('');
    }
  };

  const homeHref = game === 'tft' ? '/tft' : '/';
  const accentClass = game === 'tft' ? 'text-[#7B61FF]' : 'text-[#c89b3c]';

  return (
    <nav className="bg-[#0a0e1a] border-b border-[#1e2a3a] px-4 sm:px-6 py-3" data-game={game}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-40 flex-shrink-0">
          <a href={homeHref} className={`${accentClass} text-lg font-medium flex-shrink-0`}>
            meta<span className="text-white">stats</span>.gg
          </a>
          <GameSwitcher />
        </div>

        {/* Desktop nav */}
        <div className="hidden lg:flex items-center gap-4 flex-1 justify-end">
          {game === 'tft' ? (
            <>
              <a href="/tft" className={linkClass('search')}>{t('nav.search')}</a>
              <a href="/tft/leaderboard" className={linkClass('leaderboard')}>{t('nav.leaderboard')}</a>
              <a href="/tft/units" className={linkClass('units')}>{t('nav.units')}</a>
              <a href="/tft/items" className={linkClass('items')}>{t('nav.items')}</a>
              <a href="/tft/augments" className={linkClass('augments')}>{t('nav.augments')}</a>
              <a href="/tft/comps" className={linkClass('comps')}>{t('nav.comps')}</a>
              <a href="/tft/traits" className={linkClass('traits')}>{t('nav.traits')}</a>
              <a href="/tft/marktwert" className={linkClass('marktwert')}>{t('nav.marketvalue')}</a>
              <a href="/tft/compare" className={linkClass('analyse')}>{t('nav.analyse')}</a>
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

          {/* Global Search */}
          <div ref={searchRef} className="relative">
            <div className="flex items-center bg-[#141c2e] border border-[#2a3a50] rounded px-2.5 py-1 gap-2 hover:border-[#c89b3c]/50 transition-colors focus-within:border-[#c89b3c]">
              <svg className="w-3.5 h-3.5 text-[#4a5a70] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
                className="bg-transparent text-white text-xs outline-none placeholder-[#4a5a70] w-36"
              />
            </div>

            {/* Dropdown */}
            {searchOpen && results.length > 0 && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-[#0d1526] border border-[#1e2a3a] rounded shadow-xl overflow-hidden min-w-[260px]">
                {results.map((r, i) => (
                  <button
                    key={`${r.type}-${r.name}-${i}`}
                    onClick={() => navigateToResult(r)}
                    className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-[#141c2e] transition-colors"
                  >
                    {r.type === 'champion' ? (
                      <img
                        src={`https://ddragon.leagueoflegends.com/cdn/14.1.1/img/champion/${r.id}.png`}
                        alt=""
                        className="w-6 h-6 rounded"
                      />
                    ) : (
                      <div className="w-6 h-6 rounded bg-[#1e2a3a] flex items-center justify-center">
                        <svg className="w-3.5 h-3.5 text-[#8a9bb0]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-xs font-medium truncate">{r.name}</div>
                      <div className="text-[#4a5a70] text-[10px]">
                        {r.type === 'champion' ? t('nav.champion') : t('nav.searchPlayer')}
                      </div>
                    </div>
                    <svg className="w-3 h-3 text-[#4a5a70] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Language Dropdown */}
          <div className="relative">
            <button
              onClick={() => setLangOpen(!langOpen)}
              className="flex items-center gap-1.5 bg-[#141c2e] border border-[#2a3a50] rounded px-2.5 py-1 text-xs font-medium text-[#8a9bb0] hover:text-white hover:border-[#c89b3c] transition-colors"
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
                <div className="absolute right-0 top-full mt-1 z-40 bg-[#0d1526] border border-[#1e2a3a] rounded shadow-lg overflow-hidden min-w-[150px]">
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
                          : 'text-[#8a9bb0] hover:text-white hover:bg-[#141c2e]'
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
            className="text-[#8a9bb0] hover:text-white p-1"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
          <button
            onClick={() => { setMenuOpen(!menuOpen); setSearchOpen(false); }}
            className="text-[#8a9bb0] hover:text-white p-1"
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

      {/* Mobile search bar */}
      {searchOpen && (
        <div className="lg:hidden mt-3 pt-3 border-t border-[#1e2a3a]" ref={searchRef}>
          <div className="flex items-center bg-[#141c2e] border border-[#2a3a50] rounded px-3 py-2 gap-2">
            <svg className="w-4 h-4 text-[#4a5a70] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder={t('nav.searchPlaceholder')}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              autoFocus
              className="bg-transparent text-white text-sm outline-none placeholder-[#4a5a70] flex-1"
            />
          </div>
          {results.length > 0 && (
            <div className="mt-1 bg-[#0d1526] border border-[#1e2a3a] rounded overflow-hidden">
              {results.map((r, i) => (
                <button
                  key={`m-${r.type}-${r.name}-${i}`}
                  onClick={() => navigateToResult(r)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-[#141c2e] transition-colors"
                >
                  {r.type === 'champion' ? (
                    <img
                      src={`https://ddragon.leagueoflegends.com/cdn/14.1.1/img/champion/${r.id}.png`}
                      alt=""
                      className="w-7 h-7 rounded"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded bg-[#1e2a3a] flex items-center justify-center">
                      <svg className="w-4 h-4 text-[#8a9bb0]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm font-medium truncate">{r.name}</div>
                    <div className="text-[#4a5a70] text-xs">
                      {r.type === 'champion' ? 'Champion' : 'Spieler suchen'}
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
        <div className="lg:hidden mt-3 pt-3 border-t border-[#1e2a3a] flex flex-col gap-3">
          {game === 'tft' ? (
            <>
              <a href="/tft" className={linkClass('search')} onClick={() => setMenuOpen(false)}>{t('nav.search')}</a>
              <a href="/tft/leaderboard" className={linkClass('leaderboard')} onClick={() => setMenuOpen(false)}>{t('nav.leaderboard')}</a>
              <a href="/tft/units" className={linkClass('units')} onClick={() => setMenuOpen(false)}>{t('nav.units')}</a>
              <a href="/tft/items" className={linkClass('items')} onClick={() => setMenuOpen(false)}>{t('nav.items')}</a>
              <a href="/tft/augments" className={linkClass('augments')} onClick={() => setMenuOpen(false)}>{t('nav.augments')}</a>
              <a href="/tft/comps" className={linkClass('comps')} onClick={() => setMenuOpen(false)}>{t('nav.comps')}</a>
              <a href="/tft/traits" className={linkClass('traits')} onClick={() => setMenuOpen(false)}>{t('nav.traits')}</a>
              <a href="/tft/marktwert" className={linkClass('marktwert')} onClick={() => setMenuOpen(false)}>{t('nav.marketvalue')}</a>
              <a href="/tft/compare" className={linkClass('analyse')} onClick={() => setMenuOpen(false)}>{t('nav.analyse')}</a>
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
          <div className="flex flex-wrap gap-1.5 pt-2 border-t border-[#1e2a3a]">
            {LANGUAGES.map(l => (
              <button
                key={l.code}
                onClick={() => {
                  setLang(l.code);
                  setMenuOpen(false);
                  if (l.code !== lang) window.location.reload();
                }}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-xs ${
                  lang === l.code ? 'bg-[#c89b3c]/10 text-[#c89b3c]' : 'text-[#8a9bb0]'
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
