import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { cachedJson, ASSET_CACHE_CONTROL } from '../../lib/api-cache';
import { expandLolTier } from '../../lib/rank-groups';
import { statsForTiers, type ChampionStatsFile } from '../../lib/champion-tier-stats';

interface ChampionInfo {
  id: string;
  key: string;
  name: string;
  title: string;
  tags: string[];
  image: string;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tier = searchParams.get('tier') || 'all';
  const role = searchParams.get('role') || 'all';
  // Whitelist gegen Open-Redirect / SSRF: der region-Wert fließt in
  // Dateinamen (`champion-stats-${region.replace('1','')}.json`). Werte wie
  // `../../etc/passwd` würden sonst durchrutschen.
  // Riot-Region-IDs sind ein kleines geschlossenes Set.
  const ALLOWED_REGIONS = new Set(['euw1', 'na1', 'kr', 'eun1', 'br1', 'jp1', 'la1', 'la2', 'oc1', 'tr1', 'ru', 'me1', 'ph2', 'sg2', 'th2', 'tw2', 'vn2']);
  const rawRegion = searchParams.get('region') || 'euw1';
  const region = ALLOWED_REGIONS.has(rawRegion) ? rawRegion : 'euw1';

  try {
    // Fetch Data Dragon version + champion list
    const versionRes = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
    const versions = await versionRes.json();
    const version = versions[0];

    const champRes = await fetch(
      `https://ddragon.leagueoflegends.com/cdn/${version}/data/de_DE/champion.json`
    );
    if (!champRes.ok) {
      return NextResponse.json({ error: 'Champion-Daten nicht verfügbar' }, { status: 502 });
    }
    const champData = await champRes.json();

    // Build champion list from Data Dragon
    const champions: ChampionInfo[] = Object.values(champData.data).map((c: any) => ({
      id: c.id,
      key: c.key,
      name: c.name,
      title: c.title,
      tags: c.tags,
      image: c.image.full,
    }));

    // Zahlen kommen aus den Sammel-Dateien des Wochen-Crawls (public/champion-stats-*.json).
    let statsMap: Record<string, {
      wins: number; games: number;
      kills: number; deaths: number; assists: number;
      bans: number; totalGames: number;
    }> = {};
    let hasStats = false;


    // Sammel-Datei: nur die Raenge des Filters zaehlen
    // (app/lib/champion-tier-stats.ts). Gibt die Quelle fuer den Rang nichts
    // her, bleibt die Liste ohne Zahlen statt Master+-Zahlen zu zeigen.
    const fileTiers = tier === 'all' ? null : expandLolTier(tier);
    const applyCollected = (collectData: ChampionStatsFile) => {
      const picked = statsForTiers(collectData, fileTiers);
      if (!picked) return;
      hasStats = true;
      for (const [key, s] of Object.entries(picked.stats)) {
        statsMap[key] = { ...s, totalGames: picked.totalGames };
      }
    };

    // Regionen ohne Datei bleiben ohne Zahlen. Eine Live-Sammlung bei Riot gibt
    // es hier bewusst nicht mehr: sie kostete bis ~165 Abrufe je Aufruf auf dem
    // geteilten Schluessel und lieferte hoechstens 100 Spiele.
    try {
      const statsFile = join(process.cwd(), 'public', `champion-stats-${region.replace('1', '')}.json`);
      if (existsSync(statsFile)) applyCollected(JSON.parse(readFileSync(statsFile, 'utf8')));
    } catch {
      // Datei unlesbar: ohne Zahlen weiter
    }

    // Match-based role data from champion-builds-{region}.json (preferred over Data Dragon tags).
    // Falls back to tag heuristic when builds JSON is not yet available.
    let roleGames: Record<string, Record<string, number>> = {}; // championKey -> { TOP: n, MID: n, ... }
    try {
      const buildsFile = join(process.cwd(), 'public', `champion-builds-${region.replace('1', '')}.json`);
      if (existsSync(buildsFile)) {
        const buildsData = JSON.parse(readFileSync(buildsFile, 'utf8'));
        for (const [champKey, roles] of Object.entries(buildsData.byChampionRole || {}) as [string, any][]) {
          roleGames[champKey] = {};
          for (const [r, d] of Object.entries(roles) as [string, any][]) {
            roleGames[champKey][r] = d.games || 0;
          }
        }
      }
    } catch {
      // builds JSON not yet generated, fall back to tags
    }
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
    const result = champions.map((champ) => {
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
            ? (c.significantRoles as string[]).includes(target)
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

    // `hasStats === false` ist die stille Degradierung dieser Route: die
    // Champion-Liste steht, aber jede Statistik fehlt, weil weder Datei noch
    // Live-Sammlung geliefert haben. Antwortcode bleibt 200 — deshalb haengt
    // die kurze TTL hier am Inhalt und nicht am Status.
    return cachedJson({
      version,
      champions: filtered,
      tier,
      totalChampions: filtered.length,
      hasStats,
      region,
    }, { cache: ASSET_CACHE_CONTROL, degraded: !hasStats || filtered.length === 0 });
  } catch (error) {
    return NextResponse.json({ error: 'Server Fehler' }, { status: 500 });
  }
}
