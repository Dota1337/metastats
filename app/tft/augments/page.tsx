'use client';
import { useEffect, useMemo, useState } from 'react';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import TftHero from '../../components/tft/TftHero';
import { useI18n } from '../../lib/i18n';
import { loadTftAssets, tftIconUrl, type TftAssetsBundle } from '../../lib/tft-cdragon';

// Pure REFERENCE catalog — Riot has restricted augment statistics, so this
// page intentionally surfaces *only* name + description + tier from the
// CommunityDragon asset bundle (= public game data, no Match-V1 derivation).
// Keep this page free of placement/pickrate/top4/games or any metric that
// derives from observed matches.

type TierFilter = 'all' | 1 | 2 | 3;

const TIER_LABELS: Record<number, string> = { 1: 'Silver', 2: 'Gold', 3: 'Prismatic' };
const TIER_COLORS: Record<number, string> = { 1: '#9ab0bf', 2: '#e0c75a', 3: '#c39bff' };

export default function TftAugmentsReferencePage() {
  const { t } = useI18n();
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  const [tierFilter, setTierFilter] = useState<TierFilter>('all');
  const [query, setQuery] = useState('');

  useEffect(() => { loadTftAssets().then(setAssets); }, []);

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
      .filter(a => !q || a.name.toLowerCase().includes(q) || (a.desc || '').toLowerCase().includes(q))
      .sort((a, b) => {
        // Hierarchical ascending: Silver → Gold → Prismatic, alphabetical within.
        if (a.tier !== b.tier) return a.tier - b.tier;
        return a.name.localeCompare(b.name);
      });
  }, [augments, tierFilter, query]);

  const counts = useMemo(() => {
    const out: Record<TierFilter, number> = { all: augments.length, 1: 0, 2: 0, 3: 0 };
    for (const a of augments) out[a.tier as 1 | 2 | 3] = (out[a.tier as 1 | 2 | 3] || 0) + 1;
    return out;
  }, [augments]);

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="augments" />
      <TftHero pageTitle={t('nav.augments')} subtitle={assets?.setName} />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-2 pb-6">
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
                    : 'bg-[#141c2e] border-[#1e2a3a] text-[#a0b0c5] hover:border-[#7B61FF]/40'
                }`}
                style={active ? { backgroundColor: `${color}25`, borderColor: `${color}80`, color } : undefined}
              >
                {tk === 'all' ? t('tft.augment.allTiers') : label}
                <span className="ml-1 text-[#7a8aa0] tabular-nums">{counts[tk]}</span>
              </button>
            );
          })}
          <input
            type="text"
            placeholder={t('tft.augment.searchPlaceholder')}
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="flex-1 min-w-[140px] bg-[#141c2e] border border-[#1e2a3a] rounded px-3 py-1 text-xs text-white focus:outline-none focus:border-[#7B61FF]/60"
          />
        </div>

        {assets && filtered.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {filtered.map(a => {
              const url = tftIconUrl(assets, a.icon);
              const tierColor = TIER_COLORS[a.tier] || '#7a8aa0';
              return (
                <a
                  key={a.apiName}
                  href={`/tft/augments/${encodeURIComponent(a.apiName)}`}
                  className="flex items-start gap-3 p-3 bg-[#0d1526] border border-[#1e2a3a] rounded hover:border-[#7B61FF]/40 transition-colors"
                >
                  {url ? (
                    <img src={url} alt={a.name} className="w-12 h-12 rounded border-2 flex-shrink-0" style={{ borderColor: tierColor }} />
                  ) : (
                    <div className="w-12 h-12 rounded border-2 bg-[#1e2a3a] flex-shrink-0" style={{ borderColor: tierColor }} />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-white text-sm font-medium truncate">{a.name}</span>
                      <span className="text-[10px] uppercase tracking-widest tabular-nums flex-shrink-0" style={{ color: tierColor }}>
                        {TIER_LABELS[a.tier]}
                      </span>
                    </div>
                    {a.desc && (
                      <p className="text-[#a0b0c5] text-[11px] mt-1 leading-snug line-clamp-3">{a.desc}</p>
                    )}
                  </div>
                </a>
              );
            })}
          </div>
        )}

        {assets && filtered.length === 0 && augments.length > 0 && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6 text-center text-[#7a8aa0] text-xs">
            {/* No matches for the active filter+search — empty-state, no info copy. */}
            —
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}
