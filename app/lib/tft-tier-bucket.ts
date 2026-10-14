// Rang-Auswahl der TFT-Detailseiten (TierFilter). Eigenes Modul ohne
// 'use client', damit die Server-Seiten (SEO-Plan Schritt 5) denselben
// Start-Rang aus der Adresse lesen wie der Browser.
import { tftStatsBucket } from './rank-groups';

export type TierBucket = 'all' | 'challenger' | 'grandmaster_plus' | 'master_plus' | 'diamond_plus' | 'emerald_plus' | 'platinum_plus';

// Rangfolge von oben, Einzel-Master/-GM/-Diamond/-Emerald/-Platinum gibt es
// nicht mehr (2026-09-13). Alle X+-Gruppen stehen in DETAIL_BUCKETS
// (app/lib/snapshot-matrix.ts), sonst liefe die Detailseite live in den Abbruch.
export const TIER_BUCKETS: readonly TierBucket[] = [
  'all', 'challenger', 'grandmaster_plus', 'master_plus', 'diamond_plus', 'emerald_plus', 'platinum_plus',
];

/** ?bucket= aus der URL lesen; alte Einzelraenge (master, diamond …) auf die Gruppe biegen. */
export function tierBucketFromParam(raw: string | null | undefined, fallback: TierBucket = 'master_plus'): TierBucket {
  if (!raw) return fallback;
  const v = tftStatsBucket(raw.toLowerCase());
  return TIER_BUCKETS.includes(v as TierBucket) ? (v as TierBucket) : fallback;
}
