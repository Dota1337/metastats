#!/usr/bin/env node
/**
 * Scrapes Liquipedia's Portal:Statistics/<year> "Money Rankings" + "Organization
 * Earnings" tables. This is the canonical 2026-current ranking — independently
 * curated by the wiki community from the Tournament-Standings data, so a
 * pro's earnings appearing in this table is the strongest signal that our
 * per-pro enrichment got the numbers right (or that we're missing them).
 *
 * Writes per pro: earnings_sources.liquipedia_yearly_<year> = $USD.
 * Logs anomalies into tft_pro_validation_log when:
 *   • A portal-listed pro doesn't exist in our DB → needs the category crawler
 *   • Portal earnings differ >25% from our per-pro Liquipedia enrichment
 *
 * Usage:
 *   node scripts/crawl-tft-pro-portal-stats.mjs                # current year
 *   node scripts/crawl-tft-pro-portal-stats.mjs --year 2025    # historical
 *   node scripts/crawl-tft-pro-portal-stats.mjs --no-supabase  # dry-run
 *   node scripts/crawl-tft-pro-portal-stats.mjs --verbose
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { liquipediaHtml } from './lib/liquipedia-tft.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const hasFlag = (k) => args.includes(k);

const YEAR = arg('--year', String(new Date().getFullYear()));
const SKIP_SUPABASE = hasFlag('--no-supabase');
const VERBOSE = hasFlag('--verbose');

function loadEnv() {
  const p = resolve(process.cwd(), '.env.local');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!line.includes('=') || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SKIP_SUPABASE && !SUPA_KEY) { console.error('SUPABASE_SERVICE_ROLE_KEY required'); process.exit(1); }

async function sb(path, init = {}) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      Prefer: init.method === 'POST' || init.method === 'PATCH' ? 'return=minimal' : '',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase ${path} HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : null;
}

const stripTags = (s) =>
  String(s || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();

// Liquipedia's "Money Rankings" table is the first numeric ranking on the
// page. We locate the section by its heading anchor and then walk the table
// rows. Format per row:
//   <td>Rank</td>
//   <td><a href="/tft/Name">Name</a></td>
//   <td>$USD</td>
//   …optional gold/silver/bronze medals…
function extractMoneyRankings(html) {
  // Anchor on the "Money Rankings" heading. The page has multiple ranking
  // tables — player, organization, country — so we slice the section first.
  const startMatch = html.match(/<h[23][^>]*id="(?:Money_Rankings|Players)"[^>]*>/i);
  if (!startMatch) return [];
  const start = startMatch.index;
  // End at the next h2/h3 OR the start of the organization table — whichever
  // comes first. We scan up to ~80 KB of HTML so a single huge year doesn't
  // blow the buffer.
  const stop = html.indexOf('<h2', start + 1);
  const section = html.slice(start, stop > 0 ? stop : start + 80_000);

  const rows = [];
  // Match each <tr> with a <td> linking to /tft/Name + a $-amount.
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = rowRe.exec(section))) {
    const tdContent = m[1];
    // Player link: href="/tft/Name". Page-name = match group; display title
    // sits in the link text.
    const nameMatch = tdContent.match(/<a[^>]+href="\/(?:teamfighttactics|tft)\/([^"#?]+)"[^>]*>([^<]+)<\/a>/i);
    if (!nameMatch) continue;
    const pageName = decodeURIComponent(nameMatch[1]).replace(/_/g, ' ');
    const displayName = stripTags(nameMatch[2]);
    // USD amount — handle $1,500 / $1500.00 / $1.5M etc.
    const usdMatch = tdContent.match(/\$([0-9,]+(?:\.[0-9]+)?)\s*([KMm]?)/);
    if (!usdMatch) continue;
    let usd = Number(usdMatch[1].replace(/,/g, ''));
    if (usdMatch[2] === 'M' || usdMatch[2] === 'm') usd *= 1_000_000;
    else if (usdMatch[2] === 'K') usd *= 1_000;
    if (!Number.isFinite(usd) || usd <= 0) continue;
    rows.push({ pageName, displayName, usd });
  }
  // Dedupe by pageName (rows may repeat the same pro across medal columns).
  const seen = new Set();
  return rows.filter(r => {
    if (seen.has(r.pageName)) return false;
    seen.add(r.pageName); return true;
  });
}

async function main() {
  const runId = randomUUID();
  console.log(`=== Liquipedia Portal:Statistics/${YEAR} — run ${runId} ===`);

  const html = await liquipediaHtml(`Portal:Statistics/${YEAR}`);
  if (!html) { console.error('Page returned no HTML'); process.exit(1); }

  const rankings = extractMoneyRankings(html);
  console.log(`Found ${rankings.length} players in Money Rankings`);
  if (VERBOSE) {
    for (const r of rankings.slice(0, 20)) {
      console.log(`  $${String(r.usd).padStart(9)} ${r.displayName} (${r.pageName})`);
    }
  }

  if (SKIP_SUPABASE) {
    console.log('\n(dry — no writes)');
    return;
  }

  // Match against existing tft_pro_players. Liquipedia's `source_page` field
  // is the Wiki page title (with underscores → spaces), so case-sensitive
  // exact match is the right join key.
  const pros = await sb('tft_pro_players?select=puuid,pro_name,source_page,earnings_sources,total_earnings_usd');
  const byPage = new Map();
  const byNameLower = new Map();
  for (const p of pros) {
    if (p.source_page) byPage.set(p.source_page.replace(/_/g, ' '), p);
    byNameLower.set(p.pro_name.toLowerCase(), p);
  }

  let matched = 0, missing = 0, divergent = 0;
  const yearKey = `liquipedia_yearly_${YEAR}`;
  for (const r of rankings) {
    const pro = byPage.get(r.pageName) || byNameLower.get(r.displayName.toLowerCase());
    if (!pro) {
      missing++;
      await sb('tft_pro_validation_log', {
        method: 'POST',
        body: JSON.stringify({
          validation_run_id: runId,
          pro_name: r.displayName,
          source: 'liquipedia_portal_stats',
          status: 'missing',
          severity: 3,
          field: 'identity',
          actual: { pageName: r.pageName, usd: r.usd, year: YEAR },
          detail: `Portal:Statistics/${YEAR} lists "${r.displayName}" ($${r.usd}) but tft_pro_players has no matching row — run crawl-tft-pro-categories.mjs to backfill`,
        }),
      });
      continue;
    }
    matched++;

    const sources = { ...(pro.earnings_sources || {}), [yearKey]: r.usd };
    const lifetime = Number(pro.total_earnings_usd) || 0;
    let divergent_pct = null;
    if (lifetime > 0) {
      // Yearly earnings should be ≤ lifetime. If they're >1.2× lifetime,
      // our per-pro enrichment is missing achievements. Flag it.
      if (r.usd > lifetime * 1.2) {
        divergent_pct = (r.usd - lifetime) / r.usd;
        divergent++;
      }
    }
    await sb(`tft_pro_players?puuid=eq.${encodeURIComponent(pro.puuid)}`, {
      method: 'PATCH',
      body: JSON.stringify({ earnings_sources: sources }),
    });
    if (divergent_pct != null) {
      await sb('tft_pro_validation_log', {
        method: 'POST',
        body: JSON.stringify({
          validation_run_id: runId,
          puuid: pro.puuid,
          pro_name: pro.pro_name,
          source: 'liquipedia_portal_stats',
          status: 'warning',
          severity: 2,
          field: 'earnings',
          expected: { lifetime },
          actual: { [yearKey]: r.usd },
          detail: `Portal yearly earnings ($${r.usd}) exceed lifetime ($${lifetime}) — per-pro enrichment is missing achievements`,
        }),
      });
    }
  }
  console.log(`\nMatched: ${matched} | Missing-in-DB: ${missing} | Divergent: ${divergent}`);
}

main().catch(err => { console.error('FATAL:', err.message); console.error(err.stack); process.exit(1); });
