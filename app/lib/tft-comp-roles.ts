// Rollen in einer Comp (Carries, Tank-Traeger, gezeigte Items) und das
// Zusammenlegen von Zwei-Carry-Familien. Reine Funktionen — laufen in der
// Listen-Seite (Browser) und in der Detail-Route (Server) identisch.
//
// User-Entscheid 2026-09-27 („Code: passt · 1. Zwei · 2. 15% · 3. Passt, lege
// die Comps dann zusammen wie bspw. Soraka + Zyra"), Plan in
// .claude/plan-current.md. Carry wird an den Items erkannt, nicht mehr am
// Cluster-Key: der Key traegt nur EINE Unit und lag bei Zwei-Carry-Comps oft
// auf der falschen.

import { damageCarryItemsForSet, defensiveItemsForSet } from './tft-item-classes';

export const CARRY_MIN_GAMES = 30;
export const CARRY_MIN_PRESENCE = 0.5;   // Anteil der Comp-Spiele mit dieser Unit
export const CARRY_MIN_RATE = 0.6;       // Carry-Item je Spiel
export const CARRY_MIN_SHARE = 0.6;      // Anteil Carry-Items am Item-Volumen der Unit
export const TANK_MIN_RATE = 0.5;        // Tank-Items je Spiel
export const MAX_NAMED_CARRIES = 2;
// Haupt-Carry (User 2026-09-28, Spellweaver: Veigar vor LeBlanc): wer je
// Comp-Spiel die meisten Carry-Items traegt. Liegt der Key-Carry weniger als
// 10 % dahinter, bleibt er vorne, damit knappe Paare nicht je Region kippen.
export const KEY_CARRY_MARGIN = 1.1;
// Item-Traeger (User 2026-09-27: „Erweitere es auf 3 oder 4 … Fülle das immer
// auf 3 auf"): Units, die in dieser Comp regelmaessig fertige Items tragen.
export const ITEM_CARRIER_MIN_PRESENCE = 0.4;
export const ITEM_CARRIER_MIN_LOAD = 0.9;      // fertige Items je Spiel (Emblems zaehlen, Komponenten nicht)
export const ITEM_CARRIER_FILL_LOAD = 0.6;     // Auffuellen, solange eine Comp weniger als 3 hat
export const ITEM_CARRIER_MIN = 3;
export const ITEM_CARRIER_MAX = 4;
// Core/Flex (User 2026-10-10: „welche Units Core und Flex sind … mit einer
// Umrandung"): Core = Unit steht in mindestens 75 % der Spiele dieser Comp auf
// dem Endbrett, alles darunter ist Flex. Gemessen an Spielen mit der Unit
// (gamesWithUnit), nicht an Kopien — Kopien zaehlen bei ×2-Units doppelt.
export const CORE_MIN_PRESENCE = 0.75;
export const MERGE_MIN_JACCARD = 0.7;    // Ueberlappung der Kern-Units zweier Familien

export interface RoleItem { apiName: string; count: unknown }
export interface RoleUnit {
  characterId: string;
  count?: unknown;
  gamesWithUnit?: unknown;
  carryItemGames?: unknown;       // alt: Kopien mit Schadens-Item (ohne HoJ/EoN)
  carryItemGamesAll?: unknown;    // neu (Sammler ab 2026-09-27): Spiele mit Carry-Item inkl. HoJ/EoN
  tankItemGames?: unknown;        // neu: Tank-Items je Spiel, aufsummiert
  topItems?: RoleItem[];
}

export type IsComponent = (apiName: string) => boolean;
export interface RoleOptions { set?: number; isComponent?: IsComponent; keyCarry?: string | null }

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const unitGames = (u: RoleUnit): number => num(u.gamesWithUnit) || num(u.count);

// Hand of Justice und Edge of Night stehen im Tank-Topf (classifyBuildStyle
// braucht das so), liegen aber real nur auf Carries (Kha'Zix, Diana).
const CARRY_DEFENSIVE = /(HandOfJustice|EdgeOfNight)$/;

const setCache = new Map<string, { carry: Set<string>; tank: Set<string> }>();
export function roleItemSets(setNumber?: number): { carry: Set<string>; tank: Set<string> } {
  const k = String(setNumber ?? 'all');
  let hit = setCache.get(k);
  if (!hit) {
    const carry = new Set(damageCarryItemsForSet(setNumber));
    const tank = new Set<string>();
    for (const it of defensiveItemsForSet(setNumber)) {
      if (CARRY_DEFENSIVE.test(it)) carry.add(it);
      else tank.add(it);
    }
    hit = { carry, tank };
    setCache.set(k, hit);
  }
  return hit;
}

export interface UnitRoleStats {
  characterId: string;
  games: number;
  presence: number;
  carryRate: number;
  carryShare: number;
  tankRate: number;
  itemLoad: number;    // fertige Items je Spiel dieser Unit
  carryVolume: number; // Carry-Items je Comp-Spiel
}

export function unitRoleStats(u: RoleUnit, familyGames: number, opts: RoleOptions = {}): UnitRoleStats {
  const { carry, tank } = roleItemSets(opts.set);
  const isComp = opts.isComponent ?? (() => false);
  const games = unitGames(u);
  let carryVol = 0, tankVol = 0, allVol = 0, carryDefVol = 0;
  for (const it of u.topItems || []) {
    if (!it?.apiName || isComp(it.apiName)) continue;
    const c = num(it.count);
    allVol += c;
    if (carry.has(it.apiName)) {
      carryVol += c;
      if (CARRY_DEFENSIVE.test(it.apiName)) carryDefVol += c;
    } else if (tank.has(it.apiName)) {
      tankVol += c;
    }
  }
  // Exaktes Feld, sobald der Sammler es liefert; sonst Untergrenze aus dem
  // alten Feld (ohne HoJ/EoN) bzw. aus den gespeicherten Top-Items.
  const exactCarry = num(u.carryItemGamesAll);
  const carryRate = games > 0
    ? Math.min(1, exactCarry > 0 ? exactCarry / games : Math.max(num(u.carryItemGames), carryDefVol) / games)
    : 0;
  const tankRate = games > 0 ? (u.tankItemGames != null ? num(u.tankItemGames) : tankVol) / games : 0;
  return {
    characterId: u.characterId,
    games,
    presence: familyGames > 0 ? games / familyGames : 0,
    carryRate,
    carryShare: allVol > 0 ? carryVol / allVol : 0,
    tankRate,
    itemLoad: games > 0 ? allVol / games : 0,
    carryVolume: familyGames > 0 ? carryVol / familyGames : 0,
  };
}

export interface CompRoles {
  carries: string[];   // alle Carries, staerkster zuerst
  tanks: string[];
  // Units, an denen Items gezeigt werden; fehlt das Feld: Carries + Tanks.
  itemCarriers?: string[];
}

// Bis zu vier Units mit >= 0,9 fertigen Items je Spiel, meiste Items zuerst.
// Sind es weniger als drei, kommen Units mit >= 0,6 dazu, bis drei erreicht
// sind. Wer darunter liegt, bekommt keine Items angedichtet.
function pickItemCarriers(stats: readonly UnitRoleStats[]): string[] {
  const pool = stats
    .filter(s => s.games >= CARRY_MIN_GAMES && s.presence >= ITEM_CARRIER_MIN_PRESENCE)
    .sort((a, b) => b.itemLoad - a.itemLoad || b.games - a.games || a.characterId.localeCompare(b.characterId));
  const strong = pool.filter(s => s.itemLoad >= ITEM_CARRIER_MIN_LOAD).slice(0, ITEM_CARRIER_MAX);
  if (strong.length >= ITEM_CARRIER_MIN) return strong.map(s => s.characterId);
  return pool.filter(s => s.itemLoad >= ITEM_CARRIER_FILL_LOAD).slice(0, ITEM_CARRIER_MIN).map(s => s.characterId);
}

export function computeRoles(
  units: readonly RoleUnit[] | null | undefined,
  familyGames: number,
  opts: RoleOptions = {},
): CompRoles {
  const stats = (units || []).filter(u => u?.characterId).map(u => unitRoleStats(u, familyGames, opts));
  const carryStats = stats
    .filter(s => s.games >= CARRY_MIN_GAMES && s.presence >= CARRY_MIN_PRESENCE
      && s.carryRate >= CARRY_MIN_RATE && s.carryShare >= CARRY_MIN_SHARE)
    .sort((a, b) => b.carryVolume - a.carryVolume || b.games - a.games);
  const key = carryStats.find(s => s.characterId === opts.keyCarry);
  if (key && key !== carryStats[0] && carryStats[0].carryVolume < key.carryVolume * KEY_CARRY_MARGIN) {
    carryStats.splice(carryStats.indexOf(key), 1);
    carryStats.unshift(key);
  }
  const carries = carryStats.map(s => s.characterId);
  const carrySet = new Set(carries);
  const tanks = stats
    .filter(s => !carrySet.has(s.characterId) && s.tankRate >= TANK_MIN_RATE)
    .map(s => s.characterId);
  return { carries, tanks, itemCarriers: pickItemCarriers(stats) };
}

// Name der Comp: hoechstens zwei Carries; keiner erkannt → der Carry aus dem Key.
export function namedCarries(roles: CompRoles | null | undefined, keyCarry: string | null | undefined): string[] {
  const named = (roles?.carries || []).slice(0, MAX_NAMED_CARRIES);
  if (named.length > 0) return named;
  return keyCarry ? [keyCarry] : [];
}

// Items, die an einer Unit gezeigt werden: nur an Item-Traegern, nur fertige
// Items, die haeufigsten zuerst und immer bis `max` aufgefuellt, soweit die
// Comp so viele verschiedene fertige Items fuer diese Unit kennt.
export function shownItems<T extends RoleItem>(
  u: RoleUnit & { topItems?: T[] },
  roles: CompRoles,
  isComponent: IsComponent = () => false,
  max = 3,
): T[] {
  const holders = roles.itemCarriers ?? [...roles.carries, ...roles.tanks];
  if (!holders.includes(u.characterId)) return [];
  if (unitGames(u) <= 0) return [];
  return ((u.topItems || []) as T[])
    .filter(it => it?.apiName && !isComponent(it.apiName) && num(it.count) > 0)
    .sort((a, b) => num(b.count) - num(a.count))
    .slice(0, max);
}

export type CoreFlexKind = 'core' | 'flex';

// Core oder Flex einer Unit in einer Comp mit `games` Spielen. Zaehler und
// Nenner muessen aus denselben Zeilen stammen (Liste: tft-comp-families.ts,
// Comp-DNA: Detailseite). null = keine Spiele.
export function unitPresence(u: RoleUnit, games: number): number | null {
  return games > 0 ? unitGames(u) / games : null;
}

export function coreFlexKind(u: RoleUnit, games: number): CoreFlexKind | null {
  const p = unitPresence(u, games);
  if (p == null) return null;
  return p >= CORE_MIN_PRESENCE ? 'core' : 'flex';
}

export function coreFlexMap(units: readonly RoleUnit[] | null | undefined, games: number): Record<string, CoreFlexKind> {
  const out: Record<string, CoreFlexKind> = {};
  for (const u of units || []) {
    const k = u?.characterId ? coreFlexKind(u, games) : null;
    if (k) out[u.characterId] = k;
  }
  return out;
}

// Units mehrerer Varianten zu einer Family-Sicht aufsummieren.
export function sumUnits(lists: ReadonlyArray<readonly RoleUnit[] | null | undefined>): RoleUnit[] {
  const by = new Map<string, { count: number; gamesWithUnit: number; carryItemGames: number;
    carryItemGamesAll: number; tankItemGames: number | null; items: Map<string, number> }>();
  for (const list of lists) {
    for (const u of list || []) {
      if (!u?.characterId) continue;
      let e = by.get(u.characterId);
      if (!e) {
        e = { count: 0, gamesWithUnit: 0, carryItemGames: 0, carryItemGamesAll: 0, tankItemGames: null, items: new Map() };
        by.set(u.characterId, e);
      }
      e.count += num(u.count);
      e.gamesWithUnit += unitGames(u);
      e.carryItemGames += num(u.carryItemGames);
      e.carryItemGamesAll += num(u.carryItemGamesAll);
      if (u.tankItemGames != null) e.tankItemGames = (e.tankItemGames ?? 0) + num(u.tankItemGames);
      for (const it of u.topItems || []) {
        if (!it?.apiName) continue;
        e.items.set(it.apiName, (e.items.get(it.apiName) || 0) + num(it.count));
      }
    }
  }
  return [...by.entries()].map(([characterId, e]) => ({
    characterId,
    count: e.count,
    gamesWithUnit: e.gamesWithUnit,
    carryItemGames: e.carryItemGames,
    ...(e.carryItemGamesAll > 0 ? { carryItemGamesAll: e.carryItemGamesAll } : {}),
    ...(e.tankItemGames != null ? { tankItemGames: e.tankItemGames } : {}),
    topItems: [...e.items.entries()].sort((a, b) => b[1] - a[1]).map(([apiName, count]) => ({ apiName, count })),
  }));
}

export interface FamilyForMerge {
  key: string;         // <trait>__<carry>
  trait: string;
  keyCarry: string;
  games: number;
  units: readonly RoleUnit[];
}

// Zwei-Carry-Familien zusammenlegen (User 2026-09-27: „Soraka + Zyra",
// „Kha + Ezreal"). Regeln: gleicher Trait · gegenseitig — der Key-Carry der
// einen ist Carry der anderen und umgekehrt · Kern-Units (>= 50 % Praesenz)
// ueberlappen >= 0,7 · nicht verkettend: die meistgespielte Familie ist
// Anker, jede weitere wird nur gegen Anker verglichen, nie gegen bereits
// angehaengte Familien. Rueckgabe: Family-Key → Anker-Key.
export function resolveFamilies(families: readonly FamilyForMerge[], opts: RoleOptions = {}): Map<string, string> {
  const info = [...families]
    .sort((a, b) => b.games - a.games || a.key.localeCompare(b.key))
    .map(f => ({
      f,
      carries: new Set(computeRoles(f.units, f.games, opts).carries),
      core: new Set(f.units.filter(u => f.games > 0 && unitGames(u) / f.games >= CARRY_MIN_PRESENCE).map(u => u.characterId)),
    }));
  const anchorOf = new Map<string, string>();
  const anchors: typeof info = [];
  for (const x of info) {
    const hit = anchors.find(a =>
      a.f.trait === x.f.trait
      && a.f.keyCarry !== x.f.keyCarry
      && a.carries.has(x.f.keyCarry)
      && x.carries.has(a.f.keyCarry)
      && jaccard(a.core, x.core) >= MERGE_MIN_JACCARD);
    if (hit) anchorOf.set(x.f.key, hit.f.key);
    else { anchors.push(x); anchorOf.set(x.f.key, x.f.key); }
  }
  return anchorOf;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// Komponenten-Pruefung aus dem Asset-Bundle (tags enthaelt 'component').
export function componentCheckFromItems(
  items: Record<string, { tags?: string[] } | undefined> | null | undefined,
): IsComponent {
  return (api: string) => !!items?.[api]?.tags?.includes('component');
}
