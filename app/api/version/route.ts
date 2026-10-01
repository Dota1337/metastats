import { NextResponse } from 'next/server';
import { getLatestDdragonVersion } from '../../lib/ddragon-version-server';
import { cacheHeaders, SLOW_CACHE_CONTROL } from '../../lib/api-cache';

// Aktuelle DataDragon-Version. Eine Stunde an der Edge gecacht, damit nicht
// jeder Seitenaufruf bei Riot nachfragt.
export async function GET() {
  try {
    const version = await getLatestDdragonVersion();
    if (!version) throw new Error('keine Version');
    return NextResponse.json({ version }, { headers: cacheHeaders(SLOW_CACHE_CONTROL, 'lol-api') });
  } catch {
    return NextResponse.json({ error: 'Version nicht verfügbar' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
