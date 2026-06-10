'use client';
import { useEffect, useMemo, useState } from 'react';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import TftHero from '../../components/tft/TftHero';
import { useI18n, type TranslationKey } from '../../lib/i18n';
import { loadTftAssets, tftIconUrl, type TftAssetsBundle, type TftAugment } from '../../lib/tft-cdragon';

// Set 17 "Space Gods": 9 gods replace the traditional Carousel. Each game
// rolls 2 of the 9 + Pengu as a backup offering. The favored god (the one
// the player picked at least 2× across stages 2-4 / 3-4 / 4-4) hands out a
// final Boon at stage 4-7.
//
// Wiki-style catalog only (no stats — Riot has restricted augment metrics).
// Boon descriptions + icons come live from the asset bundle via the pattern
// TFT17_Augment_<id>GodAugment*. Static metadata (titles/themes/baseApiName)
// lives in public/tft-gods-17.json. Earlier version mapped sub-boons to
// stages 2-4 / 3-4 / 4-4 — that turned out to be guesswork (sub-boons are
// final-boon variants/quest picks, not stage offerings) and got removed.

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
  boons: { apiName: string; data: TftAugment; isBase: boolean }[];
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
        .filter(([apiName]) => apiName === groupPrefix || apiName.startsWith(groupPrefix + '_'))
        .sort((a, b) => {
          // Base first, then alphabetical.
          if (a[0] === meta.baseApiName) return -1;
          if (b[0] === meta.baseApiName) return 1;
          return a[1].name.localeCompare(b[1].name);
        });
      return {
        meta,
        boons: entries.map(([apiName, data]) => ({ apiName, data, isBase: apiName === meta.baseApiName })),
      };
    });
  }, [assets, doc]);

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="gods" />
      <TftHero pageTitle={t('nav.gods')} subtitle={assets?.setName} />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-2 pb-10">
        {/* Mechanic intro — user explicitly asked for info texts on this page. */}
        <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4 mb-4">
          <p className="text-[#a0b0c5] text-xs leading-relaxed">{t('gods.mechanic.intro')}</p>
          <div className="flex flex-wrap gap-2 mt-3">
            <StageChip label="2-4" />
            <StageChip label="3-4" />
            <StageChip label="4-4" />
            <StageChip label="4-7" accent="#c39bff" boldLabel={t('gods.stage.final')} />
          </div>
        </div>

        {assets && doc && gods.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {gods.map(g => {
              const isOpen = expanded === g.meta.id;
              // Portrait — prefer the base (final) boon's icon; fall back to first variant.
              const base = g.boons.find(b => b.isBase);
              const portrait = base?.data.icon
                ? tftIconUrl(assets, base.data.icon)
                : (g.boons[0]?.data.icon ? tftIconUrl(assets, g.boons[0].data.icon) : null);
              const displayName = g.meta.id === 'AurelionSol' ? 'Aurelion Sol' : g.meta.id;
              return (
                <div
                  key={g.meta.id}
                  className={`bg-[#0d1526] border rounded transition-colors ${
                    isOpen ? 'border-[#7B61FF]/60 lg:col-span-3 sm:col-span-2' : 'border-[#1e2a3a] hover:border-[#7B61FF]/40'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : g.meta.id)}
                    className="w-full flex items-start gap-3 p-3 text-left"
                  >
                    {portrait ? (
                      <img
                        src={portrait}
                        alt={displayName}
                        className="w-14 h-14 rounded border-2 border-[#7B61FF]/40 flex-shrink-0"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded border-2 border-[#1e2a3a] bg-[#141c2e] flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-white text-sm font-semibold">{displayName}</span>
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
                    <div className="border-t border-[#1e2a3a] p-3">
                      <div className="text-[10px] uppercase tracking-widest text-[#9ab0bf] mb-3">{t('gods.section.boons')}</div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {g.boons.map(b => {
                          const url = tftIconUrl(assets, b.data.icon);
                          const accent = b.isBase ? '#c39bff' : '#7a8aa0';
                          return (
                            <div key={b.apiName} className="flex items-start gap-2 p-2 bg-[#141c2e] rounded">
                              {url ? (
                                <img src={url} alt={b.data.name} className="w-10 h-10 rounded border" style={{ borderColor: accent + '60' }} />
                              ) : (
                                <div className="w-10 h-10 rounded border bg-[#0d1526] flex-shrink-0" style={{ borderColor: accent + '60' }} />
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-baseline gap-2">
                                  <span className="text-white text-xs font-medium">{b.data.name}</span>
                                  {b.isBase && (
                                    <span className="text-[9px] uppercase tracking-widest" style={{ color: accent }}>{t('gods.boon.main')}</span>
                                  )}
                                </div>
                                {b.data.desc && (
                                  <p className="text-[#a0b0c5] text-[11px] mt-0.5 leading-snug">{b.data.desc}</p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
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

function StageChip({ label, accent, boldLabel }: { label: string; accent?: string; boldLabel?: string }) {
  const color = accent || '#9ab0bf';
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#141c2e] border" style={{ borderColor: color + '40' }}>
      <span className="text-[10px] uppercase tracking-widest tabular-nums" style={{ color }}>{label}</span>
      {boldLabel && <span className="text-[10px] uppercase tracking-widest" style={{ color }}>· {boldLabel}</span>}
    </div>
  );
}
