// Single-source-of-truth für Item-Klassen, die Carry/Build-Style-Detection
// im Aggregator + den Pro-Specialty-Klassifikator gemeinsam nutzen.
//
// **Wichtig**: Set-17-Renamings — Riot recycelt apiNames quer durch Sets:
//   TFT_Item_RedBuff       = Sunfire Cape (Set 17) — AoE-DoT-Damage → DAMAGE
//   TFT_Item_Leviathan     = Nashor's Tooth (Set 17) — Caster-Carry-Item → DAMAGE
//   TFT_Item_StatikkShiv   = Void Staff (Set 17) — Caster-Carry-Item → DAMAGE
//   TFT_Item_MadredsBloodrazor = Giant Slayer (Set 17) — Carry-Item → DAMAGE
// Diese gehören eindeutig in DAMAGE_CARRY_ITEMS, nicht in DEFENSIVE.
//
// **Mirror**: `app/lib/tft-item-classes.ts` re-exportiert die gleichen Sets
// in TS-Form. Bei Änderungen BEIDE Dateien synchron halten — der
// classification-verifier (npm run verify) prüft diesen Sync.

export const DAMAGE_CARRY_ITEMS = new Set([
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

export const DEFENSIVE_ITEMS = new Set([
  // Pure tank HP/armor/MR items
  'TFT_Item_WarmogsArmor',
  'TFT_Item_DragonsClaw',
  'TFT_Item_GargoyleStoneplate',
  'TFT_Item_BrambleVest',
  'TFT_Item_Crownguard',
  // Support / heal / cleanse
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

/**
 * Klassifiziert die Carry-Items in einen Build-Stil:
 *   - 'damage'  → reiner Damage-Carry (default; ≥2 damage items, ≤1 defensive)
 *   - 'bruiser' → Mischbuild (1-2 damage + 1-2 defensive); klassischer Sterak/Titans/Bramble
 *   - 'tank'   → Tank-Carry (≥2 defensive, ≤1 damage); typisch durch Two-Tanky-artige Augments
 *
 * Reagiert auf das Symptom (Item-Signatur), nicht auf die Ursache (Augment),
 * damit die Klassifikation set-agnostisch und unabhängig von Augment-Renames
 * bleibt.
 */
export function classifyBuildStyle(itemNames) {
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
