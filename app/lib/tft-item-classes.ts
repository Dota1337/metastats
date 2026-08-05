// TS-Mirror von scripts/lib/tft-item-classes.mjs — die mjs-Datei ist
// Source-of-Truth (wird vom Aggregator auf der Hetzner-Box importiert).
// Bei Änderungen BEIDE Dateien synchron halten — verify-classifications.mjs
// prüft den Sync.

export const DAMAGE_CARRY_ITEMS = new Set<string>([
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
]);

export const DEFENSIVE_ITEMS = new Set<string>([
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
]);

export type BuildStyle = 'damage' | 'bruiser' | 'tank';

export function classifyBuildStyle(itemNames: readonly string[] | null | undefined): BuildStyle {
  const items = Array.isArray(itemNames) ? itemNames : [];
  let dmg = 0, def = 0;
  for (const it of items) {
    if (DAMAGE_CARRY_ITEMS.has(it)) dmg++;
    else if (DEFENSIVE_ITEMS.has(it)) def++;
  }
  if (def >= 2 && dmg <= 1) return 'tank';
  if (def >= 1 && dmg >= 1 && (def + dmg) >= 3) return 'bruiser';
  return 'damage';
}
