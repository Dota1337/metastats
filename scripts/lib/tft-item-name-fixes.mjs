// Englische Item-Namen, die CommunityDragon (en_us) falsch schreibt. Ersetzt
// wird nur exakt der falsche Wert — korrigiert Riot den Namen selbst, greift
// hier nichts mehr.
//
// Belege 18.10.2026: "Tactician's Cape" hat den Apostroph im Bundle, Crown und
// Shield nicht; tactics.tools fuehrt die Crown auf es/fr als "Tactician's
// Crown" (public/tft-item-texts-18.json). Unter 543 aktiven Set-18-Items waren
// das die einzigen zwei.
//
// Genutzt in fetch-tft-assets.mjs (Bundle). Die Loot-Tabellen erben den Namen
// aus dem Bundle (import-tft-tables.mjs, resolve()).

export const ITEM_NAME_FIXES = Object.freeze({
  'Tacticians Crown': "Tactician's Crown",
  'Tacticians Shield': "Tactician's Shield",
});

export function fixItemName(name) {
  return Object.prototype.hasOwnProperty.call(ITEM_NAME_FIXES, name) ? ITEM_NAME_FIXES[name] : name;
}
