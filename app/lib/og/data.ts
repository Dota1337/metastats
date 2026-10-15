import 'server-only';
// Daten fuer die dynamischen Vorschaubilder und Seitentitel.
//
// Harte Regel: hier wird NIE Riot gefragt und NIE eine der langsamen
// Live-Routen (/api/tft/comps, /api/summoner, /api/tft/summoner). Ein
// unbekannter Comp-Slug kostete dort gemessen 21 s und endete mit 502 — so
// lange wartet kein Messenger auf ein Vorschaubild. Quellen sind nur der
// fertige Zwischenspeicher (Comps) und je eine Datenbank-Abfrage (Spieler),
// alles mit Zeitlimit; fehlt etwas, zeigt das Bild nur Name und Marke.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CURRENT_SET } from '../current-set';
import { lookupCompDetailSnapshot } from '../comp-detail-snapshot';
import { DETAIL_MIN_GAMES } from '../snapshot-matrix';
import { parseClusterKey } from '../tft-cluster';
import { computeRoles, componentCheckFromItems, namedCarries, type RoleUnit } from '../tft-comp-roles';
import { tftTraitDisplayName, type TftAssetsBundle } from '../tft-cdragon';
import { lolPlayersLookup, tftDirectoryLookup } from '../player-lookup-server';
import { supabaseAdmin as supabase } from '../supabase';
import { withTimeout } from './frame';

export const DATA_TIMEOUT_MS = 1500;
const IMAGE_TIMEOUT_MS = 1200;

// ---------- TFT-Asset-Bundle (einmal je Server-Instanz) ----------

let assetsCache: { set: number; bundle: TftAssetsBundle | null } | null = null;

export function tftAssets(): TftAssetsBundle | null {
  if (assetsCache?.set === CURRENT_SET) return assetsCache.bundle;
  let bundle: TftAssetsBundle | null = null;
  try {
    const file = path.join(process.cwd(), 'public', `tft-assets-${CURRENT_SET}.json`);
    bundle = JSON.parse(readFileSync(file, 'utf8')) as TftAssetsBundle;
  } catch (e) {
    console.error('[og] tft-assets read failed:', (e as Error).message);
  }
  assetsCache = { set: CURRENT_SET, bundle };
  return bundle;
}

function prettyId(id: string): string {
  return id.replace(/^(?:DA_)?(?:TFT\d*_|\d+_)?/i, '').replace(/^DA_?\d*_?/i, '').replace(/_/g, ' ');
}

function championName(bundle: TftAssetsBundle | null, id: string): string {
  return bundle?.champions?.[id]?.name || prettyId(id);
}

// ---------- Comp ----------

export interface OgUnit { id: string; tile: string | null; cost: number; star3: boolean }
export interface CompOg {
  name: string;
  units: OgUnit[];
  stats: { games: number; avgPlacement: number; top4Rate: number; top1Rate: number } | null;
}

/** Name ohne Netz: Trait aus dem Slug + Carry aus dem Slug. Fuer den Seitentitel. */
export function compNameFromSlug(slug: string): string | null {
  const parts = parseClusterKey(slug);
  if (!parts) return null;
  const bundle = tftAssets();
  return `${tftTraitDisplayName(bundle, parts.trait)} · ${championName(bundle, parts.carry)}`;
}

type SnapUnit = RoleUnit & { characterId: string; gamesWithUnit?: number; star3Games?: number };
type SnapComp = {
  clusterKey: string; games: number; avgPlacement: number; top4Rate: number; top1Rate: number;
  typicalUnits?: SnapUnit[];
};

function tileUrl(bundle: TftAssetsBundle | null, id: string): string | null {
  const c = bundle?.champions?.[id] as { tile?: string; icon?: string } | undefined;
  const p = c?.tile || c?.icon;
  return bundle?.iconBase && p && !p.startsWith('/') ? bundle.iconBase + p : null;
}

export async function compOgData(slug: string): Promise<CompOg | null> {
  const parts = parseClusterKey(slug);
  if (!parts) return null;
  const bundle = tftAssets();
  // Dieselben Filter wie die Detailseite ohne Parameter
  // (CompDetailClient.tsx: all / master_plus / 3 Tage / DETAIL_MIN_GAMES Spiele).
  const hit = await withTimeout(lookupCompDetailSnapshot({
    patch: null, region: 'all', days: 3, bucket: 'master_plus', minGames: DETAIL_MIN_GAMES,
    setNumber: CURRENT_SET, slug,
  }), DATA_TIMEOUT_MS);
  const comp = (hit?.payload as { comp?: SnapComp } | undefined)?.comp ?? null;

  if (!comp) {
    const carryTile = await imageDataUrl(tileUrl(bundle, parts.carry), IMAGE_TIMEOUT_MS);
    return {
      name: compNameFromSlug(slug) || slug,
      units: [{ id: parts.carry, tile: carryTile, cost: bundle?.champions?.[parts.carry]?.cost ?? 0, star3: false }],
      stats: null,
    };
  }

  // Name wie in der Kopfzone der Seite (CompCard): Carries an den Items erkannt.
  const roles = computeRoles(comp.typicalUnits, comp.games, {
    set: bundle?.set, isComponent: componentCheckFromItems(bundle?.items), keyCarry: parts.carry,
  });
  const named = namedCarries(roles, parts.carry);
  const name = `${tftTraitDisplayName(bundle, parts.trait)} · ${named.map(id => championName(bundle, id)).join(' & ')}`;

  // Haeufigste Units zuerst, dann wie im Spiel nach Kosten sortiert.
  const units = [...(comp.typicalUnits || [])]
    .sort((a, b) => (b.gamesWithUnit ?? 0) - (a.gamesWithUnit ?? 0))
    .slice(0, 9)
    .map(u => ({
      id: u.characterId,
      cost: bundle?.champions?.[u.characterId]?.cost ?? 0,
      star3: (u.gamesWithUnit ?? 0) > 0 && (u.star3Games ?? 0) / (u.gamesWithUnit ?? 1) >= 0.55,
    }))
    .sort((a, b) => a.cost - b.cost);
  const tiles = await Promise.all(units.map(u => imageDataUrl(tileUrl(bundle, u.id), IMAGE_TIMEOUT_MS)));

  return {
    name,
    units: units.map((u, i) => ({ ...u, tile: tiles[i] })),
    stats: { games: comp.games, avgPlacement: comp.avgPlacement, top4Rate: comp.top4Rate, top1Rate: comp.top1Rate },
  };
}

// ---------- TFT-Spieler ----------

export interface TftPlayerOg { region: string | null; tier: string | null; division: string | null; lp: number | null }

// Abfrage gemeinsam mit Seitentitel und Kopf (player-lookup-server.ts), sonst
// zeigte das Bild einen Rang, wo die Seite „unbekannt“ sagt.
export async function tftPlayerOgData(gameName: string, tagLine: string): Promise<TftPlayerOg | null> {
  const r = await tftDirectoryLookup(gameName, tagLine);
  if (!r?.known) return null;
  const h = r.value;
  return { region: h.region, tier: h.tier, division: h.division, lp: h.lp };
}

// ---------- LoL-Spieler ----------

export interface LolPlayerOg {
  region: string | null; tier: string | null; rank: string | null; lp: number | null;
  marketValue: number | null; level: number | null; icon: string | null;
}

async function soloLp(playerId: string): Promise<number | null> {
  const { data: rs } = await supabase
    .from('ranked_stats')
    .select('league_points')
    .eq('player_id', playerId)
    .eq('queue_type', 'RANKED_SOLO_5x5')
    .limit(1);
  return (rs?.[0]?.league_points as number | undefined) ?? null;
}

export async function lolPlayerOgData(name: string, tag: string): Promise<LolPlayerOg | null> {
  const started = Date.now();
  const r = await lolPlayersLookup(name, tag);
  if (!r?.known) return null;
  // Beide Abfragen zusammen hoechstens DATA_TIMEOUT_MS, wie bisher.
  const rest = DATA_TIMEOUT_MS - (Date.now() - started);
  const p = { ...r.value, lp: rest > 0 ? await withTimeout(soloLp(r.value.id), rest) : null };
  const icon = typeof p.profile_icon_id === 'number'
    ? await imageDataUrl(`https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/${p.profile_icon_id}.jpg`, IMAGE_TIMEOUT_MS)
    : null;
  return {
    region: p.region ?? null,
    tier: p.tier ?? null,
    rank: p.rank ?? null,
    lp: p.lp,
    marketValue: Number(p.market_value) > 0 ? Number(p.market_value) : null,
    level: p.summoner_level ?? null,
    icon,
  };
}

// ---------- Bilder ----------

/** Bild vorab laden und als data:-URL einbetten. Ohne Vorladen holt der
 *  Renderer es selbst, ohne Zeitlimit — ein langsames CDN haelt dann das ganze
 *  Vorschaubild auf. */
export async function imageDataUrl(url: string | null, ms: number): Promise<string | null> {
  if (!url) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || 'image/png';
    if (!type.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
