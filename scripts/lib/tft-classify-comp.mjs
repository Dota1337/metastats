// Single-Source-Klassifikator fuer Comp-Cluster-Keys.
//
// Bridge fuer den Klassifikations-Drift, der zwischen 3 Pfaden bestand:
//   - tft-marketvalue.mjs (Cache-Writer fuer tft_player_match_cache)
//   - tft-build-aggregator.mjs (Daily-Aggregator fuer tft_daily_comp_stats)
//   - app/api/tft/pros/specialty/route.ts (Vercel-Live-Reclassify)
//
// Vorher: Cache hatte KEINEN UniqueTrait-Filter und einfache most-items-Carry-
// Detection. Aggregator hatte UniqueTrait-Filter + Hero-Augment + Cost-Aware-
// Swap. Folge: Pro-Cache-Top war `BlitzcrankUniqueTrait@1_...` (Single-Unit-
// Fragment), Aggregator-Listing-Top war `TFT17_GravesTrait@1_TFT17_Vex` (echte
// Comp) — Cross-Join via cluster_key = 0 Matches.
//
// Diese Lib ist die einzige Quelle fuer die Klassifikation. Beide Schreibpfade
// (Cache + Aggregator) und der Vercel-Read-Pfad ziehen daraus. Migration siehe
// reference_tft_classification_bridge.md.
//
// **Wichtig**: WhatchOut-Felder ueber alle 3 Pfade:
//   - Cache hat units im Hetzner-Shape ({character_id, tier, itemNames})
//   - Cache hat traits ohne num_units bei aelteren Rows → UniqueTrait-Filter
//     ueber Regex `/UniqueTrait$/.test(name)` ist robuster als num_units>=2
//   - Aggregator nutzt Hero-Augment-Detection — Match-V1 augments-Feld ist
//     seit 2026-06-15 leer, aber Match-Cache persistiert vergangene augments-
//     Arrays in der `augments` JSONB-Spalte → Re-Classify funktioniert auch
//     fuer alte Matches.
//
// Output-Format-Modes:
//   withAugmentSuffix=false (Cache, Vercel-Read) → `<trait>@<level>_<carry>`
//   withAugmentSuffix=true  (Aggregator)         → `<trait>@<level>_<carry>~<aug>`

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { damageCarryItemsForSet } from './tft-item-classes.mjs';
import { compDefiningAugmentSlug } from './tft-comp-defining-augments.mjs';
import { CURRENT_SET } from './current-set.mjs';

// Beides aus EINEM Bundle-Parse, per Set memoisiert:
//   costMap        — characterId → cost, fuer den Cost-Aware-Swap
//   fragmentTraits — Traits, die kein echter Comp-Trait sind (siehe unten)
//
// Fragment-Traits sind die Ein-Personen-Mechanik-Traits: genau EINE Stufe, die
// schon ab 1 Einheit greift. Sie beschreiben keine Comp, sondern haengen an
// einem einzelnen Champion — als Primary-Trait erzeugen sie Cluster wie
// `TFT17_GravesTrait@1_TFT17_Vex`, wo Vex traegt und Graves nur danebensteht.
//
// Warum aus dem Bundle statt per Namensmuster: das Muster `/UniqueTrait$/` traf
// in Set 17 elf der zwoelf, verfehlte aber `TFT17_GravesTrait` — 8 % aller
// Comp-Spiele. Ein hartkodiertes `TFT\d+_GravesTrait` waere derselbe Fehler mit
// Ansage, weil Set 18 sein eigenes Gegenstueck mit eigenem Namen bringt.
//
// Die Regex bleibt trotzdem als Fail-Safe bestehen (Union, NICHT Ersatz): faellt
// der Bundle-Read aus, ist fragmentTraits leer — und ohne Filter werden
// Fragment-Traits wieder Primary, also exakt der Bug von 2026-06-21. Ein
// leerer Set darf hier nie "alles erlaubt" bedeuten.
const _bundleCache = new Map();
// Fehlversuche werden NICHT dauerhaft gecacht, sondern nur kurz gedrosselt.
// Grund: `_bundleCache.set` stand frueher ausserhalb des `try` — ein einziger
// Request auf ein Set, dessen public/tft-assets-<set>.json noch nicht deployed
// war (Set-Flip!), schrieb den Fail-Safe-Zustand prozesslebenslang fest. Der
// spaetere Deploy heilte das nicht, nur ein Neustart. Jetzt wird nach dem
// Cooldown erneut gelesen, und der erste Fehlschlag pro Set meldet sich laut.
const _bundleFail = new Map();
const BUNDLE_RETRY_MS = 60_000;
function loadBundleDerived(setNumber) {
  const set = setNumber || CURRENT_SET;
  if (_bundleCache.has(set)) return _bundleCache.get(set);
  const derived = { costMap: new Map(), fragmentTraits: new Set() };
  const lastFail = _bundleFail.get(set);
  if (lastFail != null && Date.now() - lastFail < BUNDLE_RETRY_MS) return derived;
  try {
    const bundle = JSON.parse(readFileSync(resolve(process.cwd(), `public/tft-assets-${set}.json`), 'utf8'));
    for (const [cid, ch] of Object.entries(bundle.champions || {})) {
      if (typeof ch?.cost === 'number') derived.costMap.set(cid, ch.cost);
    }
    for (const [name, tr] of Object.entries(bundle.traits || {})) {
      const tiers = tr?.tiers;
      if (Array.isArray(tiers) && tiers.length === 1 && tiers[0]?.minUnits === 1) {
        derived.fragmentTraits.add(name);
      }
    }
  } catch (err) {
    if (!_bundleFail.has(set)) {
      console.error(`[classify] public/tft-assets-${set}.json nicht lesbar (${err && err.message ? err.message : err}) — Fail-Safe ohne Kosten-Map/Fragment-Traits, neuer Versuch in ${BUNDLE_RETRY_MS / 1000}s.`);
    }
    _bundleFail.set(set, Date.now());
    return derived;
  }
  _bundleFail.delete(set);
  _bundleCache.set(set, derived);
  return derived;
}
function loadCostMap(setNumber) {
  return loadBundleDerived(setNumber).costMap;
}

// Hero-Augment-Pattern: `TFT<N>_Augment_<UnitName>Carry` oder `<UnitName>GodAugment`.
// Ein Participant der ein Hero-Augment haelt intendiert die Unit als Carry,
// unabhaengig von Item-Count.
function carryFromAugments(participant, units) {
  const augs = participant.augments || [];
  if (augs.length === 0) return null;
  for (const a of augs) {
    if (!a) continue;
    const m = /^TFT\d+_Augment_(.+?)(?:Carry|GodAugment|HeroAugment)$/i.exec(a);
    if (!m) continue;
    const unitNameLower = m[1].toLowerCase();
    const hit = units.find(u => {
      const cid = u.character_id || u.characterId || '';
      return cid.toLowerCase().endsWith('_' + unitNameLower) || cid.toLowerCase().endsWith(unitNameLower);
    });
    if (hit) return hit.character_id || hit.characterId;
  }
  return null;
}

// Akzeptiert beide Unit-Shapes:
//   - Riot Match-V1 raw: { character_id, tier, itemNames }
//   - Hetzner-Cache:     { characterId, tier, items }
function unitItems(u) {
  return u.itemNames || u.items || [];
}
function unitCid(u) {
  return u.character_id || u.characterId || '';
}

/**
 * Klassifiziert ein Participant-Board in einen deterministischen Cluster-Key.
 *
 * @param {Object} participant - Match-V1-Participant-Shape (mit traits, units, augments, level)
 * @param {Object} [opts]
 * @param {number} [opts.currentSet=17] - Set fuer cost-map
 * @param {boolean} [opts.withAugmentSuffix=false] - Suffix `~<augSlug>` anhaengen (Aggregator-Mode)
 * @returns {{ clusterKey, primaryTrait, primaryTraitLevel, carryUnit, carryStar, compDefiningAugment, secondaryCarry, carryItems } | null}
 */
export function classifyComp(participant, opts = {}) {
  const { currentSet = CURRENT_SET, withAugmentSuffix = false } = opts;
  const { costMap, fragmentTraits } = loadBundleDerived(currentSet);
  // Set-genau, nicht global: Set 17 fuehrt TFT_Item_*, Set 18 DA_*.
  const damageItems = damageCarryItemsForSet(currentSet);

  // Fragment-Trait-Filter: Bundle-Ground-Truth vereinigt mit dem alten
  // Namensmuster. Begruendung an loadBundleDerived.
  const isFragmentTrait = (name) => /UniqueTrait$/.test(name || '') || fragmentTraits.has(name || '');

  const traits = (participant.traits || []).filter(
    t => (t.style ?? 0) > 0 && !isFragmentTrait(t.name),
  );
  if (traits.length === 0) return null;
  traits.sort((a, b) => {
    if ((b.style ?? 0) !== (a.style ?? 0)) return (b.style ?? 0) - (a.style ?? 0);
    if ((b.tier_current ?? 0) !== (a.tier_current ?? 0)) return (b.tier_current ?? 0) - (a.tier_current ?? 0);
    return (a.name || '').localeCompare(b.name || '');
  });
  const primaryTrait = traits[0];

  const units = participant.units || [];
  if (units.length === 0) return null;

  // 1) Hero-Augment override
  const heroCarryId = carryFromAugments(participant, units);
  let carry = heroCarryId ? units.find(u => unitCid(u) === heroCarryId) : null;

  // 2) Most damage-carry items
  if (!carry) {
    const byOffensiveItems = [...units]
      .map(u => {
        const items = unitItems(u);
        const offensive = items.filter(i => damageItems.has(i)).length;
        return { u, offensive, total: items.length };
      })
      .filter(x => x.offensive > 0)
      .sort((a, b) => {
        if (b.offensive !== a.offensive) return b.offensive - a.offensive;
        if (b.total !== a.total) return b.total - a.total;
        if ((b.u.tier ?? 1) !== (a.u.tier ?? 1)) return (b.u.tier ?? 1) - (a.u.tier ?? 1);
        return (b.u.rarity ?? 0) - (a.u.rarity ?? 0);
      });
    if (byOffensiveItems.length > 0) carry = byOffensiveItems[0].u;

    // 2b) Cost-Aware-Swap (Fast-8 4-Cost-Bevorzugung)
    if (carry && byOffensiveItems.length >= 2 && !heroCarryId) {
      const top1 = byOffensiveItems[0];
      const top2 = byOffensiveItems[1];
      const top1Cid = unitCid(top1.u);
      const top2Cid = unitCid(top2.u);
      const top1Cost = costMap.get(top1Cid) ?? 0;
      const top2Cost = costMap.get(top2Cid) ?? 0;
      const level = Number(participant.level || 0);
      const fastEight = level === 8;
      const lvlNineFillerCase = level === 9 && top1.offensive <= top2.offensive;
      // ACHTUNG: bewusst weiterhin das NAMENSMUSTER, nicht isFragmentTrait.
      //
      // Hier hat die Pruefung eine andere Bedeutung als beim Primary-Filter
      // oben. Dort geht es um "taugt der Trait als Comp-Name" — hier um "ist
      // der Traeger die intendierte Carry, also Finger weg vom Swap".
      //
      // Bei den *UniqueTrait-Traegern traegt diese Annahme. Bei GravesTrait
      // nicht: Graves ist ein 5-Koster und steht auf ~10 % der Boards, meist
      // als Filler. Wuerde er die Suppression ausloesen, blockierte er den
      // Cost-Aware-Swap genau in dessen Kern-Anwendungsfall (Level 9,
      // 5-Koster-Filler mit Items neben echtem 4-Koster-Carry).
      //
      // Die Divergenz zum Filter ist also gewollt und nicht Drift. Ob
      // GravesTrait hier mit soll, ist eine eigene Messung — siehe Backlog.
      const hasActiveUniqueTrait = (participant.traits || []).some(
        t => (t.style ?? 0) > 0 && /UniqueTrait$/.test(t.name || ''),
      );
      const dualCarry = top1.offensive >= 3 && top2.offensive >= 3;
      if ((fastEight || lvlNineFillerCase)
          && top1Cost === 5 && top2Cost === 4
          && top2.offensive >= top1.offensive
          && !hasActiveUniqueTrait
          && !dualCarry) {
        carry = top2.u;
      }
    }
  }

  // 3) Legacy fallback — most items total
  if (!carry) {
    const ranked = [...units].sort((a, b) => {
      const aItems = unitItems(a).length;
      const bItems = unitItems(b).length;
      if (bItems !== aItems) return bItems - aItems;
      if ((b.tier ?? 1) !== (a.tier ?? 1)) return (b.tier ?? 1) - (a.tier ?? 1);
      return (b.rarity ?? 0) - (a.rarity ?? 0);
    });
    carry = ranked[0];
  }
  const carryId = unitCid(carry);
  if (!carryId) return null;

  // Secondary-Carry-Detection (Threshold 3 damage items)
  const SECONDARY_MIN_DMG_ITEMS = 3;
  const secondaryCarry = units
    .map(u => {
      const cid = unitCid(u);
      if (!cid || cid === carryId) return null;
      const items = unitItems(u);
      const dmgItems = items.filter(i => damageItems.has(i)).length;
      return dmgItems >= SECONDARY_MIN_DMG_ITEMS ? { cid, dmgItems, tier: u.tier ?? 1 } : null;
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (b.dmgItems !== a.dmgItems) return b.dmgItems - a.dmgItems;
      return (b.tier ?? 1) - (a.tier ?? 1);
    })[0];

  const carryStar = carry.tier ?? 2;
  const augSlug = compDefiningAugmentSlug(participant.augments);

  // Two-Tanky-Augment-Detection ueber Unit-Duplicate (Match-V1 augments-Feld
  // ist seit 2026-06-15 leer; alte Cache-Rows haben augments aber persistiert).
  const hasUnitDuplicate = (() => {
    const counts = new Map();
    for (const u of units) {
      const cid = unitCid(u);
      if (!cid) continue;
      if (!/^TFT\d+_[A-Z]/.test(cid)) continue;
      counts.set(cid, (counts.get(cid) || 0) + 1);
    }
    for (const n of counts.values()) if (n >= 2) return true;
    return false;
  })();
  const effectiveAug = augSlug || (hasUnitDuplicate ? 'TwoTanky' : null);
  const augSuffix = withAugmentSuffix && effectiveAug ? `~${effectiveAug}` : '';

  const clusterKey = `${primaryTrait.name}@${primaryTrait.tier_current ?? 0}_${carryId}${augSuffix}`;

  return {
    clusterKey,
    primaryTrait: primaryTrait.name,
    primaryTraitLevel: primaryTrait.tier_current ?? 0,
    carryUnit: carryId,
    carryStar,
    compDefiningAugment: augSlug,
    secondaryCarry: secondaryCarry?.cid || null,
    carryItems: unitItems(carry).filter(Boolean).sort(),
  };
}
