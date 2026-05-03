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
    <div className="flex items-center gap-1">
      {GAMES.map(g => {
        const active = currentGame === g.id;
        const label = t(g.id === 'lol' ? 'game.lol' : 'game.tft');
        // Official icons mirrored locally from Riot's League client assets
        // (originally from CommunityDragon's rcp-fe-lol-static-assets and
        // rcp-fe-lol-tft plugins). Hosting them in /public keeps us
        // independent of the CD server's uptime.
        const src = g.id === 'lol' ? '/games/lol-icon.png' : '/games/tft-icon.svg';
        return (
          <button
            key={g.id}
            onClick={() => switchTo(g.id)}
            title={label}
            aria-label={label}
            className={`relative flex items-center justify-center w-9 h-9 rounded transition-all ${
              active
                ? 'ring-2 ring-offset-2 ring-offset-[#0a0e1a]'
                : 'opacity-50 hover:opacity-100'
            }`}
            style={active ? ({ ['--tw-ring-color' as any]: g.accent } as any) : undefined}
          >
            <img src={src} alt={label} className="w-7 h-7 object-contain" />
          </button>
        );
      })}
    </div>
  );
}
