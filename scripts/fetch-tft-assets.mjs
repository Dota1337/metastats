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

import { writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup } from 'node:dns';

const SOURCE_URL = 'https://raw.communitydragon.org/latest/cdragon/tft/en_us.json';
const COMPANIONS_URL = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/companions.json';

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

// Companion icons live under a different CD namespace than items/champions.
// Path in JSON: "/lol-game-data/assets/ASSETS/Loadouts/Companions/Tooltip_X.png"
// Maps to:     ".../plugins/rcp-be-lol-game-data/global/default/assets/loadouts/companions/tooltip_x.png"
// Note: the JSON path has BOTH `/lol-game-data/assets/` (prefix) AND `ASSETS/` (file path) —
// only the prefix needs stripping; the inner ASSETS/ lowercases to the served `assets/`.
function normalizeCompanionIcon(raw) {
  if (!raw || typeof raw !== 'string') return null;
  return raw.replace(/^\/lol-game-data\/assets\//i, '').toLowerCase();
}

async function main() {
  console.log('[1/4] Fetch CommunityDragon TFT data');
  const cd = await fetchJSON(SOURCE_URL);
  console.log('       items:', (cd.items || []).length, ' setData entries:', (cd.setData || []).length);

  console.log('[2/4] Fetch companion catalog (Chibis + Tacticians)');
  const companions = await fetchJSON(COMPANIONS_URL);
  console.log('       companions total:', companions.length);

  console.log('[3/4] Pick active set + collect entries');
  const active = pickActiveSet(cd.setData || []);
  if (!active) { console.error('No live set found'); process.exit(1); }
  console.log(`       active set: ${active.number} (${active.mutator})`);

  // Items: keep all (cross-set items appear in matches), but keyed by apiName.
  // CD ships descs with @VAR@ placeholders and the values live in `effects` —
  // we resolve here so the frontend gets ready-to-render copy.
  const items = {};
  for (const it of cd.items || []) {
    if (!it.apiName) continue;
    const rawDesc = stripHtml(it.desc || '');
    items[it.apiName] = {
      name: it.name || it.apiName,
      icon: normalizeIconPath(it.icon),
      desc: resolveDescPlaceholders(rawDesc, it.effects),
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
      // Riot's authoritative square HUD tile. We can't derive it from `icon`:
      // most units follow `<id>_splash_centered_N`, but Jax/Diana/Galio/… don't,
      // and Rhaast's tile is `TFT17_Kayn_Slay_Square` (not `_rhaast_square`).
      // Storing it verbatim lets the frontend render the correct portrait
      // without pattern-guessing. null for PVE minions (no tileIcon).
      tile: normalizeIconPath(c.tileIcon),
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
    // CD stores tier breakpoints as `effects[]` with minUnits/maxUnits + style
    // (1=bronze, 3=silver, 4=gold, 5=prismatic) and a `variables` map of
    // numeric stat bonuses. Multi-tier descs (Challenger, etc.) interleave
    // per-tier templated copy in `desc`, so we keep the raw desc + structured
    // tiers and let the frontend render either the full text once or
    // per-tier pills with style + variable breakdown.
    const tiers = (t.effects || [])
      .filter(e => e && typeof e.minUnits === 'number')
      .sort((a, b) => (a.minUnits || 0) - (b.minUnits || 0))
      .map(e => ({
        minUnits: e.minUnits,
        maxUnits: e.maxUnits ?? null,
        style: e.style ?? 0,
        variables: e.variables || {},
      }));
    traits[apiName] = {
      name: t.name || apiName,
      icon: normalizeIconPath(t.icon || ''),
      desc: stripHtml(t.desc || ''),
      innate: t.innate || '',
      tiers,
    };
  }

  // Augments: only active set. CD ships `setData[].augments` as an ARRAY OF
  // apiName STRINGS (not objects) — the full payload (name/desc/icon/effects)
  // lives in the top-level items[] list under the same apiName, keyed by the
  // `_Augment_` suffix. Earlier code iterated as objects and missed every
  // entry — the bundle landed with 0 augments. Same @VAR@ resolution as items.
  const augments = {};
  const itemsByName = new Map(items ? [] : []); // built below from cd.items
  for (const it of cd.items || []) {
    if (it.apiName) itemsByName.set(it.apiName, it);
  }
  for (const augName of active.augments || []) {
    const apiName = typeof augName === 'string' ? augName : augName?.apiName;
    if (!apiName) continue;
    const a = itemsByName.get(apiName);
    if (!a) continue;
    const rawDesc = stripHtml(a.desc || '');
    augments[apiName] = {
      name: a.name || apiName,
      icon: normalizeIconPath(a.icon || ''),
      desc: resolveDescPlaceholders(rawDesc, a.effects),
      tier: deriveAugmentTier(apiName, a.name || '', a.icon || ''),
    };
  }

  // Chibis (TFT-only premium companions) — all rarities (kMythic/kLegendary/kPrestige)
  // are kept because the bundle stays small (~120 entries × ~150B) and the frontend
  // filters by TFTRarity for the hero rotation.
  const chibis = {};
  for (const c of companions || []) {
    if (c.companionType !== 'kChibi') continue;
    if (!c.contentId) continue;
    chibis[c.contentId] = {
      name: c.name || '',
      icon: normalizeCompanionIcon(c.loadoutsIcon),
      species: c.speciesName || '',
      rarity: c.TFTRarity || 'kStandard', // kMythic / kLegendary / kPrestige
      itemId: c.itemId ?? 0,
    };
  }

  // Tacticians (Little Legends) — TFTOnly flag is barely used in CD data, so we
  // instead filter on TFTRarity in {kMythic, kLegendary} to get the iconic skins
  // (≈400 entries). Lower rarities (Standard) bloat the bundle and have less
  // visual appeal. Per-tier duplicates (level 1/2/3 evolutions) are kept — the
  // frontend can dedupe by speciesName if it shows them in a list.
  const tacticians = {};
  for (const c of companions || []) {
    if (c.companionType !== 'kLittleLegend') continue;
    if (c.TFTRarity !== 'kMythic' && c.TFTRarity !== 'kLegendary') continue;
    if (!c.contentId) continue;
    tacticians[c.contentId] = {
      name: c.name || '',
      icon: normalizeCompanionIcon(c.loadoutsIcon),
      species: c.speciesName || '',
      rarity: c.TFTRarity,
      itemId: c.itemId ?? 0,
    };
  }

  // Active items: Riot's setData[N].items is the pool that *could* drop in
  // Set N, but Riot ships it permissively — universal artifacts that haven't
  // seen a single play in 30 days across 9 regions are still listed. We pin
  // the whitelist against the actual DB aggregates so retired items don't
  // pollute the builder palette:
  //
  //   - set-specific IDs (TFT{N}_*)         optimistic, kept (might be new/rare)
  //   - TFT5_Item_*Radiant                  CD's legacy canonical IDs for
  //                                         classic radiants, kept as a family
  //   - everything else (TFT_Item_*, etc.)  must be observed in any
  //                                         public/tft-stats-{region}.json
  //                                         byItem map for the current set
  //
  // First-run safety: if no snapshots exist on disk we fall back to Riot's
  // raw list — better permissive than wiping the builder.
  const playedIds = collectPlayedIds(active.number);
  const setNPrefix = `TFT${active.number}_`;
  const rawActive = (active.items || []).filter(x => typeof x === 'string');
  const activeItems = Array.from(new Set(rawActive.filter(id => {
    if (id.startsWith(setNPrefix)) return true;
    if (/^TFT5_Item_.+Radiant$/i.test(id)) return true;
    if (id === 'TFT_Item_RadiantVirtue') return true;
    if (playedIds.size === 0) return true;
    return playedIds.has(id);
  }))).sort();

  // Augments-Whitelist: `setData[N].augments` is Riot's authoritative pool of
  // augments that can drop in this set — incl. carry-overs from older sets
  // (TFT10_Augment_*, TFT11_Augment_*…) that they re-enabled. We surface that
  // full list to the /tft/augments wiki page, with two exclusions:
  //   - God-Augments (`*GodAugment*`)  → live on /tft/gods, not the augment list
  //   - Sub-variant boons              → ditto
  // Stats-aggregator (DB) intentionally doesn't ship augment counts (Riot
  // restriction), so we can't cross-check played-IDs like we do for items.
  // First-run safety not needed here — the bundle is `setData`, always populated.
  const rawAugments = (active.augments || [])
    .map(a => typeof a === 'string' ? a : a?.apiName)
    .filter(Boolean);
  const activeAugments = Array.from(new Set(rawAugments.filter(id => !/GodAugment/i.test(id)))).sort();
  console.log(`       items: ${Object.keys(items).length}  active.items: ${activeItems.length}  champions: ${Object.keys(champions).length}  traits: ${Object.keys(traits).length}  augments: ${Object.keys(augments).length}  active.augments: ${activeAugments.length}  chibis: ${Object.keys(chibis).length}  tacticians: ${Object.keys(tacticians).length}`);

  console.log('[4/4] Write public/tft-assets.json + per-set archive');
  const payload = {
    set: active.number,
    setName: active.name,
    mutator: active.mutator,
    fetchedAt: new Date().toISOString(),
    source: 'CommunityDragon (cdragon/tft/en_us.json + companions.json)',
    iconBase: 'https://raw.communitydragon.org/latest/game/',
    companionsIconBase: 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/',
    items,
    champions,
    traits,
    augments,
    chibis,
    tacticians,
    active: {
      items: activeItems,
      augments: activeAugments,
    },
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

// Replace CD-style @VAR@ / @VAR*100@ placeholders in a description with the
// resolved numeric value from a trait/item/augment effects map. Lookup is
// case-insensitive (CD ships mixed-case keys). Unresolved tokens are
// stripped — leaving "@Foo@" in user-facing copy reads worse than a small
// punctuation gap.
function fmtNum(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '';
  if (Number.isInteger(v)) return String(v);
  const rounded = Math.round(v * 100) / 100;
  return rounded % 1 === 0 ? String(rounded) : String(rounded);
}
function resolveDescPlaceholders(desc, vars) {
  if (!desc) return desc;
  const lookup = {};
  if (vars && typeof vars === 'object') {
    for (const [k, v] of Object.entries(vars)) lookup[k.toLowerCase()] = v;
  }
  let out = desc;
  out = out.replace(/@([A-Za-z0-9_]+)\*100@/g, (_, key) => {
    const v = lookup[key.toLowerCase()];
    return typeof v === 'number' ? String(Math.round(v * 100)) : '';
  });
  out = out.replace(/@([A-Za-z0-9_]+)@/g, (_, key) => {
    const v = lookup[key.toLowerCase()];
    return v === undefined ? '' : fmtNum(typeof v === 'number' ? v : Number(v));
  });
  out = out.replace(/@[\w.:\-+*]+@/g, '');
  out = out.replace(/\s+/g, ' ')
           .replace(/\s+([,.;:])/g, '$1')
           .replace(/\(\s*\)/g, '')
           // Riot's CD source occasionally ships "...instead.Recommended" with
           // no space after a period preceding a capital letter. Insert one.
           .replace(/([.!?])([A-Z])/g, '$1 $2')
           .trim();
  return out;
}

// Riot doesn't expose the augment tier on the API directly. CDragon hides it
// in the icon path filename suffix: `…/<Name>_I.<set>.tex` for Silver, `_II` for
// Gold, `_III` for Prismatic. That's by far the most reliable hint (matches the
// in-game category). Old fallbacks for apiName/name suffixes stay as a backstop
// for assets without the underscore-tier convention.
function deriveAugmentTier(apiName, name, icon) {
  if (icon && typeof icon === 'string') {
    if (/_III\.[^.]+\.tex$/i.test(icon)) return 3;
    if (/_II\.[^.]+\.tex$/i.test(icon)) return 2;
    if (/_I\.[^.]+\.tex$/i.test(icon)) return 1;
  }
  const both = `${apiName} ${name}`.toLowerCase();
  if (/prismatic|\bplusplus|\+\+/.test(both)) return 3;
  if (/\bplus\b|gold|_plus(?!plus)/.test(both)) return 2;
  return 1;
}

// Read every public/tft-stats-{region}.json crawl snapshot and collect the
// union of item apiNames that actually showed up in matches for the given
// set. Used by main() to pin the active.items whitelist against ground truth.
function collectPlayedIds(setNumber) {
  const played = new Set();
  let files;
  try { files = readdirSync('public'); } catch { return played; }
  for (const f of files) {
    if (!/^tft-stats-.+\.json$/i.test(f)) continue;
    try {
      const stats = JSON.parse(readFileSync(`public/${f}`, 'utf8'));
      if (stats?.set != null && stats.set !== setNumber) continue;
      for (const id of Object.keys(stats?.byItem || {})) played.add(id);
    } catch { /* skip unreadable snapshot */ }
  }
  return played;
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
