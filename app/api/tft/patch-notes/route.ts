import { NextResponse } from 'next/server';
import { getAvailablePatches } from '../../../lib/tft-supabase-reader';

// TFT-specific patch notes. Sources the patch list from our daily-stats
// crawl (`get_tft_available_patches` RPC) and maps each patch number to its
// canonical Riot TFT news URL — the LoL patch-notes endpoint can't be
// reused because TFT lives on a different teamfighttactics.lol... domain.
//
// URL pattern: `https://www.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-XX-Y-notes`
// The previous teamfighttactics.lol... subdomain returned 404 — Riot
// publishes TFT patch notes under the main league of legends news index.
//
// 1-hour cache because the patch list only changes when Riot ships a new
// version (every two weeks).

interface PatchNote {
  version: string;            // '17.2'
  date: string;               // 'YYYY-MM-DD'
  url: string;
  highlights: string[];
  isNew: boolean;
}

let cached: { ts: number; patches: PatchNote[] } | null = null;
const TTL = 60 * 60 * 1000;

function tftPatchUrl(version: string): string {
  // Strip trailing letter suffix (e.g. "17.2b" → "17-2") since Riot's URL
  // doesn't include sub-patch suffixes; clicking through still lands on the
  // most recent post for that major patch.
  const m = /^(\d+)\.(\d+)/.exec(version);
  // Fallback to the news index on leagueoflegends.com — also the canonical
  // home for the per-patch posts.
  if (!m) return 'https://www.leagueoflegends.com/en-us/news/tags/teamfight-tactics-patch-notes/';
  return `https://www.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-${m[1]}-${m[2]}-notes`;
}

export async function GET() {
  const now = Date.now();
  if (cached && now - cached.ts < TTL) {
    return NextResponse.json({ patches: cached.patches });
  }

  try {
    // 180 days = roughly the lifetime of a TFT set; gives us all patches
    // of the current set plus the tail end of the previous one.
    const rows = await getAvailablePatches(180);
    const patches: PatchNote[] = rows.map((r, i) => ({
      version: r.patch,
      date: r.last_day,
      url: tftPatchUrl(r.patch),
      // We don't crawl headline summaries — the side-drawer card links
      // straight to Riot's patch notes page. Highlights stays empty so
      // the LoL-side renderer's "summary list" stays graceful.
      highlights: [],
      isNew: i === 0,
    }));

    cached = { ts: now, patches };
    return NextResponse.json({
      patches,
      lastChecked: new Date().toISOString(),
      source: 'tft-supabase + riot-news-url-pattern',
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'patch notes load failed' }, { status: 500 });
  }
}
