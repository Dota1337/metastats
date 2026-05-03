#!/usr/bin/env node
/**
 * Builds public/tft-assets-{set}.json from CommunityDragon's tft/en_us.json.
 *
 * Why we need this:
 * - Match-V1 reports items as apiName strings ("TFT_Item_BlueBuff") and
 *   champions as character_ids ("TFT17_Aatrox"). Riot's Data Dragon TFT
 *   endpoints use a different ID scheme for items (e.g. it lists Giant
 *   Slayer as TFT_Item_MadredsBloodrazor) AND its splash icons stop at
 *   Set 13 — Set 17 champion / item portraits aren't in DD at all.
 * - CommunityDragon mirrors the live League client and stays current.
 *   Every item / champion / augment / trait carries the same apiName
 *   that Match-V1 emits, plus a ready-to-resolve icon asset path.
 *
 * Output is a compact JSON containing only the *active* set, so the
 * frontend doesn't have to download CD's full 24 MB blob.
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup } from 'node:dns';

const SOURCE_URL = 'https://raw.communitydragon.org/latest/cdragon/tft/en_us.json';

function lookupIPv4(host) {
  return new Promise((resolve, reject) => {
    dnsLookup(host, { family: 4 }, (err, addr) => err ? reject(err) : resolve(addr));
  });
}
async function fetchJSON(url) {
  const u = new URL(url);
  const ip = await lookupIPv4(u.hostname);
  return new Promise((resolve, reject) => {
    const req = httpsRequest({
      host: ip, servername: u.hostname, port: 443,
      path: u.pathname + u.search, method: 'GET',
      headers: { Host: u.hostname, 'User-Agent': 'metastats-crawler/1.0' },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

// Convert a CD asset path like:
//   "ASSETS/Maps/TFT/Icons/Items/Hexcore/TFT_Item_BlueBuff.TFT_Set13.tex"
// into the CD raw URL component:
//   "assets/maps/tft/icons/items/hexcore/tft_item_bluebuff.tft_set13.png"
// We keep this relative; frontend prepends the CD raw prefix.
function normalizeIconPath(raw) {
  if (!raw || typeof raw !== 'string') return null;
  return raw
    .replace(/\.tex$/i, '.png')
    .replace(/\.dds$/i, '.png')
    .toLowerCase();
}

function pickActiveSet(setData) {
  // Highest TFTSet<N> mutator wins — same logic as detect-tft-set.mjs
  const live = setData.filter(s => /^TFTSet\d+$/.test(s.mutator || ''));
  return live.sort((a, b) => (b.number || 0) - (a.number || 0))[0] || null;
}

async function main() {
  console.log('[1/3] Fetch CommunityDragon TFT data');
  const cd = await fetchJSON(SOURCE_URL);
  console.log('       items:', (cd.items || []).length, ' setData entries:', (cd.setData || []).length);

  console.log('[2/3] Pick active set + collect entries');
  const active = pickActiveSet(cd.setData || []);
  if (!active) { console.error('No live set found'); process.exit(1); }
  console.log(`       active set: ${active.number} (${active.mutator})`);

  // Items: keep all (cross-set items appear in matches), but keyed by apiName
  const items = {};
  for (const it of cd.items || []) {
    if (!it.apiName) continue;
    items[it.apiName] = {
      name: it.name || it.apiName,
      icon: normalizeIconPath(it.icon),
      desc: stripHtml(it.desc || ''),
      composition: it.composition || [],
      tags: it.tags || [],
    };
  }

  // Champions: only the active set (set17 has TFT17_ prefix)
  const champions = {};
  for (const c of active.champions || []) {
    const apiName = c.apiName || c.characterName;
    if (!apiName) continue;
    champions[apiName] = {
      name: c.name || apiName,
      icon: normalizeIconPath(c.icon || c.tileIcon || ''),
      cost: c.cost ?? 0,
      traits: c.traits || [],
      ability: c.ability ? {
        name: c.ability.name || '',
        desc: stripHtml(c.ability.desc || ''),
      } : undefined,
    };
  }

  // Traits: only active set
  const traits = {};
  for (const t of active.traits || []) {
    const apiName = t.apiName;
    if (!apiName) continue;
    traits[apiName] = {
      name: t.name || apiName,
      icon: normalizeIconPath(t.icon || ''),
      desc: stripHtml(t.desc || ''),
      innate: t.innate || '',
    };
  }

  // Augments: only active set
  const augments = {};
  for (const a of active.augments || []) {
    const apiName = a.apiName;
    if (!apiName) continue;
    augments[apiName] = {
      name: a.name || apiName,
      icon: normalizeIconPath(a.icon || ''),
      desc: stripHtml(a.desc || ''),
      tier: deriveAugmentTier(apiName, a.name || ''),
    };
  }

  console.log(`       items: ${Object.keys(items).length}  champions: ${Object.keys(champions).length}  traits: ${Object.keys(traits).length}  augments: ${Object.keys(augments).length}`);

  console.log('[3/3] Write public/tft-assets.json + per-set archive');
  const payload = {
    set: active.number,
    setName: active.name,
    mutator: active.mutator,
    fetchedAt: new Date().toISOString(),
    source: 'CommunityDragon (cdragon/tft/en_us.json)',
    iconBase: 'https://raw.communitydragon.org/latest/game/',
    items,
    champions,
    traits,
    augments,
  };
  // Single 'live' file the frontend always reads + a per-set archive so we
  // can roll back if CD breaks. Old archives stay for diff/history.
  writeFileSync('public/tft-assets.json', JSON.stringify(payload));
  writeFileSync(`public/tft-assets-${active.number}.json`, JSON.stringify(payload));
  console.log(`       -> public/tft-assets.json (set ${active.number})`);
}

function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

// Riot doesn't put the augment tier on the API directly. Fall back to
// scanning the apiName + name for known suffixes:
//   "*_PlusPlus" / "Prismatic" → 3
//   "*_Plus" / "Gold" → 2
//   else → 1 (Silver)
function deriveAugmentTier(apiName, name) {
  const both = `${apiName} ${name}`.toLowerCase();
  if (/prismatic|\bplusplus|\+\+/.test(both)) return 3;
  if (/\bplus\b|gold|_plus(?!plus)/.test(both)) return 2;
  return 1;
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
