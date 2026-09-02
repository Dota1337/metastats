import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';
import { cachedJson } from '../../../../lib/api-cache';
import tftSet from '../../../../../public/tft-set.json' with { type: 'json' };

// /api/tft/marktwert/peaks?puuid=...
//
// Liefert den hoechsten je erreichten Marktwert des Spielers, eine Zeile je
// Set, neuestes Set zuerst. Quelle ist tft_player_marketvalue_peaks
// (supabase/migrations/0061), gefuellt von scripts/freeze-marketvalue-peaks.mjs.
//
// Service-Role ist Pflicht, nicht Bequemlichkeit: Migration 0066 hat die
// anon-Policy gedroppt und `select` von anon/authenticated entzogen. Ein
// Browser-Client sieht die Tabelle nicht — der Umweg ueber diese Route ist der
// einzige Lesepfad.
//
// Es gibt bewusst KEINEN set-Parameter: die Auswahl, welches Set angezeigt
// wird, trifft die Oberflaeche (Drop-Down). Die Route liefert alles, was der
// Spieler hat, und filtert nichts weg.
//
// Kein Rang/LP in der Antwort, obwohl die Tabelle beides fuehrt: das Profil
// zeigt bereits einen Set-Hoechstrang aus tft_player_rank_history, und die
// beiden Quellen widersprechen sich (gemessen 2026-09-02: 163 Spieler in
// beiden, 100 davon mit abweichendem Tier). Zwei verschiedene Hoechstraenge
// auf derselben Seite waeren ein Fehler, kein Mehrwert.

interface SetHistoryEntry { setNumber?: unknown; setName?: unknown }

// Set-Nummer → Marketing-Name, aus dem laufenden Set plus der Historie in
// public/tft-set.json. Fehlt ein Name, bleibt das Feld null und die
// Oberflaeche zeigt nur "Set N" — kein geratener Name.
function buildSetNames(): Record<number, string | null> {
  const out: Record<number, string | null> = {};
  const put = (num: unknown, name: unknown) => {
    if (!Number.isInteger(num)) return;
    const n = Number(num);
    const trimmed = typeof name === 'string' ? name.trim() : '';
    // detect-tft-set.mjs traegt als Platzhalter "Set N" ein, solange Riot
    // keinen Namen veroeffentlicht hat. Der darf nicht als Name durchgehen,
    // sonst steht im Drop-Down "Set 18 · Set 18".
    const isPlaceholder = trimmed === `Set ${n}` || trimmed === `Set${n}`;
    out[n] = trimmed && !isPlaceholder ? trimmed : null;
  };
  const root = tftSet as { setNumber?: unknown; setName?: unknown; history?: unknown };
  put(root.setNumber, root.setName);
  for (const entry of (Array.isArray(root.history) ? root.history : []) as SetHistoryEntry[]) {
    put(entry?.setNumber, entry?.setName);
  }
  return out;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const puuid = searchParams.get('puuid') || '';

  if (!puuid) return NextResponse.json({ error: 'puuid fehlt' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from('tft_player_marketvalue_peaks')
    .select('set_number, region, final_value, snapshot_date')
    .eq('puuid', puuid)
    .order('set_number', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const names = buildSetNames();

  const peaks = (data || []).map((row: {
    set_number: number;
    region: string | null;
    final_value: number;
    snapshot_date: string;
  }) => ({
    setNumber: row.set_number,
    setName: names[row.set_number] ?? null,
    region: row.region,
    value: row.final_value,
    // snapshot_date ist ein DATE. Postgres/Supabase liefert es je nach Pfad mit
    // Zeitanteil zurueck; ueber new Date() formatiert wandert der Tag dann je
    // nach Browser-Zone um eins. Deshalb hier auf den reinen Datumsteil kuerzen
    // und ihn genau so weiterreichen — dieselbe Falle wie in history/route.ts.
    date: String(row.snapshot_date).slice(0, 10),
  }));

  // Leeres Ergebnis ist kein Fehler: Spieler unterhalb Diamond und Spieler mit
  // weniger als 40 Spielen im Set haben nie eine Zeile. Status 200 mit leerer
  // Liste, damit die Oberflaeche einfach nichts rendert.
  return cachedJson({ puuid, peaks });
}
