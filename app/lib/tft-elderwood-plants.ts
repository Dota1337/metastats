// Elderwood-Pflanzen (Set 18): Steinrindenbaum, Lebensblume, Tiefenwald-
// Beschuetzer. Riot fuehrt sie nicht als Champions — sie stehen nur als
// Zusatz-Einheiten im Bundle (scripts/fetch-tft-assets.mjs, EXTRA_UNITS) mit
// Kosten 0 und ohne Synergie. Eine Quelle fuer Comp-Builder, Aufstellungs-
// Bretter (tft-comp-board.ts) und die Companion-Lookups.
//
// Regel laut Trait-Text DA_18_Elderwood, je Stufe (3/5/7/9/11):
//   Stufe 1  1 Steinrindenbaum + 1 Lebensblume
//   Stufe 2  ein zweiter Steinrindenbaum
//   Stufe 3  der Tiefenwald-Beschuetzer
//   Stufe 4  Pflanzen 2★, Stufe 5 3★ („star up to" — der Builder zeigt den
//            Hoechstwert; ob Pflanzen im Spiel schrittweise aufsteigen, ist
//            ungeprueft, Companion-Daten haben bisher kein Brett ab Stufe 9)
// Die Schwellen kommen aus dem Bundle, nur die Zuordnung je Stufe steht hier.
// Pflanzen belegen keinen Brettplatz und zaehlen fuer keine Synergie (MetaTFT-
// Early-Boards: 5 Champions + 3 Pflanzen auf Stufe 5, gemessen 18.10.2026).
//
// Namen: Uebersetzungsdatei s18 von tactics.tools (Stand 18.10.2026, alle 6
// Sprachen gegengelesen). Die uebrigen Unit-Namen der Seite sind Englisch.
//
// Absichtlich ohne Imports: das Modul landet im Builder, in drei Routen und
// in der App; ein Import zoege fremde Abhaengigkeiten in die Schnittstellen-
// Karte (infra/api-map.json).

export type PlantLang = 'de' | 'en' | 'ko' | 'zh' | 'es' | 'fr';

/** Was das Modul vom Bundle braucht — TftAssetsBundle passt, der Server reicht einen Auszug. */
export interface PlantBundle {
  champions?: Record<string, { traits?: readonly string[] } | null | undefined>;
  traits?: Record<string, { name?: string; tiers?: ReadonlyArray<{ minUnits?: number | null }> } | null | undefined>;
}

interface PlantDef {
  id: string;
  /** Hoechstzahl je Stufen-Index (0 = unterste Stufe). */
  copies: readonly number[];
  names: Readonly<Record<PlantLang, string>>;
}

interface PlantSetDef {
  trait: string;
  emblem: string;
  plants: readonly PlantDef[];
  /** Pflanzen-Stern je Stufen-Index. */
  stars: readonly number[];
}

const SETS: readonly PlantSetDef[] = [
  {
    trait: 'DA_18_Elderwood',
    emblem: 'DA_18_EmblemElderwood',
    plants: [
      {
        id: 'DA_Elderwood18_StonebarkTree',
        copies: [1, 2, 2, 2, 2],
        names: { en: 'Stonebark Tree', de: 'Steinrindenbaum', ko: '돌껍질 나무', zh: '石皮树', es: 'Árbol de rocorteza', fr: 'Rochécorce' },
      },
      {
        id: 'DA_Elderwood18_Lifeblossom',
        copies: [1, 1, 1, 1, 1],
        names: { en: 'Lifebloom', de: 'Lebensblume', ko: '생명꽃', zh: '生命花', es: 'Vitalbrote', fr: 'Fleur de vie' },
      },
      {
        id: 'DA_Elderwood18_Protector',
        copies: [0, 0, 1, 1, 1],
        names: { en: 'Deepwood Protector', de: 'Tiefenwald-Beschützer', ko: '깊은숲 수호자', zh: '深林守卫', es: 'Protector de bosquejondo', fr: 'Protecteur de Fonds-de-bois' },
      },
    ],
    stars: [1, 1, 1, 2, 3],
  },
];

// Notschalter: false = keine Leiste, keine Pflanzen auf Server-Brettern, und
// trimPlants laesst gesetzte Pflanzen stehen statt sie zu loeschen.
export const PLANTS_ENABLED = true;

// Comp-Bretter: das Elderwood-Emblem zaehlt mit, wenn es in mindestens so
// vielen Spielen der Comp steckt (eigene Daten, je Spiel gezaehlt).
export const EMBLEM_SHARE_MIN = 0.5;

const PLANT_BY_ID = new Map<string, PlantDef>(SETS.flatMap(s => s.plants.map(p => [p.id, p] as [string, PlantDef])));

export function isElderwoodPlant(id: string | null | undefined): boolean {
  return !!id && PLANT_BY_ID.has(id);
}

export function plantNames(id: string): Readonly<Record<PlantLang, string>> | null {
  return PLANT_BY_ID.get(id)?.names ?? null;
}

/** Name in der Sprache der Seite; null fuer alles, was keine Pflanze ist. */
export function plantName(id: string, lang: string): string | null {
  const names = PLANT_BY_ID.get(id)?.names;
  if (!names) return null;
  return (names as Record<string, string>)[lang] ?? names.en;
}

export interface PlantRules {
  /** Anzeigename der Synergie (Schluessel in boardTraitCounts). */
  traitName: string;
  traitId: string;
  emblem: string;
  mins: readonly number[];
  plants: readonly PlantDef[];
  stars: readonly number[];
}

const rulesCache = new WeakMap<object, PlantRules | null>();

/**
 * Regeln des Bundles, oder null: Notschalter aus, kein Bundle, oder der Trait
 * fehlt bzw. hat nicht genau so viele Stufen wie hier zugeordnet (Set-Wechsel,
 * geaenderter Trait) — dann lieber keine Pflanzen als falsche.
 */
export function plantRules(bundle: PlantBundle | null | undefined): PlantRules | null {
  if (!PLANTS_ENABLED || !bundle) return null;
  if (rulesCache.has(bundle)) return rulesCache.get(bundle)!;
  let out: PlantRules | null = null;
  for (const s of SETS) {
    const t = bundle.traits?.[s.trait];
    const mins = (t?.tiers || []).map(x => Number(x?.minUnits));
    if (!t?.name || mins.length !== s.stars.length || mins.some(m => !(m > 0))) continue;
    out = { traitName: t.name, traitId: s.trait, emblem: s.emblem, mins, plants: s.plants, stars: s.stars };
    break;
  }
  rulesCache.set(bundle, out);
  return out;
}

/** Index der erreichten Stufe, -1 = Synergie nicht aktiv. */
export function plantTier(rules: PlantRules, count: number): number {
  for (let i = rules.mins.length - 1; i >= 0; i--) if (count >= rules.mins[i]) return i;
  return -1;
}

/** Wie viele Pflanzen je Art bei dieser Elderwood-Zahl erlaubt sind (nur Arten > 0). */
export function plantAllowance(rules: PlantRules, count: number): Map<string, number> {
  const tier = plantTier(rules, count);
  const out = new Map<string, number>();
  if (tier < 0) return out;
  for (const p of rules.plants) {
    const n = p.copies[tier] ?? 0;
    if (n > 0) out.set(p.id, n);
  }
  return out;
}

export function plantStar(rules: PlantRules, count: number): number {
  const tier = plantTier(rules, count);
  return tier < 0 ? 1 : rules.stars[tier] ?? 1;
}

/**
 * Ueberzaehlige Pflanzen entfernen (wie im Spiel, wenn die Stufe sinkt). Je
 * Art bleiben die zuerst gesetzten — spaeter gesetzte stehen weiter hinten im
 * Array. Ohne Regeln (Bundle noch nicht da, Notschalter) bleibt alles stehen.
 * Gibt dasselbe Array zurueck, wenn nichts wegfaellt.
 */
export function trimPlants<P extends { characterId: string }>(placements: P[], rules: PlantRules | null, count: number): P[] {
  if (!rules) return placements;
  const allowed = plantAllowance(rules, count);
  const used = new Map<string, number>();
  let dropped = false;
  const out = placements.filter(p => {
    if (!isElderwoodPlant(p.characterId)) return true;
    const n = (used.get(p.characterId) || 0) + 1;
    used.set(p.characterId, n);
    if (n <= (allowed.get(p.characterId) || 0)) return true;
    dropped = true;
    return false;
  });
  return dropped ? out : placements;
}

/** Elderwood-Zahl einer Units-Liste aus dem Bundle (jeder Champion einmal, ohne Embleme). */
export function elderwoodCount(rules: PlantRules, bundle: PlantBundle, units: readonly string[]): number {
  let n = 0;
  for (const id of new Set(units)) {
    const traits = bundle.champions?.[id]?.traits || [];
    if (traits.some(t => t === rules.traitId || t === rules.traitName || bundle.traits?.[t]?.name === rules.traitName)) n++;
  }
  return n;
}

/**
 * +1, wenn das Elderwood-Emblem in mindestens EMBLEM_SHARE_MIN der Spiele der
 * Comp steckt. Nur je Spiel gezaehlte Anteile (basis 'games'); der Uebergang
 * aus Kopien ('copies') ist kein Anteil und gibt nichts.
 */
export function emblemBonus(
  rules: PlantRules,
  emblems: { basis?: string; rows?: ReadonlyArray<{ item: string; share: number | null }> } | null | undefined,
): number {
  if (emblems?.basis !== 'games') return 0;
  const row = emblems.rows?.find(r => r.item === rules.emblem);
  return row && typeof row.share === 'number' && row.share >= EMBLEM_SHARE_MIN ? 1 : 0;
}

/** Pflanzen eines Comp-Bretts (mit Kopien) aus seinen Units plus Emblem-Bonus. */
export function boardPlantIds(rules: PlantRules, bundle: PlantBundle, units: readonly string[], bonus = 0): string[] {
  const out: string[] = [];
  for (const [id, n] of plantAllowance(rules, elderwoodCount(rules, bundle, units) + bonus)) {
    for (let i = 0; i < n; i++) out.push(id);
  }
  return out;
}

/** Alle Pflanzen-IDs der Regeln (z. B. fuer Lookups und Feld-Abfragen). */
export function plantIds(rules: PlantRules): string[] {
  return rules.plants.map(p => p.id);
}
