'use client';
import { useEffect, useMemo, useState } from 'react';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import TftHero from '../../components/tft/TftHero';
import { useI18n, type TranslationKey } from '../../lib/i18n';
import { loadTftAssets, tftIconUrl, type TftAssetsBundle, type TftAugment } from '../../lib/tft-cdragon';

// Set 17 "Space Gods": 9 gods replace the traditional Carousel. Each game
// rolls 2 of the 9. Stages 2-4 / 3-4 / 4-4 offer minor "Offerings" between
// them; stage 4-7 hands out the chosen god's final Boon (armory-style).
// All boon copy + icons live in the asset bundle as TFT17_Augment_<id>GodAugment*
// — this page is a pure wiki catalog (no stats, in line with Riot's
// augment-stats restriction). Static metadata (titles/themes/baseApiName)
// lives in public/tft-gods-17.json and is updated per set.

interface GodMeta {
  id: string;
  titleKey: string;
  themeKey: string;
  baseApiName: string;
}
interface GodsDoc {
  set: number;
  gods: GodMeta[];
}

interface GodViewModel {
  meta: GodMeta;
  base: { apiName: string; data: TftAugment } | null;
  offerings: { apiName: string; data: TftAugment }[];
}

export default function TftGodsPage() {
  const { t } = useI18n();
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  const [doc, setDoc] = useState<GodsDoc | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    loadTftAssets().then(setAssets);
    fetch('/tft-gods-17.json').then(r => r.ok ? r.json() : null).then(setDoc).catch(() => setDoc(null));
  }, []);

  const gods: GodViewModel[] = useMemo(() => {
    if (!assets || !doc) return [];
    return doc.gods.map(meta => {
      const groupPrefix = `TFT17_Augment_${meta.id}GodAugment`;
      const entries = Object.entries(assets.augments)
        .filter(([apiName]) => apiName === groupPrefix || apiName.startsWith(groupPrefix + '_'));
      const base = entries.find(([apiName]) => apiName === meta.baseApiName) ?? null;
      const offerings = entries
        .filter(([apiName]) => apiName !== meta.baseApiName)
        .sort((a, b) => a[1].name.localeCompare(b[1].name));
      return {
        meta,
        base: base ? { apiName: base[0], data: base[1] } : null,
        offerings: offerings.map(([apiName, data]) => ({ apiName, data })),
      };
    });
  }, [assets, doc]);

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="gods" />
      <TftHero pageTitle={t('nav.gods')} subtitle={assets?.setName} />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-2 pb-10">
        {assets && doc && gods.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {gods.map(g => {
              const isOpen = expanded === g.meta.id;
              const portrait = g.base?.data.icon
                ? tftIconUrl(assets, g.base.data.icon)
                : (g.offerings[0]?.data.icon ? tftIconUrl(assets, g.offerings[0].data.icon) : null);
              return (
                <div
                  key={g.meta.id}
                  className={`bg-[#0d1526] border rounded transition-colors ${
                    isOpen ? 'border-[#7B61FF]/60' : 'border-[#1e2a3a] hover:border-[#7B61FF]/40'
                  } ${isOpen ? 'lg:col-span-3 sm:col-span-2' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : g.meta.id)}
                    className="w-full flex items-start gap-3 p-3 text-left"
                  >
                    {portrait ? (
                      <img
                        src={portrait}
                        alt={g.meta.id}
                        className="w-14 h-14 rounded border-2 border-[#7B61FF]/40 flex-shrink-0"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded border-2 border-[#1e2a3a] bg-[#141c2e] flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-white text-sm font-semibold">{g.meta.id === 'AurelionSol' ? 'Aurelion Sol' : g.meta.id}</span>
                        <svg
                          className={`w-4 h-4 text-[#7a8aa0] transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`}
                          fill="none" stroke="currentColor" viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                      <div className="text-[11px] uppercase tracking-widest text-[#c39bff] mt-0.5">{t(g.meta.titleKey as TranslationKey)}</div>
                      <p className="text-[11px] text-[#a0b0c5] mt-1 leading-snug line-clamp-2">{t(g.meta.themeKey as TranslationKey)}</p>
                    </div>
                  </button>
                  {isOpen && (
                    <div className="border-t border-[#1e2a3a] p-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                      <GodSection
                        title={t('gods.section.offerings')}
                        stageLabel="2-4 / 3-4 / 4-4"
                        accent="#9ab0bf"
                        entries={g.offerings}
                        assets={assets}
                      />
                      <GodSection
                        title={t('gods.section.finalBoon')}
                        stageLabel="4-7"
                        accent="#c39bff"
                        entries={g.base ? [g.base] : []}
                        assets={assets}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}

function GodSection({
  title,
  stageLabel,
  accent,
  entries,
  assets,
}: {
  title: string;
  stageLabel: string;
  accent: string;
  entries: { apiName: string; data: TftAugment }[];
  assets: TftAssetsBundle;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[10px] uppercase tracking-widest" style={{ color: accent }}>{title}</span>
        <span className="text-[10px] text-[#7a8aa0] tabular-nums">{stageLabel}</span>
      </div>
      {entries.length === 0 ? (
        <div className="text-[#7a8aa0] text-xs">—</div>
      ) : (
        <div className="space-y-2">
          {entries.map(e => {
            const url = tftIconUrl(assets, e.data.icon);
            return (
              <div key={e.apiName} className="flex items-start gap-2 p-2 bg-[#141c2e] rounded">
                {url ? (
                  <img src={url} alt={e.data.name} className="w-10 h-10 rounded border" style={{ borderColor: accent + '60' }} />
                ) : (
                  <div className="w-10 h-10 rounded border bg-[#0d1526] flex-shrink-0" style={{ borderColor: accent + '60' }} />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-white text-xs font-medium">{e.data.name}</div>
                  {e.data.desc && (
                    <p className="text-[#a0b0c5] text-[11px] mt-0.5 leading-snug">{e.data.desc}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
