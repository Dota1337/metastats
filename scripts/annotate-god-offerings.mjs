#!/usr/bin/env node
/**
 * Walk public/tft-gods-{set}.json and annotate every offering with
 * `iconApiName` — the bundle's apiName whose icon should render next to it.
 *
 * Strategy:
 *  1. exact name match in bundle.augments (e.g. "Blood Pact" → TFT17_Augment_BloodPact)
 *  2. exact name match in bundle.items (e.g. "B.F. Sword" → TFT_Item_BFSword)
 *  3. base-name match stripped of trailing "+", " I", " II", " ++" (e.g.
 *     "Shared Wealth +" → "Shared Wealth")
 *  4. generic fallback by keyword (gold / xp / reroll / tactician health /
 *     N-cost / N-star)
 *
 * Run after every patch (or whenever offerings change). Idempotent.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const bundle = JSON.parse(readFileSync('public/tft-assets.json', 'utf8'));
const setN = bundle.set;
const gods = JSON.parse(readFileSync(`public/tft-gods-${setN}.json`, 'utf8'));

const byName = new Map();
for (const [id, a] of Object.entries(bundle.augments || {})) {
  const norm = (a.name || '').toLowerCase().trim();
  if (norm) byName.set(norm, id);
}
for (const [id, it] of Object.entries(bundle.items || {})) {
  const norm = (it.name || '').toLowerCase().trim();
  if (norm && !byName.has(norm)) byName.set(norm, id);
}

// Generic Offerings (XP, Rerolls, Tactician HP, X-Cost Shops, Owned-X-Cost)
// don't have a unique apiName because Riot generates them dynamically with
// values pulled from effect maps. Map (god, stage, offering-name) → the
// closest TFT17_MarketOffering_* item that ships a usable icon.
const SPECIFIC = {
  // Ahri XP/reroll picks
  'Ahri|2-4|6 XP': 'TFT17_MarketOffering_XP_Small',
  'Ahri|3-4|8 XP': 'TFT17_MarketOffering_XP_Medium_Stage3',
  'Ahri|2-4|4 free rerolls': 'TFT17_MarketOffering_Rerolls_Small_Stage2',
  'Ahri|3-4|5 free rerolls': 'TFT17_MarketOffering_Rerolls_Small',
  'Ahri|4-4|7 free rerolls': 'TFT17_MarketOffering_Rerolls_Large_Stage4',
  // Soraka Tactician HP
  'Soraka|3-4|12 Tactician Health': 'TFT17_MarketOffering_Health',
  'Soraka|4-4|12 Tactician Health': 'TFT17_MarketOffering_Health',
  // Varus shops + owned-cost
  'Varus|2-4|Owned 3-cost': 'TFT17_MarketOffering_ThreeCostChampion_Owned',
  'Varus|2-4|3-Cost Shop': 'TFT17_MarketOffering_AllTierThreeShop',
  'Varus|3-4|Owned 3-cost': 'TFT17_MarketOffering_ThreeCostChampion_Owned',
  'Varus|3-4|4-Cost Shop': 'TFT17_MarketOffering_AllTierFourShop',
  'Varus|4-4|Owned 4-cost': 'TFT17_MarketOffering_FourCostChampion_Owned',
  // Evelynn double 5-cost
  'Evelynn|4-4|2 5-costs': 'TFT17_MarketOffering_1star5cost_Eve',
};

function genericIcon(name) { return null; }

function strip(s) {
  return s.replace(/\s*\+\+?$/, '').replace(/\s+(I|II|III)$/, '').trim();
}

function findIcon(en) {
  // Gold picks: always prefer TFT_Assist_Gold_<N> (the assist-coin artwork
  // Riot uses for the "Make it rain!" offerings) over older encounter-item
  // recycles. Earlier the lookup found e.g. TFT11_Encounter_ChoiceItem_Gain8Gold
  // first because it matches the literal name "8 gold" — that one's icon
  // doesn't match the rest of Ahri's gold-pick set.
  const goldM = en.match(/^(\d+)\s*gold\s*$/i);
  if (goldM) {
    const id = `TFT_Assist_Gold_${goldM[1]}`;
    if (bundle.items[id] || bundle.augments[id]) return id;
  }
  const direct = byName.get(en.toLowerCase().trim());
  if (direct) return direct;
  const stripped = strip(en);
  const s = byName.get(stripped.toLowerCase().trim());
  if (s) return s;
  const noColon = en.split(':')[0].trim();
  const c = byName.get(noColon.toLowerCase().trim());
  if (c) return c;
  return genericIcon(en);
}

let annotated = 0, totalOff = 0, unmatched = [];
for (const god of gods.gods) {
  if (!god.stageOfferings) continue;
  for (const [stage, offerings] of Object.entries(god.stageOfferings)) {
    for (const o of offerings) {
      totalOff++;
      const key = `${god.id}|${stage}|${o.name.en}`;
      const specific = SPECIFIC[key];
      const icon = specific || findIcon(o.name.en);
      if (icon) { o.iconApiName = icon; annotated++; }
      else { delete o.iconApiName; unmatched.push(key); }
    }
  }
}

writeFileSync(`public/tft-gods-${setN}.json`, JSON.stringify(gods, null, 2) + '\n');
console.log(`Annotated ${annotated}/${totalOff} offerings.`);
if (unmatched.length > 0) {
  console.log(`Unmatched (${unmatched.length}):`);
  for (const u of unmatched) console.log('  -', u);
}
