import { NextRequest } from 'next/server';
import { getAvailablePatches, ALL_REGIONS } from '../../../lib/tft-supabase-reader';
import { loadPatchDiff } from '../../../lib/meta-pulse-diff-snapshot';
import { PATCH_DIFF_BUCKETS, PATCH_DIFF_MIN_GAMES } from '../../../lib/snapshot-matrix';
import { SITE_URL } from '../../../lib/site';

// /api/feed/tft-patches → RSS 2.0 of TFT patch winners/losers. Sprint 5.3.
// Lightweight newsletter surface: any RSS reader / newsletter tool can scrape.
//
// Gewinner/Verlierer kommen nur aus den vorgerechneten Blobs der Box
// (tft/patch-diff/*, Meister+, alle Regionen) — der Feed fragt die Datenbank
// nicht mehr selbst. Fehlt ein Blob, steht beim Patch der kurze Ersatztext.

const SITE = SITE_URL;
const FEED_PATCHES = 6;
const APEX = PATCH_DIFF_BUCKETS.master_plus;

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, c => (
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&apos;'
  ));
}

export async function GET(_request: NextRequest) {
  const patches = await getAvailablePatches(120);
  const items: string[] = [];

  // Ein Blob je Patch, auch fuer den Vorgaenger des letzten gezeigten Patches.
  const shown = patches.slice(0, Math.min(FEED_PATCHES + 1, patches.length));
  const blobs = await Promise.all(shown.map((p, idx) => loadPatchDiff({
    entity: 'unit', regions: ALL_REGIONS, bucketLabel: 'master_plus', buckets: APEX,
    patch: p, set: Number(p.set_number), closed: idx > 0,
  }).catch(() => null)));

  for (let idx = 0; idx < Math.min(FEED_PATCHES, patches.length); idx++) {
    const p = patches[idx];
    const curr = blobs[idx];
    const prevRows = blobs[idx + 1];
    let bullets = '';
    if (curr && prevRows) {
      const prevMap = new Map(prevRows.map(r => [r.key, r]));
      const diffs: { id: string; delta: number }[] = [];
      for (const c of curr) {
        const pp = prevMap.get(c.key);
        if (!pp || c.games < PATCH_DIFF_MIN_GAMES || pp.games < PATCH_DIFF_MIN_GAMES) continue;
        const cAvg = c.sum_placement / c.games;
        const pAvg = pp.sum_placement / pp.games;
        diffs.push({ id: c.key, delta: cAvg - pAvg });
      }
      if (diffs.length > 0) {
        diffs.sort((a, b) => a.delta - b.delta);
        const winners = diffs.slice(0, 3);
        const losers = diffs.slice(-3).reverse();
        bullets =
          '<p><b>Winners:</b> ' + winners.map(w => `${w.id.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '')} (Δ ${w.delta.toFixed(2)})`).join(', ') + '</p>' +
          '<p><b>Losers:</b> ' + losers.map(l => `${l.id.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '')} (Δ +${l.delta.toFixed(2)})`).join(', ') + '</p>';
      }
    }

    items.push(`
    <item>
      <title>TFT Patch ${escapeXml(p.patch)}</title>
      <link>${SITE}/tft/patch/winners</link>
      <guid isPermaLink="false">tft-patch-${escapeXml(p.patch)}</guid>
      <pubDate>${new Date(p.last_day).toUTCString()}</pubDate>
      <description><![CDATA[${bullets || `Patch ${p.patch} data updated. ${p.total_matches} matches analyzed.`}]]></description>
    </item>`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>metastats.gg — TFT Patch Updates</title>
    <link>${SITE}</link>
    <description>Latest TFT meta shifts, patch winners and losers, computed from Master+ ranked data.</description>
    <language>en</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    ${items.join('')}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600',
    },
  });
}
