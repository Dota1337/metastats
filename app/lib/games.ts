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

import { splitLangPrefix, withLangPrefix } from './lang-path';
import { TFT_IS_HOME } from './feature-flags';

export type Game = 'lol' | 'tft';

// Startseiten beider Spiele. TFT startet auf der Comps-Uebersicht (User
// 2026-10-15: "standardmäßig die Overview-Seite"), die Liste ist der zweite
// Reiter. LoL startet auf `/`, solange TFT nicht die Hauptseite ist — sonst
// auf `/lol` (Schalter TFT_IS_HOME, feature-flags.ts). next.config.ts leitet
// passend dazu um; alle Links holen die Ziele von hier.
export const TFT_HOME = '/tft/comps/atlas';

export function lolHome(tftIsHome: boolean = TFT_IS_HOME): string {
  return tftIsHome ? '/lol' : '/';
}

// Farben stehen hier bewusst NICHT. Source-of-Truth für beide Game-Farben ist
// app/globals.css (--accent-lol / --accent-tft); der Game-Streifen greift die
// benannten Varianten direkt per CSS ab (data-half, nicht die Position). Bis
// Welle 1.5 hielt dieser Array ein `accent`-Feld mit var()-Zeigern für den
// gelöschten GameSwitcher — reiner Umweg über JS für etwas, das CSS selbst kann.
// Die Hauptseite steht links.
export function gamesInOrder(tftIsHome: boolean = TFT_IS_HOME): { id: Game; label: string }[] {
  const lol = { id: 'lol' as const, label: 'League of Legends' };
  const tft = { id: 'tft' as const, label: 'Teamfight Tactics' };
  return tftIsHome ? [tft, lol] : [lol, tft];
}

export const GAMES = gamesInOrder();

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
  { match: /^\/?$/,                   to: TFT_HOME },
  { match: /^\/lol\/?$/,              to: TFT_HOME },
];

// Platzhalter fuer die LoL-Startseite — haengt am Schalter, steht also erst
// beim Aufruf fest (lolHome).
const LOL_HOME = '$home';

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
  { match: /^\/tft\/?$/,                     to: LOL_HOME },
];

export function detectGameFromPath(pathname: string): Game {
  // Sprach-Vorsatz (/en/tft/…) zaehlt nicht mit.
  const path = splitLangPrefix(pathname).rest;
  // Exakt `/tft` oder ein Segment darunter — nicht startsWith('/tft'), sonst
  // würde eine künftige Top-Level-Route wie /tftips still als TFT gelten.
  return path === '/tft' || path.startsWith('/tft/') ? 'tft' : 'lol';
}

export function mapPathToGame(pathname: string, target: Game, tftIsHome: boolean = TFT_IS_HOME): string {
  // Der Sprach-Vorsatz bleibt: /en/tft/units → /en/champions.
  const { lang, rest } = splitLangPrefix(pathname);
  return withLangPrefix(lang, mapRestToGame(rest, target, tftIsHome));
}

function mapRestToGame(pathname: string, target: Game, tftIsHome: boolean): string {
  const rules = target === 'tft' ? PAGE_MAP_LOL_TO_TFT : PAGE_MAP_TFT_TO_LOL;
  for (const rule of rules) {
    const m = pathname.match(rule.match);
    if (!m) continue;
    if (rule.to === LOL_HOME) return lolHome(tftIsHome);
    // split/join statt replace: String.replace interpretiert $&, $' und $` im
    // Ersetzungs-String. Über die UI ist das nicht erreichbar (Slugs sind
    // encodeURIComponent-kodiert), über eine handgetippte URL schon.
    return rule.to.split('$1').join(m[1] ?? '');
  }
  // NICHT '/tft': next.config.ts leitet das auf die Uebersicht um, und der
  // Umweg kostet gemessen 158 ms — rund 40 % des Fensters, das die Transition
  // im Game-Streifen überbrücken soll.
  return target === 'tft' ? TFT_HOME : lolHome(tftIsHome);
}
