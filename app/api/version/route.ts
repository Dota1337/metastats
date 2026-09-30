import { NextResponse } from 'next/server';
import { cacheHeaders, SLOW_CACHE_CONTROL } from '../../lib/api-cache';

// Aktuelle DataDragon-Version. Eine Stunde an der Edge gecacht, damit nicht
// jeder Seitenaufruf bei Riot nachfragt.
export async function GET() {
  try {
    const res = await fetch('https://ddragon.leagueoflegends.com/api/versions.json', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error('ddragon ' + res.status);
    const versions = await res.json();
    const version = Array.isArray(versions) ? versions[0] : null;
    if (typeof version !== 'string' || !version) throw new Error('keine Version');
    return NextResponse.json({ version }, { headers: cacheHeaders(SLOW_CACHE_CONTROL, 'lol-api') });
  } catch {
    return NextResponse.json({ error: 'Version nicht verfügbar' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
