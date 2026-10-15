import { NextRequest, NextResponse } from 'next/server';
import { cachedJson, ASSET_CACHE_CONTROL } from '../../lib/api-cache';
import { loadChampionList } from '../../lib/lol-champion-list';
import { parseChampionListFilters } from '../../lib/lol-champion-filters';

// Rechnung in app/lib/lol-champion-list.ts — dieselbe Funktion liefert die
// Startdaten der Seite /champions (SEO-Plan Schritt 6).
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const filters = parseChampionListFilters(searchParams);

  try {
    const result = await loadChampionList(filters);
    if (!result) {
      return NextResponse.json({ error: 'Champion-Daten nicht verfügbar' }, { status: 502 });
    }
    return cachedJson(result.payload, { cache: ASSET_CACHE_CONTROL, degraded: result.degraded });
  } catch {
    return NextResponse.json({ error: 'Server Fehler' }, { status: 500 });
  }
}
