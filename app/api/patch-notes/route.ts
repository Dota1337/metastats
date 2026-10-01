import { NextResponse } from 'next/server';
import { cachedJson, SLOW_CACHE_CONTROL } from '../../lib/api-cache';
import { getDdragonVersions } from '../../lib/ddragon-version-server';
import { parsePatchArticles, type PatchArticle } from '../../lib/lol-patch-dates';

interface PatchNote {
  version: string;
  date: string;
  url: string;
  highlights: string[];
  isNew: boolean;
}

// Cache patch notes for 1 hour
let cachedPatches: PatchNote[] | null = null;
let cacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour
// Ohne Riot-Daten frueher neu versuchen, sonst steht eine Stunde lang kein Datum.
const RETRY_TTL = 10 * 60 * 1000;
let cacheTtl = CACHE_TTL;

// Echte Daten + Adressen von Riots Patch-Notes-Uebersicht. Die letzte gute
// Tabelle bleibt im Speicher, falls ein spaeterer Abruf scheitert.
const RIOT_OVERVIEW = 'https://www.leagueoflegends.com/en-us/news/tags/patch-notes/';
let lastArticles: Map<string, PatchArticle> | null = null;

async function fetchArticles(): Promise<Map<string, PatchArticle> | null> {
  try {
    const res = await fetch(RIOT_OVERVIEW, {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; metastats.gg)' },
    });
    if (!res.ok) return null;
    const map = parsePatchArticles(await res.text());
    return map.size > 0 ? map : null;
  } catch {
    return null;
  }
}

export async function GET() {
  const now = Date.now();
  if (cachedPatches && now - cacheTime < cacheTtl) {
    // Edge-TTL gleich dem Prozess-TTL (1h). Kuerzer waere verschenkt: der Edge
    // wuerde revalidieren und von dieser Zeile denselben alten Wert bekommen.
    return cachedJson({ patches: cachedPatches }, { cache: SLOW_CACHE_CONTROL, degraded: !lastArticles });
  }

  try {
    // Get all versions from DDragon
    const [allVersions, fresh] = await Promise.all([getDdragonVersions(), fetchArticles()]);
    if (!allVersions) throw new Error('ddragon nicht erreichbar');
    if (fresh) lastArticles = fresh;
    const articles = lastArticles;

    // Filter to major patch versions only (e.g. 16.6.1 → 16.6)
    const seen = new Set<string>();
    const majorVersions: string[] = [];
    for (const v of allVersions) {
      const parts = v.split('.');
      const major = `${parts[0]}.${parts[1]}`;
      if (!seen.has(major)) {
        seen.add(major);
        majorVersions.push(v);
      }
    }

    // Take last 15 patches
    const recentVersions = majorVersions.slice(0, 15);
    const latestVersion = recentVersions[0];

    // Build patch notes with links to official Riot patch notes page
    const patches: PatchNote[] = recentVersions.map((v, i) => {
      const parts = v.split('.');
      const season = parseInt(parts[0], 10);
      const patch = parts[1];
      // DDragon uses season numbers (e.g. 16), Riot URLs use year (e.g. 26)
      // Season 14 = 2024, Season 15 = 2025, Season 16 = 2026
      const year = season + 10;
      const key = `${year}.${parseInt(patch, 10)}`;
      // Kein Artikel (Notes noch nicht erschienen / Seite nicht lesbar): kein
      // Datum statt eines geschaetzten, Link auf Riots Uebersicht statt einer
      // geratenen Adresse (Riot hat mehrere Adress-Formen).
      const article = articles?.get(key);
      const url = article?.url ?? RIOT_OVERVIEW;
      return {
        version: `${year}.${patch}`,
        date: article?.date ?? '',
        url,
        highlights: [],
        isNew: i === 0,
      };
    });

    // Try to fetch highlights for the latest patch from Riot's data
    try {
      const patchDataRes = await fetch(
        `https://ddragon.leagueoflegends.com/cdn/${latestVersion}/data/en_US/champion.json`
      );
      if (patchDataRes.ok) {
        patches[0].highlights = [
          `Patch ${patches[0].version} ist live`,
          `${Object.keys((await patchDataRes.json()).data).length} Champions verfügbar`,
        ];
      }
    } catch {}

    cachedPatches = patches;
    cacheTime = now;
    cacheTtl = fresh ? CACHE_TTL : RETRY_TTL;

    return cachedJson({
      patches,
      latestVersion: latestVersion,
      lastChecked: new Date().toISOString(),
    }, { cache: SLOW_CACHE_CONTROL, degraded: patches.length === 0 || !articles });
  } catch (error) {
    return NextResponse.json({ error: 'Fehler beim Laden der Patch Notes' }, { status: 500 });
  }
}
