import 'server-only';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expandLolTier } from './rank-groups';
import { getLatestDdragonVersion, DDRAGON_TIMEOUT_MS } from './ddragon-version-server';
import { COLLECTED_TIERS, statsForTiers, type ChampionStatsFile, type TierStatsPick } from './champion-tier-stats';
import { boxListReady, boxStatsForTiers, LOL_CHAMPION_STATS_REGION } from './lol-champion-stats-blob.mjs';
import { loadLolChampionStats } from './lol-champion-stats-snapshot';
import type { ChampionListFilters, ChampionListPayload, ChampionListRow } from './lol-champion-filters';

// LoL-Champion-Liste: Data Dragon (Namen, Rollen-Tags) + Zahlen. EUW: zuerst
// die Box-Datei (Rang-Stichprobe Emerald bis Challenger, neuester Patch bzw.
// zwei Patches, lol-champion-stats-blob.mjs); sonst und fuer alle anderen
// Regionen die Sammel-Dateien des Wochen-Crawls (public/champion-stats-*.json,
// Rollen aus public/champion-builds-*.json). Eine Funktion fuer /api/champions
// und die Server-Huelle der Liste (SEO-Plan Schritt 6) — die Startdaten sind
// damit genau die Antwort der API.

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
  // Box-Datei parallel zu Data Dragon holen (meist aus dem Gedaechtnis).
  const boxPromise = region === LOL_CHAMPION_STATS_REGION ? loadLolChampionStats() : null;
  const version = await getLatestDdragonVersion();
  const champions = version ? await ddragonChampions(version) : null;
  if (!version || !champions) return null;

  let hasStats = false;
  let picked: TierStatsPick | null = null;
  const fileTiers = tier === 'all' ? null : expandLolTier(tier);

  // EUW: Box-Datei, sobald „Alle Raenge" Bannrate und KDA zeigen kann
  // (boxListReady). Kam sie nicht, obwohl sie da sein sollte, laeuft die Liste
  // auf der Wochendatei weiter, aber als degradiert — sonst hielte die Edge
  // 30 min lang Master+-Zahlen fest.
  const box = boxPromise ? await boxPromise : null;
  const boxFile = box?.status === 'ok' && boxListReady(box.file) ? box.file : null;
  const boxMissing = box?.status === 'unavailable';
  // Ab welchem Rang „Alle" zaehlt — aus der Quelle, nicht aus `picked`: der
  // gewaehlte Rang darf leer sein, waehrend „Alle" Zahlen hat.
  let allTiersFrom: string | null = null;
  if (boxFile) {
    const boxPick = boxStatsForTiers(boxFile, fileTiers);
    picked = boxPick;
    const allPick = fileTiers === null ? boxPick : boxStatsForTiers(boxFile, null);
    allTiersFrom = allPick?.tiers[0] ?? null;
  }

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
  if (!boxFile) {
    const collectData = readMemo<ChampionStatsFile>(
      join(process.cwd(), 'public', `champion-stats-${region.replace('1', '')}.json`),
      raw => JSON.parse(raw),
    );
    picked = collectData ? statsForTiers(collectData, fileTiers) : null;
    if (statsForTiers(collectData, null)) allTiersFrom = COLLECTED_TIERS[COLLECTED_TIERS.length - 1];
  }
  if (picked) hasStats = true;

  // Match-based role data (preferred over Data Dragon tags): Box-Datei bzw.
  // champion-builds-{region}.json. Falls back to tag heuristic when neither is available.
  const roleGames: RoleGames = boxFile?.roles || readMemo<RoleGames>(
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
    const stats = picked?.stats[champ.key];
    const totalGames = picked?.totalGames || 0;
    const banMatches = picked?.banMatches || 0;
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
      // totalGames zaehlt Teilnehmer-Plaetze (Wochendatei 10, Box 9 je Spiel).
      // Die Pickrate ist ein Anteil an Spielen, deshalb x 10: ein Champion steht
      // hoechstens einmal je Spiel. Die Bannrate hat ihren eigenen Nenner
      // (Spiele mit Ban-Daten), Bans sind je Spiel schon einmal gezaehlt.
      pickRate: stats && totalGames > 0 ? Math.round((stats.games * 10 / totalGames) * 1000) / 10 : null,
      banRate: stats && banMatches > 0 ? Math.round((stats.bans / banMatches) * 1000) / 10 : null,
      games: stats?.games || 0,
      avgKDA: stats && picked?.kdaOk && stats.games > 0 && stats.deaths > 0
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
      allTiersFrom,
    },
    degraded: !hasStats || filtered.length === 0 || boxMissing,
  };
}
