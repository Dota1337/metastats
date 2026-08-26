// Champion-Block eines TFT-Sets aus den ROHEN CommunityDragon-Quellen bauen.
//
// Warum es das gibt: der normale Weg in fetch-tft-assets.mjs liest die von CDTB
// abgeleitete Datei `cdragon/tft/en_us.json`. Deren Champion-Parser
// (`cdtb/tftdata.py`, parse_champs) ueberspringt still jede Unit ohne
// `spells`-Feld. Fuer Set 18 bleiben davon 19 Eintraege uebrig — fast nur
// PVE-Minions. Gemessen am 2026-08-26: 19 statt 76.
//
// Traits und Items derselben Datei sind NICHT betroffen (36/36 Set-18-Traits
// mit Namen). Dieses Modul ersetzt deshalb ausschliesslich den Champion-Block.
//
// Quellen und was jede beisteuert (alle am 2026-08-26 gegen Set 18 gemessen):
//   game/characters/<id>.cdtb.bin.json   Roster + Kosten (`tier`) + Trait-Links
//   .../map22/map22.bin.json             Anzeigename-, Icon- und Faehigkeits-Schluessel
//   game/en_us/.../tft.stringtable.json  Aufloesung dieser Schluessel in Text
//
// Der Roster kommt bewusst aus dem Trait-Link der Per-Unit-Records und nicht
// aus der Shop-Tabelle: map22 fuehrt fuer Set 18 93 Shop-Eintraege, aber 19
// davon (TFT18_Nocturne, TFT18_Anivia, ...) stehen in KEINER Character-Liste,
// tragen keine Traits und haben keine Icon-Pfade — Karteileichen. Der
// Trait-Filter reproduziert die echte Liste (`TftCharacterList`, 78 Eintraege)
// exakt bis auf zwei Summons.

const LIST_URL   = 'https://raw.communitydragon.org/json/latest/game/characters/';
const CHAR_URL   = id => `https://raw.communitydragon.org/latest/game/characters/${id}.cdtb.bin.json`;
const MAP22_URL  = 'https://raw.communitydragon.org/latest/game/data/maps/shipping/map22/map22.bin.json';
const STRING_URL = 'https://raw.communitydragon.org/latest/game/en_us/data/menu/en_us/tft.stringtable.json';

const CONCURRENCY = 12;

// `_splash_tile_N` ist die Shop-Kachel, `_splash_centered_N` das breite Splash.
// Das bestehende Bundle fuehrt unter `icon` das centered-Bild — gegen Set 17
// verifiziert (tft17_akali_splash_tile_68 ↔ Bundle …_splash_centered_68).
// Set-18-Units ohne dieses Muster (Teamplanner-Splashes) bleiben unveraendert.
function toIcon(raw, normalizeIconPath) {
  const p = normalizeIconPath(raw);
  if (!p) return null;
  return p.replace(/_splash_tile_(\d+)\.png$/, '_splash_centered_$1.png');
}

async function mapWithConcurrency(items, limit, fn) {
  const queue = [...items];
  const out = [];
  await Promise.all(Array.from({ length: limit }, async () => {
    while (queue.length) {
      const r = await fn(queue.shift());
      if (r) out.push(r);
    }
  }));
  return out;
}

/**
 * @param {number} setNumber
 * @param {object} deps
 * @param {(url: string) => Promise<any>} deps.fetchJSON
 * @param {(raw: string) => string|null} deps.normalizeIconPath
 * @param {(s: string) => string} deps.stripHtml
 * @param {Array<{apiName: string, name: string}>} deps.traits  aus der abgeleiteten Datei
 * @returns {Promise<{champions: object, stats: object}>}
 */
export async function buildChampionsFromRaw(setNumber, deps) {
  const { fetchJSON, normalizeIconPath, stripHtml, traits = [] } = deps;
  const log = deps.log || (() => {});

  // 1) Kandidaten. Klassische Set-Praefixe FREMDER Sets fallen raus; alles
  // andere bleibt drin, weil Riot die Konvention pro Set wechseln kann —
  // Set 18 heisst `DA_18_Sentry`, `DA_Cinderling18`, `DA_Lux18_Base`.
  const listing = await fetchJSON(LIST_URL);
  const candidates = listing
    .map(e => e.name)
    .filter(n => n.endsWith('.cdtb.bin.json'))
    .map(n => n.slice(0, -'.cdtb.bin.json'.length))
    .filter(id => {
      const m = /^tft(\d+)_/.exec(id);
      return !m || Number(m[1]) === setNumber;
    });
  log(`       Kandidaten-Records: ${candidates.length}`);

  // 2) Roster ueber den Trait-Link.
  const traitRx = new RegExp(`Sets/TFTSet${setNumber}/Traits/`, 'i');
  const units = await mapWithConcurrency(candidates, CONCURRENCY, async (id) => {
    let json;
    try { json = await fetchJSON(CHAR_URL(id)); } catch { return null; }
    const recKey = Object.keys(json).find(k => /CharacterRecords\/Root$/i.test(k));
    if (!recKey) return null;
    const rec = json[recKey];
    const linked = (rec.mLinkedTraits || [])
      .map(t => String(t.TraitData || ''))
      .filter(t => traitRx.test(t));
    if (!linked.length) return null;
    return {
      id: recKey.split('/')[1],          // Original-Schreibweise, nicht der Dateiname
      cost: rec.tier,
      traits: linked.map(t => t.split('/').pop()),
    };
  });
  log(`       Units mit Set-${setNumber}-Traits: ${units.length}`);
  if (!units.length) throw new Error(`keine Units mit Sets/TFTSet${setNumber}/Traits/ gefunden`);

  // 3) Namen, Icons, Faehigkeitstexte.
  const [map22, stringtable] = await Promise.all([fetchJSON(MAP22_URL), fetchJSON(STRING_URL)]);
  const strings = new Map(
    Object.entries(stringtable.entries || stringtable).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const shopRx = new RegExp(`Sets/TFTSet${setNumber}/Shop/`, 'i');
  const shop = new Map();
  for (const [key, val] of Object.entries(map22)) {
    if (shopRx.test(key) && val && val.mName) shop.set(String(val.mName).toLowerCase(), val);
  }
  log(`       Shop-Eintraege: ${shop.size}, Stringtable: ${strings.size}`);

  const traitNames = new Map(traits.map(t => [String(t.apiName || '').toLowerCase(), t.name]));
  const str = key => (key ? strings.get(String(key).toLowerCase()) : undefined);

  const champions = {};
  const stats = { units: units.length, withShop: 0, noShop: [], noName: [], noIcon: [], unknownTraits: new Set() };
  for (const u of units) {
    const s = shop.get(u.id.toLowerCase());
    if (!s) { stats.noShop.push(u.id); continue; }   // Summons ohne Shop-Eintrag
    stats.withShop++;

    const name = str(s.mDisplayNameTra);
    if (!name) stats.noName.push(u.id);
    const icon = toIcon(s.SquareSplashPath, normalizeIconPath);
    const tile = normalizeIconPath(s.TeamPlannerPortraitPath);
    if (!icon || !tile) stats.noIcon.push(u.id);

    const abilityName = str(s.mAbilityNameTra);
    const abilityDesc = str(s.mDescriptionTra);

    champions[u.id] = {
      name: name || u.id,
      icon,
      tile,
      cost: s.BaseCost ?? u.cost ?? 0,
      // Das Bundle fuehrt Champion-Traits als ANZEIGENAMEN ("Blossom"), die
      // Trait-Map dagegen als apiName. Verifiziert gegen Set 17
      // (TFT17_Briar → ["Anima","Primordian","Rogue"]).
      traits: u.traits.map(t => {
        const n = traitNames.get(t.toLowerCase());
        if (!n) stats.unknownTraits.add(t);
        return n || t;
      }),
      ability: (abilityName || abilityDesc)
        ? { name: abilityName || '', desc: stripHtml(abilityDesc || '') }
        : undefined,
    };
  }
  stats.unknownTraits = [...stats.unknownTraits];
  return { champions, stats };
}
