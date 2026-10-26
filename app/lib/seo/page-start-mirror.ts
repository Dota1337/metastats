import 'server-only';
// Startdaten aus den Route-Spiegeln der Box (app/lib/route-mirror.mjs): genau
// die Antwort, die der Browser von der Route bekaeme. Keine TFT-Importe —
// diese Datei laden auch LoL-Seiten (start-core.ts).
import { readRouteMirrorForPage, type RouteMirrorName } from '../route-mirror-read';
import {
  LOL_LEADERBOARD_START, LOL_MARKTWERT_START, TFT_LEADERBOARD_START, TFT_MARKTWERT_START_REGION,
  TFT_TOURNAMENTS_START, tftMarktwertQuery, tftMarktwertSparksQuery,
} from '../page-start-queries';
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

// ---------- TFT-Marktwert (Liste und Verlaeufe getrennt) ----------

export interface TftMarktwertStart<L, S> {
  /** Fehlt ein Teil, laedt die Seite nur diesen im Browser nach. */
  list: MirrorStart<L> | null;
  sparks: MirrorStart<S> | null;
}

export async function tftMarktwertStart<L, S>(): Promise<TftMarktwertStart<L, S>> {
  const region = TFT_MARKTWERT_START_REGION;
  const [list, sparks] = await Promise.all([
    mirrorStart<L>('tftMarktwert', tftMarktwertQuery(region, '')),
    mirrorStart<S>('tftMarktwertSparks', tftMarktwertSparksQuery(region)),
  ]);
  return { list, sparks };
}

// ---------- LoL-Marktwert, LoL-Rangliste, TFT-Turniere, LoL-Startseite ----------

export function lolMarktwertStart<T>(): Promise<MirrorStart<T> | null> {
  return mirrorStart<T>('lolMarktwert', LOL_MARKTWERT_START);
}

export function lolLeaderboardStart<T>(): Promise<MirrorStart<T> | null> {
  return mirrorStart<T>('lolLeaderboard', LOL_LEADERBOARD_START);
}

export function tftTournamentsStart<T>(): Promise<MirrorStart<T> | null> {
  return mirrorStart<T>('tftTournaments', TFT_TOURNAMENTS_START);
}

export function lolHomeStart<T>(): Promise<MirrorStart<T> | null> {
  return mirrorStart<T>('lolHome', {});
}
