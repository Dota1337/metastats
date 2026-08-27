// TS-Mirror von scripts/lib/tft-classify-comp.mjs — die mjs-Datei ist
// Source-of-Truth (wird vom Aggregator + Cache-Writer auf der Hetzner-Box
// importiert). Bei Aenderungen BEIDE Dateien synchron halten.
//
// Diese TS-Version laeuft im Vercel-Bundle (specialty/route.ts, onetricks,
// marktwert) und muss bit-identisch zu mjs klassifizieren — sonst kommt der
// Klassifikations-Drift wieder zurueck, den wir gerade unifiziert haben.
//
// costMap wird hier — wie in der mjs — zur Runtime aus public/tft-assets-<set>.json
// via fs gelesen (App-Router Node-Runtime, Pattern wie comps/route.ts:25-41).
// Vor dem Fix 2026-06-28 war das NICHT implementiert: costMap kam nur aus opts,
// kein Caller uebergab sie -> der Cost-Aware-Swap lief auf dem Vercel-Read-Pfad
// NIE, waehrend die mjs (Write-Pfad) ihn ausfuehrte -> carryUnit/clusterKey
// divergierten im Fast-8/9-5-vs-4-Cost-Korridor (Audit D1).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { damageCarryItemsForSet } from './tft-item-classes';
import { compDefiningAugmentSlug } from './tft-comp-defining-augments';
import { CURRENT_SET } from './current-set';

export interface ClassifyTrait {
  name?: string;
  style?: number;
  // Akzeptiert beide Casings — Match-V1 raw nutzt snake_case (tier_current),
  // processed/Hetzner-output ist oft camelCase (tierCurrent).
  tier_current?: number;
  tierCurrent?: number;
  num_units?: number;
  numUnits?: number;
}

function traitTier(t: ClassifyTrait): number {
  return t.tier_current ?? t.tierCurrent ?? 0;
}
function traitNumUnits(t: ClassifyTrait): number {
  return t.num_units ?? t.numUnits ?? 0;
}
export interface ClassifyUnit {
  character_id?: string;
  characterId?: string;
  tier?: number;
  rarity?: number;
  items?: string[];
  itemNames?: string[];
}
export interface ClassifyParticipant {
  traits?: ClassifyTrait[];
  units?: ClassifyUnit[];
  augments?: string[];
  level?: number;
}

export interface ClassifyOpts {
  currentSet?: number;
  withAugmentSuffix?: boolean;
  costMap?: Map<string, number>;
}

export interface ClassifyResult {
  clusterKey: string;
  primaryTrait: string;
  primaryTraitLevel: number;
  carryUnit: string;
  carryStar: number;
  compDefiningAugment: string | null;
  secondaryCarry: string | null;
  carryItems: string[];
}

function unitItems(u: ClassifyUnit): string[] {
  return u.itemNames || u.items || [];
}
function unitCid(u: ClassifyUnit): string {
  return u.character_id || u.characterId || '';
}

function carryFromAugments(participant: ClassifyParticipant, units: ClassifyUnit[]): string | null {
  const augs = participant.augments || [];
  if (augs.length === 0) return null;
  for (const a of augs) {
    if (!a) continue;
    const m = /^TFT\d+_Augment_(.+?)(?:Carry|GodAugment|HeroAugment)$/i.exec(a);
    if (!m) continue;
    const unitNameLower = m[1].toLowerCase();
    const hit = units.find(u => {
      const cid = unitCid(u).toLowerCase();
      return cid.endsWith('_' + unitNameLower) || cid.endsWith(unitNameLower);
    });
    if (hit) return unitCid(hit);
  }
  return null;
}

// Runtime-Mirror von tft-classify-comp.mjs::loadCostMap — identische Quelle,
// identisches Caching. App-Router-Default ist Node-Runtime (kein Edge), fs ist
// erlaubt. Bei leerem/fehlendem Bundle: leere Map cachen (Swap wird dann No-Op).
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
interface BundleDerived {
  costMap: Map<string, number>;
  fragmentTraits: Set<string>;
  championIds: Set<string>;
}
const _bundleCache = new Map<number, BundleDerived>();
// Fehlversuche werden NICHT dauerhaft gecacht, sondern nur kurz gedrosselt.
// Grund: `_bundleCache.set` stand frueher ausserhalb des `try` — ein einziger
// Request auf ein Set, dessen public/tft-assets-<set>.json noch nicht deployed
// war (Set-Flip!), schrieb den Fail-Safe-Zustand prozesslebenslang fest. Der
// spaetere Deploy heilte das nicht, nur ein Neustart. Jetzt wird nach dem
// Cooldown erneut gelesen, und der erste Fehlschlag pro Set meldet sich laut.
const _bundleFail = new Map<number, number>();
const BUNDLE_RETRY_MS = 60_000;
function loadBundleDerived(setNumber: number): BundleDerived {
  const set = setNumber || CURRENT_SET;
  const cached = _bundleCache.get(set);
  if (cached) return cached;
  const derived: BundleDerived = { costMap: new Map(), fragmentTraits: new Set(), championIds: new Set() };
  const lastFail = _bundleFail.get(set);
  if (lastFail != null && Date.now() - lastFail < BUNDLE_RETRY_MS) return derived;
  try {
    const bundle = JSON.parse(
      readFileSync(resolve(process.cwd(), `public/tft-assets-${set}.json`), 'utf8'),
    ) as {
      champions?: Record<string, { cost?: number }>;
      traits?: Record<string, { tiers?: { minUnits?: number }[] }>;
    };
    for (const [cid, ch] of Object.entries(bundle.champions || {})) {
      if (typeof ch?.cost === 'number') derived.costMap.set(cid, ch.cost);
      derived.championIds.add(cid);
    }
    for (const [name, tr] of Object.entries(bundle.traits || {})) {
      const tiers = tr?.tiers;
      if (Array.isArray(tiers) && tiers.length === 1 && tiers[0]?.minUnits === 1) {
        derived.fragmentTraits.add(name);
      }
    }
  } catch (err) {
    if (!_bundleFail.has(set)) {
      console.error(`[classify] public/tft-assets-${set}.json nicht lesbar (${err instanceof Error ? err.message : String(err)}) — Fail-Safe ohne Kosten-Map/Fragment-Traits, neuer Versuch in ${BUNDLE_RETRY_MS / 1000}s.`);
    }
    _bundleFail.set(set, Date.now());
    return derived;
  }
  _bundleFail.delete(set);
  _bundleCache.set(set, derived);
  return derived;
}

// Set-agnostischer Einheiten-Test fuer API-Eingaben.
//
// Bis Set 17 hiessen alle Champion-IDs TFT<set>_<Name>; mehrere Routen haben
// deshalb gegen /^TFTd+_/ validiert. Set 18 bricht das: 74 der 91 IDs heissen
// DA_* (gemessen am Bundle 2026-08-26), die Routen haben die Eingabe damit
// komplett verworfen. Statt eines Namensmusters fragen wir jetzt das Bundle
// des Sets — das ist ohnehin die Wahrheit ueber existierende Einheiten.
//
// Der Formtest bleibt davor stehen: er haelt Unsinn und Sonderzeichen raus,
// auch wenn das Bundle gerade nicht lesbar ist. Faellt der Read aus, ist
// championIds leer — dann gilt bewusst nur die Form, denn ein leerer Set
// wuerde sonst JEDE Anfrage abweisen (Set-Flip vor dem Deploy des Bundles).
// Mehrteilig: Set-18-IDs haben zwei Unterstriche (DA_18_Ahri), aeltere einen
const UNIT_ID_SHAPE = /^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+$/;
export function isKnownUnitId(id: string, setNumber: number = CURRENT_SET): boolean {
  if (typeof id !== 'string' || !UNIT_ID_SHAPE.test(id)) return false;
  const ids = loadBundleDerived(setNumber).championIds;
  return ids.size === 0 || ids.has(id);
}

// Exportiert, weil derselbe Test an zwei Stellen gebraucht wird: hier beim
// Klassifizieren (Write-Pfad) und in app/api/tft/comps/route.ts beim
// Ausblenden alter Fragment-Cluster (Read-Pfad). Zwei Kopien waeren genau der
// Drift, den wir bei UniqueTrait schon einmal hatten.
export function isFragmentTraitName(name?: string, setNumber: number = CURRENT_SET): boolean {
  if (!name) return false;
  return /UniqueTrait$/.test(name) || loadBundleDerived(setNumber).fragmentTraits.has(name);
}

export function classifyComp(participant: ClassifyParticipant, opts: ClassifyOpts = {}): ClassifyResult | null {
  const { currentSet = CURRENT_SET, withAugmentSuffix = false, costMap: costMapOverride } = opts;
  // Self-load the cost map (D1): the swap was dead because no caller passed it.
  const derived = loadBundleDerived(currentSet);
  const costMap = costMapOverride ?? derived.costMap;
  // Set-genau, nicht global: Set 17 fuehrt TFT_Item_*, Set 18 DA_*.
  const damageItems = damageCarryItemsForSet(currentSet);

  // Fragment-Trait-Filter: Bundle-Ground-Truth vereinigt mit dem alten
  // Namensmuster. Begruendung an loadBundleDerived. Bewusst NICHT an
  // costMapOverride gekoppelt — der Override ersetzt nur die Kosten.
  const traits = (participant.traits || []).filter(
    t => (t.style ?? 0) > 0 && !isFragmentTraitName(t.name, currentSet),
  );
  if (traits.length === 0) return null;
  traits.sort((a, b) => {
    if ((b.style ?? 0) !== (a.style ?? 0)) return (b.style ?? 0) - (a.style ?? 0);
    if (traitTier(b) !== traitTier(a)) return traitTier(b) - traitTier(a);
    return (a.name || '').localeCompare(b.name || '');
  });
  const primaryTrait = traits[0];

  const units = participant.units || [];
  if (units.length === 0) return null;

  // 1) Hero-Augment override
  const heroCarryId = carryFromAugments(participant, units);
  let carry: ClassifyUnit | undefined = heroCarryId ? units.find(u => unitCid(u) === heroCarryId) : undefined;

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

    // 2b) Cost-Aware-Swap
    if (carry && byOffensiveItems.length >= 2 && !heroCarryId) {
      const top1 = byOffensiveItems[0];
      const top2 = byOffensiveItems[1];
      const top1Cost = costMap.get(unitCid(top1.u)) ?? 0;
      const top2Cost = costMap.get(unitCid(top2.u)) ?? 0;
      const level = Number(participant.level || 0);
      const fastEight = level === 8;
      const lvlNineFillerCase = level === 9 && top1.offensive <= top2.offensive;
      // ACHTUNG: bewusst weiterhin das NAMENSMUSTER, nicht isFragmentTrait.
      // Andere Bedeutung als beim Primary-Filter oben: hier geht es um "ist der
      // Traeger die intendierte Carry, also Finger weg vom Swap". Bei
      // GravesTrait traegt diese Annahme nicht (5-Koster-Filler auf ~10 % der
      // Boards) — er wuerde den Swap in dessen Kernfall blockieren. Die
      // Divergenz ist gewollt, nicht Drift. Details in der mjs.
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

  // 3) Legacy fallback
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
  if (!carry) return null;
  const carryId = unitCid(carry);
  if (!carryId) return null;

  const SECONDARY_MIN_DMG_ITEMS = 3;
  const secondaryCarry = units
    .map(u => {
      const cid = unitCid(u);
      if (!cid || cid === carryId) return null;
      const items = unitItems(u);
      const dmgItems = items.filter(i => damageItems.has(i)).length;
      return dmgItems >= SECONDARY_MIN_DMG_ITEMS ? { cid, dmgItems, tier: u.tier ?? 1 } : null;
    })
    .filter((x): x is { cid: string; dmgItems: number; tier: number } => x !== null)
    .sort((a, b) => {
      if (b.dmgItems !== a.dmgItems) return b.dmgItems - a.dmgItems;
      return (b.tier ?? 1) - (a.tier ?? 1);
    })[0];

  const carryStar = carry.tier ?? 2;
  const augSlug = compDefiningAugmentSlug(participant.augments);

  const hasUnitDuplicate = (() => {
    const counts = new Map<string, number>();
    for (const u of units) {
      const cid = unitCid(u);
      if (!cid) continue;
      // Set-Praefix + GROSSbuchstabe = echte Unit; Summons sind lowercase.
      // `DA` deckt Set 18 ab (DA_18_Ahri, DA_Krug18).
      if (!/^(?:TFT\d+|Set\d+|DA)_(?:\d+_)?[A-Z]/.test(cid)) continue;
      counts.set(cid, (counts.get(cid) || 0) + 1);
    }
    for (const n of counts.values()) if (n >= 2) return true;
    return false;
  })();
  const effectiveAug = augSlug || (hasUnitDuplicate ? 'TwoTanky' : null);
  const augSuffix = withAugmentSuffix && effectiveAug ? `~${effectiveAug}` : '';

  const primaryTier = traitTier(primaryTrait);
  const clusterKey = `${primaryTrait.name}@${primaryTier}_${carryId}${augSuffix}`;

  return {
    clusterKey,
    primaryTrait: primaryTrait.name || '',
    primaryTraitLevel: primaryTier,
    carryUnit: carryId,
    carryStar,
    compDefiningAugment: augSlug,
    secondaryCarry: secondaryCarry?.cid || null,
    carryItems: unitItems(carry).filter(Boolean).sort(),
  };
}
