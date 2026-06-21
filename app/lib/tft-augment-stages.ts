// Pro Augment die typische Stage bestimmen, in der es angeboten/gespielt wird.
//
// Datenlage (Recherche 2026-06-21): CDragon-Bundle hat KEINE strukturierte
// Stage-Info auf Augments (kein stage/minStage/maxStage-Property). Die
// einzige nutzbare Quelle ist die Slot-Position in den kuratierten
// tftacademy-Comp-Guides (`tft-comp-guides-{set}.json`):
//
//   augments[0..2] → Slot 1 (Stage 2-1)
//   augments[3..5] → Slot 2 (Stage 3-2)
//   augments[6..7] → Slot 3 (Stage 4-2)
//
// Pro Augment aggregieren wir über alle 33 kuratierten Comps wie oft es in
// welchem Slot auftaucht. Der häufigste Slot ist die „typische Stage".
//
// Für die ~150 active Augments ohne Comp-Guide-Datenpunkt fallen wir auf
// eine Tier-Heuristik zurück: Silver (1) → Stage 2-1, Gold (2) → Stage 3-2,
// Prismatic (3) → Stage 4-2. Das matched die TFT-Spielmechanik: höhere
// Tiers haben in späteren Stages höhere Spawn-Wahrscheinlichkeit
// (`reference_tft_spielmechanik_set17.md` Shop-Odds-Tabelle).

import type { CompGuidesBundle } from './tft-comp-guides';

export type AugmentStage = '2-1' | '3-2' | '4-2';

export interface AugmentStageInfo {
  stage: AugmentStage;
  // Slot-Verteilung über alle Comp-Guides die dieses Augment listen.
  // Bei [5, 1, 0]: 5× in Stage 2-1, 1× in Stage 3-2, 0× in Stage 4-2.
  // Bei null: keine Comp-Guide-Daten, stage kommt aus Tier-Heuristik.
  distribution: [number, number, number] | null;
  source: 'guides' | 'tier-heuristic';
}

// Bestimme die dominant-Slot-Position aus einer Slot-Counts-Verteilung.
// Bei Gleichstand bevorzugen wir die frühere Stage (User-Erwartung: ein
// Econ-Augment das 2× in Stage 2-1 und 2× in Stage 3-2 ist, wird typisch
// als 2-1-Augment wahrgenommen).
function dominantSlot(counts: [number, number, number]): 0 | 1 | 2 {
  const [s1, s2, s3] = counts;
  if (s1 >= s2 && s1 >= s3) return 0;
  if (s2 >= s3) return 1;
  return 2;
}

function stageFromSlot(slot: 0 | 1 | 2): AugmentStage {
  return slot === 0 ? '2-1' : slot === 1 ? '3-2' : '4-2';
}

function stageFromTier(tier: number | null | undefined): AugmentStage {
  // Silver=1 → früh, Gold=2 → mid, Prismatic=3 → spät. Default Stage 3-2
  // für unbekannte Tiers (sicherster Mittelwert).
  if (tier === 1) return '2-1';
  if (tier === 3) return '4-2';
  return '3-2';
}

// Pro-Augment Slot-Aggregation aus dem CompGuide-Bundle. Returnt eine Map
// die mit dem apiName als Key indexed ist.
export function buildAugmentSlotMap(
  bundle: CompGuidesBundle | null,
): Map<string, [number, number, number]> {
  const out = new Map<string, [number, number, number]>();
  if (!bundle?.comps) return out;
  for (const guide of Object.values(bundle.comps)) {
    if (!guide.augments || guide.augments.length === 0) continue;
    // Wenn augmentTypes nicht parallel zu augments läuft (fehlgeschlagene
    // Klassifikation), nutzen wir die Slot-Position by-Index als Fallback.
    for (let i = 0; i < guide.augments.length; i++) {
      const aug = guide.augments[i];
      const slot: 0 | 1 | 2 = i < 3 ? 0 : i < 6 ? 1 : 2;
      const cur = out.get(aug) || ([0, 0, 0] as [number, number, number]);
      cur[slot]++;
      out.set(aug, cur);
    }
  }
  return out;
}

// Pro-Augment Stage-Info bestimmen. Slot-Map sollte einmal pro Page-Load
// gebaut werden (buildAugmentSlotMap), nicht pro Aufruf.
export function augmentStageInfo(
  apiName: string,
  slotMap: Map<string, [number, number, number]>,
  tier: number | null | undefined,
): AugmentStageInfo {
  const dist = slotMap.get(apiName);
  if (dist && (dist[0] + dist[1] + dist[2]) > 0) {
    return {
      stage: stageFromSlot(dominantSlot(dist)),
      distribution: [...dist] as [number, number, number],
      source: 'guides',
    };
  }
  return {
    stage: stageFromTier(tier),
    distribution: null,
    source: 'tier-heuristic',
  };
}

// Sort-Key Pro-Augment: Stage-Index (0/1/2) + Sample-Size (höhere Sample =
// vertrauenswürdiger). Augments ohne Comp-Guide-Daten (tier-heuristic)
// erhalten 0.5/1.5/2.5-Werte damit sie zwischen die guides-basierten
// Augments fallen (weniger sichere Klassifikation, sortiert hinter
// guides-basierten der gleichen Stage).
export function augmentStageSortKey(info: AugmentStageInfo): number {
  const baseSlot = info.stage === '2-1' ? 0 : info.stage === '3-2' ? 1 : 2;
  const heuristicPenalty = info.source === 'tier-heuristic' ? 0.5 : 0;
  return baseSlot * 10 + heuristicPenalty;
}

// Stage-Color-Mapping konsistent zur Spielmechanik (frühe = grün/grau,
// mittlere = lila, späte = gold). Reused für Badge-Borders + Pills.
export function stageColor(stage: AugmentStage): string {
  switch (stage) {
    case '2-1': return '#3ecf8e'; // grün = früh
    case '3-2': return '#7B61FF'; // lila = mid
    case '4-2': return '#e0c75a'; // gold = spät
  }
}
