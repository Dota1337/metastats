'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useI18n } from '../lib/i18n';
import { GAMES, GAME_COOKIE, detectGameFromPath, mapPathToGame, type Game } from '../lib/games';

// Two-icon switcher rendered to the right of the metastats logo. Active
// game is highlighted with its own accent colour; clicking the inactive
// icon navigates to the matching page on the other game (or that game's
// landing page when no counterpart exists).

export default function GameSwitcher() {
  const { t } = useI18n();
  const pathname = usePathname() || '/';
  const currentGame = detectGameFromPath(pathname);

  // Persist current game choice on every navigation so a fresh visit to /
  // restores the user's last context.
  useEffect(() => {
    document.cookie = `${GAME_COOKIE}=${currentGame}; path=/; max-age=31536000; samesite=lax`;
  }, [currentGame]);

  const switchTo = (target: Game) => {
    if (target === currentGame) return;
    window.location.href = mapPathToGame(pathname, target);
  };

  return (
    <div className="flex items-center gap-1 bg-[#141c2e] border border-[#2a3a50] rounded p-0.5">
      {GAMES.map(g => {
        const active = currentGame === g.id;
        const label = t(g.id === 'lol' ? 'game.lol' : 'game.tft');
        return (
          <button
            key={g.id}
            onClick={() => switchTo(g.id)}
            title={label}
            aria-label={label}
            className={`flex items-center justify-center w-7 h-7 rounded transition-colors ${
              active ? 'shadow-sm' : 'hover:bg-[#1e2a3a]'
            }`}
            style={active ? { backgroundColor: `${g.accent}20`, color: g.accent } : { color: '#5a6a80' }}
          >
            <GameIcon game={g.id} className="w-4 h-4" />
          </button>
        );
      })}
    </div>
  );
}

function GameIcon({ game, className }: { game: Game; className?: string }) {
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
