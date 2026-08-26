// TS-Mirror von scripts/lib/tft-item-classes.mjs — die mjs-Datei ist
// Source-of-Truth (wird vom Aggregator auf der Hetzner-Box importiert).
// Bei Änderungen BEIDE Dateien synchron halten. Die Begründung für die
// Set-Achse (Riot recycelt apiNames und wechselt ab Set 18 auf `DA_`) und
// die Herkunft der Set-18-Buckets (gemessene Träger-Verteilung, weil `desc`
// leer und die Icon-Pfade fremd sind) stehen ausführlich in der mjs-Datei.

const DAMAGE_BY_SET: Record<number, Set<string>> = {
  17: new Set<string>([
    // Pure AD
    'TFT_Item_Bloodthirster',
    'TFT_Item_Deathblade',
    'TFT_Item_InfinityEdge',
    'TFT_Item_LastWhisper',
    'TFT_Item_SpearOfShojin',
    // Pure AP
    'TFT_Item_JeweledGauntlet',
    'TFT_Item_ArchangelsStaff',
    'TFT_Item_Morellonomicon',
    'TFT_Item_RabadonsDeathcap',
    'TFT_Item_NightHarvester',
    'TFT_Item_Leviathan',     // Nashor's Tooth (Set-17 rename)
    'TFT_Item_StatikkShiv',   // Void Staff (Set-17 rename)
    'TFT_Item_RedBuff',       // Sunfire Cape (Set-17 rename) — AoE DoT damage
    // Hybrid AD/AP — only ever on damage carries
    'TFT_Item_GuinsoosRageblade',
    'TFT_Item_HextechGunblade',
    'TFT_Item_TitansResolve',
    // Attack-speed — single-target / Runaan-spreader carry items
    'TFT_Item_RapidFireCannon',
    'TFT_Item_RunaansHurricane',
    'TFT_Item_MadredsBloodrazor',  // Giant Slayer (Set-17 rename) — %-max-HP-Schaden, nur auf Carries
    // Bruiser-carry only (off-tank like Riven)
    'TFT_Item_SteraksGage',
    // Mana-engine carry items
    'TFT_Item_BlueBuff',
  ]),

  // Set 18. Zahlen = Gesamt-Volumen aus public/tft-metatft-comps-18.json,
  // gemessen 2026-08-26.
  18: new Set<string>([
    // Pure AD
    'DA_Bloodthirster',        // 963
    'DA_Deathblade',           // 9059
    'DA_InfinityEdge',         // 6354
    'DA_LastWhisper',          // 6685
    'DA_SpearOfShojin',        // 21966
    // Pure AP
    'DA_ArchangelsStaff',      // 1550
    'DA_JeweledGauntlet',      // 20442
    'DA_Morellonomicon',       // 2796
    'DA_NashorsTooth',         // 523
    'DA_RabadonsDeathcap',     // 10210
    'DA_VoidStaff',            // 4115
    // Hybrid AD/AP
    'DA_GuinsoosRageblade',    // 28134
    'DA_HextechGunblade',      // 2415
    'DA_TitansResolve',        // 7857
    // Attack-speed / Crit
    'DA_KrakensFury',          // 13399
    'DA_RedBuff',              // 10228 — Ashe/KogMaw_AD/Xayah, null Tanks
    'DA_GiantSlayer',          // 10274
    'DA_StrikersFlail',        // 13629 — Set-17-Gegenstueck fehlt dort in beiden Buckets
    // Bruiser-carry only
    'DA_SteraksGage',          // 5760
    // Mana-engine
    'DA_BlueBuff',             // 3378
  ]),
};

const DEFENSIVE_BY_SET: Record<number, Set<string>> = {
  17: new Set<string>([
    'TFT_Item_WarmogsArmor',
    'TFT_Item_DragonsClaw',
    'TFT_Item_GargoyleStoneplate',
    'TFT_Item_BrambleVest',
    'TFT_Item_Crownguard',
    'TFT_Item_Redemption',
    'TFT_Item_ProtectorsVow',
    'TFT_Item_AdaptiveHelm',
    'TFT_Item_Evenshroud',
    'TFT_Item_SpectralGauntlet',
    'TFT_Item_FrozenHeart',
    'TFT_Item_IonicSpark',
    'TFT_Item_SteadfastHeart',
    'TFT_Item_HandOfJustice',
    'TFT_Item_EdgeOfNight',
  ]),

  18: new Set<string>([
    'DA_WarmogsArmor',         // 21728
    'DA_DragonsClaw',          // 79
    'DA_GargoyleStoneplate',   // 23530
    'DA_BrambleVest',          // 648
    'DA_Crownguard',           // 1249
    'DA_SunfireCape',          // 3587 — nur Frontline; in Set 17 lief es als TFT_Item_RedBuff unter DAMAGE
    'DA_SpiritVisage',         // 10532
    'DA_ProtectorsVow',        // 6177
    'DA_AdaptiveHelm',         // 1199
    'DA_Evenshroud',           // 2528
    'DA_IonicSpark',           // 5198
    'DA_SteadfastHeart',       // 54
    'DA_HandOfJustice',        // 3456 — liegt nur auf Carries, bleibt aber wie in Set 17 defensiv
    'DA_EdgeOfNight',          // 11734 — dito
  ]),
};

// Bewusst KEINEM Bucket zugeordnet (Set 18): DA_Quicksilver, DA_ThiefsGloves,
// DA_TacticiansCape/Crown/Shield.

function unionOf(bySet: Record<number, Set<string>>): Set<string> {
  const out = new Set<string>();
  for (const s of Object.values(bySet)) for (const id of s) out.add(id);
  return out;
}

export const DAMAGE_CARRY_ITEMS = unionOf(DAMAGE_BY_SET);
export const DEFENSIVE_ITEMS = unionOf(DEFENSIVE_BY_SET);

export const CLASSIFIED_SETS = Object.keys(DAMAGE_BY_SET).map(Number).sort((a, b) => a - b);

function forSet(bySet: Record<number, Set<string>>, setNumber?: number): Set<string> {
  const s = setNumber != null ? bySet[setNumber] : undefined;
  return s || unionOf(bySet);
}

export function damageCarryItemsForSet(setNumber?: number): Set<string> { return forSet(DAMAGE_BY_SET, setNumber); }

export function defensiveItemsForSet(setNumber?: number): Set<string> { return forSet(DEFENSIVE_BY_SET, setNumber); }

export type BuildStyle = 'damage' | 'bruiser' | 'tank';

export function classifyBuildStyle(itemNames: readonly string[] | null | undefined, setNumber?: number): BuildStyle {
  const items = Array.isArray(itemNames) ? itemNames : [];
  const dmgSet = damageCarryItemsForSet(setNumber);
  const defSet = defensiveItemsForSet(setNumber);
  let dmg = 0, def = 0;
  for (const it of items) {
    if (dmgSet.has(it)) dmg++;
    else if (defSet.has(it)) def++;
  }
  if (def >= 2 && dmg <= 1) return 'tank';
  if (def >= 1 && dmg >= 1 && (def + dmg) >= 3) return 'bruiser';
  return 'damage';
}
