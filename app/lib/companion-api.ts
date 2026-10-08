// Antworten fuer die Overwolf-App (apps/overwolf-app) unter /api/companion/v1/*.
//
// Die App rechnet nichts selbst: Familien, Namen, Item-Traeger und Tier-
// Buchstaben kommen fertig vom Server, berechnet mit denselben Funktionen wie
// /tft/comps (tft-comp-families, tft-comp-roles, tft-tier-letter). So kann die
// App nie andere Comps zeigen als die Seite.
//
// Reine Funktionen ohne Netz — die Routen holen die Daten und reichen sie hier
// durch, damit der Zuschnitt testbar bleibt (companion-api.test.mjs).
import { NextResponse } from 'next/server';
import type { CompFamily } from '../components/tft/CompFamilyRow';
import { isThreeStarUnit, parseClusterKey, STAR3_MIN_GAMES, STAR3_SHARE_THRESHOLD } from './tft-cluster';
import { tftChampionTileUrl, tftIconUrl, tftTraitDisplayName, type TftAssetsBundle } from './tft-cdragon';
import { componentCheckFromItems, namedCarries, shownItems } from './tft-comp-roles';
import { tierLetterOfSync, type TierCutoffs } from './tft-tier-letter';
import { BAG_SIZE, SHOP_ODDS } from './tft-roll-odds';
import {
  COMPANION_API_VERSION,
  type CompanionComp, type CompanionCompUnit, type CompanionLobbyPlayer,
  type CompanionLookups, type CompanionMatch, type CompanionStats, type CompanionVs,
} from './companion-types';

export * from './companion-types';
// Aufstellungsbrett (resolveBoard, unitsAtPlayerLevel, buildCompBoards) liegt
// in einer reinen Datei, weil die Comp-Liste es auch im Browser braucht.
export * from './tft-comp-board';

export const SITE_ORIGIN = 'https://www.metastats.gg';

// Die App laeuft unter overwolf-extension://<app-id>. Fester Stern statt
// gespiegeltem Origin: alle Routen sind lesend und ohne Cookies, und ein
// gespiegelter Origin wuerde die Edge-Kopie je Herkunft aufspalten.
export const COMPANION_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export function companionJson(
  data: unknown,
  opts: { cdn: string; browser?: string; status?: number },
): NextResponse {
  return NextResponse.json(data, {
    status: opts.status ?? 200,
    headers: {
      ...COMPANION_CORS_HEADERS,
      'Cache-Control': opts.browser ?? 'public, max-age=300',
      'Vercel-CDN-Cache-Control': opts.cdn,
      'Vercel-Cache-Tag': 'companion-api',
    },
  });
}

export function companionPreflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: COMPANION_CORS_HEADERS });
}

// Bild-Pfade der Seite sind teils relativ (/api/img/...). In der App gibt es
// keinen gemeinsamen Ursprung, also immer absolut.
export function absoluteUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  if (u.startsWith('/')) return SITE_ORIGIN + u;
  return u;
}

const round = (v: number | null | undefined, digits: number): number | null =>
  v == null || !Number.isFinite(v) ? null : Number(v.toFixed(digits));

/** Spiele + Platz/Top 4/Sieg aus einer Zeile der Seiten-Routen. */
export function companionStats(r: {
  games?: number | null; avgPlacement?: number | null; top4Rate?: number | null; top1Rate?: number | null;
}): CompanionStats {
  return {
    games: Number(r.games) || 0,
    avg: round(r.avgPlacement, 2),
    top4: round(r.top4Rate, 3),
    win: round(r.top1Rate, 3),
  };
}

// Reihenfolge der Units wie auf /tft/comps: Kosten aufsteigend, dann Name.
function sortUnits<T extends { characterId: string }>(units: T[], assets: TftAssetsBundle | null): T[] {
  const costOf = (cid: string) => assets?.champions[cid]?.cost ?? 1;
  const nameOf = (cid: string) => (assets?.champions[cid]?.name || cid).toLowerCase();
  return [...units].sort((a, b) =>
    costOf(a.characterId) - costOf(b.characterId) || nameOf(a.characterId).localeCompare(nameOf(b.characterId)));
}

/** <trait>__<carry> eines cluster_key — dieselbe Regel wie familyKeyForMerge. */
export function memberKeyOf(clusterKey: string): string | null {
  const p = parseClusterKey(clusterKey);
  return p ? `${p.trait}__${p.carry}` : null;
}

export interface CompPairInput { a_key: string; b_key: string; games: number; a_better: number }

/**
 * Matchups zwischen den Comps der Liste aus den Paar-Zeilen der Datenbank
 * (zwei Comps im selben Spiel, wer landet weiter vorn). Sub-Cluster werden
 * ueber `members` ihrer Comp zugeordnet und nach Spielen gewichtet summiert,
 * wie die Detailseite es je Gegner-Familie tut. Paare innerhalb derselben
 * Comp fallen weg. Ab `minGames` Spielen, sonst kein Eintrag.
 */
export function buildCompanionVs(
  comps: Array<Pick<CompanionComp, 'key' | 'members'>>,
  pairs: CompPairInput[],
  minGames = 30,
): Record<string, Record<string, CompanionVs>> {
  const owner = new Map<string, string>();
  for (const c of comps) for (const m of c.members ?? [c.key]) if (!owner.has(m)) owner.set(m, c.key);
  const acc = new Map<string, { games: number; ahead: number }>();
  const add = (a: string, b: string, games: number, ahead: number) => {
    const k = `${a}\u0000${b}`;
    const cur = acc.get(k) ?? { games: 0, ahead: 0 };
    cur.games += games;
    cur.ahead += ahead;
    acc.set(k, cur);
  };
  for (const p of pairs) {
    const ak = memberKeyOf(p.a_key);
    const bk = memberKeyOf(p.b_key);
    const a = ak ? owner.get(ak) : undefined;
    const b = bk ? owner.get(bk) : undefined;
    const games = Number(p.games) || 0;
    if (!a || !b || a === b || games <= 0) continue;
    const aBetter = Number(p.a_better) || 0;
    add(a, b, games, aBetter);
    add(b, a, games, games - aBetter);
  }
  const out: Record<string, Record<string, CompanionVs>> = {};
  for (const [k, v] of acc) {
    if (v.games < minGames) continue;
    const [a, b] = k.split('\u0000');
    (out[a] ||= {})[b] = [v.games, Number((v.ahead / v.games).toFixed(3))];
  }
  return out;
}

// Reroll-Comps bleiben auf der Stufe, auf der ihr 3-Sterne-Carry am haeufigsten
// im Shop steht: 1-Kosten auf 5, 2-Kosten auf 6, 3-Kosten auf 7.
export const REROLL_LEVEL_BY_COST: Record<number, number> = { 1: 5, 2: 6, 3: 7 };

/**
 * Reroll oder nicht (classification-reviewer 2026-10-07, 33/33 Comps richtig):
 * ein Carry oder Item-Traeger kostet hoechstens 3 und steht ueber alle
 * Varianten der Familie gerechnet zu mindestens STAR3_SHARE_THRESHOLD auf
 * 3 Sternen. Die Stufe kommt von den Kosten des Carrys mit dem hoechsten
 * 3-Sterne-Anteil. Kein Filter auf die Endstufe: Reroll-Comps leveln nach dem
 * 3-Sterne-Treffer weiter und enden oft auf 8.
 */
export function rerollPlan(
  candidates: string[],
  variants: Array<{ typicalUnits?: Array<{ characterId: string; gamesWithUnit?: unknown; star3Games?: unknown }> }>,
  costOf: (cid: string) => number | null | undefined,
): { level: number; targets: string[] } | null {
  const want = new Set(candidates);
  const acc = new Map<string, { games: number; star3: number }>();
  for (const v of variants) {
    for (const u of v.typicalUnits || []) {
      if (!want.has(u.characterId)) continue;
      const cur = acc.get(u.characterId) ?? { games: 0, star3: 0 };
      cur.games += Number(u.gamesWithUnit) || 0;
      cur.star3 += Number(u.star3Games) || 0;
      acc.set(u.characterId, cur);
    }
  }
  const hits = [...acc]
    .map(([id, a]) => ({ id, cost: Number(costOf(id)), share: a.games > 0 ? a.star3 / a.games : 0, games: a.games }))
    .filter(h => REROLL_LEVEL_BY_COST[h.cost] != null && h.games >= STAR3_MIN_GAMES && h.share >= STAR3_SHARE_THRESHOLD)
    .sort((a, b) => b.share - a.share || a.id.localeCompare(b.id));
  if (hits.length === 0) return null;
  const cost = hits[0].cost;
  return { level: REROLL_LEVEL_BY_COST[cost], targets: hits.filter(h => h.cost === cost).map(h => h.id) };
}

export function toCompanionComp(
  family: CompFamily,
  assets: TftAssetsBundle | null,
  cutoffs: TierCutoffs | null,
): CompanionComp {
  const main = family.mainComp;
  const parts = parseClusterKey(main.slug || main.clusterKey);
  const roles = { carries: family.carries, tanks: family.tanks, itemCarriers: family.itemCarriers };
  const named = namedCarries(roles, parts?.carry ?? family.carry);
  const nameOf = (cid: string) => assets?.champions[cid]?.name || cid.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '');
  const traitName = tftTraitDisplayName(assets, family.trait);
  const isComponent = componentCheckFromItems(assets?.items);
  const units = sortUnits(main.typicalUnits || [], assets).slice(0, 9).map(u => {
    const items = shownItems(u, roles, isComponent, 3).map(it => it.apiName);
    const out: CompanionCompUnit = { id: u.characterId };
    if (items.length > 0) out.items = items;
    if (isThreeStarUnit(u as { gamesWithUnit?: unknown; star3Games?: unknown })) out.star3 = true;
    return out;
  });
  const tier = cutoffs
    ? tierLetterOfSync({ avgPlacement: main.avgPlacement, pickRate: main.pickRate, games: main.games }, 'comps', cutoffs)
    : null;
  const reroll = rerollPlan(
    [...new Set([...named, ...(family.itemCarriers ?? [])])],
    (family.variants?.length ? family.variants : [main]) as Parameters<typeof rerollPlan>[1],
    cid => assets?.champions[cid]?.cost,
  );
  const members = [family.familyKey];
  for (const v of family.variants || []) {
    for (const s of [v.slug, v.clusterKey, ...((v._mergedFrom as string[] | undefined) ?? [])]) {
      const k = typeof s === 'string' ? memberKeyOf(s) : null;
      if (k && !members.includes(k)) members.push(k);
    }
  }
  return {
    key: family.familyKey,
    members,
    slug: main.slug || main.clusterKey,
    name: named.length > 0 ? `${traitName} · ${named.map(nameOf).join(' & ')}` : traitName,
    trait: family.trait,
    carries: named,
    itemCarriers: family.itemCarriers ?? [],
    tier,
    avg: round(family.weightedAvgPlacement, 2),
    top4: round(family.weightedTop4Rate, 3),
    win: round(family.weightedTop1Rate, 3),
    pick: round(family.familyPickRate, 4),
    games: family.totalGames,
    traitLevel: parts?.level ?? family.level,
    avgLevel: round(main.avgLevel ?? null, 2),
    units,
    ...(reroll ? { reroll } : {}),
  };
}

// ---------------------------------------------------------------------------
// Namen + Bilder + Rezepte, einmal je Set in der App zwischengespeichert.

// Nur, was im laufenden Set wirklich vorkommt: Champions mit Kosten 1-5 und
// mindestens einem Trait (das Bundle fuehrt auch Monster wie „Murk Wolf"),
// alle Items aus active.items ausser Augmenten. Augmente stehen im Bundle mit
// unter items, erkennbar am Icon-Ordner hud/zaps/ (2026-10-02: 343 von 537;
// von 322 auf Units gespielten Items ueber 15 Regionen liegt keins dort).
// Artefakte, strahlende Items und Embleme muessen mit, sonst zeigt die App
// in Partien Buchstaben statt Icons.
// Nicht am Namen: DA_18_EmblemFloraFatalisAugment ist ein getragenes Emblem.
function isAugmentEntry(icon: string | null | undefined): boolean {
  return /\/hud\/zaps\//i.test(icon ?? '');
}

export function toCompanionLookups(assets: TftAssetsBundle): CompanionLookups {
  const champions: CompanionLookups['champions'] = {};
  for (const [id, c] of Object.entries(assets.champions)) {
    if (!c || !(c.cost >= 1 && c.cost <= 5) || !c.traits?.length) continue;
    champions[id] = {
      name: c.name,
      cost: c.cost,
      icon: absoluteUrl(tftChampionTileUrl(assets, c)),
      traits: c.traits,
    };
  }
  const items: CompanionLookups['items'] = {};
  for (const id of assets.active?.items ?? []) {
    const it = assets.items[id];
    if (!it || isAugmentEntry(it.icon)) continue;
    const isComp = !!it.tags?.includes('component');
    const recipe = it.composition?.length === 2 ? [it.composition[0], it.composition[1]] as [string, string] : undefined;
    items[id] = {
      name: it.name,
      icon: absoluteUrl(tftIconUrl(assets, it.icon)),
      ...(recipe ? { recipe } : {}),
      ...(isComp ? { component: true as const } : {}),
    };
  }
  const traits: CompanionLookups['traits'] = {};
  for (const [id, t] of Object.entries(assets.traits)) {
    if (!t) continue;
    traits[id] = { name: tftTraitDisplayName(assets, id), icon: absoluteUrl(tftIconUrl(assets, t.icon)) };
  }
  return { v: COMPANION_API_VERSION, set: assets.set, champions, items, traits, shopOdds: SHOP_ODDS, bagSize: BAG_SIZE };
}

// ---------------------------------------------------------------------------
// Eigener Verlauf: nur die eigene Zeile je Spiel, ohne Mitspieler. Augments
// werden bewusst nicht durchgereicht (Overwolf-Regel, siehe README der App).

interface RawParticipant {
  puuid?: string;
  riotIdName?: string | null;
  placement?: number;
  level?: number;
  traits?: Array<{ name?: string; numUnits?: number; style?: number; tierCurrent?: number }>;
  units?: Array<{ characterId?: string; tier?: number; itemNames?: string[]; items?: string[] }>;
}
interface RawMatch {
  matchId?: string;
  gameDatetime?: number;
  queueId?: number;
  participants?: RawParticipant[];
}

const traitsOf = (p: RawParticipant) => (p.traits || [])
  .filter(t => t?.name && (t.style ?? 0) > 0)
  .sort((a, b) => (b.style ?? 0) - (a.style ?? 0) || (b.numUnits ?? 0) - (a.numUnits ?? 0))
  .map(t => ({ id: t.name as string, units: t.numUnits ?? 0, style: t.style ?? 0 }));
const unitsOf = (p: RawParticipant) => (p.units || [])
  .filter(u => u?.characterId)
  .map(u => ({ id: u.characterId as string, star: u.tier ?? 1, items: u.itemNames ?? u.items ?? [] }));

/**
 * Eigene Zeile je Spiel. Mit `lobby` zusaetzlich alle Spieler der Partie
 * (Riot-ID, Platz, Traits, Units) — Augments bleiben in beiden Faellen weg.
 */
export function toCompanionMatch(m: RawMatch, puuid: string, opts: { lobby?: boolean } = {}): CompanionMatch | null {
  const me = m.participants?.find(p => p.puuid === puuid);
  if (!m.matchId || !me || typeof me.placement !== 'number') return null;
  const out: CompanionMatch = {
    id: m.matchId,
    at: Number(m.gameDatetime) || 0,
    queue: typeof m.queueId === 'number' ? m.queueId : null,
    placement: me.placement,
    level: typeof me.level === 'number' ? me.level : null,
    traits: traitsOf(me),
    units: unitsOf(me),
  };
  if (opts.lobby) {
    out.lobby = (m.participants || [])
      .filter(p => p?.puuid && typeof p.placement === 'number')
      .sort((a, b) => (a.placement as number) - (b.placement as number))
      .map((p): CompanionLobbyPlayer => ({
        name: typeof p.riotIdName === 'string' && p.riotIdName ? p.riotIdName : null,
        puuid: p.puuid as string,
        placement: p.placement as number,
        level: typeof p.level === 'number' ? p.level : null,
        traits: traitsOf(p),
        units: unitsOf(p),
      }));
  }
  return out;
}
