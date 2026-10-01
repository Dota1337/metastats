import 'server-only';

// DataDragon-Versionsliste fuer Server-Routen. Gegenstueck fuer den Browser
// ist ddragon-version.ts (fragt /api/version). Skripte nutzen
// scripts/lib/lol-items.mjs (laengeres Zeitlimit, wirft bei Fehlern).
//
// Zeitlimit, damit ein haengendes ddragon nicht die ganze Route bis zum
// Funktions-Timeout festhaelt. Der Speicher lebt nur in einer laufenden
// Server-Instanz, er ist kein geteilter Cache.

export const DDRAGON_TIMEOUT_MS = 5000;
const VERSIONS_URL = 'https://ddragon.leagueoflegends.com/api/versions.json';
const MEMO_MS = 10 * 60 * 1000;

let memo: { versions: string[]; at: number } | null = null;

async function fetchVersions(): Promise<string[]> {
  const res = await fetch(VERSIONS_URL, { signal: AbortSignal.timeout(DDRAGON_TIMEOUT_MS) });
  if (!res.ok) throw new Error('ddragon ' + res.status);
  const data: unknown = await res.json();
  if (!Array.isArray(data) || data.length === 0 || !data.every((v) => typeof v === 'string' && v)) {
    throw new Error('ddragon: keine Versionsliste');
  }
  return data as string[];
}

// Neueste zuerst. fresh: am Speicher vorbei und ohne Rueckfall auf den
// letzten guten Wert (fuer den Patch-Cron, der sonst eine alte Version als
// aktuell eintragen wuerde). null, wenn nichts Gueltiges vorliegt.
export async function getDdragonVersions({ fresh = false }: { fresh?: boolean } = {}): Promise<string[] | null> {
  const now = Date.now();
  if (!fresh && memo && now - memo.at < MEMO_MS) return memo.versions;
  try {
    const versions = await fetchVersions();
    memo = { versions, at: now };
    return versions;
  } catch {
    return fresh ? null : memo?.versions ?? null;
  }
}

export async function getLatestDdragonVersion(opts?: { fresh?: boolean }): Promise<string | null> {
  return (await getDdragonVersions(opts))?.[0] ?? null;
}
