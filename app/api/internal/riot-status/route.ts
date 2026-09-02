// Riot-TFT-Plattformstatus für das Internal-Ops-Dashboard.
//
// Die Abfrage-Logik liegt seit 02.09.2026 in app/lib/riot-status.ts, weil sie
// sich das oeffentliche Banner (app/api/tft/status) teilt. Was hier bleibt,
// ist die Ausgabe-Entscheidung: das Dashboard bekommt Riots eigenen
// Meldungstext und die Fehlerdetails, das oeffentliche Gegenstueck nicht.
//
// Pattern wie ops-snapshot: force-dynamic + no-store. Der In-Process-Cache in
// der Lib (5 min) haelt die Riot-Quota klein — 15 Regionen alle 5 min sind
// 3 Anfragen pro Minute.

import { NextRequest, NextResponse } from 'next/server';
import { getRiotStatus } from '@/app/lib/riot-status';

export const dynamic = 'force-dynamic';

// Auth-Schutz: middleware.ts hat Early-Return-Branch für /api/internal/*
// und validiert den __metastats_internal Cookie. Hier braucht's daher
// keinen expliziten Auth-Check (siehe reference_internal_ops_dashboard.md).

export async function GET(_request: NextRequest) {
  const apiKey = process.env.RIOT_API_KEY_TFT;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'RIOT_API_KEY_TFT not configured', regions: [] },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const { at, regions } = await getRiotStatus(apiKey);

  return NextResponse.json(
    { cachedAt: new Date(at).toISOString(), regions },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
