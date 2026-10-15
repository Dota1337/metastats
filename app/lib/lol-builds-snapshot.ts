import 'server-only';
// Liest die vorgerechneten Builds der LoL-Champion-Standardansicht (euw1 +
// EMERALD_PLUS) aus dem Blob. Geschrieben von scripts/publish-lol-builds.mjs
// nach jedem Verdichtungslauf; Pfade und Pruefregel: lol-builds-blob.mjs.
// Leser: die Builds-Route (Datei zuerst) und die Startdaten der Seite
// (seo/lol-detail-data.ts). Jeder Fehler → null → live wie bisher.
// Notschalter LOL_BUILDS_SNAPSHOT=0: Route rechnet live, Seite ohne Builds.
import { fetchBlob } from './meta-pulse-diff-snapshot';
import { isChampionKey, isValidLolBuildsSnapshot, lolBuildsPath } from './lol-builds-blob.mjs';
import type { BuildsResponse } from './lol-builds-view';

export type LolBuildsSnapshot = BuildsResponse & { builtAt: string };

export async function loadLolBuildsSnapshot(key: string): Promise<LolBuildsSnapshot | null> {
  if (process.env.LOL_BUILDS_SNAPSHOT === '0' || !isChampionKey(key)) return null;
  const snap = await fetchBlob(lolBuildsPath(key));
  return isValidLolBuildsSnapshot(snap, key) ? (snap as LolBuildsSnapshot) : null;
}
