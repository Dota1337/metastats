#!/usr/bin/env node
/**
 * Builds public/tft-patch-notes-{set}.json from tactics.tools/info/patch-notes
 * — chosen over Riot direct because tactics.tools image-src URLs leak the
 * actual apiName (tft17_caitlyn.jpg → TFT17_Caitlyn) which sidesteps the 338
 * Item-Display-Name-Collisions across legacy Sets that would plague a
 * display-name reverse-lookup against Riot's raw HTML.
 *
 * Source verified 2026-06-21 via classification-reviewer Spot-Check:
 *   - HTML stable across patches 17.1 / 17.2 / 17.5 (h2 SYSTEMS / LARGE
 *     CHANGES / BUG FIXES + h4-per-entry pattern)
 *   - robots.txt: `User-agent: *` ohne Disallow → Scrape erlaubt
 *   - img src patterns:
 *       /img/face/tft17_{champ}.jpg     → TFT17_{Champ}
 *       /img/augments/17{aug}.png       → TFT17_Augment_{aug}
 *       /static/trait-icons/.../tft17_{trait}_w.svg → TFT17_{trait}
 *
 * Schema-Beispiel:
 *   {
 *     "set": 17,
 *     "source": "tactics.tools/info/patch-notes",
 *     "fetchedAt": "...",
 *     "patches": {
 *       "17.5": {
 *         "sections": [
 *           { "category": "TRAITS", "entries": [
 *               { "apiName": "TFT17_AnimaSquad", "displayName": "Anima Squad",
 *                 "change": "AnimaSquad bonus damage: 20/40/60 ⇒ 25/45/65" }
 *           ]},
 *           ...
 *         ]
 *       },
 *       "17.4": {...}
 *     }
 *   }
 *
 * Bootstrap: erster Lauf scraped alle in patches[]-Argument übergebenen
 * Versions. Daily-Crawl-Lauf scraped nur den aktuellen Patch (kein
 * Riot-Hammer-Loop). Fail-loud bei zu wenigen parsed Entries.
 */
import { request } from 'node:https';
import { lookup } from 'node:dns';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

function lookupIPv4(host) {
  return new Promise((res, rej) => lookup(host, { family: 4 }, (e, a) => e ? rej(e) : res(a)));
}
function get(url) {
  const u = new URL(url);
  return lookupIPv4(u.hostname).then(ip => new Promise((res, rej) => {
    const req = request({
      host: ip, servername: u.hostname, port: 443,
      path: u.pathname + u.search, method: 'GET',
      headers: {
        Host: u.hostname,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        'Accept': 'text/html,application/json,*/*',
      },
    }, r => {
      const c = [];
      r.on('data', x => c.push(x));
      r.on('end', () => {
        if (r.statusCode !== 200) return rej(new Error('HTTP ' + r.statusCode + ' for ' + url));
        res(Buffer.concat(c).toString('utf8'));
      });
    });
    req.on('error', rej);
    req.setTimeout(60000, () => req.destroy(new Error('timeout')));
    req.end();
  }));
}

function decodeHtml(s) {
  return s
    .replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
function stripTags(s) {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

// Extrahiert die apiName aus einem tactics.tools img-src. Pattern:
//   /img/face/tft17_caitlyn.jpg   → TFT17_Caitlyn
//   /img/augments/17NasusCarry1.png → TFT17_Augment_NasusCarry1
//   /static/trait-icons/.../tft17_admin_w.svg → TFT17_Admin_W (Stargazer-Constellations)
// Bei nicht-Set-17 oder unbekanntem Pattern: null (UI zeigt dann plain
// displayName ohne Link).
function apiNameFromImgSrc(src, setNumber) {
  if (!src) return null;
  // Champion face
  let m = /\/img\/face\/tft(\d+)_([a-z0-9]+)\.(jpg|png|webp)/i.exec(src);
  if (m) {
    if (parseInt(m[1], 10) !== setNumber) return null;
    const champ = m[2].charAt(0).toUpperCase() + m[2].slice(1);
    return `TFT${setNumber}_${champ}`;
  }
  // Augment
  m = /\/img\/augments\/(\d+)([A-Za-z0-9]+)\.(png|jpg|svg)/i.exec(src);
  if (m) {
    if (parseInt(m[1], 10) !== setNumber) return null;
    return `TFT${setNumber}_Augment_${m[2]}`;
  }
  // Trait icon (oft mit „new"-prefix bei Constellation-Varianten)
  m = /\/trait-icons\/[^/]*tft(\d+)_([a-z0-9_]+?)(?:_w)?\.svg/i.exec(src);
  if (m) {
    if (parseInt(m[1], 10) !== setNumber) return null;
    // Snake-Case zu PascalCase
    const trait = m[2].split('_').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('_');
    return `TFT${setNumber}_${trait}`;
  }
  return null;
}

// Parsing pro Patch-Notes-Page. tactics.tools rendert pro Section (h2)
// einzelne Entries als `<div class="flex items-center pt-2">` Container
// mit `<img alt="EntityName" src="…tft17_…"/>` + nachfolgendem `<div>`
// mit dem Change-Text. Plus h3-Sub-Sections (z.B. „UNITS: TIER 1") als
// Themen-Untergruppen innerhalb einer h2.
//
// Strategie:
//   1. h2-Sections finden (top-level)
//   2. Pro Section: alle img-Tags mit tactics.tools-src + alt finden
//   3. Pro img: nachfolgenden Change-Text bis zum nächsten img extrahieren
//   4. apiName aus img-src, displayName aus img-alt
function parsePatchNotes(html, setNumber) {
  const sections = [];

  const h2Re = /<h2[^>]*>([\s\S]*?)<\/h2>/g;
  const h2Matches = [];
  let m;
  while ((m = h2Re.exec(html)) !== null) {
    h2Matches.push({ index: m.index, end: m.index + m[0].length, name: stripTags(m[1]) });
  }
  if (h2Matches.length === 0) return [];

  for (let i = 0; i < h2Matches.length; i++) {
    const h2 = h2Matches[i];
    const sectionEnd = i + 1 < h2Matches.length ? h2Matches[i + 1].index : html.length;
    const sectionHtml = html.slice(h2.end, sectionEnd);

    // Pro Section: img-Tags mit tactics.tools-src (= Entity-Marker)
    // Plus die Change-Text-Div direkt danach
    const entries = [];
    const imgRe = /<img[^>]+alt="([^"]*)"[^>]+src="([^"]+tft\.tools[^"]+)"[^>]*\/>/g;
    const imgMatches = [];
    let mi;
    while ((mi = imgRe.exec(sectionHtml)) !== null) {
      imgMatches.push({
        index: mi.index,
        end: mi.index + mi[0].length,
        alt: decodeHtml(mi[1]),
        src: mi[2],
      });
    }

    for (let j = 0; j < imgMatches.length; j++) {
      const img = imgMatches[j];
      const entryEnd = j + 1 < imgMatches.length ? imgMatches[j + 1].index : sectionHtml.length;
      // Change-Text steht im nächsten div oder p nach dem img.
      // Pragmatischer Greedy-Match: erstes `<div ...>TEXT</div>` nach dem img
      // (mit text-Inhalt, nicht nested-img).
      const after = sectionHtml.slice(img.end, entryEnd);
      // Erstes div mit reinem Text-Inhalt (kein img drin)
      const textDivRe = /<div[^>]*>([^<]+?)<\/div>/;
      const dm = textDivRe.exec(after);
      let change = dm ? decodeHtml(stripTags(dm[1])).trim() : '';
      // Fallback: erstes p oder span mit text
      if (!change || change.length < 5) {
        const pm = /<(?:p|span)[^>]*>([^<]+?)<\/(?:p|span)>/.exec(after);
        change = pm ? decodeHtml(stripTags(pm[1])).trim() : '';
      }
      // Fallback 2: nimm den ganzen text nach img bis zum nächsten img
      if (!change || change.length < 5) {
        change = decodeHtml(stripTags(after.slice(0, 500))).trim();
      }
      const apiName = apiNameFromImgSrc(img.src, setNumber);
      if (!change || change.length < 5) continue;
      // Filter: Developer-Notes sind oft sehr lang und gehören eigentlich zur
      // Section, nicht zum Entry. Aber wir akzeptieren das als Best-Effort.
      const displayName = img.alt || '';
      if (!displayName) continue;
      entries.push({ apiName, displayName, change });
    }

    if (entries.length > 0) {
      sections.push({ category: h2.name, entries });
    }
  }
  return sections;
}

async function scrapePatch(patch, setNumber) {
  const url = `https://tactics.tools/info/patch-notes/${patch}`;
  console.log(`       fetch ${url}`);
  const html = await get(url);
  const sections = parsePatchNotes(html, setNumber);
  const totalEntries = sections.reduce((s, x) => s + x.entries.length, 0);
  const withApiName = sections.reduce((s, x) => s + x.entries.filter(e => e.apiName).length, 0);
  console.log(`       parsed: ${sections.length} sections, ${totalEntries} entries, ${withApiName} with apiName`);
  if (totalEntries < 5) {
    throw new Error(`Patch ${patch}: too few entries parsed (${totalEntries}). HTML structure changed?`);
  }
  return { sections, totalEntries, withApiName };
}

async function main() {
  // Patch-Liste aus Argument (z.B. „17.5,17.4,17.3,17.2,17.1") oder
  // Default: nur aktueller Patch aus tft-set.json
  const arg = process.argv[2];
  const live = JSON.parse(readFileSync('public/tft-assets.json', 'utf8'));
  const setNumber = live.set;
  let patches;
  if (arg === '--bootstrap') {
    // Bootstrap-Mode: alle bekannten Set-17-Patches aus current set
    const setMeta = JSON.parse(readFileSync('public/tft-set.json', 'utf8'));
    // setMeta.latestPatch z.B. „17.5" → wir scrapen 17.1 bis latestPatch
    const latest = setMeta.latestPatch || `${setNumber}.5`;
    const minor = parseInt(latest.split('.')[1] || '5', 10);
    patches = [];
    for (let p = 1; p <= minor; p++) patches.push(`${setNumber}.${p}`);
  } else if (arg) {
    patches = arg.split(',').map(s => s.trim()).filter(Boolean);
  } else {
    const setMeta = JSON.parse(readFileSync('public/tft-set.json', 'utf8'));
    patches = [setMeta.latestPatch || `${setNumber}.5`];
  }

  console.log(`[1/3] Scrape tactics.tools/info/patch-notes for patches: ${patches.join(', ')}`);
  const out = {
    set: setNumber,
    source: 'tactics.tools/info/patch-notes',
    fetchedAt: new Date().toISOString(),
    patches: {},
  };
  // Existing override mergen (incremental updates)
  const existingPath = `public/tft-patch-notes-${setNumber}.json`;
  if (existsSync(existingPath)) {
    try {
      const existing = JSON.parse(readFileSync(existingPath, 'utf8'));
      out.patches = existing.patches || {};
    } catch { /* ignore */ }
  }

  let succeeded = 0;
  for (const patch of patches) {
    try {
      const { sections, totalEntries, withApiName } = await scrapePatch(patch, setNumber);
      out.patches[patch] = {
        scrapedAt: new Date().toISOString(),
        sections,
        counts: { totalEntries, withApiName },
      };
      succeeded++;
    } catch (e) {
      console.warn(`       SKIP ${patch}: ${e.message}`);
    }
    // Rate-limit zwischen Patches damit wir tactics.tools nicht hämmern
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`[2/3] Cross-reference apiName-Coverage with Riot bundle`);
  const allApiNames = new Set();
  const matchedApiNames = new Set();
  for (const entry of Object.values(out.patches).flatMap(p => p.sections.flatMap(s => s.entries))) {
    if (entry.apiName) {
      allApiNames.add(entry.apiName);
      const bundleHas = live.champions[entry.apiName] || live.augments[entry.apiName] || live.traits[entry.apiName];
      if (bundleHas) matchedApiNames.add(entry.apiName);
    }
  }
  console.log(`       unique apiNames: ${allApiNames.size}, in bundle: ${matchedApiNames.size}`);

  console.log(`[3/3] Write ${existingPath}`);
  writeFileSync(existingPath, JSON.stringify(out, null, 2));
  console.log(`       done. Scraped ${succeeded}/${patches.length} patches.`);
  if (succeeded === 0) {
    console.error('FAIL: 0 patches scraped successfully');
    process.exit(1);
  }
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
