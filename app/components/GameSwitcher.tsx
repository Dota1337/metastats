'use client';
import { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useI18n } from '../lib/i18n';
import { GAMES, GAME_COOKIE, detectGameFromPath, mapPathToGame, type Game } from '../lib/games';

export default function GameSwitcher() {
  const { t } = useI18n();
  const pathname = usePathname() || '/';
  const currentGame = detectGameFromPath(pathname);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Persist current game choice on every navigation so a fresh visit to /
  // restores the user's last context.
  useEffect(() => {
    document.cookie = `${GAME_COOKIE}=${currentGame}; path=/; max-age=31536000; samesite=lax`;
  }, [currentGame]);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const switchTo = (target: Game) => {
    setOpen(false);
    if (target === currentGame) return;
    window.location.href = mapPathToGame(pathname, target);
  };

  const current = GAMES.find(g => g.id === currentGame) || GAMES[0];

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 bg-[#141c2e] border border-[#2a3a50] rounded px-2.5 py-1 text-xs font-medium text-[#8a9bb0] hover:text-white hover:border-[var(--accent)] transition-colors"
        title={t('game.switch')}
      >
        <GameIcon game={current.id} className="w-3.5 h-3.5" />
        <span className="text-white hidden sm:inline">{current.id.toUpperCase()}</span>
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-40 bg-[#0d1526] border border-[#1e2a3a] rounded shadow-lg overflow-hidden min-w-[200px]">
            {GAMES.map(g => (
              <button
                key={g.id}
                onClick={() => switchTo(g.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors ${
                  currentGame === g.id
                    ? 'bg-[#1e2a3a] text-white'
                    : 'text-[#8a9bb0] hover:text-white hover:bg-[#141c2e]'
                }`}
              >
                <GameIcon game={g.id} className="w-4 h-4" />
                <span className="font-medium flex-1 text-left text-white">
                  {t(g.id === 'lol' ? 'game.lol' : 'game.tft')}
                </span>
                {currentGame === g.id && (
                  <svg className="w-3.5 h-3.5" style={{ color: g.accent }} fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function GameIcon({ game, className }: { game: Game; className?: string }) {
  // Inline SVG so we don't depend on any external asset for the switcher itself
  if (game === 'tft') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinejoin="round" d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
        <path strokeLinejoin="round" d="M12 7l4 2.25v4.5L12 16l-4-2.25v-4.5L12 7z" />
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v18M3 12h18" strokeLinecap="round" />
    </svg>
  );
}
