'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import { useI18n } from '../../../lib/i18n';
import { loadTftAssets, tftIconUrl, type TftAssetsBundle } from '../../../lib/tft-cdragon';

// Pure reference detail — Riot has restricted augment-statistics display, so
// this page intentionally surfaces only name + description + tier from the
// CommunityDragon asset bundle. No Match-V1 derived metrics.

const TIER_LABELS: Record<number, string> = { 1: 'Silver', 2: 'Gold', 3: 'Prismatic' };
const TIER_COLORS: Record<number, string> = { 1: '#9ab0bf', 2: '#e0c75a', 3: '#c39bff' };

export default function TftAugmentReferenceDetailPage() {
  const { t } = useI18n();
  const params = useParams();
  const apiName = decodeURIComponent(String(params?.name || ''));
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);

  const meta = assets?.augments[apiName];
  const tier = meta?.tier ?? 0;
  const tierColor = TIER_COLORS[tier] || '#7a8aa0';
  const iconUrl = tftIconUrl(assets, meta?.icon);

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
      </div>
      <Footer />
    </main>
  );
}
