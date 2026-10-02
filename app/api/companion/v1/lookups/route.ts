// Namen, Bilder, Item-Rezepte und Shop-Wahrscheinlichkeiten des laufenden Sets
// fuer die Overwolf-App. Aendert sich nur mit Set bzw. Patch.
import { NextRequest } from 'next/server';
import type { TftAssetsBundle } from '../../../../lib/tft-cdragon';
import {
  COMPANION_API_VERSION, companionJson, companionPreflight, toCompanionLookups,
} from '../../../../lib/companion-api';

export function OPTIONS() {
  return companionPreflight();
}

export async function GET(request: NextRequest) {
  const assets = await fetch(`${request.nextUrl.origin}/tft-assets.json`)
    .then(r => (r.ok ? r.json() as Promise<TftAssetsBundle> : null))
    .catch(() => null);
  if (!assets) {
    return companionJson(
      { v: COMPANION_API_VERSION, error: 'assets_unavailable' },
      { status: 503, cdn: 'no-store', browser: 'no-store' },
    );
  }
  return companionJson(toCompanionLookups(assets), {
    cdn: 'public, s-maxage=21600, stale-while-revalidate=86400',
    browser: 'public, max-age=3600',
  });
}
