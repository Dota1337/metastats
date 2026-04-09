import { NextResponse } from 'next/server';

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

export async function GET() {
  const now = Date.now();
  if (cachedPatches && now - cacheTime < CACHE_TTL) {
    return NextResponse.json({ patches: cachedPatches });
  }

  try {
    // Get all versions from DDragon
    const versionsRes = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
    const allVersions: string[] = await versionsRes.json();

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
      const url = `https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-${year}-${patch}-notes`;

      // Estimate date: patches release every 2 weeks on Wednesday
      // Latest patch is current, each previous is ~14 days earlier
      const baseDate = new Date();
      baseDate.setDate(baseDate.getDate() - i * 14);
      // Snap to nearest Wednesday
      const dayOfWeek = baseDate.getDay();
      const daysToWed = (dayOfWeek >= 3) ? dayOfWeek - 3 : dayOfWeek + 4;
      baseDate.setDate(baseDate.getDate() - daysToWed);

      return {
        version: `${season}.${patch}`,
        date: baseDate.toISOString().split('T')[0],
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

    return NextResponse.json({
      patches,
      latestVersion: latestVersion,
      lastChecked: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({ error: 'Fehler beim Laden der Patch Notes' }, { status: 500 });
  }
}
