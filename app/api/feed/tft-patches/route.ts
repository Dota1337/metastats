import { NextRequest } from 'next/server';
import { getAvailablePatches, callRpc } from '../../../lib/tft-supabase-reader';

// /api/feed/tft-patches → RSS 2.0 of TFT patch winners/losers. Sprint 5.3.
// Lightweight newsletter surface: any RSS reader / newsletter tool can scrape.

const SITE = 'https://www.metastats.gg';

interface UnitRow {
  character_id: string;
  games: number;
  sum_placement: number;
  top4: number;
  top1: number;
  participants: number;
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, c => (
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&apos;'
  ));
}

// ph2/th2 raus — leer im TFT-Crawl (siehe tft-supabase-reader.ts).
const ALL_REGIONS = ['euw1','kr','na1','eun1','br1','jp1','la1','la2','oc1','tr1','ru','me1','sg2','tw2','vn2'];
const APEX = ['master','grandmaster','challenger'];

export async function GET(_request: NextRequest) {
  const patches = await getAvailablePatches(120);
  const items: string[] = [];

  for (let idx = 0; idx < Math.min(6, patches.length); idx++) {
    const p = patches[idx];
    const prev = patches[idx + 1];
    let bullets = '';
    try {
      if (prev) {
        const [curr, prevRows] = await Promise.all([
          callRpc<UnitRow[]>('get_tft_unit_stats', {
            p_regions: ALL_REGIONS, p_buckets: APEX, p_days: 30, p_patch: p.patch, p_set: p.set_number,
          }),
          callRpc<UnitRow[]>('get_tft_unit_stats', {
            p_regions: ALL_REGIONS, p_buckets: APEX, p_days: 30, p_patch: prev.patch, p_set: prev.set_number,
          }),
        ]);
        const prevMap = new Map(prevRows.map(r => [r.character_id, r]));
        const diffs: { id: string; delta: number }[] = [];
        for (const c of curr) {
          const pp = prevMap.get(c.character_id);
          if (!pp || c.games < 50 || pp.games < 50) continue;
          const cAvg = Number(c.sum_placement) / Number(c.games);
          const pAvg = Number(pp.sum_placement) / Number(pp.games);
          diffs.push({ id: c.character_id, delta: cAvg - pAvg });
        }
        diffs.sort((a, b) => a.delta - b.delta);
        const winners = diffs.slice(0, 3);
        const losers = diffs.slice(-3).reverse();
        bullets =
          '<p><b>Winners:</b> ' + winners.map(w => `${w.id.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '')} (Δ ${w.delta.toFixed(2)})`).join(', ') + '</p>' +
          '<p><b>Losers:</b> ' + losers.map(l => `${l.id.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '')} (Δ +${l.delta.toFixed(2)})`).join(', ') + '</p>';
      }
    } catch {}

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
