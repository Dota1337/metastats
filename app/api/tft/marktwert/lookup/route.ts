import { NextRequest, NextResponse } from 'next/server';
import { CURRENT_SET } from '../../../../lib/current-set';
import { supabaseAdmin } from '../../../../lib/supabase';
import { cachedJson } from '../../../../lib/api-cache';
import { parseRegion, REGION_ALL } from '../../../../lib/regions';

// /api/tft/marktwert/lookup?region=euw1&puuids=a,b,c
//
// Neuester Marktwert je Spieler fuer genau die Spieler, die die Rangliste
// gerade zeigt. Die Top-500-Wertliste (../leaderboard) trifft dort nur einen
// Teil: EUW "Alle" 340 von 500 Spielern, 403 haben einen Wert (2026-09-27).
//
// Das 14-Tage-Fenster ist kein Datenfilter, sondern haelt die Antwort unter
// dem 1.000-Zeilen-Deckel der Datenbank-Schnittstelle (gemessen: 206,
// content-range 0-999). Jeder Spieler bekommt taeglich einen Stand, also
// hoechstens 14 x 50 = 700 Zeilen; ohne Fenster waeren es bis zu 28 je
// Spieler seit Set-Start und der Deckel schnitte still ab.
//
// region=all (weltweite Rangliste): dieselbe puuid kann in mehreren Regionen
// stehen (gemessen 6 unter den Master+-Spielern), deshalb heissen die
// Schluessel dort "region:puuid" statt nur "puuid".

const MAX_PUUIDS = 50;
const WINDOW_DAYS = 14;
const PUUID_RE = /^[A-Za-z0-9_-]{78}$/;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const region = parseRegion(searchParams.get('region'), { allowAll: true });
  const isWorld = region === REGION_ALL;
  if (!region) return NextResponse.json({ error: 'invalid_region' }, { status: 400 });

  const puuids = [...new Set((searchParams.get('puuids') || '').split(',').filter(Boolean))];
  if (puuids.length === 0 || puuids.length > MAX_PUUIDS || !puuids.every(p => PUUID_RE.test(p))) {
    return NextResponse.json({ error: 'invalid_puuids' }, { status: 400 });
  }

  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  let query = supabaseAdmin
    .from('tft_player_marketvalue_snapshots')
    .select('region, puuid, final_value, snapshot_date')
    .eq('set_number', CURRENT_SET)
    .in('puuid', puuids)
    .gte('snapshot_date', since);
  if (!isWorld) query = query.eq('region', region);
  const { data, error } = await query
    .order('snapshot_date', { ascending: false })
    .limit(1000);

  // Fehler kurz zwischenspeichern: ein ungecachter Fehler wuerde jeden
  // Seitenaufruf erneut gegen die Datenbank schicken.
  if (error) {
    return cachedJson({ region, values: {} }, { degraded: true });
  }

  // Absteigend sortiert → der erste Treffer je Spieler ist der neueste.
  const values: Record<string, number> = {};
  for (const row of data || []) {
    const key = isWorld ? `${row.region}:${row.puuid}` : row.puuid;
    if (!(key in values) && typeof row.final_value === 'number') values[key] = row.final_value;
  }
  return cachedJson({ region, values });
}
