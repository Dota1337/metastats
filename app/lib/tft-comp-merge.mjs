// Comps zusammenlegen (User 31.10.2026: „Lege die Comps zusammen (reroll Comps
// bleiben nach wie vor eine eigene Comp), damit wir den Durchschnitt immer
// richtig haben"). Die Katalog-Regel ordnet Bretter nach ihrem Trait zu. So wird
// aus einer Linie wie Elderwood mit Soraka, die auf hoher Stufe Gnar und dann Lux
// dazunimmt, ein Stapel getrennter Comps: die schwache Grund-Comp (Ø 4,71) und
// die starke Endstufe (Ø 3,37), die nur erreicht, wer ohnehin gewinnt. Der
// Durchschnitt der Linie steht dann nirgends. MetaTFT, tactics.tools und TFTable
// zeigen eine Zeile.
//
// Reines Modul ohne IO: scripts/build-comp-merges.mjs (Box) rechnet damit, die
// Seite liest nur das Ergebnis (Tabelle tft_comp_merge, Migration 0109).
//
// Regeln, gemessen an den Tageszeilen 24.–30.10.2026 (Diamond+, alle Regionen):
//  - Reroll bleibt fuer sich: nie eine Reroll-Comp mit einer Nicht-Reroll-Comp.
//  - R1 Endstufe: der Key-Carry kostet 5. Die Comp haengt an der Comp desselben
//    Traits, deren Carry am haeufigsten auf ihrem Brett steht. Ein 5-Kosten-Ziel
//    ist erlaubt (Lux → Gnar → Soraka, die Linie laeuft ueber Gnar), nur Bretter
//    ohne Aehnlichkeit nicht (Vanguard Alune, Lunar Lux bleiben fuer sich).
//  - R2 gleiche Traeger: gleicher Trait, gleicher Reroll-Status, die Item-Traeger
//    der einen stecken in denen der anderen, der Kern ist fast gleich (Riftbeast:
//    Brambleback traegt ueberall die Items, der Key-Carry heisst nur anders).
//  - Schutz: traegt eine Comp Items auf einer Unit, die in der anderen kaum
//    steht, ist es eine andere Comp (Defender Rengar).
// Das Ziel einer Gruppe ist ihre meistgespielte Comp. Eine Zuordnung gilt fest
// fuer die Patch-Familie: je nach Rang und Zeitraum kippte die Regel sonst
// (Lux → Aphelios fehlte in 5 von 12 Filtern).

export const MERGE_RULES = Object.freeze({
  version: 1,
  minGames: 100,          // Comp braucht so viele Spiele im Eingabefenster
  boardPresence: 0.5,     // Unit gehoert zum typischen Brett
  corePresence: 0.75,     // Unit gehoert zum Kern
  carrierLoad: 1.5,       // Item-Traeger: fertige Items je Spiel
  rerollShare: 0.4,       // Reroll: Haupt-Traeger kostet <=3 und steht so oft auf 3 Sternen
  rerollMaxCost: 3,
  endCost: 5,
  endMinBack: 0.5,        // R1: Carry des Ziels steht so oft auf dem Brett der Endstufe
  endMinSimilarity: 0.6,  // R1: gleiche Units der typischen Bretter
  sameCoreShare: 0.8,     // R2: Anteil des eigenen Kerns auf dem Brett der anderen
  sameMinSimilarity: 0.4, // R2: gleiche Units der typischen Bretter (Blossom Gnar → Master Yi: 0,18, danach erst 0,50)
  guardLoad: 1.2,         // Schutz: Unit traegt so viele Items ...
  guardPresence: 0.4,     // ... und steht in der anderen Comp seltener als das
});

const splitKey = key => {
  const s = String(key || '');
  const i = s.indexOf('__');
  return i > 0 ? [s.slice(0, i), s.slice(i + 2)] : [s, ''];
};

/** Leerer Sammler fuer die Eingabe. */
export function newMergeInput() {
  return new Map();
}

/**
 * Eine Tageszeile in die Eingabe. `compKey` ist die Katalog-Comp der Zeile.
 * @param {Map<string, any>} input
 * @param {string} compKey
 * @param {{ games: number, units: Array<any> }} row typical_units der Tageszeile
 * @param {(apiName: string) => boolean} isComponent
 */
export function addMergeRow(input, compKey, row, isComponent = () => false) {
  const games = Number(row?.games) || 0;
  if (!compKey || games <= 0) return;
  let c = input.get(compKey);
  if (!c) {
    const [trait, carry] = splitKey(compKey);
    c = { key: compKey, trait, carry, games: 0, units: new Map() };
    input.set(compKey, c);
  }
  c.games += games;
  for (const u of row.units || []) {
    if (!u?.characterId) continue;
    let x = c.units.get(u.characterId);
    if (!x) { x = { games: 0, star3: 0, items: 0 }; c.units.set(u.characterId, x); }
    x.games += Number(u.gamesWithUnit) || Number(u.count) || 0;
    x.star3 += Number(u.star3Games) || 0;
    for (const it of u.topItems || []) {
      if (it?.apiName && !isComponent(it.apiName)) x.items += Number(it.count) || 0;
    }
  }
}

const presence = (c, id) => (c.games > 0 ? (c.units.get(id)?.games || 0) / c.games : 0);
const load = x => (x.games > 0 ? x.items / x.games : 0);

/** Item-Traeger ab einer Mindest-Praesenz, meiste Items zuerst. */
function carriers(c, minPresence) {
  return [...c.units.entries()]
    .filter(([id, x]) => presence(c, id) >= minPresence && load(x) >= MERGE_RULES.carrierLoad)
    .sort((a, b) => load(b[1]) - load(a[1]) || a[0].localeCompare(b[0]))
    .map(([id]) => id);
}

const unitsAt = (c, minPresence) => new Set([...c.units.keys()].filter(id => presence(c, id) >= minPresence));

/** Reroll-Comp: der Haupt-Item-Traeger kostet wenig und steht meist auf 3 Sternen. */
export function isRerollComp(c, costOf) {
  const main = carriers(c, MERGE_RULES.boardPresence)[0];
  if (!main) return false;
  const x = c.units.get(main);
  const cost = Number(costOf(main));
  return cost >= 1 && cost <= MERGE_RULES.rerollMaxCost && x.games > 0 && x.star3 / x.games >= MERGE_RULES.rerollShare;
}

function similarity(a, b) {
  const ua = unitsAt(a, MERGE_RULES.boardPresence);
  const ub = unitsAt(b, MERGE_RULES.boardPresence);
  let both = 0;
  for (const id of ua) if (ub.has(id)) both++;
  const all = ua.size + ub.size - both;
  return all > 0 ? both / all : 0;
}

// Anteil des eigenen Kerns (ohne den Key-Carry), der auf dem Brett der anderen steht.
function coreShare(x, y) {
  const core = [...unitsAt(x, MERGE_RULES.corePresence)].filter(id => id !== x.carry);
  return core.length > 0 ? core.filter(id => presence(y, id) >= MERGE_RULES.boardPresence).length / core.length : 0;
}

// Eine Unit mit vielen Items, die in der anderen Comp kaum steht: andere Comp.
function guardBlocks(a, b) {
  for (const [id, x] of a.units) {
    if (presence(a, id) >= MERGE_RULES.corePresence && load(x) >= MERGE_RULES.guardLoad
      && presence(b, id) < MERGE_RULES.guardPresence) return true;
  }
  return false;
}

/**
 * Paare „x gehoert zu y" aus der Eingabe, ohne Gruppen zu bilden.
 * @returns {Array<{ from: string, to: string, rule: 'R1'|'R2' }>}
 */
export function mergePairs(input, costOf) {
  const list = [...input.values()].filter(c => c.games >= MERGE_RULES.minGames);
  const reroll = new Map(list.map(c => [c.key, isRerollComp(c, costOf)]));
  const isEnd = c => Number(costOf(c.carry)) === MERGE_RULES.endCost;
  const pairs = [];
  for (const x of list) {
    const peers = list.filter(y => y !== x && y.trait === x.trait && reroll.get(y.key) === reroll.get(x.key));
    if (isEnd(x) && !reroll.get(x.key)) {
      const target = peers
        .filter(y => !guardBlocks(y, x) && similarity(x, y) >= MERGE_RULES.endMinSimilarity
          && presence(x, y.carry) >= MERGE_RULES.endMinBack)
        .sort((a, b) => presence(x, b.carry) - presence(x, a.carry) || b.games - a.games || a.key.localeCompare(b.key))[0];
      if (target) { pairs.push({ from: x.key, to: target.key, rule: 'R1' }); continue; }
    }
    const own = carriers(x, MERGE_RULES.corePresence);
    if (own.length === 0) continue;
    const same = peers
      .filter(y => y.games > x.games && similarity(x, y) >= MERGE_RULES.sameMinSimilarity)
      .filter(y => {
        const other = carriers(y, MERGE_RULES.corePresence);
        if (other.length === 0) return false;
        const subset = own.every(id => other.includes(id)) || other.every(id => own.includes(id));
        return subset && coreShare(x, y) >= MERGE_RULES.sameCoreShare && !guardBlocks(x, y) && !guardBlocks(y, x);
      })
      // Die aehnlichste Comp, nicht die groesste: Blossom Gnar gehoert zur Zyra-Linie
      // (Sett, Ahri, Gnar), nicht zu Master Yi, das nur mehr Spiele hat.
      .sort((a, b) => similarity(x, b) - similarity(x, a) || b.games - a.games || a.key.localeCompare(b.key))[0];
    if (same) pairs.push({ from: x.key, to: same.key, rule: 'R2' });
  }
  return pairs;
}

/**
 * Gruppen aus den Paaren: jede Comp zeigt direkt auf die meistgespielte ihrer
 * Gruppe. `fixed` sind die schon gespeicherten Zuordnungen der Patch-Familie, sie
 * bleiben unveraendert — neue Paare kommen nur dazu (ein gespeichertes Ziel bleibt
 * auch dann Ziel, wenn eine andere Comp der Gruppe inzwischen mehr Spiele hat).
 * @param {Array<{ from: string, to: string, rule: string }>} pairs
 * @param {Map<string, any>} input
 * @param {Array<{ from: string, to: string, rule?: string }>} [fixed]
 * @returns {Array<{ from: string, to: string, rule: string, fromGames: number, toGames: number }>} nur Neues
 */
export function resolveMerges(pairs, input, fixed = []) {
  const parent = new Map();
  const find = k => {
    let cur = k;
    const seen = new Set();
    while (parent.has(cur) && !seen.has(cur)) { seen.add(cur); cur = parent.get(cur); }
    return cur;
  };
  const gamesOf = k => input.get(k)?.games || 0;
  for (const f of fixed) if (f.from !== f.to && find(f.to) !== f.from) parent.set(f.from, f.to);
  const fixedFrom = new Set(fixed.map(f => f.from));
  const fixedRoots = new Set(fixed.map(f => find(f.to)));
  const ruleOf = new Map();
  for (const p of pairs) {
    const a = find(p.from);
    const b = find(p.to);
    if (a === b) continue;
    // Das Ziel wird die groessere Gruppe; ein gespeichertes Ziel bleibt Ziel.
    const keepA = fixedRoots.has(a) && !fixedRoots.has(b);
    const keepB = fixedRoots.has(b) && !fixedRoots.has(a);
    const [root, child] = keepA ? [a, b] : keepB ? [b, a]
      : gamesOf(a) > gamesOf(b) || (gamesOf(a) === gamesOf(b) && a < b) ? [a, b] : [b, a];
    if (fixedRoots.has(child)) continue; // zwei feste Gruppen bleiben getrennt
    parent.set(child, root);
    ruleOf.set(p.from, p.rule);
    ruleOf.set(child, p.rule);
  }
  const out = [];
  for (const k of parent.keys()) {
    if (fixedFrom.has(k)) continue;
    const to = find(k);
    if (to === k) continue;
    out.push({ from: k, to, rule: ruleOf.get(k) ?? 'R2', fromGames: gamesOf(k), toGames: gamesOf(to) });
  }
  // Auch Glieder einer Kette zeigen direkt aufs Ziel.
  return out.sort((a, b) => a.to.localeCompare(b.to) || b.fromGames - a.fromGames);
}

const familyOrder = (a, b) => {
  const [x, y] = [a, b].map(p => /^(\d+)\.(\d+)/.exec(p) || []);
  return Number(x[1]) - Number(y[1]) || Number(x[2]) - Number(y[2]);
};

/**
 * Zeilen, die fuer die Patch-Familien eines Fensters gelten, aelteste zuerst: je
 * Familie ihre eigenen, sonst die der letzten Familie davor (ein neuer Patch gilt
 * bis zum ersten eigenen Lauf mit der alten Zuordnung).
 * @param {Array<{ patch_family: string, from_key: string, to_key: string }>} rows
 * @param {string[]} windowFamilies
 */
export function mergeRowsForWindow(rows, windowFamilies) {
  const known = [...new Set((rows || []).map(r => r.patch_family))].sort(familyOrder);
  const use = new Set();
  for (const f of windowFamilies) {
    const hit = known.filter(k => familyOrder(k, f) <= 0).pop();
    if (hit) use.add(hit);
  }
  return [...use].sort(familyOrder).flatMap(f => rows.filter(r => r.patch_family === f));
}

/**
 * Lese-Seite: Comp → Ziel, Ketten aufgeloest, Kreise brechen ab (die Comp bleibt
 * dann fuer sich). `rows` je Patch-Familie aelteste zuerst: die neuere gewinnt.
 * @param {Array<{ from_key: string, to_key: string }>} rows
 * @returns {Map<string, string>}
 */
export function mergeTargets(rows) {
  const next = new Map();
  for (const r of rows || []) if (r?.from_key && r?.to_key && r.from_key !== r.to_key) next.set(r.from_key, r.to_key);
  const out = new Map();
  for (const from of next.keys()) {
    const seen = new Set([from]);
    let cur = next.get(from);
    while (next.has(cur) && !seen.has(cur)) { seen.add(cur); cur = next.get(cur); }
    if (!seen.has(cur)) out.set(from, cur);
  }
  return out;
}

const hashOf = text => {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = (h * 33 + text.charCodeAt(i)) >>> 0;
  return h.toString(36);
};

/**
 * Zuordnung auf die Katalog-Sicht (Familie → Comp) anwenden. Ein Ziel, das im
 * Katalog gar nicht vorkommt, zaehlt nicht: die Comp bleibt dann fuer sich.
 * @param {Map<string, string>} lookup Familie → Comp
 * @param {Map<string, string>} targets Comp → Grund-Comp (mergeTargets)
 * @returns {{ lookup: Map<string, string>, partOf: Map<string, string>, parts: Map<string, string[]>, stamp: string | null }}
 *   partOf/parts nur fuer zusammengelegte Comps, Grund-Comp in parts zuerst; stamp
 *   kennzeichnet den Stand (null = nichts zusammengelegt).
 */
export function applyMerges(lookup, targets) {
  const known = new Set(lookup.values());
  const active = new Map([...targets].filter(([from, to]) => known.has(from) && known.has(to)));
  if (active.size === 0) return { lookup, partOf: new Map(), parts: new Map(), stamp: null };
  const roots = new Set(active.values());
  const out = new Map();
  const partOf = new Map();
  const parts = new Map();
  for (const root of roots) parts.set(root, [root]);
  for (const [fam, comp] of lookup) {
    const to = active.get(comp);
    out.set(fam, to ?? comp);
    if (to || roots.has(comp)) partOf.set(fam, comp);
    if (to && !parts.get(to).includes(comp)) parts.get(to).push(comp);
  }
  for (const list of parts.values()) list.splice(1, list.length, ...list.slice(1).sort());
  const sorted = [...active].map(([a, b]) => `${a}>${b}`).sort().join(',');
  return { lookup: out, partOf, parts, stamp: `m${active.size}-${hashOf(sorted)}` };
}

/**
 * Stand ohne Zuordnung (Notschalter, Fehler), gleiche Form wie applyMerges.
 * @param {Map<string, string>} lookup
 * @returns {{ lookup: Map<string, string>, partOf: Map<string, string>, parts: Map<string, string[]>, stamp: string | null }}
 */
export const noMerges = lookup => ({ lookup, partOf: new Map(), parts: new Map(), stamp: null });
