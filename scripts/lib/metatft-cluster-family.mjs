// Bildet MetaTFT-Cluster auf unsere Comp-Familien (`<trait>__<carry>`) ab.
//
// Warum kein Set-Overlap-Matching: der naheliegende Weg wäre, jeden Cluster per
// Jaccard gegen die Familien aus der DB zu vergleichen. Gemessen am 2026-08-04
// über die Top-50-Familien: 47 Treffer, die sich auf nur 25 Cluster verteilen —
// 16 Kollisionen. Der Grund ist, dass Set-Overlap den Carry nicht kennt: der
// Cluster "TFT17_DRX, TFT17_Kindred" führt Akali mit 35.222 Item-Builds gegen
// Kindred mit 1.291. Über die Unit-Menge sind beide Familien identisch, über
// den Carry nicht — und der Carry ist das, was den Guide trägt.
//
// Stattdessen leiten wir den Familien-Key aus dem Cluster ab, statt ihn zu
// suchen: aus units + traits + den dominanten Item-Builds bauen wir einen
// synthetischen Participant und schicken ihn durch DIESELBE classifyComp-Lib,
// die auch Cache und Aggregator schreiben. Damit ist der Key per Konstruktion
// im selben Format und nach derselben Regel gebildet — es gibt keinen zweiten
// Klassifikator, der driften könnte (`reference_tft_classification_bridge`).
//
// Der Carry fällt dabei automatisch richtig: classifyComp wählt nach
// Damage-Item-Count, und die Items kommen aus dem meistgespielten Build je
// Unit. Ein separates "Hard-Gate Carry" braucht es deshalb nicht.
//
// **Filter-Fix und Reclassify gehören zusammen.** Seit 2026-08-05 filtert
// classifyComp Fragment-Traits nicht mehr per Regex `/UniqueTrait$/`, sondern
// per Bundle-Ground-Truth (genau EINE Stufe, die ab 1 Unit greift) vereinigt
// mit dem Regex. Das ergänzt in Set 17 genau einen Trait: TFT17_GravesTrait.
//
// TFT17_SpaceGroove gehört ausdrücklich NICHT dazu — der hat fünf Stufen
// (1/3/5/7/10) und ist ein normaler Comp-Trait. Ein früherer Kommentar an
// dieser Stelle behauptete das Gegenteil; wer ihn gefiltert hätte, hätte eine
// echte Comp-Linie zerstört.
//
// Wichtig bleibt die Kopplung: die cluster_keys in der DB sind nach der
// jeweils geltenden Regel gebildet. Ändert sich der Filter, muss der
// Reclassify hinterher, sonst zeigt das Mapping auf Keys, die es nicht gibt.

import { classifyComp } from './tft-classify-comp.mjs';
import { damageCarryItemsForSet } from './tft-item-classes.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CURRENT_SET } from './current-set.mjs';

/** "TFT17_DRX_2" -> { name: "TFT17_DRX", tier: 2 } */
function parseTrait(raw) {
  const m = /^(.*?)_(\d+)$/.exec(String(raw || ''));
  if (!m) return { name: String(raw || ''), tier: 1 };
  return { name: m[1], tier: Number(m[2]) };
}

const _styleCache = new Map();
function loadTraitStyles(setNumber) {
  const set = setNumber || CURRENT_SET;
  if (_styleCache.has(set)) return _styleCache.get(set);
  let map = new Map();
  try {
    const bundle = JSON.parse(readFileSync(resolve(process.cwd(), `public/tft-assets-${set}.json`), 'utf8'));
    map = new Map(Object.entries(bundle.traits || {}).map(([name, t]) => [name, (t?.tiers || []).map(x => x.style ?? 0)]));
  } catch { /* ohne Bundle fallen wir unten auf die Stufe zurück */ }
  _styleCache.set(set, map);
  return map;
}

/**
 * Der style-Wert, den ein Trait auf der gegebenen Stufe im echten Board hätte.
 *
 * Das ist der Unterschied, der die Familien-Zuordnung trägt: classifyComp
 * sortiert Traits primär nach style, und der ist NICHT die Stufe. GravesTrait
 * erreicht schon mit einer Unit style 4, DRX auf seiner ersten Stufe nur 1.
 * Setzt man style auf die Stufe, gewinnt bei Gleichstand die alphabetische
 * Sortierung — dann wird aus einer GravesTrait-Comp eine DRX-Comp, und die
 * Familie findet ihren Guide nicht mehr. Gemessen 2026-08-04: vier
 * GravesTrait-Familien mit zusammen ~79.000 Spielen fielen so heraus.
 *
 * Das Suffix in "TFT17_DRX_2" ist der 1-basierte Stufen-Index, nicht die
 * Unit-Zahl — Stufe 2 von DRX ist also style 5.
 */
function styleFor(styles, name, tier) {
  const list = styles.get(name);
  if (!list || list.length === 0) return tier;
  return list[Math.min(tier, list.length) - 1] ?? tier;
}

// Ein Build zählt als Carry-Build ab dieser Zahl Damage-Items.
//
// Historie: die Schwelle stand auf 1, weil die Damage-Item-Liste
// MadredsBloodrazor (Giant Slayer, 12.002 Builds) nicht kannte und MasterYi
// deshalb mit Schwelle 2 aus seiner eigenen Comp fiel. Das Item ist seit
// 2026-08-05 in der Liste — der sauberere Fix, der damals nur deshalb
// aufgeschoben war, weil er einen Reclassify verlangt.
//
// Die Schwelle bleibt trotzdem bei 1: sie zu heben wäre eine zweite
// Verhaltensänderung im selben Lauf, ohne Messung dafür. Die Trennschärfe
// kommt ohnehin aus dem Volumen (siehe unten).
//
// Die Trennschärfe kommt ohnehin aus dem Volumen: reine Tanks haben null
// Damage-Items (Nunu mit Crownguard und zwei FrozenHeart) und fallen hier
// heraus, schwach bespielte Nebenträger über CO_CARRY_MIN_RATIO.
const CARRY_MIN_DAMAGE_ITEMS = 1;
// Ab diesem Anteil am stärksten Carry-Volumen gilt eine zweite Unit ebenfalls
// als Carry der Comp.
const CO_CARRY_MIN_RATIO = 0.5;
// Mehr als drei Carrys hat keine Comp — darüber ist die Clusterung kaputt.
const MAX_CARRIES = 3;

/**
 * Bestimmt die Carrys eines Clusters über das Volumen der Carry-Builds.
 *
 * Zwei Fallen, beide am 2026-08-04 an echten Clustern gemessen:
 *
 * 1. Die Zahl der Damage-Items im besten Build reicht nicht. Bei
 *    "MeleeTrait, MasterYi" hält Kindred 3 Damage-Items, MasterYi nur 1 —
 *    MasterYi hat aber das dreifache Volumen. Der seltene Alt-Build gewann.
 *    Deshalb summieren wir Build-Counts statt Items zu zählen.
 *
 * 2. `unit_numitems_count` als Volumen ist ebenfalls falsch, weil Tanks Items
 *    halten: bei "ShieldTank, Nunu, Illaoi" führt Nunu mit 29.205 — mit
 *    Crownguard und zwei FrozenHeart, also null Damage-Items. Deshalb zählen
 *    nur Builds mit mindestens CARRY_MIN_DAMAGE_ITEMS.
 *
 * Mehrere Carrys sind der Normalfall, nicht der Fehlerfall: MetaTFT clustert
 * "Mecha, AurelionSol, Karma" als eine Comp (Karma 1.748 / AurelionSol 1.588,
 * beide mit Carry-Items) und nennt beide im Namen. In unserer Aggregation sind
 * das zwei Familien — beide sollen denselben Guide sehen, denn es ist dieselbe
 * Comp. Würden wir hier auf einen Carry zwingen, verlören 15 von 69 Clustern
 * ihren Guide, darunter welche mit über 60.000 Spielen.
 *
 * @returns {Array<{ carry: string, volume: number }>} nach Volumen absteigend
 */
export function carryCandidates(cluster, damageItems) {
  const volume = new Map();
  for (const b of cluster.builds || []) {
    if (!b?.unit) continue;
    const dmg = (b.buildName || []).filter(i => damageItems.has(i)).length;
    if (dmg < CARRY_MIN_DAMAGE_ITEMS) continue;
    volume.set(b.unit, (volume.get(b.unit) || 0) + (Number(b.count) || 0));
  }
  const ranked = [...volume.entries()]
    .map(([carry, v]) => ({ carry, volume: v }))
    .sort((a, b) => b.volume - a.volume);
  if (ranked.length === 0) return [];

  const top = ranked[0].volume;
  return ranked.filter(r => r.volume / top >= CO_CARRY_MIN_RATIO).slice(0, MAX_CARRIES);
}

/**
 * Baut aus einem MetaTFT-Cluster einen Participant im Match-V1-Shape, in dem
 * genau die übergebene Unit Items hält.
 *
 * Dass nur der Carry Items bekommt, ist Absicht: welche Units als Carry in
 * Frage kommen, entscheidet carryCandidates() aus dem Cluster-Volumen — ein
 * Signal, das ein einzelnes Board nicht hat. classifyComp bleibt trotzdem die
 * Instanz, die Trait-Filter und Key-Form vorgibt; wir nehmen ihm nur die Wahl
 * zwischen Kandidaten ab, indem wir ihm einen eindeutigen Board-Zustand geben.
 */
export function clusterToParticipant(cluster, carry, setNumber) {
  const bestBuild = new Map();
  for (const b of cluster.builds || []) {
    const unit = b?.unit;
    if (!unit) continue;
    const count = Number(b.count) || 0;
    const prev = bestBuild.get(unit);
    if (!prev || count > prev.count) {
      bestBuild.set(unit, { count, items: Array.isArray(b.buildName) ? b.buildName : [] });
    }
  }

  const units = (cluster.units || []).map(cid => ({
    character_id: cid,
    tier: 2,
    itemNames: cid === carry ? (bestBuild.get(cid)?.items || []) : [],
  }));

  // MetaTFT liefert nur die erreichte Stufe im Suffix. Den style-Wert, nach dem
  // classifyComp primär sortiert, holen wir aus dem Asset-Bundle — siehe
  // styleFor(): ihn mit der Stufe gleichzusetzen verschiebt die Trait-Rangfolge
  // und damit die halbe Familien-Zuordnung.
  const styles = loadTraitStyles(setNumber);
  const traits = (cluster.traits || []).map(raw => {
    const { name, tier } = parseTrait(raw);
    return { name, style: styleFor(styles, name, tier), tier_current: tier, num_units: 0 };
  });

  // Level aus der Levelling-Strategie, damit der Cost-Aware-Swap in
  // classifyComp (Fast-8-Zweig) dieselbe Entscheidung trifft wie im Live-Spiel.
  const lv = String(cluster.levelling || '');
  const level = /Fast 9|lvl 9/i.test(lv) ? 9 : 8;

  return { traits, units, augments: [], level };
}

/**
 * Alle Familien, die dieser Cluster bedient — eine je Carry.
 *
 * @returns {Array<{ familyKey: string, trait: string, carry: string }>}
 */
export function clusterFamilies(cluster, opts = {}) {
  const damageItems = opts.damageItems || damageCarryItemsForSet(opts.currentSet ?? CURRENT_SET);
  const units = cluster.units || [];
  const out = [];

  for (const cand of carryCandidates(cluster, damageItems)) {
    // Builds können Units nennen, die nicht in units_string stehen. Dann bekäme
    // der Participant gar keine Items und classifyComp griffe irgendeine Unit —
    // lieber keinen Key als einen geratenen.
    if (!units.includes(cand.carry)) continue;

    const res = classifyComp(clusterToParticipant(cluster, cand.carry, opts.currentSet ?? CURRENT_SET), {
      currentSet: opts.currentSet ?? CURRENT_SET,
    });
    if (!res) continue;
    // Sicherung gegen stille Drift, falls classifyComp seine Carry-Regel
    // ändert: der Key muss den Carry tragen, den wir vorgegeben haben.
    if (res.carryUnit !== cand.carry) continue;

    const familyKey = `${res.primaryTrait}__${res.carryUnit}`;
    if (out.some(o => o.familyKey === familyKey)) continue;
    out.push({ familyKey, trait: res.primaryTrait, carry: res.carryUnit });
  }

  return out;
}

/**
 * Baut die Familie→Cluster-Map für alle Cluster.
 *
 * Kollisionen (mehrere Cluster derselben Familie) löst die Spielzahl auf: die
 * Familie zeigt den Guide des meistgespielten Clusters. Das ist keine
 * Notlösung, sondern die inhaltlich richtige Antwort — die Familie IST die
 * Konsolidierung mehrerer Sub-Cluster, und ihr Vertreter ist der, den die
 * meisten Spieler tatsächlich spielen.
 *
 * @returns {{ map: Record<string, string>, collisions: Array, unclassified: Array }}
 */
export function buildFamilyMap(comps, opts = {}) {
  const byFamily = new Map();
  const unclassified = [];

  for (const c of comps) {
    const fams = clusterFamilies(c, opts);
    if (fams.length === 0) { unclassified.push(c.id); continue; }
    for (const fam of fams) {
      const list = byFamily.get(fam.familyKey) || [];
      list.push({ id: c.id, games: c.games || 0, name: c.name });
      byFamily.set(fam.familyKey, list);
    }
  }

  const map = {};
  const collisions = [];
  for (const [familyKey, list] of byFamily) {
    list.sort((a, b) => b.games - a.games);
    map[familyKey] = list[0].id;
    if (list.length > 1) {
      collisions.push({ familyKey, chosen: list[0].id, dropped: list.slice(1).map(x => x.id) });
    }
  }

  return { map, collisions, unclassified };
}
