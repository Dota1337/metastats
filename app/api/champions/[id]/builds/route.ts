import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

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
}
interface BuildsFile {
  region: string;
  collectedAt: string;
  matchesAnalyzed: number;
  ddragonVersion: string;
  byChampionRole: Record<string, Record<string, RoleData>>;
}

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

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const region = (searchParams.get('region') || 'euw1').toLowerCase();
  const requestedRole = searchParams.get('role'); // null = return all roles

  const championKey = await resolveChampionKey(id);
  if (!championKey) {
    return NextResponse.json({ error: 'Champion not found' }, { status: 404 });
  }

  // Region maps to file suffix: euw1 -> euw, kr -> kr
  const regionSuffix = region.replace(/\d+$/, '');
  const file = join(process.cwd(), 'public', `champion-builds-${regionSuffix}.json`);
  if (!existsSync(file)) {
    return NextResponse.json({ championKey, region, hasBuilds: false, roles: {} });
  }

  let payload: BuildsFile;
  try {
    payload = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return NextResponse.json({ championKey, region, hasBuilds: false, roles: {} });
  }

  const championRoles = payload.byChampionRole?.[championKey] || {};
  const roleMap: Record<string, string> = {
    top: 'TOP', jungle: 'JUNGLE', mid: 'MIDDLE', adc: 'BOTTOM', support: 'UTILITY',
  };
  const filtered = requestedRole && roleMap[requestedRole.toLowerCase()]
    ? { [roleMap[requestedRole.toLowerCase()]]: championRoles[roleMap[requestedRole.toLowerCase()]] }
    : championRoles;

  // Sort roles by games desc so frontend can default-pick the most-played one
  const orderedRoles = Object.entries(filtered)
    .filter(([, data]) => data && data.games > 0)
    .sort((a, b) => (b[1] as RoleData).games - (a[1] as RoleData).games);

  return NextResponse.json({
    championKey,
    region,
    hasBuilds: orderedRoles.length > 0,
    collectedAt: payload.collectedAt,
    ddragonVersion: payload.ddragonVersion,
    matchesAnalyzed: payload.matchesAnalyzed,
    roles: Object.fromEntries(orderedRoles),
  });
}
