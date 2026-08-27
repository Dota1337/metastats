import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';
import { cachedJson } from '../../../../lib/api-cache';
import { CURRENT_SET_START_DATE } from '../../../../lib/current-set';

// /api/tft/marktwert/history?puuid=...&region=euw1&days=30
// /api/tft/marktwert/history?puuid=...&region=euw1&from=2026-04-15
//
// Returns the daily-snapshot time-series for one player, newest first.
// Used by the line-chart on the player page. Calls the RPC defined in
// supabase/migrations/0007_tft_player_marketvalue_snapshots.sql.
//
// `from` (ISO YYYY-MM-DD) wins over `days` when both are present. The
// player-page hero uses it to scope the sparkline to the current TFT set.
//
// Der Set-Schnitt gilt aber fuer JEDEN Aufrufer, nicht nur fuer den, der
// `from` mitschickt: der Multiplikator kommt aus der Population des laufenden
// Sets. Eine Linie ueber den Set-Wechsel hinweg vergleicht zwei verschiedene
// Grundgesamtheiten und zeigt am Wechseltag einen Sprung, der keine
// Leistungsaenderung ist. Der Spielervergleich fragt z.B. pauschal 30 Tage.

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const puuid = searchParams.get('puuid') || '';
  const region = (searchParams.get('region') || 'euw1').toLowerCase();
  const from = searchParams.get('from') || '';

  let days: number;
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    const fromMs = new Date(from + 'T00:00:00Z').getTime();
    const todayMs = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
    const computed = Math.ceil((todayMs - fromMs) / 86_400_000) + 1;
    days = Math.max(1, Math.min(365, computed));
  } else {
    days = Math.max(1, Math.min(365, parseInt(searchParams.get('days') || '30', 10)));
  }

  // Schnitt am Set-Start. Ist das Datum unbekannt, bleibt das Fenster wie
  // angefragt — lieber eine zu lange Linie als gar keine.
  if (CURRENT_SET_START_DATE) {
    const startMs = new Date(CURRENT_SET_START_DATE + 'T00:00:00Z').getTime();
    const todayMs = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
    const sinceSetStart = Math.floor((todayMs - startMs) / 86_400_000) + 1;
    if (sinceSetStart >= 1) days = Math.min(days, sinceSetStart);
  }

  if (!puuid) return NextResponse.json({ error: 'puuid fehlt' }, { status: 400 });

  const { data, error } = await supabaseAdmin.rpc('get_tft_marketvalue_history', {
    p_puuid: puuid,
    p_region: region,
    p_days: days,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // RPC returns newest first; the chart wants oldest→newest for left→right
  // rendering. Reverse here so the consumer doesn't need to.
  // Der Tages-Deckel oben ist nur die Grobmaske: die RPC rechnet ihr Fenster
  // ab heute rueckwaerts und liefert dabei noch den Vortag des Set-Starts mit
  // (gemessen 2026-08-27: days=2 lieferte den 25.08.). Der Schnitt muss
  // deshalb am Datum selbst passieren.
  const cutoff = CURRENT_SET_START_DATE;
  const inSet = (d: unknown) => !cutoff || String(d).slice(0, 10) >= cutoff;

  const series = (data || [])
    .filter((row: any) => inSet(row.snapshot_date))
    .map((row: any) => ({
      date: row.snapshot_date,
      tier: row.tier,
      rank: row.rank,
      lp: row.lp,
      ladderRank: row.ladder_rank,
      baseValue: row.base_value,
      multiplier: Number(row.multiplier),
      finalValue: row.final_value,
      sampleSize: row.sample_size,
    }))
    .reverse();

  return cachedJson({ region, puuid, days, series });
}
