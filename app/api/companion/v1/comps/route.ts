// Comp-Liste fuer die Overwolf-App. Dieselben Familien wie /tft/comps (Top 40,
// nur aktuelles Set), auf das zugeschnitten, was die App anzeigt, statt der
// Rohzeilen. Die Daten kommen aus der bestehenden Comps-Route im selben
// Prozess, damit es nur einen Lesepfad zur Datenbank gibt.
import { NextRequest } from 'next/server';
import { GET as compsGET } from '../../../tft/comps/route';
import { buildCompFamilies, currentSetFamilies, topFamilyKeys } from '../../../../lib/tft-comp-families';
import { resolveCutoffs } from '../../../../lib/tft-tier-letter';
import type { TftAssetsBundle } from '../../../../lib/tft-cdragon';
import {
  COMPANION_API_VERSION, companionJson, companionPreflight, toCompanionComp,
  type CompanionCompsResponse,
} from '../../../../lib/companion-api';

export const maxDuration = 60;

const NO_STORE = { cdn: 'no-store', browser: 'no-store' };

export function OPTIONS() {
  return companionPreflight();
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  // Region/Bucket prueft die Comps-Route selbst; hier nur Laenge und Zeichen.
  const region = /^[a-z0-9_]{2,20}$/.test(sp.get('region') || '') ? sp.get('region')! : 'all';
  const bucket = /^[a-z_]{3,20}$/.test(sp.get('bucket') || '') ? sp.get('bucket')! : 'master_plus';
  const daysRaw = parseInt(sp.get('days') || '3', 10);
  const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(14, daysRaw)) : 3;

  const origin = request.nextUrl.origin;
  const inner = new URL('/api/tft/comps', origin);
  inner.search = new URLSearchParams({
    patch: 'current', bucket, days: String(days), region, bucketAuto: '1', source: 'data',
  }).toString();

  const [res, assets, cutoffBundle] = await Promise.all([
    compsGET(new NextRequest(inner)),
    fetch(`${origin}/tft-assets.json`).then(r => (r.ok ? r.json() as Promise<TftAssetsBundle> : null)).catch(() => null),
    fetch(`${origin}/tft-tier-cutoffs.json`).then(r => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  if (!res.ok) {
    return companionJson({ v: COMPANION_API_VERSION, error: 'comps_unavailable' }, { status: 503, ...NO_STORE });
  }
  const body = await res.json() as {
    comps?: Parameters<typeof buildCompFamilies>[0];
    filters?: { patch?: string; set?: number; bucket?: string; days?: number; region?: string };
  };
  const families = currentSetFamilies(buildCompFamilies(body.comps ?? [], 'avg', assets), assets);
  const top = topFamilyKeys(families);
  const shown = top ? families.filter(f => top.has(f.familyKey)) : families;
  const set = body.filters?.set ?? assets?.set ?? null;
  const cutoffs = cutoffBundle ? resolveCutoffs(cutoffBundle, set) : null;

  const out: CompanionCompsResponse = {
    v: COMPANION_API_VERSION,
    set,
    patch: body.filters?.patch ?? null,
    filters: {
      region: body.filters?.region ?? region,
      bucket: body.filters?.bucket ?? bucket,
      days: body.filters?.days ?? days,
    },
    generatedAt: new Date().toISOString(),
    comps: shown.map(f => toCompanionComp(f, assets, cutoffs)),
  };
  return companionJson(out, { cdn: 'public, s-maxage=1800, stale-while-revalidate=21600' });
}
