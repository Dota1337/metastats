// Wie viele verschiedene Shop-Einheiten es je Kostenstufe gibt.
//
// Warum abgeleitet und nicht getippt: die Zahl stand bis 2026-09-25 als
// Konstante in app/tft/tools/odds/page.tsx und war schon fuer Set 17 falsch
// (18/13/13/14/10 statt 14/13/13/14/9) — PvE-Monster, Trainingspuppe und
// Ausruestungs-Amboss waren als Shop-Einheiten mitgezaehlt. Niemand hat es
// bemerkt, weil kein Waechter darauf schaute. Die Zahl ist der Nenner jeder
// Roll-Wahrscheinlichkeit; ist sie falsch, ist die ganze Seite falsch.
//
// Diese Datei liest das Asset-Bundle mit `fs` und gehoert deshalb
// ausschliesslich in Server-Components. Das Bundle ist ~2,1 MB und darf nicht
// ins Browser-Paket — dieselbe Begruendung wie in app/lib/tft-classify-comp.ts.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CURRENT_SET } from './current-set';

export type CostTier = 1 | 2 | 3 | 4 | 5;
export type UniqueChampsPerCost = Record<CostTier, number>;

interface BundleChampion {
  cost?: unknown;
  traits?: unknown;
  icon?: unknown;
}

// POOL_RULE_V1 — Zaehlregel, spiegelbildlich in scripts/verify-classifications.mjs.
// Wird sie hier geaendert, muss sie dort mitgeaendert werden; der Marker
// POOL_RULE_V1 haelt beide Stellen auffindbar und wird vom Pre-Push geprueft.
//
// Drei Bedingungen, jede mit einem Grund:
//   1. cost 1-5          — Kostenstufe 6+ und 0 sind keine Shop-Einheiten.
//   2. traits nicht leer — schliesst PvE-Monster, Trainingspuppe und Amboss
//                          aus; die haben im Bundle eine cost, erscheinen
//                          aber nie im Laden.
//   3. Entdopplung ueber icon — Riot fuehrt Wandel-Formen als eigene
//                          Eintraege (Set 18: zehn Lux-Varianten, alle mit
//                          demselben Bild). Sie teilen sich EINE Tuete und
//                          duerfen den Pool nicht verzehnfachen.
export function deriveUniqueChampsPerCost(
  champions: Record<string, BundleChampion> | null | undefined,
): UniqueChampsPerCost {
  const counts: UniqueChampsPerCost = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const seen = new Set<string>();

  for (const [apiName, champ] of Object.entries(champions || {})) {
    const cost = champ?.cost;
    if (typeof cost !== 'number' || cost < 1 || cost > 5) continue;
    const traits = champ?.traits;
    if (!Array.isArray(traits) || traits.length === 0) continue;

    const icon = typeof champ?.icon === 'string' ? champ.icon.trim().toLowerCase() : '';
    // Ohne brauchbares Bild kann nicht entdoppelt werden — dann zaehlt der
    // apiName, damit eine fehlende Bildangabe nicht ganze Einheiten schluckt.
    const key = icon && icon !== 'none' ? `i:${icon}` : `n:${apiName}`;
    if (seen.has(key)) continue;
    seen.add(key);

    counts[cost as CostTier] += 1;
  }

  return counts;
}

/** Liest das Bundle des laufenden Sets und leitet die Zahlen ab. Nur serverseitig. */
export function readUniqueChampsPerCost(set: number = CURRENT_SET): UniqueChampsPerCost {
  const path = resolve(process.cwd(), `public/tft-assets-${set}.json`);
  const bundle = JSON.parse(readFileSync(path, 'utf8')) as {
    champions?: Record<string, BundleChampion>;
  };
  const counts = deriveUniqueChampsPerCost(bundle.champions);

  // Build-Zeit-Fehler statt stillschweigend falscher Wahrscheinlichkeiten:
  // faellt eine Kostenstufe auf 0, ist entweder das Bundle kaputt oder Riot
  // hat das Schema geaendert. Beides darf nicht live gehen.
  const empty = ([1, 2, 3, 4, 5] as const).filter(c => counts[c] === 0);
  if (empty.length > 0) {
    throw new Error(
      `[tft-shop-pool] Set ${set}: Kostenstufe(n) ${empty.join('/')} ohne Einheiten — `
      + 'Bundle unvollstaendig oder Schema geaendert.',
    );
  }

  return counts;
}
