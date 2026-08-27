// Pro Augment die erlaubten Pick-Stages bestimmen — Ground-Truth aus
// tactics.tools-Override.
//
// Datenlage (verifiziert 2026-06-21 via classification-reviewer + data-skeptic):
// - CDragon-Bundle hat KEINE Stage-Info (kein stage/minStage/maxStage)
// - Riot Match-V1 augments-Feld tot seit 2026-06-15 (feedback_no_augment_stats)
// - tactics.tools/info/augments rendert pro Augment 3 Stage-Pills mit
//   opacity-30 für inactive — das ist die EINZIGE öffentlich strukturierte
//   Ground-Truth-Quelle
//
// Pattern analog zu refresh-augment-tiers.mjs (Tier-Override-Pattern):
// - Scraper `scripts/refresh-augment-stages.mjs` läuft pro Patch
// - Output `public/tft-augment-stages-{set}.json` mit `{apiName: ['2-1','3-2','4-2'][]}`
// - Diese Library lädt den Override + macht Lookup
//
// WICHTIG — Anti-Patterns die wir KEINE WIEDER machen (Spec-Fail-Lessons
// vom 2026-06-21):
// - Slot-Position aus Comp-Guides ≠ Stage-Constraint (Slot = Recommendation-
//   Rank, NICHT Stage-Pick-Stamp)
// - Tier-Heuristik (Silver=2-1, Gold=3-2, Prismatic=4-2) ist Probability ≠
//   Constraint — Silver-Augments können Stage 3-2/4-2 erscheinen, wir
//   labeln NICHT auf Tier-Basis
// - Wenn Override fehlt → 'unknown', NICHT geguessed (feedback_no_fake_values)
// - Stage-Verteilungs-Charts mit Counts/Prozenten VERBOTEN
//   (feedback_no_augment_stats Zeile 13: „Augment-by-Stage-Charts mit Stats")

import { CURRENT_SET } from './current-set';

export type AugmentStage = '2-1' | '3-2' | '4-2';

export interface AugmentStagesOverride {
  set: number;
  source: string;
  fetchedAt: string;
  counts?: { cards?: number; pinned?: number; unmatched?: number };
  stages: Record<string, AugmentStage[]>;
}

let cached: Promise<AugmentStagesOverride | null> | null = null;

export function loadAugmentStages(): Promise<AugmentStagesOverride | null> {
  if (!cached) {
    cached = fetch(`/tft-augment-stages-${CURRENT_SET}.json`)
      .then(r => r.ok ? r.json() : null)
      .catch(() => null);
  }
  return cached;
}

// Returnt die erlaubten Stages für ein Augment. Bei fehlendem Override-
// Eintrag returnt null (= „unknown", UI rendert kein Stage-Badge).
export function augmentStagesFor(
  override: AugmentStagesOverride | null,
  apiName: string,
): AugmentStage[] | null {
  if (!override?.stages) return null;
  const entry = override.stages[apiName];
  return Array.isArray(entry) && entry.length > 0 ? entry : null;
}

// Stage-Color-Mapping — 2-1=grün (früh), 3-2=lila (mid), 4-2=gold (spät).
// Matched die existing UI-Konvention.
export function stageColor(stage: AugmentStage): string {
  switch (stage) {
    case '2-1': return '#3ecf8e';
    case '3-2': return '#7B61FF';
    case '4-2': return '#e0c75a';
  }
}

// Sort-Key Pro-Augment für „nach Stage" Sortierung. Stage-Set kodiert
// als Bitfield: 2-1=1, 3-2=2, 4-2=4. So sortieren wir „nur 2-1" zuerst
// (1), dann „2-1+3-2" (3), dann „nur 3-2" (2), dann „3-2+4-2" (6),
// dann „nur 4-2" (4), dann „2-1+3-2+4-2" (7). Pragmatisch ordnen wir
// stattdessen nach „frühste enthaltene Stage" — User-Intuition:
// User der nach Stage 2-1 sucht erwartet alle Augments mit 2-1
// drin oben, in welcher Kombination auch immer.
export function augmentStageSortKey(stages: AugmentStage[] | null): number {
  if (!stages || stages.length === 0) return 99; // unknown → ans Ende
  if (stages.includes('2-1')) return stages.length === 1 ? 0 : 1;
  if (stages.includes('3-2')) return stages.length === 1 ? 2 : 3;
  return stages.length === 1 ? 4 : 5; // nur 4-2 oder unklare Kombi
}
