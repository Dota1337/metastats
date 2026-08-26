// Single-source-of-truth für Item-Klassen, die Carry/Build-Style-Detection
// im Aggregator + den Pro-Specialty-Klassifikator gemeinsam nutzen.
//
// **Nach Set-Nummer geschlüsselt, nicht nach Namen.** Riot recycelt apiNames
// quer durch Sets und wechselt ausserdem das Präfix: Set 17 führt
// `TFT_Item_<Alias>`, Set 18 `DA_<Anzeigename>`. Ein Suffix-Match über beide
// hinweg ist nachweislich falsch — siehe die Set-17-Umbenennungen unten.
//
// **Set-17-Umbenennungen** (der Grund für die Set-Achse):
//   TFT_Item_RedBuff       = Sunfire Cape (Set 17) — AoE-DoT-Damage → DAMAGE
//   TFT_Item_Leviathan     = Nashor's Tooth (Set 17) — Caster-Carry-Item → DAMAGE
//   TFT_Item_StatikkShiv   = Void Staff (Set 17) — Caster-Carry-Item → DAMAGE
//   TFT_Item_MadredsBloodrazor = Giant Slayer (Set 17) — Carry-Item → DAMAGE
//
// **Set 18** bricht mit dem `TFT*_Item_`-Präfix komplett und führt Klarnamen
// unter `DA_`. Die `desc`-Felder sind im Bundle leer (gemessen 2026-08-26:
// 39 von 39 fertigen Nicht-Emblem-Kombi-Items ohne Text), und die Icon-Pfade
// zeigen auf fremde Dateien (`DA_SunfireCape` → `tft_item_redbuff.png`).
// Beide Signale taugen also nicht zur Einordnung. Die Buckets unten stehen
// deshalb auf der gemessenen Träger-Verteilung aus
// public/tft-metatft-comps-18.json (Volumen aus `comps[].builds[].count`):
// ein Item, das ausschliesslich auf Carries liegt, ist ein Damage-Item.
//
// **Mirror**: `app/lib/tft-item-classes.ts` hält die gleichen Sets in TS-Form.
// Bei Änderungen BEIDE Dateien synchron halten.

const DAMAGE_BY_SET = {
  17: new Set([
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

  // Set 18. Zahlen in Klammern = Gesamt-Volumen und die volumenstärksten
  // Träger, gemessen am 2026-08-26 über public/tft-metatft-comps-18.json.
  18: new Set([
    // Pure AD
    'DA_Bloodthirster',        // 963 — ElderDragon, GnarSmall, MasterYi_AD
    'DA_Deathblade',           // 9059 — Draven, Sivir, Xayah
    'DA_InfinityEdge',         // 6354 — Sivir, KogMaw_AD, ElderDragon
    'DA_LastWhisper',          // 6685 — Ashe, Sivir, Ezreal
    'DA_SpearOfShojin',        // 21966 — Ahri, Ashe, Warwick
    // Pure AP
    'DA_ArchangelsStaff',      // 1550 — Cassiopeia, Sentry, Elise
    'DA_JeweledGauntlet',      // 20442 — Ahri, Kayle, Nidalee_AP
    'DA_Morellonomicon',       // 2796 — Morgana
    'DA_NashorsTooth',         // 523 — Ahri, Alune, Nidalee_AP
    'DA_RabadonsDeathcap',     // 10210 — Kayle, KhaZix, Morgana
    'DA_VoidStaff',            // 4115 — Morgana, Alune, Zyra
    // Hybrid AD/AP
    'DA_GuinsoosRageblade',    // 28134 — Aphelios, Kayle, Nidalee_AP
    'DA_HextechGunblade',      // 2415 — Tristana, Cassiopeia, Veigar
    'DA_TitansResolve',        // 7857 — Rengar, Warwick, GnarSmall
    // Attack-speed / Crit
    'DA_KrakensFury',          // 13399 — Aphelios, Caitlyn, Draven
    'DA_RedBuff',              // 10228 — Ashe, KogMaw_AD, Xayah (null Tanks)
    'DA_GiantSlayer',          // 10274 — Aphelios, Brambleback, Tristana
    // Striker's Flail. Sechstgroesstes Item des Sets und traegt die beiden
    // volumenstaerksten AP-Carries. Das Set-17-Gegenstueck
    // (TFT_Item_PowerGauntlet) fehlt bis heute in BEIDEN Buckets — dieselbe
    // Fehlerklasse wie Giant Slayer 2026-08-05, siehe metatft-cluster-family.mjs.
    // Set 17 hier bewusst NICHT nachgezogen: das erzwaenge einen Reclassify
    // ueber den kompletten Set-17-Bestand.
    'DA_StrikersFlail',        // 13629 — Ahri, Nidalee_AP, Ezreal
    // Bruiser-carry only
    'DA_SteraksGage',          // 5760 — Warwick, Brambleback, ElderDragon (0 auf Sett/Ornn/Sentinel)
    // Mana-engine
    'DA_BlueBuff',             // 3378 — Veigar, Cassiopeia, Sentry
  ]),
};

const DEFENSIVE_BY_SET = {
  17: new Set([
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
  ]),

  18: new Set([
    // Pure tank HP/armor/MR
    'DA_WarmogsArmor',         // 21728 — Sett, Sentinel, Ornn
    'DA_DragonsClaw',          // 79 — Leona, Elise, Sejuani
    'DA_GargoyleStoneplate',   // 23530 — Sett, Ornn, Sentinel
    'DA_BrambleVest',          // 648 — Maokai, Sejuani, Alistar
    'DA_Crownguard',           // 1249 — Malphite, Taric, Sett
    // Sunfire Cape. In Set 17 lief dieses Item unter dem apiName
    // TFT_Item_RedBuff und stand dort im DAMAGE-Bucket. In Set 18 liegt es
    // auf 3587 Builds ausschliesslich auf Frontline (Lillia, Fiddlesticks,
    // Hecarim, Rammus) — keine einzige Carry-Unit. Deshalb defensive.
    'DA_SunfireCape',          // 3587
    // Support / heal / cleanse
    'DA_SpiritVisage',         // 10532 — Ornn, Krug, Scuttlecrab
    'DA_ProtectorsVow',        // 6177 — Sentinel, Lillia, Sett
    'DA_AdaptiveHelm',         // 1199 — Sentinel 708 vs Morgana 438: Mehrheit, nicht Eindeutigkeit
    'DA_Evenshroud',           // 2528 — Lillia, Hecarim, Sentinel
    'DA_IonicSpark',           // 5198 — Sett, Fiddlesticks, Diana
    'DA_SteadfastHeart',       // 54 — Ornn, Sett, Malphite
    // Diese beiden liegen in Set 18 messbar nur auf Carries (HandOfJustice
    // 3456 auf KhaZix/Murkwolf/Kennen, EdgeOfNight 11734 auf Rengar/
    // Brambleback/KhaZix). Sie bleiben trotzdem hier, wie in Set 17:
    // Ueberlebens-Items AUF einem Carry sind kein Carry-Signal, und die
    // Carry-Abdeckung ist ohne sie bereits vollstaendig (0 Cluster ohne
    // Kandidat, gemessen). Umstufen waere eine Verhaltensaenderung ohne Not.
    'DA_HandOfJustice',        // 3456
    'DA_EdgeOfNight',          // 11734
  ]),
};

// Bewusst KEINEM Bucket zugeordnet (Set 18): DA_Quicksilver (2851, liegt auf
// genau einer Unit — ein Ein-Unit-Signal traegt keine Entscheidung),
// DA_ThiefsGloves (30, Zufalls-Items) und die drei Tactician-Traeger
// DA_TacticiansCape/Crown/Shield (0 Builds, reine Team-Size-Utility).

/** Vereinigung über alle Sets. Nur für Aufrufer ohne Set-Kontext. */
function unionOf(bySet) {
  const out = new Set();
  for (const s of Object.values(bySet)) for (const id of s) out.add(id);
  return out;
}

export const DAMAGE_CARRY_ITEMS = unionOf(DAMAGE_BY_SET);
export const DEFENSIVE_ITEMS = unionOf(DEFENSIVE_BY_SET);

/** Alle Sets, für die eine Item-Klassen-Liste existiert. */
export const CLASSIFIED_SETS = Object.keys(DAMAGE_BY_SET).map(Number).sort((a, b) => a - b);

function forSet(bySet, setNumber) {
  const s = bySet[setNumber];
  if (s) return s;
  // Kein stiller Fallback auf ein einzelnes Set: das war genau der Bug beim
  // Set-18-Bump (Set-17-IDs gegen Set-18-Daten → null Carry-Kandidaten). Die
  // Vereinigung haelt bestehende Sets am Leben; dass ein NEUES Set fehlt,
  // meldet scripts/verify-classifications.mjs mit Exit-Code.
  return unionOf(bySet);
}

/** Damage-Carry-Items des angegebenen Sets. */
export function damageCarryItemsForSet(setNumber) { return forSet(DAMAGE_BY_SET, setNumber); }

/** Defensive Items des angegebenen Sets. */
export function defensiveItemsForSet(setNumber) { return forSet(DEFENSIVE_BY_SET, setNumber); }

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
export function classifyBuildStyle(itemNames, setNumber) {
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
