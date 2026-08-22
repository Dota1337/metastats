'use client';
import { useEffect, useMemo, useState } from 'react';
import { withAlpha } from '../../lib/color';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import TftHero from '../../components/tft/TftHero';
import { useI18n } from '../../lib/i18n';
import { loadTftAssets, tftIconUrl, tftAugmentLocalised, type TftAssetsBundle } from '../../lib/tft-cdragon';
import {
  loadAugmentStages,
  augmentStagesFor,
  augmentStageSortKey,
  stageColor,
  type AugmentStage,
  type AugmentStagesOverride,
} from '../../lib/tft-augment-stages';

// Pure REFERENCE catalog — Riot has restricted augment statistics, so this
// page intentionally surfaces *only* name + description + tier from the
// CommunityDragon asset bundle (= public game data, no Match-V1 derivation).
// Keep this page free of placement/pickrate/top4/games or any metric that
// derives from observed matches.

type TierFilter = 'all' | 1 | 2 | 3;

const TIER_LABELS: Record<number, string> = { 1: 'Silver', 2: 'Gold', 3: 'Prismatic' };
const TIER_COLORS: Record<number, string> = { 1: '#9ab0bf', 2: '#e0c75a', 3: '#c39bff' };

// Detect the tier the icon FILE belongs to from its CDragon path suffix.
// Riot encodes it as `<name>_I.tex`, `_II`, `_III` (sometimes with `-` instead).
// Returns 1/2/3 or null when no marker is found.
function iconTierFromPath(iconPath: string | null | undefined): number | null {
  if (!iconPath) return null;
  const p = iconPath.toLowerCase();
  if (/[_-]iii[._]/.test(p)) return 3;
  if (/[_-]ii[._]/.test(p)) return 2;
  if (/[_-]i[._]/.test(p)) return 1;
  return null;
}

export default function TftAugmentsReferencePage() {
  const { t, lang } = useI18n();
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  const [tierFilter, setTierFilter] = useState<TierFilter>('all');
  const [stageFilter, setStageFilter] = useState<'all' | AugmentStage>('all');
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<'tier' | 'stage'>('tier');
  const [stagesOverride, setStagesOverride] = useState<AugmentStagesOverride | null>(null);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);
  useEffect(() => { loadAugmentStages().then(setStagesOverride); }, []);

  // Source of truth for the catalog = `bundle.active.augments` (= Riot's
  // setData[N].augments minus God-Augments, see scripts/fetch-tft-assets.mjs).
  // That includes carry-overs from older sets (TFT10_*, TFT11_*…) Riot re-
  // enabled for Set 17. Old logic only matched the current-set prefix, which
  // missed ~240 of 276 entries. Falls back to setPrefix when an old bundle
  // ships without `active.augments` (pre-2026-06-10).
  const augments = useMemo(() => {
    if (!assets) return [];
    const whitelist = assets.active?.augments;
    if (whitelist?.length) {
      const set = new Set(whitelist);
      return Object.entries(assets.augments)
        .filter(([apiName]) => set.has(apiName))
        .map(([apiName, a]) => ({ apiName, ...a }));
    }
    const setPrefix = `TFT${assets.set}_`;
    return Object.entries(assets.augments)
      .filter(([apiName]) => apiName.startsWith(setPrefix) && !/GodAugment/i.test(apiName))
      .map(([apiName, a]) => ({ apiName, ...a }));
  }, [assets]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return augments
      .filter(a => tierFilter === 'all' || a.tier === tierFilter)
      .filter(a => {
        if (stageFilter === 'all') return true;
        // „enthält Stage X" — Multi-Stage-Constraint, NICHT exact-match.
        // Augment mit ['3-2','4-2'] passt zu Filter 3-2 UND Filter 4-2.
        const stages = augmentStagesFor(stagesOverride, a.apiName);
        return stages != null && stages.includes(stageFilter);
      })
      .filter(a => {
        if (!q) return true;
        const loc = tftAugmentLocalised(a, lang);
        return loc.name.toLowerCase().includes(q) || (loc.desc || '').toLowerCase().includes(q);
      })
      .sort((a, b) => {
        if (sortMode === 'stage') {
          const sa = augmentStagesFor(stagesOverride, a.apiName);
          const sb = augmentStagesFor(stagesOverride, b.apiName);
          const ka = augmentStageSortKey(sa);
          const kb = augmentStageSortKey(sb);
          if (ka !== kb) return ka - kb;
          if (a.tier !== b.tier) return a.tier - b.tier;
          return tftAugmentLocalised(a, lang).name.localeCompare(tftAugmentLocalised(b, lang).name);
        }
        // Default Tier-Sort: Silver → Gold → Prismatic, alphabetical within.
        if (a.tier !== b.tier) return a.tier - b.tier;
        const an = tftAugmentLocalised(a, lang).name;
        const bn = tftAugmentLocalised(b, lang).name;
        return an.localeCompare(bn);
      });
  }, [augments, tierFilter, stageFilter, query, lang, stagesOverride, sortMode]);

  const counts = useMemo(() => {
    const out: Record<TierFilter, number> = { all: augments.length, 1: 0, 2: 0, 3: 0 };
    for (const a of augments) out[a.tier as 1 | 2 | 3] = (out[a.tier as 1 | 2 | 3] || 0) + 1;
    return out;
  }, [augments]);

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav active="augments" />
      <TftHero pageTitle={t('nav.augments')} />
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 pt-2 pb-6">
        {/* Filter + search row. Keep it tight — no info-texts, just controls. */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {(['all', 3, 2, 1] as TierFilter[]).map(tk => {
            const active = tierFilter === tk;
            // `label` is only used for the non-`all` branch; the `all` button
            // shows tft.augment.allTiers directly. Don't pre-compute a label
            // for `all` that gets thrown away.
            const label = tk === 'all' ? '' : TIER_LABELS[tk as number];
            const color = tk === 'all' ? '#7B61FF' : TIER_COLORS[tk as number];
            return (
              <button
                key={tk}
                type="button"
                onClick={() => setTierFilter(tk)}
                className={`px-3 py-1 rounded text-xs border transition-colors ${
                  active
                    ? 'text-white'
                    : 'bg-surface-raised border-border-subtle text-fg-secondary hover:border-accent-a40'
                }`}
                style={active ? { backgroundColor: `${withAlpha(color, 0x25)}`, borderColor: `${withAlpha(color, 0x80)}`, color } : undefined}
              >
                {tk === 'all' ? t('tft.augment.allTiers') : label}
                <span className="ml-1 text-fg-muted tabular-nums">{counts[tk]}</span>
              </button>
            );
          })}
          <input
            type="text"
            placeholder={t('tft.augment.searchPlaceholder')}
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="flex-1 min-w-[140px] bg-surface-raised border border-border-subtle rounded px-3 py-1 text-xs text-white focus:outline-none focus:border-accent-a60"
          />
        </div>

        {/* Stage-Filter + Sort-Toggle — Ground-Truth aus tactics.tools-
            Override (refresh-augment-stages.mjs). Multi-Stage-Augments
            erscheinen bei jedem ihrer Stages im Filter. */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-fg-muted text-[10px] uppercase tracking-widest mr-1">{t('tft.augment.stage.label')}:</span>
          {(['all', '2-1', '3-2', '4-2'] as const).map(s => {
            const active = stageFilter === s;
            const color = s === 'all' ? '#7B61FF' : stageColor(s as AugmentStage);
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStageFilter(s)}
                className={`px-2.5 py-1 rounded text-xs border transition-colors ${
                  active
                    ? 'text-white'
                    : 'bg-surface-raised border-border-subtle text-fg-secondary hover:border-accent-a40'
                }`}
                style={active ? { backgroundColor: `${withAlpha(color, 0x25)}`, borderColor: `${withAlpha(color, 0x80)}`, color } : undefined}
              >
                {s === 'all' ? t('tft.augment.stage.all') : `Stage ${s}`}
              </button>
            );
          })}
          <div className="w-px h-5 bg-surface-overlay mx-1" />
          <span className="text-fg-muted text-[10px] uppercase tracking-widest">{t('tft.sortBy')}:</span>
          <button
            type="button"
            onClick={() => setSortMode('tier')}
            className={`px-2.5 py-1 rounded text-xs border transition-colors ${
              sortMode === 'tier'
                ? 'bg-accent-a25 border-accent-a80 text-[#a892ff]'
                : 'bg-surface-raised border-border-subtle text-fg-secondary hover:border-accent-a40'
            }`}
          >
            {t('tft.augment.sort.tier')}
          </button>
          <button
            type="button"
            onClick={() => setSortMode('stage')}
            className={`px-2.5 py-1 rounded text-xs border transition-colors ${
              sortMode === 'stage'
                ? 'bg-accent-a25 border-accent-a80 text-[#a892ff]'
                : 'bg-surface-raised border-border-subtle text-fg-secondary hover:border-accent-a40'
            }`}
          >
            {t('tft.augment.sort.stage')}
          </button>
          {stagesOverride && (
            <span className="text-fg-faint text-[10px] italic ml-2">
              {(t('tft.augment.stage.sourceNote') as string)
                .replace('{n}', String(stagesOverride.counts?.pinned ?? Object.keys(stagesOverride.stages).length))}
            </span>
          )}
        </div>

        {assets && filtered.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map(a => {
              const url = tftIconUrl(assets, a.icon);
              const tierColor = TIER_COLORS[a.tier] || 'var(--fg-muted)';
              const loc = tftAugmentLocalised(a, lang);
              // Riot recycles the same icon file across +/++ variants — e.g.
              // Deadlier Blades (Prismatic, tier 3) ships with the Gold-tier
              // `_ii` icon. Where the icon's tier doesn't match the bundle's
              // tier we overlay a hue-blend layer in the target tier color
              // so Prismatic-tier rows look Prismatic, Silver-tier look Silver.
              // mix-blend-mode: hue takes only the overlay's hue and keeps the
              // image's lightness + saturation, so artwork detail survives.
              const iconTier = iconTierFromPath(a.icon);
              const needsTint = iconTier !== null && iconTier !== a.tier;
              const augStages = augmentStagesFor(stagesOverride, a.apiName);
              return (
                <a
                  key={a.apiName}
                  href={`/tft/augments/${encodeURIComponent(a.apiName)}`}
                  className="flex items-start gap-3 p-3 bg-surface-base border border-border-subtle rounded hover:border-accent-a40 transition-colors"
                >
                  <div className="relative w-12 h-12 rounded border-2 overflow-hidden flex-shrink-0" style={{ borderColor: tierColor }}>
                    {url ? (
                      <img src={url} alt={loc.name} className="block w-full h-full" />
                    ) : (
                      <div className="w-full h-full bg-surface-overlay" />
                    )}
                    {needsTint && (
                      <div
                        className="absolute inset-0 pointer-events-none"
                        style={{ backgroundColor: tierColor, mixBlendMode: 'hue' }}
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-white text-sm font-semibold truncate">{loc.name}</span>
                      <span className="text-[11px] uppercase tracking-widest tabular-nums flex-shrink-0 font-medium" style={{ color: tierColor }}>
                        {TIER_LABELS[a.tier]}
                      </span>
                    </div>
                    {augStages && augStages.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {augStages.map(s => {
                          const c = stageColor(s);
                          return (
                            <span
                              key={s}
                              className="text-[10px] tabular-nums px-1.5 py-0.5 rounded border font-medium"
                              style={{ color: c, backgroundColor: `${withAlpha(c, 0x1a)}`, borderColor: `${withAlpha(c, 0x55)}` }}
                            >
                              {s}
                            </span>
                          );
                        })}
                      </div>
                    )}
                    {loc.desc && (
                      <p className="text-fg-secondary text-xs mt-1.5 leading-snug line-clamp-3">{loc.desc}</p>
                    )}
                  </div>
                </a>
              );
            })}
          </div>
        )}

        {assets && filtered.length === 0 && augments.length > 0 && (
          <div className="bg-surface-base border border-border-subtle rounded p-6 text-center text-fg-muted text-xs">
            {/* No matches for the active filter+search — empty-state, no info copy. */}
            —
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}
