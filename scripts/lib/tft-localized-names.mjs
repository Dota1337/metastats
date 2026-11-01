// Namen von Items, Units und Synergien je Sprache fuer das Asset-Bundle (User
// 01.11.2026: ganze TFT-Seite, nur Englisch zeigt englische Namen). `name` bleibt
// Englisch, weil Logik daran haengt (Emblem-Regel, Synergien einer Unit, Adressen).
//
// Regeln:
// - Nur aktive Items plus deren Bauteile: alle 4231 Items blaehen das Bundle auf.
// - Gleicher Name wie Englisch wird nicht gespeichert, `tftLabel` faellt dann
//   ohnehin auf `name` zurueck. Leerer Name (TFT_Item_EmptyBag) gilt als fehlend.
// - Faellt eine Sprachdatei aus, bleiben die Namen des vorherigen Bundles, wenn
//   es dasselbe Set ist. Nie ein Abbruch: fehlende Namen sind Englisch, nicht kaputt.

export const NAME_LANGS = ['de', 'ko', 'zh', 'es', 'fr'];

// Rohschluessel statt Name (`tft_item_name_x`, `game_...`), bei Riot selten.
const RAW_KEY = /^[a-z0-9]+(?:_[a-z0-9]+)+$/;

function clean(value, en) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v || v === en || RAW_KEY.test(v)) return null;
  return v;
}

function pickSet(setData, mutator) {
  return (setData || []).find(s => s?.mutator === mutator) ?? null;
}

/**
 * Traegt `names` (und bei Synergien `descs`) direkt in die Eintraege ein.
 *
 * @param {object} p
 * @param {Record<string, any>} p.items
 * @param {string[]} p.activeItems
 * @param {Record<string, any>} p.champions  Kopien tragen `aliasOf`
 * @param {Record<string, any>} p.traits
 * @param {Record<string, string>} p.itemAliases  Kopie -> Quelle
 * @param {Record<string, Map<string, any>>} p.localeItems  Sprache -> apiName -> Eintrag
 * @param {Record<string, any[]>} p.localeSets  Sprache -> setData der Sprachdatei
 * @param {string} p.mutator  aktives Set, z. B. TFTSet18
 * @param {any|null} p.previous  vorheriges Bundle (nur nutzen, wenn gleiches Set)
 * @param {(s: string) => string} p.stripHtml
 * @returns {Record<string, {items: number, champions: number, traits: number, descs: number, fromPrevious: boolean}>}
 */
export function applyLocalizedNames(p) {
  const { items, activeItems, champions, traits, itemAliases = {}, localeItems, localeSets, mutator, previous, stripHtml } = p;

  // Bauteile zaehlen mit: das Rezept eines Items zeigt sie in vielen Listen.
  const wanted = new Set();
  for (const id of activeItems) {
    wanted.add(id);
    for (const part of items[id]?.composition || []) wanted.add(part);
  }

  const put = (entry, field, lang, value) => {
    if (!value) return false;
    (entry[field] ??= {})[lang] = value;
    return true;
  };

  const stats = {};
  for (const lang of NAME_LANGS) {
    const locItems = localeItems[lang];
    const set = pickSet(localeSets[lang], mutator);
    const fromPrevious = !locItems?.size || !set;
    const prev = fromPrevious && previous ? previous : null;
    const count = { items: 0, champions: 0, traits: 0, descs: 0, fromPrevious };

    for (const id of wanted) {
      const entry = items[id];
      if (!entry) continue;
      const value = prev
        ? prev.items?.[id]?.names?.[lang]
        : clean(locItems?.get(itemAliases[id] ?? id)?.name, entry.name);
      if (put(entry, 'names', lang, value)) count.items++;
    }

    const locChamps = new Map((set?.champions || []).map(c => [c.apiName || c.characterName, c]));
    for (const [id, entry] of Object.entries(champions)) {
      // Die Rohquellen (tft-champions-raw.mjs) bringen ihre Namen selbst mit.
      if (entry.names?.[lang]) { count.champions++; continue; }
      const value = prev
        ? prev.champions?.[id]?.names?.[lang]
        : clean(locChamps.get(entry.aliasOf ?? id)?.name, entry.name);
      if (put(entry, 'names', lang, value)) count.champions++;
    }

    const locTraits = new Map((set?.traits || []).map(t => [t.apiName, t]));
    for (const [id, entry] of Object.entries(traits)) {
      const loc = locTraits.get(id);
      const name = prev ? prev.traits?.[id]?.names?.[lang] : clean(loc?.name, entry.name);
      if (put(entry, 'names', lang, name)) count.traits++;
      const desc = prev
        ? prev.traits?.[id]?.descs?.[lang]
        : clean(loc?.desc ? stripHtml(loc.desc) : null, entry.desc);
      if (put(entry, 'descs', lang, desc)) count.descs++;
    }
    stats[lang] = count;
  }
  return stats;
}
