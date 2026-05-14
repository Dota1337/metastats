import { NextResponse } from 'next/server';
import { getAvailablePatches } from '../../../lib/tft-supabase-reader';
import { tftPatchLabel } from '../../../lib/tft-patch-label';

// TFT-specific patch notes. Sources the patch list from our daily-stats
// crawl (`get_tft_available_patches` RPC) and maps each patch number to its
// canonical Riot TFT news URL — the LoL patch-notes endpoint can't be
// reused because TFT lives on a different teamfighttactics.lol... domain.
//
// URL pattern (verified live 2026-05-13 against the TFT news index):
//   `https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-XX-Y`
//
// Earlier attempts failed because of two mistakes:
//   1) `www.leagueoflegends.com` doesn't host TFT articles — they're on
//      the TFT subdomain (teamfighttactics.lol...).
//   2) The path has no `-notes` suffix, despite the LoL pattern using one.
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
  if (!m) return 'https://teamfighttactics.leagueoflegends.com/en-us/news/tags/patch-notes/';
  return `https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-${m[1]}-${m[2]}`;
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
    // The crawl_meta table stores Riot's raw game_version (LoL patch like
    // "16.10"), not the TFT marketing label users actually see in-game
    // and on the patch-notes page. Normalise here so the side-drawer
    // header, the link URL, and the date list all match.
    const dedup = new Map<string, { date: string; raw: string }>();
    for (const r of rows) {
      const tftLabel = tftPatchLabel(r.patch);
      if (!tftLabel) continue;
      // Keep the *latest* entry per TFT label (rows are already sorted
      // newest-first by getAvailablePatches).
      if (!dedup.has(tftLabel)) dedup.set(tftLabel, { date: r.last_day, raw: r.patch });
    }
    const patches: PatchNote[] = [...dedup.entries()].map(([version, info], i) => ({
      version,
      date: info.date,
      url: tftPatchUrl(version),
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
