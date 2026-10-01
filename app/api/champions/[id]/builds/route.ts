import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { supabaseAdmin } from '../../../../lib/supabase';
import { cachedJson, STATS_CACHE_CONTROL } from '../../../../lib/api-cache';
import { LOL_RANK_GROUPS } from '../../../../lib/rank-groups';
import { parseRegion } from '../../../../lib/regions';
import { itemVerdict, type StratumCount, type VerdictResult } from '../../../../lib/lol-item-verdict';
import { pickCounters } from '../../../../lib/lol-counters.mjs';

interface BuildEntry {
  items: number[];
  games: number;
  wins: number;
}
interface ItemEntry { item: number; games: number; wins: number }
interface RuneEntry {
  primary: number; keystone: number;
  p1: number; p2: number; p3: number;
  secondary: number; s1: number; s2: number;
  off: number; flex: number; def: number;
  games: number; wins: number;
}
interface KeystoneEntry { id: number; games: number; wins: number }
interface SummonerEntry { spells: number[]; games: number; wins: number }
interface CounterEntry { enemy: string; gamesAgainst: number; lossesAgainst: number }
interface RoleData {
  games: number;
  wins: number;
  topBuilds: BuildEntry[];
  topBoots: ItemEntry[];
  topItems: ItemEntry[];
  topRunes: RuneEntry[];
  topKeystones: KeystoneEntry[];
  topSummoners: SummonerEntry[];
  counters: { strongAgainst: CounterEntry[]; weakAgainst: CounterEntry[] };
  itemVerdicts?: Record<string, VerdictResult>;
}
interface BuildsFile {
  region: string;
  collectedAt: string;
  matchesAnalyzed: number;
  ddragonVersion: string;
  byChampionRole: Record<string, Record<string, RoleData>>;
}
interface StatRow {
  patch: string; role: string; dim: string; key: string;
  stratum: number; games: number; wins: number;
}

const ROLE_PARAM: Record<string, string> = {
  top: 'TOP', jungle: 'JUNGLE', mid: 'MIDDLE', adc: 'BOTTOM', support: 'UTILITY',
};
// Rangauswahl nur, wo die Rang-Stichprobe sammelt (scripts/collect-lol-matches.mjs RANK_REGION).
const RANK_REGIONS = new Set(['euw1']);
const RANK_OPTIONS = ['EMERALD_PLUS', 'DIAMOND_PLUS', 'MASTER_PLUS'] as const;
// Neuester Patch gilt erst ab so vielen Spielen des Champions; sonst der Patch mit den meisten.
const MIN_PATCH_GAMES = 500;
// Darunter gilt die Datei (siehe GET).
const MIN_DB_GAMES = 200;
const PAGE = 1000;

// Resolve championKey: route param can be the Riot integer key (e.g. "157" for Yasuo)
// OR the Data Dragon string id (e.g. "Yasuo"). The builds JSON keys by integer key,
// so for string ids we map via Data Dragon.
async function resolveChampionKey(idParam: string): Promise<string | null> {
  if (/^\d+$/.test(idParam)) return idParam;
  try {
    const versionRes = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
    const versions = await versionRes.json();
    const v = versions[0];
    const champRes = await fetch(`https://ddragon.leagueoflegends.com/cdn/${v}/data/en_US/champion.json`);
    if (!champRes.ok) return null;
    const data = await champRes.json();
    for (const c of Object.values(data.data) as any[]) {
      if (c.id === idParam) return c.key;
    }
  } catch {}
  return null;
}

async function latestDdragonVersion(): Promise<string | null> {
  try {
    const res = await fetch('https://ddragon.leagueoflegends.com/api/versions.json', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return (await res.json())[0] ?? null;
  } catch {
    return null;
  }
}

const patchNum = (p: string) => p.split('.').map(Number);
const patchDesc = (a: string, b: string) => {
  const [a1, a2] = patchNum(a), [b1, b2] = patchNum(b);
  return b1 - a1 || b2 - a2;
};

// Summen je Champion + Rang-Gruppe aus lol_champion_build_stats (Supabase).
// null = Tabelle nicht erreichbar; { rows: [] } = erreichbar, aber keine Daten.
async function loadDbRows(region: string, champion: number, tiers: string[]): Promise<{ patch: string; rows: StatRow[] } | null> {
  // 1) Gesamtzeilen: klein, reichen fuer die Patch-Wahl.
  const totals = await supabaseAdmin
    .from('lol_champion_build_stats')
    .select('patch, games')
    .eq('region', region).eq('champion', champion).eq('dim', 'total').in('tier', tiers)
    .limit(5000);
  if (totals.error) return null;
  const byPatch = new Map<string, number>();
  for (const r of totals.data as { patch: string; games: number }[]) {
    byPatch.set(r.patch, (byPatch.get(r.patch) || 0) + r.games);
  }
  if (!byPatch.size) return { patch: '', rows: [] };
  const patches = [...byPatch.keys()].sort(patchDesc);
  const patch = patches.find(p => (byPatch.get(p) || 0) >= MIN_PATCH_GAMES)
    ?? [...byPatch.entries()].sort((a, b) => b[1] - a[1])[0][0];

  // 2) Alle Zeilen des gewaehlten Patches, seitenweise (PostgREST liefert max. 1000 je Abruf).
  const base = () => supabaseAdmin
    .from('lol_champion_build_stats')
    .select('patch, role, dim, key, stratum, games, wins', { count: 'exact' })
    .eq('region', region).eq('patch', patch).eq('champion', champion).in('tier', tiers)
    .order('role').order('dim').order('key').order('tier').order('stratum');
  const first = await base().range(0, PAGE - 1);
  if (first.error) return null;
  const rows = [...(first.data as StatRow[])];
  const count = first.count ?? rows.length;
  const pages = [];
  for (let from = PAGE; from < count; from += PAGE) pages.push(base().range(from, from + PAGE - 1));
  for (const res of await Promise.all(pages)) {
    if (res.error) return null;
    rows.push(...(res.data as StatRow[]));
  }
  return { patch, rows };
}

type Acc = Map<string, { games: number; wins: number }>;
function add(acc: Acc, key: string, g: number, w: number) {
  const e = acc.get(key);
  if (e) { e.games += g; e.wins += w; } else acc.set(key, { games: g, wins: w });
}
const top = (acc: Acc, n: number) => [...acc.entries()].sort((a, b) => b[1].games - a[1].games).slice(0, n);

// Zeilen einer Rolle -> dieselbe Form wie public/champion-builds-*.json, plus Item-Urteile.
function buildRole(rows: StatRow[]): RoleData {
  const dims: Record<string, Acc> = {};
  const totalStrata: StratumCount[] = [];
  const itemStrata = new Map<string, StratumCount[]>();
  let games = 0, wins = 0;
  for (const r of rows) {
    if (r.dim === 'total') {
      games += r.games; wins += r.wins;
      totalStrata.push({ stratum: r.stratum, games: r.games, wins: r.wins });
      continue;
    }
    if (r.dim === 'item') {
      const list = itemStrata.get(r.key) || [];
      list.push({ stratum: r.stratum, games: r.games, wins: r.wins });
      itemStrata.set(r.key, list);
    }
    add(dims[r.dim] ||= new Map(), r.key, r.games, r.wins);
  }
  const get = (d: string) => dims[d] || new Map();

  const topItems = top(get('item'), 15).map(([k, v]) => ({ item: Number(k), ...v }));
  const itemVerdicts: Record<string, VerdictResult> = {};
  for (const [k, strata] of itemStrata) {
    const v = itemVerdict(totalStrata, strata);
    if (v.verdict) itemVerdicts[k] = v;
  }

  // Schluessel '0' = ohne Stiefel, gehoert nicht in die Stiefel-Liste.
  const bootsAcc = new Map([...get('boots')].filter(([k]) => k !== '0'));
  const counterEntries = [...get('vs').entries()]
    .map(([k, v]) => ({ enemy: k, gamesAgainst: v.games, lossesAgainst: v.games - v.wins }));

  return {
    games,
    wins,
    topBuilds: top(get('build'), 5).map(([k, v]) => ({ items: k.split(',').map(Number), ...v })),
    topBoots: top(bootsAcc, 5).map(([k, v]) => ({ item: Number(k), ...v })),
    topItems,
    topRunes: top(get('rune'), 5).map(([k, v]) => {
      const [primary, keystone, p1, p2, p3, secondary, s1, s2, off, flex, def] = k.split(',').map(Number);
      return { primary, keystone, p1, p2, p3, secondary, s1, s2, off, flex, def, ...v };
    }),
    topKeystones: top(get('keystone'), 5).map(([k, v]) => ({ id: Number(k), ...v })),
    topSummoners: top(get('spells'), 3).map(([k, v]) => ({ spells: k.split(',').map(Number), ...v })),
    counters: pickCounters(counterEntries, games > 0 ? wins / games : NaN),
    itemVerdicts,
  };
}

// Dateien vom alten Sammellauf haben noch die rohe Sortierung (Doppelungen
// zwischen den Listen) — bis zum naechsten Lauf hier dieselbe Regel anwenden.
function rerankFileCounters(roles: Record<string, RoleData | undefined>) {
  const out: Record<string, RoleData | undefined> = {};
  for (const [role, d] of Object.entries(roles)) {
    out[role] = d && d.counters
      ? { ...d, counters: pickCounters([...d.counters.strongAgainst, ...d.counters.weakAgainst], d.games > 0 ? d.wins / d.games : NaN) }
      : d;
  }
  return out;
}

function readJsonFile(region: string): BuildsFile | null {
  // Region maps to file suffix: euw1 -> euw, kr -> kr
  const file = join(process.cwd(), 'public', `champion-builds-${region.replace(/\d+$/, '')}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function orderRoles(roles: Record<string, RoleData | undefined>, requestedRole: string | null) {
  const wanted = requestedRole ? ROLE_PARAM[requestedRole.toLowerCase()] : null;
  const filtered = wanted ? { [wanted]: roles[wanted] } : roles;
  // Sort roles by games desc so frontend can default-pick the most-played one
  return Object.fromEntries(
    Object.entries(filtered)
      .filter((e): e is [string, RoleData] => !!e[1] && e[1].games > 0)
      .sort((a, b) => b[1].games - a[1].games),
  );
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  // Die Region landet in einem Dateinamen (readJsonFile), deshalb nur bekannte Werte.
  const region = parseRegion(searchParams.get('region'), { fallback: 'euw1' });
  if (!region) {
    return NextResponse.json({ error: 'Invalid region' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const requestedRole = searchParams.get('role'); // null = return all roles
  const rankParam = (searchParams.get('rank') || '').toUpperCase();
  const rank = RANK_REGIONS.has(region) && (RANK_OPTIONS as readonly string[]).includes(rankParam) ? rankParam : null;

  const championKey = await resolveChampionKey(id);
  if (!championKey) {
    return NextResponse.json({ error: 'Champion not found' }, { status: 404 });
  }

  // Rang-Daten aus Supabase; fehlen sie, gilt die Datei (alle Raenge, source: 'json').
  let dbDown = false;
  if (rank) {
    const db = await loadDbRows(region, Number(championKey), LOL_RANK_GROUPS[rank]);
    if (db === null) dbDown = true;
    // Unter MIN_DB_GAMES (Anlaufphase, seltene Champions) waeren die Top-Builds
    // Zufall — dann lieber die Datei ueber alle Raenge.
    else if (db.rows.reduce((s, r) => s + (r.dim === 'total' ? r.games : 0), 0) >= MIN_DB_GAMES) {
      const byRole = new Map<string, StatRow[]>();
      for (const r of db.rows) {
        const list = byRole.get(r.role) || [];
        list.push(r);
        byRole.set(r.role, list);
      }
      const roles: Record<string, RoleData> = {};
      for (const [role, rows] of byRole) roles[role] = buildRole(rows);
      const ordered = orderRoles(roles, requestedRole);
      const sampleSize = Object.values(roles).reduce((s, r) => s + r.games, 0);
      const ddragonVersion = (await latestDdragonVersion()) ?? readJsonFile(region)?.ddragonVersion;
      if (ddragonVersion && Object.keys(ordered).length) {
        return cachedJson({
          championKey,
          region,
          source: 'db',
          rank,
          patch: db.patch,
          sampleSize,
          hasBuilds: true,
          ddragonVersion,
          matchesAnalyzed: sampleSize,
          roles: ordered,
        }, { cache: STATS_CACHE_CONTROL });
      }
    }
  }

  const payload = readJsonFile(region);
  const base = { championKey, region, source: 'json' as const, rank: null };
  if (!payload) {
    return cachedJson({ ...base, hasBuilds: false, roles: {} }, { degraded: dbDown });
  }
  const ordered = orderRoles(rerankFileCounters(payload.byChampionRole?.[championKey] || {}), requestedRole);
  return cachedJson({
    ...base,
    hasBuilds: Object.keys(ordered).length > 0,
    collectedAt: payload.collectedAt,
    ddragonVersion: payload.ddragonVersion,
    matchesAnalyzed: payload.matchesAnalyzed,
    roles: ordered,
  }, { cache: STATS_CACHE_CONTROL, degraded: dbDown });
}
