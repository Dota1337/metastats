import 'server-only';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expandLolTier } from './rank-groups';
import { getLatestDdragonVersion, DDRAGON_TIMEOUT_MS } from './ddragon-version-server';
import { statsForTiers, type ChampionStatsFile } from './champion-tier-stats';
import type { ChampionListFilters, ChampionListPayload, ChampionListRow } from './lol-champion-filters';

// LoL-Champion-Liste: Data Dragon (Namen, Rollen-Tags) + Sammel-Dateien des
// Wochen-Crawls (public/champion-stats-*.json, Rollen aus
// public/champion-builds-*.json). Eine Funktion fuer /api/champions und die
// Server-Huelle der Liste (SEO-Plan Schritt 6) — die Startdaten sind damit
// genau die Antwort der API.

interface ChampionInfo {
  id: string;
  key: string;
  name: string;
  title: string;
  tags: string[];
  image: string;
}

type RoleGames = Record<string, Record<string, number>>; // championKey -> { TOP: n, MIDDLE: n, ... }

// Die Dateien aendern sich nur mit einem Deploy; die Seite fragt sie aber bei
// jedem Aufruf ab (champion-builds-euw.json hat 1,1 MB). Deshalb je Prozess
// gemerkt, neu gelesen nur bei geaenderter Datei. Hoechstens ein Eintrag je
// erlaubter Region.
const fileMemo = new Map<string, { mtimeMs: number; value: unknown }>();

function readMemo<T>(file: string, parse: (raw: string) => T): T | null {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch {
    return null; // Datei fehlt: Region ohne Zahlen bzw. ohne Rollen
  }
  const hit = fileMemo.get(file);
  if (hit && hit.mtimeMs === mtimeMs) return hit.value as T;
  try {
    const value = parse(readFileSync(file, 'utf8'));
    fileMemo.set(file, { mtimeMs, value });
    return value;
  } catch {
    return null; // Datei unlesbar: ohne Zahlen weiter
  }
}

function roleGamesOf(raw: string): RoleGames {
  const buildsData = JSON.parse(raw) as { byChampionRole?: Record<string, Record<string, { games?: number }>> };
  const roleGames: RoleGames = {};
  for (const [champKey, roles] of Object.entries(buildsData.byChampionRole || {})) {
    roleGames[champKey] = {};
    for (const [r, d] of Object.entries(roles)) {
      roleGames[champKey][r] = d.games || 0;
    }
  }
  return roleGames;
}

// Je Prozess fuer die laufende Version gemerkt; der Abruf selbst liegt im
// Data Cache (Adresse traegt die Version, Inhalt aendert sich nie).
let ddragonMemo: { version: string; list: ChampionInfo[] } | null = null;

async function ddragonChampions(version: string): Promise<ChampionInfo[] | null> {
  if (ddragonMemo?.version === version) return ddragonMemo.list;
  const res = await fetch(
    `https://ddragon.leagueoflegends.com/cdn/${version}/data/de_DE/champion.json`,
    { signal: AbortSignal.timeout(DDRAGON_TIMEOUT_MS), next: { revalidate: 86400 } },
  );
  if (!res.ok) return null;
  const champData = (await res.json()) as {
    data: Record<string, Omit<ChampionInfo, 'image'> & { image: { full: string } }>;
  };
  const list: ChampionInfo[] = Object.values(champData.data).map((c) => ({
    id: c.id,
    key: c.key,
    name: c.name,
    title: c.title,
    tags: c.tags,
    image: c.image.full,
  }));
  ddragonMemo = { version, list };
  return list;
}

/** null = Data Dragon nicht erreichbar (die Route antwortet dann 502). */
export async function loadChampionList(
  { tier, role, region }: ChampionListFilters,
): Promise<{ payload: ChampionListPayload; degraded: boolean } | null> {
  const version = await getLatestDdragonVersion();
  const champions = version ? await ddragonChampions(version) : null;
  if (!version || !champions) return null;

  // Zahlen kommen aus den Sammel-Dateien des Wochen-Crawls (public/champion-stats-*.json).
  const statsMap: Record<string, {
    wins: number; games: number;
    kills: number; deaths: number; assists: number;
    bans: number; totalGames: number;
  }> = {};
  let hasStats = false;

  // Sammel-Datei: nur die Raenge des Filters zaehlen
  // (app/lib/champion-tier-stats.ts). Gibt die Quelle fuer den Rang nichts
  // her, bleibt die Liste ohne Zahlen statt Master+-Zahlen zu zeigen.
  //
  // Regionen ohne Datei bleiben ohne Zahlen. Eine Live-Sammlung bei Riot gibt
  // es hier bewusst nicht mehr: sie kostete bis ~165 Abrufe je Aufruf auf dem
  // geteilten Schluessel und lieferte hoechstens 100 Spiele.
  //
  // Die Pfade stehen ausgeschrieben im join(): daran erkennt die Build-Spur,
  // welche Dateien die Funktion braucht.
  const fileTiers = tier === 'all' ? null : expandLolTier(tier);
  const collectData = readMemo<ChampionStatsFile>(
    join(process.cwd(), 'public', `champion-stats-${region.replace('1', '')}.json`),
    raw => JSON.parse(raw),
  );
  const picked = collectData ? statsForTiers(collectData, fileTiers) : null;
  if (picked) {
    hasStats = true;
    for (const [key, s] of Object.entries(picked.stats)) {
      statsMap[key] = { ...s, totalGames: picked.totalGames };
    }
  }

  // Match-based role data from champion-builds-{region}.json (preferred over Data Dragon tags).
  // Falls back to tag heuristic when builds JSON is not yet available.
  const roleGames = readMemo<RoleGames>(
    join(process.cwd(), 'public', `champion-builds-${region.replace('1', '')}.json`),
    roleGamesOf,
  ) || {};
  const hasMatchRoles = Object.keys(roleGames).length > 0;

  // Map Data Dragon tags to roles (fallback for champions without match data)
  const tagToRole: Record<string, string> = {
    Fighter: 'TOP',
    Tank: 'TOP',
    Assassin: 'JUNGLE',
    Mage: 'MIDDLE',
    Marksman: 'BOTTOM',
    Support: 'UTILITY',
  };

  // Resolve primary role + significant roles for a champion. Significant = role
  // accounts for at least 5% of the champion's games — that's where op.gg/lolg
  // also draws the line for "this champion is a viable pick here".
  const ROLE_SIGNIFICANCE = 0.05;
  function resolveRoles(champKey: string, tags: string[]): { primary: string; significant: Set<string> } {
    const fromMatches = roleGames[champKey];
    if (fromMatches && Object.keys(fromMatches).length > 0) {
      const total = Object.values(fromMatches).reduce((a, b) => a + b, 0);
      const significant = new Set<string>();
      let primary = '';
      let max = -1;
      for (const [r, g] of Object.entries(fromMatches)) {
        if (g / total >= ROLE_SIGNIFICANCE) significant.add(r);
        if (g > max) { max = g; primary = r; }
      }
      return { primary, significant };
    }
    const tagPrimary = tagToRole[tags[0]] || 'MIDDLE';
    return { primary: tagPrimary, significant: new Set([tagPrimary]) };
  }

  // Merge champion info with stats
  const result: ChampionListRow[] = champions.map((champ) => {
    const stats = statsMap[champ.key];
    const { primary, significant } = resolveRoles(champ.key, champ.tags);

    return {
      id: champ.id,
      key: champ.key,
      name: champ.name,
      title: champ.title,
      tags: champ.tags,
      image: champ.image,
      role: primary,
      significantRoles: [...significant],
      winRate: stats && stats.games > 0 ? Math.round((stats.wins / stats.games) * 1000) / 10 : null,
      // totalGames zaehlt Teilnehmer (Spiele x 10). Pick-/Bannrate sind Anteile
      // an Spielen, deshalb x 10: ein Champion steht hoechstens einmal je Spiel.
      pickRate: stats && stats.totalGames > 0 ? Math.round((stats.games * 10 / stats.totalGames) * 1000) / 10 : null,
      banRate: stats && stats.totalGames > 0 ? Math.round((stats.bans * 10 / stats.totalGames) * 1000) / 10 : null,
      games: stats?.games || 0,
      avgKDA: stats && stats.games > 0 && stats.deaths > 0
        ? Math.round(((stats.kills + stats.assists) / stats.deaths) * 100) / 100
        : null,
    };
  });

  // Filter by role: when match-based roles are available, use significantRoles
  // (champion qualifies for every role he plays >= 5%). Otherwise primary only.
  const roleMap: Record<string, string> = {
    top: 'TOP',
    jungle: 'JUNGLE',
    mid: 'MIDDLE',
    adc: 'BOTTOM',
    support: 'UTILITY',
  };
  const filtered = role !== 'all'
    ? result.filter((c) => {
        const target = roleMap[role.toLowerCase()];
        if (!target) return false;
        return hasMatchRoles
          ? c.significantRoles.includes(target)
          : c.role === target;
      })
    : result;

  // Sort: champions with data first (by pick rate desc), then alphabetically
  filtered.sort((a, b) => {
    if (a.games > 0 && b.games === 0) return -1;
    if (a.games === 0 && b.games > 0) return 1;
    if (a.games > 0 && b.games > 0) return (b.pickRate || 0) - (a.pickRate || 0);
    return a.name.localeCompare(b.name);
  });

  // `hasStats === false` ist die stille Degradierung: die Champion-Liste
  // steht, aber jede Statistik fehlt, weil keine Datei geliefert hat. Die
  // Route antwortet trotzdem 200 — deshalb haengt die kurze TTL am Inhalt und
  // nicht am Status; die Server-Huelle nimmt solche Staende nicht als Startdaten.
  return {
    payload: {
      version,
      champions: filtered,
      tier,
      totalChampions: filtered.length,
      hasStats,
      region,
    },
    degraded: !hasStats || filtered.length === 0,
  };
}
