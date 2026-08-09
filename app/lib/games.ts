// Single source of truth for the multi-game setup. Both LoL and TFT use the
// same metastats domain; the active game is derived from the URL prefix
// (`/tft/...` -> tft, otherwise lol). The user's last choice is persisted in
// the metastats-game cookie so a fresh visit to / restores their preference.

export type Game = 'lol' | 'tft';

// Farben stehen hier bewusst NICHT. Source-of-Truth für beide Game-Farben ist
// app/globals.css (--accent-lol / --accent-tft); der Game-Streifen greift die
// benannten Varianten direkt per CSS ab. Bis Welle 1.5 hielt dieser Array ein
// `accent`-Feld mit var()-Zeigern für den gelöschten GameSwitcher — reiner
// Umweg über JS für etwas, das CSS selbst kann.
export const GAMES: { id: Game; label: string }[] = [
  { id: 'lol', label: 'League of Legends' },
  { id: 'tft', label: 'Teamfight Tactics' },
];

export const GAME_COOKIE = 'metastats-game';

// Map a LoL pathname to its TFT equivalent (and vice versa) so the
// GameSwitcher lands the user on the corresponding page after toggling.
// Pages without a counterpart fall back to the game's landing route.
const PAGE_MAP_LOL_TO_TFT: { match: RegExp; to: string }[] = [
  { match: /^\/leaderboard(\/.*)?$/, to: '/tft/leaderboard' },
  { match: /^\/champions\/[^/]+$/,    to: '/tft/units' },           // champion detail -> units list
  { match: /^\/champions(\/.*)?$/,    to: '/tft/units' },
  { match: /^\/marktwert(\/.*)?$/,    to: '/tft/marktwert' },
  { match: /^\/compare(\/.*)?$/,      to: '/tft/compare' },
  { match: /^\/ligen(\/.*)?$/,        to: '/tft/tournaments' },     // leagues → TFT tournaments
  { match: /^\/player\/(.+)$/,        to: '/tft/player/$1' },
  { match: /^\/?$/,                   to: '/tft' },
];

const PAGE_MAP_TFT_TO_LOL: { match: RegExp; to: string }[] = [
  { match: /^\/tft\/leaderboard(\/.*)?$/,    to: '/leaderboard' },
  { match: /^\/tft\/units(\/.*)?$/,          to: '/champions' },
  { match: /^\/tft\/items(\/.*)?$/,          to: '/champions' },       // no LoL equivalent
  { match: /^\/tft\/augments(\/.*)?$/,       to: '/champions' },
  { match: /^\/tft\/comps(\/.*)?$/,          to: '/champions' },
  { match: /^\/tft\/traits(\/.*)?$/,         to: '/champions' },
  { match: /^\/tft\/marktwert(\/.*)?$/,      to: '/marktwert' },
  { match: /^\/tft\/compare(\/.*)?$/,        to: '/compare' },
  { match: /^\/tft\/tournaments(\/.*)?$/,    to: '/ligen' },           // TFT tournaments → leagues
  { match: /^\/tft\/player\/(.+)$/,          to: '/player/$1' },
  { match: /^\/tft\/?$/,                     to: '/' },
];

export function detectGameFromPath(pathname: string): Game {
  return pathname.startsWith('/tft') ? 'tft' : 'lol';
}

export function mapPathToGame(pathname: string, target: Game): string {
  const rules = target === 'tft' ? PAGE_MAP_LOL_TO_TFT : PAGE_MAP_TFT_TO_LOL;
  for (const rule of rules) {
    const m = pathname.match(rule.match);
    if (m) return rule.to.replace('$1', m[1] ?? '');
  }
  return target === 'tft' ? '/tft' : '/';
}
