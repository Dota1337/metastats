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
import { resolve } from 'node:path';
import { lookup as dnsLookup } from 'node:dns';
import { loadCurrentSet } from './lib/current-set.mjs';

const SOURCE_URL = 'https://raw.communitydragon.org/latest/cdragon/tft/en_us.json';
const COMPANIONS_URL = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/companions.json';
// CDragon ships the full tft JSON per locale. We pull all 6 UI languages so
// the augment + boon text can be rendered natively in DE/EN/KO/ZH/ES/FR
// instead of falling back to English. ~24MB per locale, kept off the wire by
// only persisting the apiName→{name,desc} pairs we actually surface.
const LOCALES = [
  { code: 'de', file: 'de_de.json' },
  { code: 'en', file: 'en_us.json' },
  { code: 'ko', file: 'ko_kr.json' },
  { code: 'zh', file: 'zh_cn.json' },
  { code: 'es', file: 'es_es.json' },
  { code: 'fr', file: 'fr_fr.json' },
];

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

// Das aktive Set kommt aus public/tft-set.json, NICHT aus der CDragon-Datenlage.
//
// Frueher stand hier "highest TFTSet<N> mutator wins — same logic as
// detect-tft-set.mjs". Das war einmal wahr und ist es seit dem Bump-Gate
// (detect-tft-set.mjs:173) nicht mehr: detect haelt bewusst auf dem alten Set,
// bis SET_BUMP_EARLIEST erreicht ist, waehrend diese Funktion ungegatet der
// hoechsten Nummer folgte.
//
// Beide laufen im selben Daily-Crawl und committen ihre Datei. Sobald CDragon
// das neue Set fuehrt — typischerweise Tage vor dem Live-Go — schrieb
// tft-assets.json also `set: 18`, waehrend tft-set.json auf 17 stand. Folgen:
// check-drift meldet alle Set-Literale als Drift und blockiert JEDEN Push, und
// loadCostMap(18) findet ein Bundle, das die Pipeline gar nicht spielen will.
//
// Reihenfolge im Workflow (detect vor fetch) ist damit auch inhaltlich
// begruendet und nicht mehr nur zufaellig richtig.
// Der Anzeigename aus dem gegateten public/tft-set.json — nur wenn er zur
// gewaehlten Set-Nummer passt. CDragon liefert fuer ein frisches Set einen
// Platzhalter: TFTSet18 meldete am 2026-08-26 den Namen "Set10".
function gatedSetName(active) {
  const path = resolve(process.cwd(), 'public', 'tft-set.json');
  if (!existsSync(path)) return null;
  try {
    const j = JSON.parse(readFileSync(path, 'utf8'));
    const num = j.currentSet?.number ?? j.setNumber ?? null;
    if (num !== active?.number) return null;
    const name = j.currentSet?.name ?? j.setName ?? null;
    return typeof name === 'string' && name.trim() ? name : null;
  } catch { return null; }
}

function pickActiveSet(setData) {
  const live = setData.filter(s => /^TFTSet\d+$/.test(s.mutator || ''));
  if (live.length === 0) return null;

  const gated = loadCurrentSet();
  if (typeof gated === 'number') {
    const held = live.find(s => s.number === gated);
    if (held) return held;
    // tft-set.json nennt ein Set, das CDragon nicht (mehr) fuehrt. Nicht still
    // auf die hoechste Nummer ausweichen — das waere genau der ungegatete
    // Sprung, den dieser Code verhindern soll.
    console.error(`FATAL: tft-set.json sagt Set ${gated}, CDragon fuehrt es nicht.`);
    console.error(`       verfuegbar: ${live.map(s => s.number).join(', ')}`);
    console.error('       -> erst detect-tft-set.mjs klaeren, dann Assets ziehen.');
    process.exit(1);
  }

  // Kein lesbares tft-set.json: Erstlauf oder kaputte Datei. Hier ist die
  // CDragon-Wahl der einzig moegliche Weg — aber sichtbar, nicht stillschweigend.
  console.warn('WARN: public/tft-set.json nicht lesbar — falle auf CDragon-Hoechstnummer zurueck (ungegatet).');
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

  console.log('[2.5/4] Fetch non-English locales for augment text');
  // Parallel fetch all locales except en_us (already loaded as `cd`).
  // Each ~24MB; we only retain the items[].apiName → {name, desc} pairs.
  const localeItems = { en: new Map((cd.items || []).map(it => [it.apiName, it])) };
  await Promise.all(LOCALES.filter(l => l.code !== 'en').map(async (l) => {
    try {
      const json = await fetchJSON(`https://raw.communitydragon.org/latest/cdragon/tft/${l.file}`);
      localeItems[l.code] = new Map((json.items || []).map(it => [it.apiName, it]));
      console.log(`       ${l.code}: ${localeItems[l.code].size} item entries`);
    } catch (e) {
      console.warn(`       ${l.code}: FAILED (${e.message}) — augments will fall back to en`);
      localeItems[l.code] = new Map();
    }
  }));

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

  // Vollstaendigkeits-Gate auf dem Champion-Block.
  //
  // CDTBs Champion-Parser (cdtb/tftdata.py, parse_champs) ueberspringt still
  // jede Unit ohne `spells`-Feld. Fuer Set 18 blieben davon 19 Eintraege
  // uebrig, davon 2 mit Traits — der Rest sind PVE-Minions. Gesunde Sets
  // liegen bei 60-101 Units mit Traits (14/15/16/17 am 2026-08-26 gemessen),
  // die Schwelle 40 trennt beide Faelle deutlich.
  //
  // Traits und Items derselben Quelle sind nicht betroffen und bleiben stehen.
  const CHAMPS_MIN = 40;
  const withTraits = Object.values(champions).filter(c => (c.traits || []).length > 0).length;
  if (withTraits < CHAMPS_MIN) {
    console.log(`[3.5/4] Champion-Block unvollstaendig (${withTraits} Units mit Traits) — baue aus Rohquellen`);
    const { buildChampionsFromRaw } = await import('./lib/tft-champions-raw.mjs');
    const { champions: rebuilt, stats } = await buildChampionsFromRaw(active.number, {
      fetchJSON, normalizeIconPath, stripHtml,
      traits: active.traits || [],
      log: m => console.log(m),
    });
    const n = Object.keys(rebuilt).length;
    console.log(`       rebuilt: ${n} Champions (ohne Shop-Eintrag: ${stats.noShop.length})`);
    if (stats.noName.length) console.warn('       WARN ohne Namen:', stats.noName.join(' '));
    if (stats.noIcon.length) console.warn('       WARN ohne Icon:', stats.noIcon.join(' '));
    if (stats.unknownTraits.length) console.warn('       WARN unbekannte Traits:', stats.unknownTraits.join(' '));
    // Hart abbrechen statt ein halbes Bundle zu schreiben: die bestehende
    // public/tft-assets-*.json bleibt dann unveraendert liegen.
    if (n < CHAMPS_MIN) {
      console.error(`FATAL: Rohquellen liefern nur ${n} Champions (< ${CHAMPS_MIN}) — Bundle bleibt unveraendert.`);
      process.exit(1);
    }
    // Merge statt Ersatz: die PVE-Minions aus der abgeleiteten Datei
    // (TFT_BlueGolem, TFT_Krug, ...) tauchen in Boards auf und fehlen den
    // Rohquellen, weil sie keine Set-Traits tragen.
    Object.assign(champions, rebuilt);
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
  //
  // Load the tactics.tools tier override (if present) — the only public
  // ground-truth for Silver/Gold/Prismatic (CDragon has no tier field; the
  // icon-suffix is unreliable for Plus/PlusPlus variants). Run
  // `scripts/refresh-augment-tiers.mjs` before this to (re)build the file.
  let tierOverride = {};
  try {
    const path = `public/tft-augment-tiers-${active.number}.json`;
    if (existsSync(path)) {
      tierOverride = JSON.parse(readFileSync(path, 'utf8')).tiers || {};
      console.log(`       tier-override: ${Object.keys(tierOverride).length} augments pinned by tactics.tools`);
    } else {
      console.warn(`       WARN: ${path} missing — tier resolution will fall back to heuristics`);
    }
  } catch (e) { console.warn(`       WARN: tier-override read failed: ${e.message}`); }

  // Augment icons come straight from CDragon (Riot's own artwork). We tried
  // tactics.tools' tier-tagged CDN as an overlay (2026-06-10) — turned out
  // their image files recycle across augments (ForgeAFriend1.png is byte-
  // identical to ConstructACompanion2.png) and across +/++ variants, so it
  // wasn't a reliable upgrade. MetaTFT's `cdn/augments/<tier>/<name>.png`
  // route returns a 200 placeholder PNG for everything. No public source
  // ships truly tier-specific artwork for every TFT augment — Riot itself
  // only renders one icon file per family. We use what Riot ships.

  const augments = {};
  const itemsByName = new Map(items ? [] : []); // built below from cd.items
  for (const it of cd.items || []) {
    if (it.apiName) itemsByName.set(it.apiName, it);
  }
  // Build per-locale {name, desc} pairs for each augment. The English entry
  // doubles as the default — same heuristic as before to handle sub-augments
  // where desc==undefined or desc==name (e.g. Quest picks). For each non-EN
  // locale we use the localised name/desc with the same effects-map (the
  // @placeholders are language-agnostic numeric refs).
  function buildI18nForAugment(apiName) {
    const out = {};
    for (const loc of LOCALES) {
      const it = localeItems[loc.code]?.get(apiName);
      if (!it) continue;
      const nameDup = it.name && it.desc && it.name.trim() === it.desc.trim();
      const hasSeparateDesc = !!(it.desc && it.desc.trim()) && !nameDup;
      const nameIsTitle = it.name && it.name.length < 60 && !/[@.]/.test(it.name);
      let displayName, sourceDesc;
      if (hasSeparateDesc && nameIsTitle) {
        displayName = it.name;
        sourceDesc = it.desc;
      } else {
        // For "title is the long sentence" cases we keep the synthetic suffix
        // title (en-only — every locale would otherwise get the same suffix
        // and the user would see English titles on a translated page). Falling
        // back to the suffix is fine because it's a stable game term.
        displayName = (apiName.split('_').pop() || apiName).replace(/([a-z])([A-Z])/g, '$1 $2');
        sourceDesc = it.name || '';
      }
      out[loc.code] = {
        name: displayName,
        desc: resolveDescPlaceholders(stripHtml(sourceDesc), it.effects),
      };
    }
    return out;
  }

  for (const augName of active.augments || []) {
    const apiName = typeof augName === 'string' ? augName : augName?.apiName;
    if (!apiName) continue;
    const a = itemsByName.get(apiName);
    if (!a) continue;
    const i18n = buildI18nForAugment(apiName);
    const en = i18n.en || { name: apiName, desc: '' };
    augments[apiName] = {
      name: en.name,
      icon: normalizeIconPath(a.icon || ''),
      desc: en.desc,
      tier: deriveAugmentTier(apiName, a.name || '', a.icon || '', tierOverride),
      i18n,
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
  //   - God-Augments (`*GodAugment*`)  → Set-17-Mechanik, gehoert nicht in die
  //                                       Augment-Liste. Ab Set 18 ein No-Op.
  //   - Sub-variant boons              → ditto
  // Stats-aggregator (DB) intentionally doesn't ship augment counts (Riot
  // restriction), so we can't cross-check played-IDs like we do for items.
  // First-run safety not needed here — the bundle is `setData`, always populated.
  const rawAugments = (active.augments || [])
    .map(a => typeof a === 'string' ? a : a?.apiName)
    .filter(Boolean);
  let activeAugments = Array.from(new Set(rawAugments.filter(id => !/GodAugment/i.test(id)))).sort();

  // Gegenprobe gegen tactics.tools, weil `setData[N].augments` bei einem
  // frischen Set nicht verlaesslich ist. Gemessen am 2026-08-26 gegen
  // cdragon/tft/en_us.json: TFTSet18 fuehrt 596 Augments bei 19 Champions,
  // waehrend Set 17 bei 273, Set 16 bei 275 und Set 14 bei 358 liegt. Der
  // Champion-Wert ist nachweislich kaputt (siehe der Rohquellen-Fallback in
  // [3.5/4]) — die Augment-Liste desselben Blobs ist es ebenso.
  //
  // Folge ohne Filter: 161 der 596 Augments haben keinen tactics.tools-Tier
  // und fallen auf die Icon-Heuristik zurueck, also erfundene Tiers auf der
  // Wiki-Seite. Coverage 73.0 % statt der 98.8 %, die Set 17 hatte.
  //
  // Regel: behalten wird, was tactics.tools kennt ODER was das Praefix des
  // aktiven Sets traegt (Set 17 -> `TFT17_`, Set 18 -> `DA_`). Das Praefix
  // kommt aus den Traits des Sets, nicht aus einem Literal — gemessen:
  // Set 17 = 43x `TFT17`, Set 18 = 36x `DA`, jeweils eindeutig.
  //
  // Der Filter greift nur, wenn die Override-Datei plausibel gross ist.
  // Faellt tactics.tools aus, bleibt Riots voller Pool stehen (schlechtere
  // Tiers, aber keine still verschwundenen Augments).
  const OVERRIDE_MIN = 150;
  const overrideCount = Object.keys(tierOverride).length;
  if (overrideCount >= OVERRIDE_MIN) {
    const prefixCount = new Map();
    for (const t of Object.keys(traits)) {
      const p = t.split('_')[0];
      prefixCount.set(p, (prefixCount.get(p) || 0) + 1);
    }
    const setPrefix = [...prefixCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    const keep = activeAugments.filter(id => tierOverride[id] != null || (setPrefix && id.startsWith(`${setPrefix}_`)));
    const dropped = activeAugments.length - keep.length;
    console.log(`       augment-pool: ${activeAugments.length} -> ${keep.length} (Praefix "${setPrefix}_", ${dropped} ohne tactics.tools-Beleg verworfen)`);
    activeAugments = keep;
  } else {
    console.warn(`       WARN: nur ${overrideCount} Augments von tactics.tools gepinnt (<${OVERRIDE_MIN}) — Pool-Gegenprobe uebersprungen, Riots volle Liste bleibt stehen`);
  }
  console.log(`       items: ${Object.keys(items).length}  active.items: ${activeItems.length}  champions: ${Object.keys(champions).length}  traits: ${Object.keys(traits).length}  augments: ${Object.keys(augments).length}  active.augments: ${activeAugments.length}  chibis: ${Object.keys(chibis).length}  tacticians: ${Object.keys(tacticians).length}`);

  console.log('[4/4] Write public/tft-assets.json + per-set archive');
  const payload = {
    set: active.number,
    // public/tft-set.json ist der gegatete Source-of-Truth fuer Nummer UND
    // Namen; CDragons active.name ist bei einem frischen Set ein Platzhalter.
    setName: gatedSetName(active) || active.name,
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

// Tier resolution for TFT augments. CDragon doesn't ship a numeric tier
// field, and Riot's icon-path suffix (`_I/_II/_III`) is unreliable because
// it gets recycled across `Plus/PlusPlus` variants (e.g. Heroic Grab Bag++
// ships with the Gold base icon `Heroic-Grab-Bag-II.tex`). So the icon
// alone is wrong for ~33 augments per set.
//
// Ground-truth source = tactics.tools, fetched into public/tft-augment-
// tiers-{N}.json by scripts/refresh-augment-tiers.mjs (run before this).
// That covers ~95% of the set's augment pool. For unmatched augments we
// fall back to:
//
//   1. apiName suffix (`*Silver/Gold/Prismatic$`)
//   2. raw icon path tier marker `[_-](I|II|III)(\.<sub>)?\.tex$`
//   3. Default Gold (2) — middle ground, never dump unknown into Silver
//
// NOTE on the old `Plus` heuristic (removed 2026-06-10): assuming `*Plus$`
// = Gold and `*PlusPlus$` = Prismatic was wrong for many augments.
// "Lucky Gloves+" is Prismatic, "Branching Out+" is Silver, etc.
// Riot's naming convention is *not* tier-implying — only tactics.tools'
// rendered tier list is.
function deriveAugmentTier(apiName, _name, rawIcon, override) {
  if (override && override[apiName] != null) return override[apiName];
  if (typeof apiName === 'string') {
    if (/Prismatic$/i.test(apiName)) return 3;
    if (/Gold$/i.test(apiName)) return 2;
    if (/Silver$/i.test(apiName)) return 1;
  }
  if (typeof rawIcon === 'string') {
    const m = rawIcon.match(/[_-](III|II|I)(?:\.[a-z0-9_]+)?\.tex$/i);
    if (m) {
      const s = m[1].toUpperCase();
      if (s === 'III') return 3;
      if (s === 'II') return 2;
      return 1;
    }
  }
  return 2;
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
