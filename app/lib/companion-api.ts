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
import { isThreeStarUnit, parseClusterKey } from './tft-cluster';
import { tftChampionTileUrl, tftIconUrl, tftTraitDisplayName, type TftAssetsBundle } from './tft-cdragon';
import { componentCheckFromItems, namedCarries, shownItems } from './tft-comp-roles';
import { tierLetterOfSync, type TierCutoffs } from './tft-tier-letter';
import { BAG_SIZE, SHOP_ODDS } from './tft-roll-odds';

export const COMPANION_API_VERSION = 1;
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

export interface CompanionCompUnit {
  id: string;
  items?: string[];    // nur an Item-Traegern, wie auf /tft/comps; fehlt = keine
  star3?: true;
}

export interface CompanionComp {
  key: string;         // Familien-Schluessel <trait>__<carry>
  slug: string;        // Detailseite auf metastats.gg
  name: string;        // „Trait · Carry & Carry"
  trait: string;
  carries: string[];
  itemCarriers: string[];
  tier: string | null; // S/A/B/C/D, null unter der Mindest-Spielzahl
  avg: number | null;
  top4: number | null;
  win: number | null;
  pick: number | null;
  games: number;
  traitLevel: number;  // Trait-Stufe der gezeigten Variante (Zahl im Key, nicht Spieler-Stufe)
  avgLevel: number | null; // Spieler-Stufe am Spielende im Schnitt
  units: CompanionCompUnit[];
}

export interface CompanionCompsResponse {
  v: number;
  set: number | null;
  patch: string | null;
  filters: { region: string; bucket: string; days: number };
  generatedAt: string;
  comps: CompanionComp[];
}

// Reihenfolge der Units wie auf /tft/comps: Kosten aufsteigend, dann Name.
function sortUnits<T extends { characterId: string }>(units: T[], assets: TftAssetsBundle | null): T[] {
  const costOf = (cid: string) => assets?.champions[cid]?.cost ?? 1;
  const nameOf = (cid: string) => (assets?.champions[cid]?.name || cid).toLowerCase();
  return [...units].sort((a, b) =>
    costOf(a.characterId) - costOf(b.characterId) || nameOf(a.characterId).localeCompare(nameOf(b.characterId)));
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
  return {
    key: family.familyKey,
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
  };
}

// ---------------------------------------------------------------------------
// Namen + Bilder + Rezepte, einmal je Set in der App zwischengespeichert.

export interface CompanionLookups {
  v: number;
  set: number;
  champions: Record<string, { name: string; cost: number; icon: string | null; traits: string[] }>;
  items: Record<string, { name: string; icon: string | null; recipe?: [string, string]; component?: true }>;
  traits: Record<string, { name: string; icon: string | null }>;
  shopOdds: Record<number, [number, number, number, number, number]>;
  bagSize: Record<number, number>;
}

// Nur, was im laufenden Set wirklich vorkommt: Champions mit Kosten 1-5 und
// mindestens einem Trait (das Bundle fuehrt auch Monster wie „Murk Wolf"),
// Items aus active.items, die Komponente oder 2-teiliges Rezept sind.
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
    if (!it) continue;
    const isComp = !!it.tags?.includes('component');
    const recipe = it.composition?.length === 2 ? [it.composition[0], it.composition[1]] as [string, string] : undefined;
    if (!isComp && !recipe) continue;
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

export interface CompanionMatch {
  id: string;
  at: number;          // Spielende, ms
  queue: number | null;
  placement: number;
  level: number | null;
  traits: Array<{ id: string; units: number; style: number }>;
  units: Array<{ id: string; star: number; items: string[] }>;
}

interface RawParticipant {
  puuid?: string;
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

export function toCompanionMatch(m: RawMatch, puuid: string): CompanionMatch | null {
  const me = m.participants?.find(p => p.puuid === puuid);
  if (!m.matchId || !me || typeof me.placement !== 'number') return null;
  return {
    id: m.matchId,
    at: Number(m.gameDatetime) || 0,
    queue: typeof m.queueId === 'number' ? m.queueId : null,
    placement: me.placement,
    level: typeof me.level === 'number' ? me.level : null,
    traits: (me.traits || [])
      .filter(t => t?.name && (t.style ?? 0) > 0)
      .sort((a, b) => (b.style ?? 0) - (a.style ?? 0) || (b.numUnits ?? 0) - (a.numUnits ?? 0))
      .map(t => ({ id: t.name as string, units: t.numUnits ?? 0, style: t.style ?? 0 })),
    units: (me.units || [])
      .filter(u => u?.characterId)
      .map(u => ({ id: u.characterId as string, star: u.tier ?? 1, items: u.itemNames ?? u.items ?? [] })),
  };
}
