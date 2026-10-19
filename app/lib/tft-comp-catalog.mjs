// Comp-Katalog: welche Comps es gibt und welches Brett zu welcher Comp gehoert
// (User 19./20.10.2026: „den Gesamtdurchschnitt aller Spieler der Comp … wie
// MetaTFT"). Vorher galt der staerkste Trait am Spielende als Comp — wer den
// hohen Trait schaffte, hatte meist gewonnen, wer frueh rausflog, landete in
// einer anderen Comp. Daher Werte wie Ø 2,xx.
//
// Jetzt: Eine Comp ist eine klassische Familie (<trait>__<carry>) mit ihren
// Core-Units (Units in >=75 % ihrer Spiele). Ein Brett gehoert zu der Comp, von
// deren Core es die meisten Units traegt. Regeln an 5.456 vollen Lobbys
// geeicht (V1, .claude/plan-current.md): Core unter 4 Units → keine eigene
// Comp (sonst schluckt „Executioner · Ezreal" mit Core {Ezreal} jedes Brett
// mit Ezreal); Core komplett in einem groesseren Core → Mitglied der groesseren
// Comp; Treffer >= min(Coregroesse, 3) und Anteil >= 0,5; Carry spielt keine
// Rolle (aenderte in V1 nichts).
//
// Reines Modul ohne IO: der Sammler auf der Box (Zuordnung je Brett) und die
// Seite (Alias der klassischen Familien fuer Tage vor der Umstellung) rechnen
// mit denselben Funktionen.

export const CATALOG_RULES = Object.freeze({
  version: 1,
  minGames: 200,         // Familie braucht so viele Spiele im Eingabefenster
  coreMinPresence: 0.75, // Core = Unit in mindestens diesem Anteil der Spiele
  minCore: 4,            // kleinere Cores ergeben keine eigene Comp
  minHits: 3,            // Brett braucht min(Coregroesse, minHits) Core-Units ...
  minShare: 0.5,         // ... und mindestens diesen Anteil des Cores
  rerollStar3: 0.55,     // Core-Unit gilt als Reroll-Unit ab diesem 3★-Anteil (wie das 3★-Abzeichen)
  rerollMinGames: 5,
});

const PLAYABLE_UNIT_ID_RE = /^(?:TFT\d+|Set\d+|DA)_(?:\d+_)?[A-Z]/;

/**
 * @typedef {{ g: number, s3: number }} UnitCount
 * @typedef {{ fam: string, games: number, units: Record<string, UnitCount>, top4ByLevel?: Record<string, number> }} ClassicFamily
 * members: Familien, deren Core im Core dieser Comp steckt (Katalog-Regel).
 * adopted: uebrige klassische Familien des Eingabefensters, deren typisches
 *   Brett (Units in >=50 % ihrer Spiele) per assignBoard hier landet — nur fuer
 *   das Umlegen klassischer Tage, nie fuer neue Bretter.
 * @typedef {{ key: string, core: string[], reroll: string[], carries: string[], targetLevel: number | null, members: string[], adopted: string[], games: number }} CatalogComp
 * @typedef {{ version: number, comps: CatalogComp[] }} Catalog
 */

/** `<trait>__<carry>` → [trait, carry]. Erstes `__` wie familyParts in
 *  tft-comp-matchups.ts — beide Seiten muessen gleich zerlegen. */
export function splitFamilyKey(fam) {
  const s = String(fam || '');
  const i = s.indexOf('__');
  return i > 0 ? [s.slice(0, i), s.slice(i + 2)] : [s, ''];
}

/** Familien-Schluessel `<trait>__<carry>` aus einem Cluster-Schluessel
 *  (`<trait>@<stufe>_<carry>[*N][~aug][#second]`), dieselbe Regel wie
 *  compTraitFamilyKey in tft-cluster.ts. Ohne '@' unveraendert zurueck. */
export function familyOfCluster(clusterKey) {
  const m = /^(.+)@(\d+)_([^#*~]+)(?:\*(\d))?(?:~([A-Za-z]+))?(?:#(.+))?$/.exec(String(clusterKey || ''));
  return m ? `${m[1]}__${m[3]}` : String(clusterKey || '');
}

function defaultIsUnit(id) {
  return PLAYABLE_UNIT_ID_RE.test(String(id || ''));
}

// Haeufigste Stufe der Top-4-Bretter; liegen die zwei haeufigsten weniger als
// 10 Prozentpunkte auseinander, die niedrigere (data-skeptic 20.10.2026: bei
// 2 von 31 Comps knapp, je Tag kippte sonst die Zielstufe).
function targetLevelOf(top4ByLevel) {
  const lv = Object.entries(top4ByLevel || {})
    .map(([l, n]) => ({ level: Number(l), n: Number(n) || 0 }))
    .filter(x => x.level > 0 && x.n > 0)
    .sort((a, b) => b.n - a.n || a.level - b.level);
  if (lv.length === 0) return null;
  const total = lv.reduce((s, x) => s + x.n, 0);
  if (lv.length > 1 && (lv[0].n - lv[1].n) / total < 0.10) return Math.min(lv[0].level, lv[1].level);
  return lv[0].level;
}

/**
 * Kandidaten aus den klassischen Familien: Core, Reroll-Units, Zielstufe.
 * @param {ClassicFamily[]} families
 * @param {{ isUnit?: (id: string) => boolean }} opts
 */
function candidates(families, opts) {
  const isUnit = opts.isUnit ?? defaultIsUnit;
  const R = CATALOG_RULES;
  const out = [];
  for (const f of families) {
    if (!f?.fam || !(f.games >= R.minGames)) continue;
    const pres = Object.entries(f.units || {})
      .filter(([id]) => isUnit(id))
      .map(([id, x]) => ({ id, p: (x.g || 0) / f.games, g: x.g || 0, s3: x.s3 || 0 }))
      .sort((a, b) => b.p - a.p || a.id.localeCompare(b.id));
    const core = pres.filter(x => x.p >= R.coreMinPresence);
    if (core.length < R.minCore) continue;
    out.push({
      fam: f.fam,
      games: f.games,
      core: core.map(x => x.id),
      coreSet: new Set(core.map(x => x.id)),
      reroll: core.filter(x => x.g >= R.rerollMinGames && x.s3 / x.g >= R.rerollStar3).map(x => x.id),
      carry: splitFamilyKey(f.fam)[1],
      targetLevel: targetLevelOf(f.top4ByLevel),
    });
  }
  return out;
}

const isSubset = (a, b) => a.every(x => b.has(x));

/**
 * Baut den Katalog. Mit `prev` (Katalog des Vortags im selben Patch) und
 * `freeze: true` bleiben die vorhandenen Comps unveraendert (Core, Reroll,
 * Zielstufe, Name); neue Familien werden Mitglied einer vorhandenen Comp, wenn
 * ihr Core darin steckt, sonst eigene neue Comp. So kippen Comps nicht mitten
 * im Patch, und neue Spielweisen kommen trotzdem dazu.
 * @param {ClassicFamily[]} families
 * `names` (Katalog des Vorpatches oder Vortags, ohne Einfrieren): Namen per
 * Kern-Ueberschneidung uebernehmen (carryNames).
 * @param {{ isUnit?: (id: string) => boolean, prev?: Catalog | null, freeze?: boolean, names?: Catalog | null }} [opts]
 * @returns {Catalog}
 */
export function buildCatalog(families, opts = {}) {
  const cand = candidates(families, opts);
  /** @type {CatalogComp[]} */
  let comps;
  if (opts.freeze && opts.prev?.comps?.length) {
    comps = opts.prev.comps.map(c => ({ ...c, core: [...c.core], reroll: [...c.reroll], carries: [...c.carries], members: [...c.members], adopted: [] }));
    // Zielstufe darf nachgefuellt werden: klassische Tageszeilen haben kein
    // Top-4 je Stufe, ein Katalog aus ihnen startet mit null.
    const candByFam = new Map(cand.map(a => [a.fam, a]));
    for (const c of comps) if (c.targetLevel == null) c.targetLevel = candByFam.get(c.key)?.targetLevel ?? null;
    const known = new Set(comps.flatMap(c => c.members));
    const added = [];
    const frozen = new Set(comps);
    for (const a of [...cand].sort((x, y) => y.core.length - x.core.length || y.games - x.games || x.fam.localeCompare(y.fam))) {
      if (known.has(a.fam)) continue;
      // Auch Obermengen eines eingefrorenen Cores werden Mitglied: eine neue
      // Comp darf eine eingefrorene nie verdraengen (sie bekaeme sonst deren
      // beste Bretter, data-skeptic 20.10.2026: 8 solche Kerne in 10 Tagen).
      const host = [...comps, ...added]
        .filter(c => isSubset(a.core, new Set(c.core)) || (frozen.has(c) && isSubset(c.core, a.coreSet)))
        .sort((x, y) => y.core.length - x.core.length || y.games - x.games || x.key.localeCompare(y.key))[0];
      if (host) {
        host.members.push(a.fam);
        if (host.core.includes(a.carry) && !host.carries.includes(a.carry)) host.carries.push(a.carry);
      } else {
        added.push({ key: a.fam, core: a.core, reroll: a.reroll, carries: [a.carry], targetLevel: a.targetLevel, members: [a.fam], adopted: [], games: a.games });
      }
      known.add(a.fam);
    }
    comps.push(...added);
  } else {
    // Core komplett in einem groesseren (bei Gleichstand: mehr Spiele) → Mitglied.
    const order = [...cand].sort((x, y) => y.core.length - x.core.length || y.games - x.games || x.fam.localeCompare(y.fam));
    const host = new Map();
    for (const a of cand) {
      for (const b of order) {
        if (b === a || host.has(b.fam)) continue;
        if (!isSubset(a.core, b.coreSet)) continue;
        if (a.core.length === b.core.length && (a.games > b.games || (a.games === b.games && a.fam < b.fam))) continue;
        host.set(a.fam, b.fam);
        break;
      }
    }
    const root = fam => { let x = fam; for (let i = 0; i < 32 && host.has(x); i++) x = host.get(x); return x; };
    const byKey = new Map();
    for (const a of order) {
      if (root(a.fam) !== a.fam) continue;
      byKey.set(a.fam, { key: a.fam, core: a.core, reroll: a.reroll, carries: [a.carry], targetLevel: a.targetLevel, members: [a.fam], adopted: [], games: a.games });
    }
    for (const a of order) {
      const r = root(a.fam);
      if (r === a.fam) continue;
      const c = byKey.get(r);
      c.members.push(a.fam);
      c.games += a.games;
      if (c.core.includes(a.carry) && !c.carries.includes(a.carry)) c.carries.push(a.carry);
    }
    comps = [...byKey.values()];
  }
  comps.sort((x, y) => y.games - x.games || x.key.localeCompare(y.key));
  const catalog = { version: CATALOG_RULES.version, comps };
  adoptFamilies(families, catalog, opts);
  if (opts.names?.comps?.length) carryNames(comps, opts.names, new Map(families.map(f => [f?.fam, f?.games || 0])));
  return catalog;
}

/**
 * Namen ueber Kataloge hinweg behalten: eine Comp, deren Core zu mindestens 70 %
 * (Jaccard) mit einer Comp des Vorgaenger-Katalogs uebereinstimmt, uebernimmt
 * deren Namen. Sonst wandern die Namen, obwohl die Kerne bleiben (data-skeptic
 * 20.10.2026: 57 von 67 Kernen ≥70 % gleich, aber nur 45 von 76 Ankern), und am
 * Patchwechsel zerfiele dieselbe Comp in zwei Zeilen. Beste Paare zuerst, jeder
 * Name hoechstens einmal.
 * Nur Namen, die im neuen Katalog eine Familie DIESER Comp sind (Mitglied oder
 * fest zugeordnet) und mindestens halb so viele Spiele haben wie die Familie,
 * nach der die Comp sonst hiesse: sonst hiess die grosse Adaptor-Aphelios-Comp
 * in 18.4 „Primal · Aphelios“ (Name aus 18.3b) — der Trait im Namen muss zu den
 * Brettern passen.
 * @param {Map<string, number>} famGames Spiele je klassischer Familie (Eingabe)
 * @param {CatalogComp[]} comps
 * @param {Catalog} names
 */
function carryNames(comps, names, famGames) {
  const pairs = [];
  for (const c of comps) {
    const a = new Set(c.core);
    const own = new Set([...c.members, ...(c.adopted || [])]);
    const base = famGames.get(c.key) || 0;
    for (const p of names.comps) {
      if (!own.has(p.key) || (famGames.get(p.key) || 0) < 0.5 * base) continue;
      const inter = p.core.filter(id => a.has(id)).length;
      const j = inter / (a.size + p.core.length - inter);
      if (j >= 0.7) pairs.push({ c, key: p.key, j });
    }
  }
  pairs.sort((x, y) => y.j - x.j || y.c.games - x.c.games || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  const chosen = new Map();
  const taken = new Set();
  for (const { c, key } of pairs) {
    if (chosen.has(c) || taken.has(key)) continue;
    chosen.set(c, key);
    taken.add(key);
  }
  // Ein Name, den eine nicht umbenannte Comp schon traegt, wird nicht doppelt vergeben.
  const kept = new Set(comps.filter(c => !chosen.has(c)).map(c => c.key));
  for (const [c, key] of chosen) if (!kept.has(key)) c.key = key;
}

/**
 * Jede klassische Familie ohne Mitgliedschaft einmal fest zuordnen: ihr
 * typisches Brett (Units in mindestens der Haelfte ihrer Spiele) geht per
 * assignBoard an eine Comp. So ist das Umlegen alter Tage ein reines
 * Nachschlagen, gleich fuer jede Region und jeden Rang (architect 20.10.2026).
 * In V1 an vollen Lobbys geeicht: Abweichung zur Einzelspiel-Zuordnung 0,171.
 * Familien ohne Treffer bleiben ohne Comp und erscheinen nicht.
 * @param {ClassicFamily[]} families
 * @param {Catalog} catalog
 * @param {{ isUnit?: (id: string) => boolean }} [opts]
 */
function adoptFamilies(families, catalog, opts = {}) {
  const isUnit = opts.isUnit ?? defaultIsUnit;
  const known = new Set(catalog.comps.flatMap(c => c.members));
  const byKey = new Map(catalog.comps.map(c => [c.key, c]));
  for (const f of [...families].sort((a, b) => String(a?.fam).localeCompare(String(b?.fam)))) {
    if (!f?.fam || known.has(f.fam) || !(f.games > 0)) continue;
    const typical = Object.entries(f.units || {})
      .filter(([id, x]) => isUnit(id) && (x.g || 0) / f.games >= 0.5)
      .map(([id]) => id);
    const comp = assignBoard(typical, catalog);
    if (comp) byKey.get(comp.key).adopted.push(f.fam);
    known.add(f.fam);
  }
}

/**
 * Comp eines Bretts. `units`: eindeutige Champion-IDs des Bretts (Pflanzen und
 * Beschwoerungen schon herausgefiltert). Beste Comp nach Treffern, dann Anteil,
 * dann ob ein Carry der Comp auf dem Brett steht, dann Spielen, dann Name —
 * fest, damit ein Lauf wiederholbar ist. (Carry vor Spielen: sonst entschied
 * bei 5 % der Bretter nur die Groesse der Comp, data-skeptic 20.10.2026.)
 * @param {Iterable<string>} units
 * @param {Catalog} catalog
 * @returns {CatalogComp | null}
 */
export function assignBoard(units, catalog) {
  const ids = units instanceof Set ? units : new Set(units);
  const R = CATALOG_RULES;
  let best = null;
  let bh = 0;
  let bs = 0;
  let bc = false;
  for (const c of catalog?.comps || []) {
    let hits = 0;
    for (const id of c.core) if (ids.has(id)) hits++;
    const share = hits / c.core.length;
    if (hits < Math.min(c.core.length, R.minHits) || share < R.minShare) continue;
    const carry = c.carries.some(id => ids.has(id));
    const better = !best || hits > bh || (hits === bh && (share > bs || (share === bs
      && ((carry && !bc) || (carry === bc
        && (c.games > best.games || (c.games === best.games && c.key < best.key)))))));
    if (better) {
      best = c;
      bh = hits;
      bs = share;
      bc = carry;
    }
  }
  return best;
}

/**
 * „Perfekt getroffen" (User 19./20.10.2026): Reroll-Comp → alle Reroll-Units
 * im selben Spiel auf 3★ oder mehr; sonst Zielstufe der Comp erreicht, alle
 * Core-Units auf dem Brett und die Carries mindestens 2★.
 * @param {Map<string, number>} stars hoechster Stern je Unit auf dem Brett
 * @param {number} level Spielerstufe
 * @param {CatalogComp} comp
 */
export function isPerfect(stars, level, comp) {
  if (!comp) return false;
  if (comp.reroll.length > 0) return comp.reroll.every(id => (stars.get(id) || 0) >= 3);
  if (comp.targetLevel == null || !(level >= comp.targetLevel)) return false;
  return comp.core.every(id => stars.has(id)) && comp.carries.every(id => (stars.get(id) || 0) >= 2);
}

/**
 * Schluessel einer zugeordneten Zeile in der bekannten Schreibweise
 * `<trait>@<stufe>_<carry>`: Trait und Carry der Comp, Stufe = die auf diesem
 * Brett erreichte Stufe genau dieses Traits (0, wenn er nicht aktiv ist).
 * @param {CatalogComp} comp
 * @param {{ name?: string, tier_current?: number, style?: number }[]} traits
 */
export function compClusterKey(comp, traits) {
  const [trait, carry] = splitFamilyKey(comp.key);
  const t = (traits || []).find(x => x?.name === trait && (x.style ?? 0) > 0);
  return `${trait}@${t?.tier_current ?? 0}_${carry}`;
}

/**
 * Klassische Familie → Comp-Name (Mitglieder und fest zugeordnete Familien).
 * Familien ohne Comp fehlen.
 * @param {Catalog} catalog
 * @returns {Map<string, string>}
 */
export function aliasMap(catalog) {
  const m = new Map();
  for (const c of catalog?.comps || []) {
    for (const f of [...c.members, ...(c.adopted || [])]) m.set(f, c.key);
    // Uebernommener Name (carryNames) steht nicht in members; Zeilen von
    // Sammeltagen tragen ihn als Familien-Schluessel.
    m.set(c.key, c.key);
  }
  return m;
}

/**
 * Familien → Comp ueber mehrere Kataloge (Fenster ueber eine Patch-Grenze):
 * aelteste zuerst uebergeben, der neuere gewinnt.
 * @param {Catalog[]} catalogs
 * @returns {Map<string, string>}
 */
export function mergedAliasMap(catalogs) {
  const m = new Map();
  for (const cat of catalogs || []) for (const [f, k] of aliasMap(cat)) m.set(f, k);
  return m;
}

/**
 * Pruefsumme eines Katalogs (Sammler prueft damit die uebergebene Datei).
 * Reihenfolge-fest: Comps nach Schluessel, Listen sortiert.
 * @param {Catalog} catalog
 */
export function catalogHash(catalog) {
  const norm = (catalog?.comps || [])
    .map(c => [c.key, [...c.core].sort(), [...c.reroll].sort(), [...c.carries].sort(), c.targetLevel ?? null,
      [...c.members].sort(), [...(c.adopted || [])].sort()])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const s = JSON.stringify([catalog?.version ?? null, norm]);
  // Zwei FNV-1a-32 mit verschiedenem Start — reicht als Pruefsumme und braucht
  // kein node:crypto (das Modul landet auch im Browser-Bundle).
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x01000193) ^ (b >>> 13);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
