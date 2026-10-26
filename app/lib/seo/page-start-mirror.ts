import 'server-only';
// Startdaten aus den Route-Spiegeln der Box (app/lib/route-mirror.mjs): genau
// die Antwort, die der Browser von der Route bekaeme. Keine TFT-Importe —
// diese Datei laden auch LoL-Seiten (start-core.ts).
import { readRouteMirrorForPage, type RouteMirrorName } from '../route-mirror-read';
import { TFT_LEADERBOARD_START } from '../page-start-queries';
import { pageStartOn, PAGE_START_READ_MS, rememberStart, withTimeout } from './start-core';

export interface MirrorStart<T> {
  body: T;
  /** Stand der Datei — die Seite laedt im Browser nach, wenn er aelter ist
   *  als die Route selbst cachen wuerde (LoL-Rangliste). */
  builtAt: string;
}

export function mirrorStart<T>(name: RouteMirrorName, query: Record<string, string>): Promise<MirrorStart<T> | null> {
  if (!pageStartOn()) return Promise.resolve(null);
  return rememberStart(`mirror:${name}:${new URLSearchParams(query)}`, () =>
    withTimeout(readRouteMirrorForPage<T>(name, query), PAGE_START_READ_MS));
}

// ---------- TFT-Rangliste ----------

export interface TftLeaderboardBody {
  players: unknown[];
  hasNextPage?: boolean;
  totalPlayers?: number | null;
}

export function tftLeaderboardStart<T extends TftLeaderboardBody>(): Promise<MirrorStart<T> | null> {
  return mirrorStart<T>('leaderboard', TFT_LEADERBOARD_START);
}

// ---------- Ligen (Uebersicht ohne Liga) ----------

export interface StandingsBody {
  leagues: unknown[];
}

export function ligenStart<T extends StandingsBody>(): Promise<MirrorStart<T> | null> {
  return mirrorStart<T>('standings', {});
}
