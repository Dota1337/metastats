'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import type { TftAssetsBundle } from '../../lib/tft-cdragon';
import { findChampion } from '../../lib/tft-cdragon';
import { useI18n } from '../../lib/i18n';
import { compFamilyKey, parseClusterKey } from '../../lib/tft-cluster';

// Variants-Switcher: surfaces all sub-cluster variants of a comp family on
// the Comp-Detail page. Family = (trait, level, carry) without *N / ~aug /
// #secondary suffixes.
//
// Render-Rules (per data-skeptic verdict 2026-06-18):
//   - threshold for visibility: games >= 50 AND >= 5% of family total
//     (server-side enforced, see /api/tft/comps/variants)
//   - active variant always included even when below threshold
//   - hide component entirely when only the active variant exists
//   - max 4 variants visible (server-capped)

interface Variant {
  clusterKey: string;
  slug: string;
  games: number;
  avgPlacement: number;
  top4Rate: number;
  top1Rate: number;
  carryStar: number;
  augmentSlug: string | null;
  secondary: string | null;
  belowThreshold: boolean;
}

interface VariantsResponse {
  family: string;
  familyTotal: number;
  variants: Variant[];
}

function prettyChar(s: string) { return s.replace(/^TFT\d+_/, ''); }

function variantLabel(
  v: { carryStar: number; secondary: string | null },
  t: (key: any) => string,
  assets: TftAssetsBundle | null,
): string {
  const parts: string[] = [];
  if (v.carryStar === 3) parts.push(t('tft.comp.variant.reroll3'));
  if (v.secondary) {
    const ch = findChampion(assets, v.secondary);
    const name = ch?.name || prettyChar(v.secondary);
    parts.push((t('tft.comp.variant.with') as string).replace('{name}', name));
  }
  if (parts.length === 0) return t('tft.comp.variant.base') as string;
  return parts.join(' · ');
}

export default function VariantsSwitcher({
  clusterKey, region, bucket, days, patch, assets,
  familyMergeActive = false,
  familySize = 1,
}: {
  clusterKey: string;
  region: string;
  bucket: string;
  days: number;
  patch: string | null;
  assets: TftAssetsBundle | null;
  // Family-Mode-Info vom Detail-Page-Parent: ob die Detail-API gerade alle
  // Sub-Cluster zur Familie aggregiert (Default ab Familien-Merge-Spec) und
  // wie viele Sub-Cluster im Aggregat sitzen. familySize > 1 → Family-Banner.
  familyMergeActive?: boolean;
  familySize?: number;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [data, setData] = useState<VariantsResponse | null>(null);
  const family = compFamilyKey(clusterKey);

  useEffect(() => {
    const params = new URLSearchParams({
      family,
      region,
      bucket,
      days: String(days),
    });
    if (patch) params.set('patch', patch);
    fetch(`/api/tft/comps/variants?${params.toString()}`)
      .then(r => r.ok ? r.json() : null)
      .then(setData)
      .catch(() => setData(null));
  }, [family, region, bucket, days, patch]);

  if (!data) return null;

  // Ensure active variant is always in the list (data-skeptic requirement):
  // if the user navigated directly to a below-threshold variant, show it
  // alongside the threshold-passing ones with a sample-size flag.
  const activeParts = parseClusterKey(clusterKey);
  const hasActive = data.variants.some(v => v.clusterKey === clusterKey);
  const variants: Variant[] = (!hasActive && activeParts)
    ? [
        ...data.variants,
        {
          clusterKey,
          slug: clusterKey,
          games: 0,
          avgPlacement: 0,
          top4Rate: 0,
          top1Rate: 0,
          carryStar: activeParts.carryStar,
          augmentSlug: activeParts.augmentSlug,
          secondary: activeParts.secondary,
          belowThreshold: true,
        },
      ]
    : data.variants;

  // Family-Mode-Banner: wenn die Detail-API gerade alle Sub-Cluster aggregiert,
  // braucht der User den Hinweis + Toggle zur Sub-Cluster-Sicht. Wenn nur 1
  // Sub-Cluster in der Family ist, gibt es nichts zu aggregieren — Banner aus.
  const showFamilyBanner = familyMergeActive && familySize > 1;
  const toggleVariantMode = () => {
    if (!pathname) return;
    const next = new URLSearchParams(search?.toString() || '');
    if (familyMergeActive) {
      next.set('variant', 'exact');
    } else {
      next.delete('variant');
    }
    const q = next.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  };
  if (variants.length <= 1 && !showFamilyBanner) return null;

  return (
    <section className="mt-3 bg-[#0d1526] border border-[#1e2a3a] rounded p-3">
      {showFamilyBanner && (
        <div className="mb-3 flex items-center justify-between gap-2 px-3 py-2 bg-[#7B61FF]/8 border border-[#7B61FF]/30 rounded">
          <div className="text-xs text-[#cdd6e0]">
            {t('tft.comp.familyMode.banner').replace('{n}', String(familySize))}
          </div>
          <button
            onClick={toggleVariantMode}
            className="text-[10px] uppercase tracking-widest px-2 py-1 bg-[#0a0e1a] border border-[#7B61FF]/40 text-[#cdd6e0] hover:text-white hover:border-[#7B61FF] rounded transition-colors"
          >
            {t('tft.comp.familyMode.toggleToExact')}
          </button>
        </div>
      )}
      {!familyMergeActive && (
        <div className="mb-3 flex items-center justify-between gap-2 px-3 py-2 bg-[#0a0e1a] border border-[#1e2a3a] rounded">
          <div className="text-xs text-[#a0b0c5]">
            {t('tft.comp.familyMode.exactNotice')}
          </div>
          <button
            onClick={toggleVariantMode}
            className="text-[10px] uppercase tracking-widest px-2 py-1 bg-[#0a0e1a] border border-[#1e2a3a] text-[#a0b0c5] hover:text-white hover:border-[#7B61FF]/40 rounded transition-colors"
          >
            {t('tft.comp.familyMode.toggleToFamily')}
          </button>
        </div>
      )}
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-[#a0b0c5] text-xs uppercase tracking-widest">{t('tft.comp.variants')}</h2>
      </div>
      <div className="flex flex-wrap gap-2">
        {variants.map(v => {
          const isActive = v.clusterKey === clusterKey;
          const label = variantLabel(v, t, assets);
          const url = `/tft/comps/${encodeURIComponent(v.slug)}?region=${region}&bucket=${bucket}`;
          return (
            <button
              key={v.clusterKey}
              onClick={() => { if (!isActive) router.push(url); }}
              className={`px-3 py-1.5 rounded border text-xs transition-colors ${
                isActive
                  ? 'bg-[#7B61FF]/15 border-[#7B61FF] text-white cursor-default'
                  : 'bg-[#0a0e1a] border-[#1e2a3a] text-[#a0b0c5] hover:border-[#7B61FF]/40 hover:text-white cursor-pointer'
              }`}
              title={
                v.belowThreshold
                  ? `${label} — ${t('tft.comp.variant.lowSample')}`
                  : `${label} · Avg ${v.avgPlacement.toFixed(2)} · ${v.games} games`
              }
            >
              <span className="font-medium">{label}</span>
              {!v.belowThreshold && (
                <span className="ml-2 text-[#7a8aa0] tabular-nums">
                  {v.avgPlacement.toFixed(2)} · {v.games}
                </span>
              )}
              {v.belowThreshold && (
                <span className="ml-2 text-[#5a6a80] text-[10px]">
                  {t('tft.comp.variant.lowSample')}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
