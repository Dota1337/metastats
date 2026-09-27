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
export const ITEM_MIN_SHARE = 0.15;      // Item erscheint auf >= 15 % der Spiele der Unit
export const MAX_NAMED_CARRIES = 2;
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
export interface RoleOptions { set?: number; isComponent?: IsComponent }

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
  };
}

export interface CompRoles {
  carries: string[];   // alle Carries, staerkster zuerst
  tanks: string[];
}

export function computeRoles(
  units: readonly RoleUnit[] | null | undefined,
  familyGames: number,
  opts: RoleOptions = {},
): CompRoles {
  const stats = (units || []).filter(u => u?.characterId).map(u => unitRoleStats(u, familyGames, opts));
  const carries = stats
    .filter(s => s.games >= CARRY_MIN_GAMES && s.presence >= CARRY_MIN_PRESENCE
      && s.carryRate >= CARRY_MIN_RATE && s.carryShare >= CARRY_MIN_SHARE)
    .sort((a, b) => b.carryRate - a.carryRate || b.games - a.games)
    .map(s => s.characterId);
  const carrySet = new Set(carries);
  const tanks = stats
    .filter(s => !carrySet.has(s.characterId) && s.tankRate >= TANK_MIN_RATE)
    .map(s => s.characterId);
  return { carries, tanks };
}

// Name der Comp: hoechstens zwei Carries; keiner erkannt → der Carry aus dem Key.
export function namedCarries(roles: CompRoles | null | undefined, keyCarry: string | null | undefined): string[] {
  const named = (roles?.carries || []).slice(0, MAX_NAMED_CARRIES);
  if (named.length > 0) return named;
  return keyCarry ? [keyCarry] : [];
}

// Items, die an einer Unit gezeigt werden: nur Carries und Tank-Traeger, nur
// fertige Items, nur ab 15 % der Spiele dieser Unit.
export function shownItems<T extends RoleItem>(
  u: RoleUnit & { topItems?: T[] },
  roles: CompRoles,
  isComponent: IsComponent = () => false,
  max = 3,
): T[] {
  if (!roles.carries.includes(u.characterId) && !roles.tanks.includes(u.characterId)) return [];
  const games = unitGames(u);
  if (games <= 0) return [];
  return ((u.topItems || []) as T[])
    .filter(it => it?.apiName && !isComponent(it.apiName) && num(it.count) / games >= ITEM_MIN_SHARE)
    .sort((a, b) => num(b.count) - num(a.count))
    .slice(0, max);
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

function jaccard(a: Set<string>, b: Set<string>): number {
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
