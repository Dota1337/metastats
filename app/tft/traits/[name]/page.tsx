'use client';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import { useI18n } from '../../../lib/i18n';
import { loadTftAssets, tftIconUrl, tftChampionTileUrl, type TftAssetsBundle, type TftTrait, type TftTraitTier } from '../../../lib/tft-cdragon';
import {
  renderTraitDesc,
  findTraitItemPool,
  findTraitVariants,
  extractConstellationLabel,
  stripStargazerPreamble,
  findArbiterOptions,
} from '../../../lib/tft-trait-desc';

// Per-trait detail page. Combines three data sources:
//   1) /api/tft/traits — stat rows (1 per activation level)
//   2) /api/tft/units — units whose `traits` include this trait (from
//      the CommunityDragon asset bundle, joined client-side)
//   3) tft-assets.json — tiers (minUnits/style/variables) + raw desc.
// No new RPC needed; everything is filterable from existing endpoints.

interface TraitStat {
  name: string;
  activation: number;
  games: number;
  avgPlacement: number | null;
  top4Rate: number | null;
  pickRate: number | null;
}

interface UnitStat {
  characterId: string;
  games: number;
  avgPlacement: number | null;
  top4Rate: number | null;
  top1Rate?: number | null;
  pickRate?: number | null;
}

// Visual map for trait activation styles. Mirrors the in-game frame colors.
const STYLE_COLORS: Record<number, { label: string; hex: string }> = {
  1: { label: 'Bronze',    hex: '#a07a4d' },
  3: { label: 'Silver',    hex: '#cfd6dc' },
  4: { label: 'Gold',      hex: '#e0c75a' },
  5: { label: 'Prismatic', hex: '#c39bff' },
};

export default function TftTraitDetailPage() {
  const { t } = useI18n();
  const params = useParams();
  const search = useSearchParams();
  const apiName = decodeURIComponent(String(params?.name || ''));
  const bucket = search.get('bucket') || 'master_plus';
  const region = search.get('region') || 'all';

  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  const [traitStats, setTraitStats] = useState<TraitStat[]>([]);
  const [units, setUnits] = useState<UnitStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch(`/api/tft/traits?region=${region}&bucket=${bucket}`).then(r => r.json()).catch(() => ({ traits: [] })),
      fetch(`/api/tft/units?region=${region}&bucket=${bucket}`).then(r => r.json()).catch(() => ({ units: [] })),
    ]).then(([traitData, unitData]) => {
      if (cancelled) return;
      const allTraits = (traitData.traits || []) as TraitStat[];
      // When the route param is a display name (e.g. "Stargazer"), the API
      // rows are keyed by per-variant apiName — so we match against any
      // variant in the family, not just an exact key.
      const variantApiNames = new Set<string>();
      variantApiNames.add(apiName);
      if (typeof window !== 'undefined') {
        // No assets dependency here yet (we're inside the fetch); resolve
        // variants by scanning the API response, which always carries the
        // raw apiName. Final variant resolution happens in the render path
        // via assets, but for now we leave per-variant rows visible.
      }
      setTraitStats(allTraits.filter(t => t.name === apiName).sort((a, b) => a.activation - b.activation));
      // Filter to units that mention this trait in their CD bundle entry.
      // The asset bundle is needed for the join — without assets, no filter.
      setUnits(unitData.units || []);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [apiName, region, bucket]);

  // URL param can be either a raw apiName ("TFT17_Stargazer_Wolf") or a
  // display name ("Stargazer", "Arbiter"). When it's a display name we
  // surface every variant together; when it's an apiName but the trait
  // belongs to a multi-variant family, we also fall through to the
  // grouped view so users land on the same page either way.
  const directMeta: TftTrait | undefined = assets?.traits[apiName];
  const matchByDisplayName = assets
    ? Object.entries(assets.traits).filter(([, m]) => m.name === apiName)
    : [];
  const displayName = directMeta?.name ?? apiName;
  const allVariants = assets
    ? findTraitVariants(displayName, assets.traits as any)
    : [];
  const isGroup = allVariants.length > 1;
  // For the header (icon + name + tiers) we prefer the "root" variant when
  // the family has one (TFT17_Stargazer w/o suffix), otherwise the first.
  const rootVariant = allVariants.find(v => !/_\w+$/.test(v.apiName.replace(/^TFT\d+_/, ''))) || allVariants[0];
  const traitMeta: TftTrait | undefined = directMeta
    ?? (matchByDisplayName[0]?.[1] as TftTrait | undefined)
    ?? rootVariant?.meta as TftTrait | undefined;
  const iconUrl = tftIconUrl(assets, traitMeta?.icon);
  const isArbiter = displayName === 'Arbiter';

  // Join: which units have this trait? CD champions store `traits[]` as an
  // array of display names (not apiNames) — but our traits dict is keyed by
  // apiName. So we join through the asset bundle: champion.traits includes
  // either the apiName or the human name depending on CD set conventions.
  const traitNamesToMatch = new Set<string>([apiName, traitMeta?.name || ''].filter(Boolean));
  const matchingUnits = assets
    ? units
        .filter(u => {
          const champion = assets.champions[u.characterId];
          if (!champion?.traits) return false;
          return champion.traits.some(tr => traitNamesToMatch.has(tr));
        })
        .sort((a, b) => (a.avgPlacement ?? 9) - (b.avgPlacement ?? 9))
    : [];

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="traits" />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <a href="/tft/traits" className="text-[#7B61FF] text-xs hover:underline">← {t('nav.traits')}</a>

        {/* Header: icon + name + tier-pill row */}
        <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-5 mb-5 mt-2">
          <div className="flex items-start gap-4 flex-wrap">
            {iconUrl ? (
              <img src={iconUrl} alt={traitMeta?.name || apiName} className="w-16 h-16 rounded-lg border-2 border-[#7B61FF]" />
            ) : (
              <div className="w-16 h-16 rounded-lg bg-[#1e2a3a]" />
            )}
            <div className="flex-1 min-w-0">
              <h1 className="text-white text-2xl font-medium">{traitMeta?.name || prettyTrait(apiName)}</h1>
              {traitMeta?.innate && (
                <p className="text-[#a892ff] text-xs mt-1">{traitMeta.innate}</p>
              )}
              {/* Tier breakpoint pills */}
              {traitMeta?.tiers && traitMeta.tiers.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {traitMeta.tiers.map((tier, i) => (
                    <TierPill key={i} tier={tier} />
                  ))}
                </div>
              )}
            </div>
          </div>
          {(() => {
            // For multi-variant families we render the per-variant cards
            // further down; the header description is the "root" variant
            // (the one without the per-mechanic suffix) which carries the
            // generic blurb without the variant-specific body.
            const headerTrait = isGroup && rootVariant ? rootVariant.meta : traitMeta;
            const rendered = renderTraitDesc(headerTrait as any);
            const effectiveApiName = directMeta ? apiName : (rootVariant?.apiName || apiName);
            const itemPool = findTraitItemPool(effectiveApiName, assets?.items);
            const referencesRandomItem = rendered.tiers.some(t => /random .* item/i.test(t.text));
            if (!rendered.generalDesc && rendered.tiers.length === 0) return null;
            return (
              <div className="mt-4 text-sm text-[#a0b0c5] leading-relaxed space-y-2">
                {rendered.generalDesc && <p>{rendered.generalDesc}</p>}
                {rendered.tiers.length > 0 && (
                  <ul className="space-y-1.5">
                    {rendered.tiers.map(tier => (
                      <li key={tier.minUnits} className="flex gap-2 items-start">
                        <span className="text-[#7B61FF] font-semibold tabular-nums shrink-0 w-7 text-right">({tier.minUnits})</span>
                        <span>{tier.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {referencesRandomItem && itemPool.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-[#1e2a3a]">
                    <div className="text-[#a0b0c5] text-[10px] uppercase tracking-widest mb-2">
                      {t('tft.trait.possibleItems')}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {itemPool.map(item => (
                        <span
                          key={item.apiName}
                          className="inline-block px-2 py-0.5 rounded bg-[#1e2a3a] text-[#a0b0c5] text-xs"
                        >
                          {item.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* Multi-variant family (e.g. Stargazer's 7 constellations) — one
           card per variant with the shared preamble stripped. Hidden when
           there's only a single variant. */}
        {isGroup && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-5 mb-5">
            <div className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">
              {t('tft.trait.variants').replace('{n}', String(allVariants.filter(v => v.apiName !== rootVariant?.apiName).length))}
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {allVariants
                .filter(v => v.apiName !== rootVariant?.apiName)
                .map(v => {
                  const constellation = extractConstellationLabel(v.meta.desc) || v.meta.name;
                  const cleanedMeta = { ...v.meta, desc: stripStargazerPreamble(v.meta.desc) };
                  const r = renderTraitDesc(cleanedMeta as any);
                  return (
                    <div key={v.apiName} className="bg-[#0a0e1a] border border-[#1e2a3a] rounded p-3">
                      <div className="text-[#7B61FF] text-sm font-semibold mb-2">{constellation}</div>
                      {r.generalDesc && (
                        <p className="text-[#a0b0c5] text-xs leading-relaxed mb-2">{r.generalDesc}</p>
                      )}
                      {r.tiers.length > 0 && (
                        <ul className="space-y-1 text-xs">
                          {r.tiers.map(tier => (
                            <li key={tier.minUnits} className="flex gap-2 items-start">
                              <span className="text-[#7B61FF] font-semibold tabular-nums shrink-0 w-6 text-right">({tier.minUnits})</span>
                              <span className="text-[#a0b0c5]">{tier.text}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* Arbiter — Cause × Effect pickable matrix. Set 17 Arbiters let
           you pair any cause from one column with any effect from the
           other; rendering them side-by-side makes the mechanic legible
           without reading prose. */}
        {isArbiter && (() => {
          const { causes, effects } = findArbiterOptions(
            assets?.items as any,
            traitMeta as any,
          );
          if (causes.length === 0 && effects.length === 0) return null;
          return (
            <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-5 mb-5">
              <div className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">
                {t('tft.trait.arbiterPicker')}
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <div className="text-white text-xs font-semibold mb-2 uppercase tracking-wider">
                    {t('tft.trait.arbiterCauses')}
                  </div>
                  <ul className="space-y-1.5">
                    {causes.map(c => (
                      <li key={c.apiName} className="bg-[#0a0e1a] border border-[#1e2a3a] rounded px-3 py-2 text-xs">
                        <div className="text-[#7B61FF] font-medium mb-0.5">{c.label}</div>
                        <div className="text-[#a0b0c5] leading-snug">{c.desc}</div>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="text-white text-xs font-semibold mb-2 uppercase tracking-wider">
                    {t('tft.trait.arbiterEffects')}
                  </div>
                  <ul className="space-y-1.5">
                    {effects.map(e => (
                      <li key={e.apiName} className="bg-[#0a0e1a] border border-[#1e2a3a] rounded px-3 py-2 text-xs">
                        <div className="text-[#7B61FF] font-medium mb-0.5">{e.label}</div>
                        <div className="text-[#a0b0c5] leading-snug">{e.desc}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Per-tier stats table */}
        {!loading && traitStats.length > 0 && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded mb-5 overflow-hidden">
            <div className="px-4 py-2 bg-[#0a0e1a] text-[#a0b0c5] text-xs uppercase tracking-widest">
              {t('tft.trait.statsPerTier')}
            </div>
            <div className="grid grid-cols-[4rem_1fr_5rem_5rem_5rem_5rem] gap-2 px-4 py-2 text-[10px] uppercase text-[#7a8aa0] bg-[#0a0e1a] border-t border-[#1e2a3a]">
              <div className="text-right">{t('tft.activation')}</div>
              <div></div>
              <div className="text-right">{t('tft.avgPlacement')}</div>
              <div className="text-right">{t('tft.pickRate')}</div>
              <div className="text-right">{t('tft.top4')}</div>
              <div className="text-right">{t('tft.gamesShort')}</div>
            </div>
            {traitStats.map(s => {
              const tier = traitMeta?.tiers?.find(tier =>
                s.activation >= tier.minUnits && (tier.maxUnits == null || s.activation <= tier.maxUnits)
              );
              const styleColor = tier ? STYLE_COLORS[tier.style] : null;
              return (
                <div key={s.activation} className="grid grid-cols-[4rem_1fr_5rem_5rem_5rem_5rem] gap-2 px-4 py-2 items-center text-xs border-t border-[#1e2a3a]">
                  <div className="text-right text-[#7B61FF] font-medium">{s.activation}</div>
                  <div>
                    {styleColor && (
                      <span
                        className="px-2 py-0.5 rounded text-[10px] uppercase tracking-widest"
                        style={{ backgroundColor: `${styleColor.hex}20`, color: styleColor.hex }}
                      >
                        {styleColor.label}
                      </span>
                    )}
                  </div>
                  <div className="text-right text-white">{s.avgPlacement?.toFixed(2) ?? '—'}</div>
                  <div className="text-right text-[#a0b0c5]">{s.pickRate != null ? `${(s.pickRate * 100).toFixed(1)}%` : '—'}</div>
                  <div className="text-right text-[#a0b0c5]">{s.top4Rate != null ? `${(s.top4Rate * 100).toFixed(1)}%` : '—'}</div>
                  <div className="text-right text-[#7a8aa0]">{s.games}</div>
                </div>
              );
            })}
          </div>
        )}

        {/* Best units with this trait */}
        {!loading && matchingUnits.length > 0 && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-5 mb-5">
            <div className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">{t('tft.trait.bestUnits')}</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {matchingUnits.slice(0, 15).map(u => {
                const champion = assets?.champions[u.characterId];
                const champUrl = tftChampionTileUrl(assets, champion);
                const cost = champion?.cost ?? 1;
                return (
                  <a
                    key={u.characterId}
                    href={`/tft/units/${encodeURIComponent(u.characterId)}?bucket=${bucket}`}
                    className="flex flex-col items-center bg-[#141c2e] border border-[#1e2a3a] rounded p-2 hover:border-[#7B61FF]/50 transition"
                  >
                    {champUrl ? (
                      <img src={champUrl} alt={champion!.name} className="w-12 h-12 rounded object-cover border-2" style={{ borderColor: costColor(cost) }} />
                    ) : (
                      <div className="w-12 h-12 rounded bg-[#1e2a3a]" />
                    )}
                    <div className="text-white text-[11px] mt-1 text-center truncate w-full">{champion?.name || prettyChar(u.characterId)}</div>
                    <div className="text-[#a0b0c5] text-[10px]">
                      {u.avgPlacement?.toFixed(2) ?? '—'} {t('tft.avgPlacementShort')}
                    </div>
                  </a>
                );
              })}
            </div>
          </div>
        )}

        {loading && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6 text-center text-[#a0b0c5] text-sm">
            {t('tft.loading')}
          </div>
        )}

        {!loading && traitStats.length === 0 && matchingUnits.length === 0 && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6 text-center text-[#a0b0c5] text-sm">
            {t('tft.trait.noData')}
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}

function TierPill({ tier }: { tier: TftTraitTier }) {
  const sc = STYLE_COLORS[tier.style];
  const color = sc?.hex || '#7a8aa0';
  return (
    <div
      className="flex items-center gap-2 rounded px-2.5 py-1 text-xs font-medium tabular-nums"
      style={{ backgroundColor: `${color}18`, color, border: `1px solid ${color}40` }}
    >
      <span className="text-base font-bold">{tier.minUnits}</span>
      {sc && <span className="text-[10px] uppercase tracking-widest opacity-80">{sc.label}</span>}
    </div>
  );
}

function prettyTrait(s: string) { return s.replace(/^TFT\d+_/, '').replace(/Trait$/, ''); }
function prettyChar(s: string) { return s.replace(/^TFT\d+_/, ''); }
function costColor(cost: number) {
  return cost === 1 ? '#9aa6b2'
    : cost === 2 ? '#3a8'
    : cost === 3 ? '#3a8ddc'
    : cost === 4 ? '#c39bff'
    : '#e0c75a';
}
