#!/usr/bin/env node
/**
 * Scrape Riot's TFT Patch Schedule article into public/tft-roadmap.json.
 *
 * URL: https://support-teamfighttactics.riotgames.com/hc/en-us/articles/
 *      37127675562387-Patch-Schedule-Teamfight-Tactics
 *
 * The table has rows like:
 *   "TFT17.3" | "May 13, 2026"
 * Set boundaries are derived from where the major version changes
 * (e.g. last TFT17.x patch → set 17 end-1; first TFT18.x patch → set 18 start).
 *
 * Run weekly + on-demand by the season detect job.
 */

import { writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const URL = 'https://support-teamfighttactics.riotgames.com/hc/en-us/articles/37127675562387-Patch-Schedule-Teamfight-Tactics';

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function parseDate(text) {
  // "May 13, 2026" or "May 13, 2026 (Thursday)" → "2026-05-13"
  const m = text.match(/(\w+)\s+(\d+),\s*(\d{4})/);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${String(month).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
}

function parsePatchLabel(text) {
  // "TFT17.3" → { set: 17, version: "17.3" }
  // Some legacy rows omit "TFT" — be permissive.
  const m = text.match(/^(?:TFT)?(\d+)\.(\d+)$/i);
  if (!m) return null;
  return { set: Number(m[1]), version: `${m[1]}.${m[2]}` };
}

async function fetchHtml() {
  const res = await fetch(URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; metastats-roadmap-fetcher/1.0; +https://metastats.gg)',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) throw new Error(`roadmap HTTP ${res.status}`);
  return res.text();
}

function extractPatches(html) {
  const tableMatch = html.match(/<table[^>]*>[\s\S]*?<\/table>/);
  if (!tableMatch) throw new Error('no table found on roadmap page');
  const rows = tableMatch[0].match(/<tr[\s\S]*?<\/tr>/g) || [];
  const patches = [];
  for (const row of rows) {
    const cells = (row.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/g) || [])
      .map(c => c.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim());
    if (cells.length < 2) continue;
    const label = parsePatchLabel(cells[0]);
    const date = parseDate(cells[1]);
    if (label && date) patches.push({ version: label.version, set: label.set, date });
  }
  return patches;
}

// Set boundaries: for each set, startDate = first patch in that set,
// endDate = one day before the first patch of the next set (or null if not yet known).
function deriveSets(patches) {
  const bySet = new Map();
  for (const p of patches) {
    if (!bySet.has(p.set)) bySet.set(p.set, []);
    bySet.get(p.set).push(p);
  }
  const sorted = [...bySet.keys()].sort((a, b) => a - b);
  const out = {};
  for (let i = 0; i < sorted.length; i++) {
    const set = sorted[i];
    const list = bySet.get(set).slice().sort((a, b) => a.date.localeCompare(b.date));
    const startDate = list[0].date;
    let endDate = null;
    if (i + 1 < sorted.length) {
      const nextStart = bySet.get(sorted[i + 1]).slice().sort((a, b) => a.date.localeCompare(b.date))[0].date;
      // end = day before next set's first patch
      const d = new Date(nextStart + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() - 1);
      endDate = d.toISOString().slice(0, 10);
    }
    out[String(set)] = { setNumber: set, startDate, endDate, patches: list.map(p => ({ version: p.version, date: p.date })) };
  }
  return out;
}

async function main() {
  console.log('[roadmap] fetching from Riot Support');
  const html = await fetchHtml();
  console.log(`[roadmap] ${html.length} bytes`);
  const patches = extractPatches(html);
  if (patches.length === 0) throw new Error('no patches parsed — page format may have changed');
  const sets = deriveSets(patches);

  const out = {
    source: URL,
    fetchedAt: new Date().toISOString(),
    patches,
    sets,
  };
  const path = resolve(process.cwd(), 'public', 'tft-roadmap.json');
  writeFileSync(path, JSON.stringify(out, null, 2) + '\n');
  console.log(`[roadmap] wrote ${path}`);
  console.log(`[roadmap] ${patches.length} patches across sets ${Object.keys(sets).join(', ')}`);
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
