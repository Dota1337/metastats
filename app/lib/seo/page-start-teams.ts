import 'server-only';
// Startdaten der Pro-Teams-Liste (/teams): dieselbe Datei, die die Seite im
// Browser laedt (public/pro-teams/listing.json, scripts/build-pro-teams-derivate.mjs).
// Per fs gelesen — next.config.ts nimmt sie dafuer in die Funktion mit
// (outputFileTracingIncludes). Fehlt sie: keine Startdaten, die Seite laedt wie bisher.
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pageStartOn } from './start-core';

export interface TeamsListing<Team> {
  teams: Team[];
  seasons: string[];
}

// Die Datei aendert sich nur mit einem Deploy: je Prozess einmal lesen, neu nur
// bei geaenderter Datei (lokal beim Entwickeln).
let cached: { mtimeMs: number; value: TeamsListing<unknown> } | null = null;

export function teamsStart<Team>(): TeamsListing<Team> | null {
  if (!pageStartOn()) return null;
  try {
    const file = path.join(process.cwd(), 'public', 'pro-teams', 'listing.json');
    const { mtimeMs } = statSync(file);
    if (cached?.mtimeMs !== mtimeMs) {
      const data = JSON.parse(readFileSync(file, 'utf8')) as { teams?: unknown; seasons?: unknown };
      if (!Array.isArray(data.teams) || data.teams.length === 0) return null;
      cached = { mtimeMs, value: { teams: data.teams, seasons: Array.isArray(data.seasons) ? data.seasons as string[] : [] } };
    }
    return cached.value as TeamsListing<Team>;
  } catch {
    return null;
  }
}
