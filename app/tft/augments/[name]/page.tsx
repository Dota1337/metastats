'use client';
import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import { useI18n } from '../../../lib/i18n';
import { loadTftAssets, tftIconUrl, tftChampionTileUrl, findChampion, type TftAssetsBundle } from '../../../lib/tft-cdragon';
import { loadCompGuidesBundle, type CompGuide } from '../../../lib/tft-comp-guides';

// Pure reference detail — Riot has restricted augment-statistics display, so
// this page intentionally surfaces only name + description + tier from the
// CommunityDragon asset bundle. No Match-V1 derived metrics.
//
// Plus #5 Augment-Driven Comp-Picker (2026-06-21): Reverse-Lookup auf
// tft-comp-guides-17.json + tft-comp-slug-map-17.json zeigt welche
// kuratierten Comps dieses Augment in ihrer Augment-Liste haben.
// Adressiert die kritische Stage-2-1/3-2/4-2-Pick-Entscheidung — User
// sieht Augment-Optionen, klickt eine an, sieht passende Comps.

const TIER_LABELS: Record<number, string> = { 1: 'Silver', 2: 'Gold', 3: 'Prismatic' };
const TIER_COLORS: Record<number, string> = { 1: '#9ab0bf', 2: '#e0c75a', 3: '#c39bff' };

interface CompMatch {
  slug: string;
  guide: CompGuide;
  trait: string;
  carry: string;
}

export default function TftAugmentReferenceDetailPage() {
  const { t } = useI18n();
  const params = useParams();
  const apiName = decodeURIComponent(String(params?.name || ''));
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  const [compGuidesBundle, setCompGuidesBundle] = useState<Awaited<ReturnType<typeof loadCompGuidesBundle>> | null>(null);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);
  useEffect(() => { loadCompGuidesBundle().then(setCompGuidesBundle); }, []);

  const meta = assets?.augments[apiName];
  const tier = meta?.tier ?? 0;
  const tierColor = TIER_COLORS[tier] || '#7a8aa0';
  const iconUrl = tftIconUrl(assets, meta?.icon);

  // Reverse-Lookup: alle Comps die dieses Augment in ihren kuratierten
  // Augments listen. Slug-Map gibt trait+carry pro Comp.
  const matchingComps: CompMatch[] = useMemo(() => {
    if (!compGuidesBundle?.guides || !compGuidesBundle?.map) return [];
    const out: CompMatch[] = [];
    for (const [slug, guide] of Object.entries(compGuidesBundle.guides.comps)) {
      if (!guide.augments.includes(apiName)) continue;
      // Slug-Map-Entry mit augmentsRef=slug ODER mit dem slug direkt
      const mapEntry = compGuidesBundle.map.slugs[slug]
        || Object.values(compGuidesBundle.map.slugs).find(e => e.augmentsRef === slug);
      if (!mapEntry) continue;
      out.push({
        slug,
        guide,
        trait: mapEntry.primaryTrait,
        carry: mapEntry.primaryCarry,
      });
    }
    return out;
  }, [compGuidesBundle, apiName]);

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="augments" />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <a href="/tft/augments" className="text-[#7B61FF] text-xs hover:underline">← {t('nav.augments')}</a>

        {assets && !meta && (
          <div className="mt-4 bg-[#0d1526] border border-[#1e2a3a] rounded p-6 text-center text-[#a0b0c5] text-sm">
            —
          </div>
        )}

        {meta && (
          <div className="mt-2 bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-5">
            <div className="flex items-start gap-4 flex-wrap">
              {iconUrl ? (
                <img src={iconUrl} alt={meta.name} className="w-20 h-20 rounded-lg border-2" style={{ borderColor: tierColor }} />
              ) : (
                <div className="w-20 h-20 rounded-lg bg-[#1e2a3a]" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-white text-2xl font-medium">{meta.name}</h1>
                  {tier > 0 && (
                    <span
                      className="px-2 py-0.5 rounded text-[10px] uppercase tracking-widest"
                      style={{ backgroundColor: `${tierColor}20`, color: tierColor, border: `1px solid ${tierColor}55` }}
                    >
                      {TIER_LABELS[tier]}
                    </span>
                  )}
                </div>
                {meta.desc && (
                  <p className="text-[#a0b0c5] text-sm mt-3 leading-relaxed whitespace-pre-line">{meta.desc}</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* #5 — Comps die dieses Augment kuratiert spielen. Reine Display-
            Sektion ohne Stats (feedback_no_augment_stats: Augment-Stats
            verboten, kuratierte Comp-Liste pro Augment ist erlaubt). */}
        {meta && matchingComps.length > 0 && (
          <div className="mt-5 bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-5">
            <h2 className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">
              {t('tft.augment.compsPlayingThis')}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {matchingComps.map(m => {
                const traitMeta = assets?.traits[m.trait];
                const traitName = traitMeta?.name || m.trait.replace(/^TFT\d+_/, '');
                const carryChamp = findChampion(assets, m.carry);
                const carryName = carryChamp?.name || m.carry.replace(/^TFT\d+_/, '');
                const carryUrl = tftChampionTileUrl(assets, carryChamp);
                // Cluster-Key heuristisch konstruieren — Comp-Detail nimmt
                // jeden Slug an und auflöst zum besten Match.
                const compSlug = `${m.trait}@6_${m.carry}`;
                return (
                  <a
                    key={m.slug}
                    href={`/tft/comps/${encodeURIComponent(compSlug)}`}
                    className="flex items-center gap-3 p-3 rounded-md bg-[#141c2e] border border-[#1e2a3a] hover:border-[#7B61FF]/50 transition-colors"
                  >
                    {carryUrl ? (
                      <img
                        src={carryUrl}
                        alt={carryName}
                        className="w-10 h-10 rounded-md border-2 border-[#c39bff]/50 object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-md bg-[#1e2a3a] flex-shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-white text-sm font-medium truncate">{carryName}</div>
                      <div className="text-[#a0b0c5] text-[11px] truncate">{traitName}</div>
                      {m.guide.difficulty && (
                        <div className="text-[10px] text-[#7a8aa0] uppercase tracking-wider mt-0.5">
                          {m.guide.difficulty}
                        </div>
                      )}
                    </div>
                  </a>
                );
              })}
            </div>
            <div className="text-[#5a6a80] text-[10px] mt-3 italic">
              {t('tft.augment.compsPlayingThis.note')}
            </div>
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}
