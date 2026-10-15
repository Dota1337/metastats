import { NextRequest, NextResponse } from 'next/server';
import { resolveFilters } from '../../../lib/tft-supabase-reader';
import { isSnapshotPublisher } from '../../../lib/snapshot-lookup';
import { loadItemCarriers, loadUnitBuilds, lookupDetailBuildsStock } from '../../../lib/tft-detail-builds';
import { cachedJson } from '../../../lib/api-cache';

// Vorrat der Item-Bloecke fuer die Unit- und Item-Detailseiten (0096): ALLE
// Units und Items einer Filter-Kombination in einem Stand. Der Publisher holt
// ihn fuer die Standardansicht (Matrix-Endpunkt `detail-builds`) und legt ihn
// ab; die Detail-Routen und die Startdaten lesen ihn (app/lib/tft-detail-builds.ts).
//
// Live gerechnet wird nur fuer den Publisher — fuer alle anderen gibt es den
// abgelegten Stand oder nichts. Die Abfrage ueber alle Units ist zu schwer, um
// sie jedem Aufrufer zu oeffnen.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const publisher = isSnapshotPublisher(request);
  try {
    const filters = await resolveFilters(searchParams, { publisher });
    const meta = {
      region: filters.regionLabel,
      bucket: filters.bucketLabel,
      days: filters.days,
      requestedDays: filters.requestedDays,
      patch: filters.patch,
      patchFilter: filters.patchFilter,
      set: filters.setNumber,
      startDay: filters.startDay,
      endDay: filters.endDay,
    };
    if (!publisher) {
      const stock = await lookupDetailBuildsStock(filters);
      return stock ? cachedJson(stock) : NextResponse.json({ hasData: false, filters: meta });
    }
    const [units, items] = await Promise.all([loadUnitBuilds(filters, null), loadItemCarriers(filters, null)]);
    const hasData = Object.keys(units).length > 0 || Object.keys(items).length > 0;
    return NextResponse.json({ hasData, filters: meta, units, items });
  } catch (e) {
    console.error('[detail-builds]', (e as Error).message);
    return NextResponse.json({ hasData: false, error: 'unavailable' }, { status: 503 });
  }
}
