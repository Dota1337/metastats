// Single source of truth for the multi-game setup. Both LoL and TFT use the
// same metastats domain; the active game is derived from the URL prefix
// (`/tft/...` -> tft, otherwise lol).
//
// Der metastats-game-Cookie wird zwar geschrieben (GameStrip), aber NIRGENDS
// gelesen — weder hier, noch in middleware.ts, noch server-seitig. Er stellt
// insbesondere KEINE Präferenz wieder her; der frühere Kommentar an dieser
// Stelle behauptete das und war schlicht falsch. Das aktive Spiel ist eine
// reine Funktion des Pfads, und das muss so bleiben: eine Cookie-Quelle würde
// eine lila LoL-Seite erzeugen, sobald der Cookie auf tft steht.

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
  { match: /^\/?$/,                   to: '/tft/comps' },
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
  // Exakt `/tft` oder ein Segment darunter — nicht startsWith('/tft'), sonst
  // würde eine künftige Top-Level-Route wie /tftips still als TFT gelten.
  return pathname === '/tft' || pathname.startsWith('/tft/') ? 'tft' : 'lol';
}

export function mapPathToGame(pathname: string, target: Game): string {
  const rules = target === 'tft' ? PAGE_MAP_LOL_TO_TFT : PAGE_MAP_TFT_TO_LOL;
  for (const rule of rules) {
    const m = pathname.match(rule.match);
    // split/join statt replace: String.replace interpretiert $&, $' und $` im
    // Ersetzungs-String. Über die UI ist das nicht erreichbar (Slugs sind
    // encodeURIComponent-kodiert), über eine handgetippte URL schon.
    if (m) return rule.to.split('$1').join(m[1] ?? '');
  }
  // NICHT '/tft': next.config.ts leitet das mit 308 auf /tft/comps um, und der
  // Umweg kostet gemessen 158 ms — rund 40 % des Fensters, das die Transition
  // im Game-Streifen überbrücken soll.
  return target === 'tft' ? '/tft/comps' : '/';
}
