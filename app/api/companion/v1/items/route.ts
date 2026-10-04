// Items fuer die Overwolf-App: Liste (Platz, Top 4, Sieg, Spiele, haeufigste
// Traeger) und mit ?id= die Traeger mit ihrem Ergebnis. Duenne Huelle um
// /api/tft/items im selben Prozess.
import { NextRequest } from 'next/server';
import { GET as itemsGET } from '../../../tft/items/route';
import {
  COMPANION_API_VERSION, companionJson, companionPreflight, companionStats,
  type CompanionItemDetail, type CompanionItemsResponse,
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
  if (id != null && !/^[A-Za-z0-9_]{2,80}$/.test(id)) {
    return companionJson({ v: COMPANION_API_VERSION, error: 'bad_id' }, { status: 400, ...NO_STORE });
  }
  const inner = new URL('/api/tft/items', request.nextUrl.origin);
  inner.search = new URLSearchParams({
    region, patch: 'current', bucket: 'master_plus', days: '3', bucketAuto: '1', ...(id ? { id } : {}),
  }).toString();
  const res = await itemsGET(new NextRequest(inner));
  if (!res.ok) {
    return companionJson({ v: COMPANION_API_VERSION, error: 'items_unavailable' }, { status: 503, ...NO_STORE });
  }
  const body = await res.json().catch(() => null) as {
    filters?: { patch?: string; set?: number };
    items?: Array<RawStats & { apiName: string; pickRate?: number | null; topUsers?: string[] }>;
    item?: (RawStats & { apiName: string; topUsers?: Array<RawStats & { characterId: string }> }) | null;
  } | null;
  if (!body) {
    return companionJson({ v: COMPANION_API_VERSION, error: 'items_unavailable' }, { status: 503, ...NO_STORE });
  }

  if (id) {
    const it = body.item;
    if (!it) return companionJson({ v: COMPANION_API_VERSION, error: 'not_found' }, { status: 404, ...NO_STORE });
    const out: CompanionItemDetail = {
      v: COMPANION_API_VERSION,
      id: it.apiName,
      ...companionStats(it),
      users: (it.topUsers || []).map(u => ({ id: u.characterId, ...companionStats(u) })),
    };
    return companionJson(out, CACHE);
  }

  const out: CompanionItemsResponse = {
    v: COMPANION_API_VERSION,
    set: body.filters?.set ?? null,
    patch: body.filters?.patch ?? null,
    items: (body.items || []).map(i => ({
      id: i.apiName,
      ...companionStats(i),
      pick: i.pickRate == null ? null : Number(i.pickRate.toFixed(4)),
      users: (i.topUsers || []).filter(u => typeof u === 'string').slice(0, 8),
    })),
  };
  return companionJson(out, CACHE);
}
