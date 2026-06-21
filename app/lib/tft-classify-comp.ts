// TS-Mirror von scripts/lib/tft-classify-comp.mjs — die mjs-Datei ist
// Source-of-Truth (wird vom Aggregator + Cache-Writer auf der Hetzner-Box
// importiert). Bei Aenderungen BEIDE Dateien synchron halten.
//
// Diese TS-Version laeuft im Vercel-Bundle (specialty/route.ts, onetricks,
// marktwert) und muss bit-identisch zu mjs klassifizieren — sonst kommt der
// Klassifikations-Drift wieder zurueck, den wir gerade unifiziert haben.
//
// costMap-Loading laeuft hier ueber das gebundelte public/tft-assets-<set>.json
// (das bei Build-Time im Vercel-Bundle landet), waehrend die mjs-Version das
// File zur Runtime liest. Format und Inhalt sind identisch.

import { DAMAGE_CARRY_ITEMS } from './tft-item-classes';
import { compDefiningAugmentSlug } from './tft-comp-defining-augments';

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

export function classifyComp(participant: ClassifyParticipant, opts: ClassifyOpts = {}): ClassifyResult | null {
  const { withAugmentSuffix = false, costMap } = opts;

  const traits = (participant.traits || []).filter(
    t => (t.style ?? 0) > 0 && !/UniqueTrait$/.test(t.name || ''),
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
        const offensive = items.filter(i => DAMAGE_CARRY_ITEMS.has(i)).length;
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
    if (carry && byOffensiveItems.length >= 2 && !heroCarryId && costMap) {
      const top1 = byOffensiveItems[0];
      const top2 = byOffensiveItems[1];
      const top1Cost = costMap.get(unitCid(top1.u)) ?? 0;
      const top2Cost = costMap.get(unitCid(top2.u)) ?? 0;
      const level = Number(participant.level || 0);
      const fastEight = level === 8;
      const lvlNineFillerCase = level === 9 && top1.offensive <= top2.offensive;
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
      const dmgItems = items.filter(i => DAMAGE_CARRY_ITEMS.has(i)).length;
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
      if (!/^TFT\d+_[A-Z]/.test(cid)) continue;
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
