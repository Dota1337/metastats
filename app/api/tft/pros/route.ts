import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { cachedJson, SLOW_CACHE_CONTROL } from '../../../lib/api-cache';

// /api/tft/pros
//
// Multi-Source-aware pro listing. Replaces the old "all Liquipedia pros" view
// with a classified roster (tpc / tournament / streamer / historic / inactive)
// so the page can default to verified pros and hide the long tail of
// streamer/historic entries behind opt-in toggles.
//
// Filters:
//   classification = csv of (tpc|tournament|streamer|historic|inactive). Default:
//                    tpc,tournament — verified set the page lands on.
//                    Pass "all" to bypass.
//   region         = single platform routing (euw1, kr, …)
//   team           = exact team name
//   min_confidence = int 0-100, default 0
//
// Single-pro lookup via ?puuid=… still works (used by player badge upgrade).

const DEFAULT_CLASSIFICATIONS = ['tpc', 'tournament'];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const puuid = searchParams.get('puuid');

  if (puuid) {
    const { data, error } = await supabaseAdmin
      .from('tft_pro_players')
      .select('*')
      .eq('puuid', puuid)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    // Kein Edge-Cache fuer den Einzelabruf: der Schluesselraum ist eine PUUID
    // pro Spieler und damit praktisch unbegrenzt. Jeder Eintrag waere ein
    // eigener Cache-Key mit Trefferquote nahe null — nur Ballast, gegen den
    // sich ausserdem bequem der Cache mit Muell fuellen liesse.
    return NextResponse.json({ pro: data || null }, { headers: { 'Cache-Control': 'no-store' } });
  }

  // Classification filter — comma-separated, "all" = no filter.
  const classRaw = searchParams.get('classification');
  let classifications: string[] | null;
  if (!classRaw) {
    classifications = DEFAULT_CLASSIFICATIONS;
  } else if (classRaw === 'all') {
    classifications = null;
  } else {
    const allowed = new Set(['tpc', 'tournament', 'streamer', 'historic', 'inactive']);
    classifications = classRaw.split(',').map(s => s.trim()).filter(s => allowed.has(s));
    if (classifications.length === 0) classifications = DEFAULT_CLASSIFICATIONS;
  }

  const region = searchParams.get('region');
  const team = searchParams.get('team');
  const minConfidence = Math.max(0, Math.min(100, parseInt(searchParams.get('min_confidence') || '0', 10)));
  const limit = Math.max(1, Math.min(1000, parseInt(searchParams.get('limit') || '500', 10)));

  const { data, error } = await supabaseAdmin.rpc('get_tft_pros_classified', {
    p_classifications: classifications,
    p_region: region || null,
    p_team: team || null,
    p_min_confidence: minConfidence,
    p_limit: limit,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Aggregate counts for filter chips and tab badges. Cheap second query — same
  // table, no join. Tab badges (classCounts) span ALL classifications so each
  // tab shows its own total. Region/team chips MUST count the same
  // classification set the active tab renders — the old hardcoded
  // tpc+tournament+streamer set showed "EUW 42" while the verified tab
  // rendered 6 rows (badge ≠ list, user-visible bug 2026-07-05).
  const { data: allClassified } = await supabaseAdmin
    .from('tft_pro_players')
    .select('classification,region,team,tpc_verified,tpc_region', { head: false });

  const classCounts: Record<string, number> = {};
  const regionCounts: Record<string, number> = {};
  const teamCounts: Record<string, number> = {};
  const tpcRegionCounts: Record<string, number> = {};
  for (const row of (allClassified || []) as any[]) {
    const c = row.classification || 'inactive';
    classCounts[c] = (classCounts[c] || 0) + 1;
    if (!classifications || classifications.includes(c)) {
      regionCounts[row.region] = (regionCounts[row.region] || 0) + 1;
      if (row.team) teamCounts[row.team] = (teamCounts[row.team] || 0) + 1;
    }
    if (row.tpc_verified && row.tpc_region) {
      tpcRegionCounts[row.tpc_region] = (tpcRegionCounts[row.tpc_region] || 0) + 1;
    }
  }

  // Das Roster kommt aus dem Pro-Crawl und bewegt sich taeglich, nicht
  // minuetlich — 1h frisch, 24h stale-while-revalidate.
  //
  // `degraded`, wenn der zweite Query (die Zaehl-Abfrage) nichts geliefert hat:
  // dann stehen alle Badges auf 0, obwohl die Liste Eintraege hat. Das ist eine
  // 200er-Antwort mit kaputtem Inhalt, und die darf nicht eine Stunde lang
  // festgeschrieben werden.
  return cachedJson({
    pros: data || [],
    count: data?.length || 0,
    classifications,
    classCounts,
    regionCounts,
    teamCounts,
    tpcRegionCounts,
  }, {
    cache: SLOW_CACHE_CONTROL,
    degraded: Object.keys(classCounts).length === 0,
  });
}
