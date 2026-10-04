// Units fuer die Overwolf-App: Liste (Platz, Top 4, Sieg, Spiele, meistgebaute
// Items) und mit ?id= die Detail-Werte (Items und Item-Sets mit Ergebnis).
// Duenne Huelle um /api/tft/units im selben Prozess, damit App und Seite
// dieselben Zahlen zeigen.
import { NextRequest } from 'next/server';
import { GET as unitsGET } from '../../../tft/units/route';
import {
  COMPANION_API_VERSION, companionJson, companionPreflight, companionStats,
  type CompanionUnitDetail, type CompanionUnitsResponse,
} from '../../../../lib/companion-api';

export const maxDuration = 60;

const NO_STORE = { cdn: 'no-store', browser: 'no-store' };
const CACHE = { cdn: 'public, s-maxage=1800, stale-while-revalidate=21600' };

export function OPTIONS() {
  return companionPreflight();
}

interface RawStats { games?: number; avgPlacement?: number | null; top4Rate?: number | null; top1Rate?: number | null }

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const region = /^[a-z0-9_]{2,20}$/.test(sp.get('region') || '') ? sp.get('region')! : 'all';
  const id = sp.get('id');
  if (id != null && !/^[A-Za-z0-9_]{2,60}$/.test(id)) {
    return companionJson({ v: COMPANION_API_VERSION, error: 'bad_id' }, { status: 400, ...NO_STORE });
  }
  const inner = new URL('/api/tft/units', request.nextUrl.origin);
  inner.search = new URLSearchParams({
    region, patch: 'current', bucket: 'master_plus', days: '3', bucketAuto: '1', ...(id ? { id } : {}),
  }).toString();
  const res = await unitsGET(new NextRequest(inner));
  if (!res.ok) {
    return companionJson({ v: COMPANION_API_VERSION, error: 'units_unavailable' }, { status: 503, ...NO_STORE });
  }
  const body = await res.json().catch(() => null) as {
    filters?: { patch?: string; set?: number };
    set?: number; patch?: string;
    units?: Array<RawStats & { characterId: string; pickRate?: number | null; topItems?: Array<{ item: string }> }>;
    unit?: (RawStats & {
      characterId: string;
      topItems?: Array<RawStats & { item: string }>;
      topItemSets?: Array<RawStats & { items: string[] }>;
    }) | null;
  } | null;
  if (!body) {
    return companionJson({ v: COMPANION_API_VERSION, error: 'units_unavailable' }, { status: 503, ...NO_STORE });
  }

  if (id) {
    const u = body.unit;
    if (!u) return companionJson({ v: COMPANION_API_VERSION, error: 'not_found' }, { status: 404, ...NO_STORE });
    const out: CompanionUnitDetail = {
      v: COMPANION_API_VERSION,
      id: u.characterId,
      ...companionStats(u),
      items: (u.topItems || []).map(x => ({ id: x.item, ...companionStats(x) })),
      itemSets: (u.topItemSets || []).map(x => ({ items: x.items, ...companionStats(x) })),
    };
    return companionJson(out, CACHE);
  }

  const out: CompanionUnitsResponse = {
    v: COMPANION_API_VERSION,
    set: body.filters?.set ?? null,
    patch: body.filters?.patch ?? null,
    units: (body.units || []).map(u => ({
      id: u.characterId,
      ...companionStats(u),
      pick: u.pickRate == null ? null : Number(u.pickRate.toFixed(4)),
      items: (u.topItems || []).map(t => t.item).slice(0, 6),
    })),
  };
  return companionJson(out, CACHE);
}
