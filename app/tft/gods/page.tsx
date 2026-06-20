'use client';
import { useEffect, useMemo, useState } from 'react';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import TftHero from '../../components/tft/TftHero';
import { useI18n, type TranslationKey } from '../../lib/i18n';
import { loadTftAssets, tftIconUrl, tftAugmentLocalised, type TftAssetsBundle, type TftAugment } from '../../lib/tft-cdragon';

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

type Lang = 'de' | 'en' | 'ko' | 'zh' | 'es' | 'fr';
interface I18nText { en: string; de?: string; ko?: string; zh?: string; es?: string; fr?: string }
interface Offering { name: I18nText; desc: I18nText; iconApiName?: string }
interface GodMeta {
  id: string;
  titleKey: string;
  themeKey: string;
  baseApiName: string;
  category?: string;
  stageOfferings?: Record<'2-4' | '3-4' | '4-4', Offering[]>;
  // Optional: re-route a sub-boon's icon to a different bundle entry. Used for
  // AurelionSol's Quest picks, whose CDragon icons are placeholders or wrong.
  boonIconOverrides?: Record<string, string>;
}
interface GodsDoc {
  set: number;
  gods: GodMeta[];
}

interface GodViewModel {
  meta: GodMeta;
  boons: { apiName: string; data: TftAugment; isBase: boolean }[];
}

function pickI18n(text: I18nText, lang: Lang): string {
  return text[lang] || text.en || '';
}

export default function TftGodsPage() {
  const { t, lang } = useI18n();
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
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 pt-2 pb-10">
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
              const base = g.boons.find(b => b.isBase);
              const variants = g.boons.filter(b => !b.isBase);
              const portrait = base?.data.icon
                ? tftIconUrl(assets, base.data.icon)
                : (g.boons[0]?.data.icon ? tftIconUrl(assets, g.boons[0].data.icon) : null);
              const displayName = g.meta.id === 'AurelionSol' ? 'Aurelion Sol' : g.meta.id;
              const isOpen = expanded === g.meta.id;
              const hasVariants = variants.length > 0;
              return (
                <div
                  key={g.meta.id}
                  className={`bg-[#0d1526] border rounded transition-colors ${
                    isOpen ? 'border-[#7B61FF]/60' : 'border-[#1e2a3a] hover:border-[#7B61FF]/40'
                  }`}
                >
                  {/* Header: portrait + name + title + theme — always visible */}
                  <div className="flex items-start gap-3 p-3">
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
                      <div className="text-white text-sm font-semibold">{displayName}</div>
                      <div className="text-[11px] uppercase tracking-widest text-[#c39bff] mt-0.5">{t(g.meta.titleKey as TranslationKey)}</div>
                      <p className="text-[11px] text-[#a0b0c5] mt-1 leading-snug">{t(g.meta.themeKey as TranslationKey)}</p>
                    </div>
                  </div>

                  {/* Final Boon (Stage 4-7) — always visible, prominent */}
                  {base && (() => {
                    const loc = tftAugmentLocalised(base.data, lang);
                    return (
                      <div className="px-3 pb-3">
                        <div className="flex items-baseline justify-between mb-1.5">
                          <span className="text-[10px] uppercase tracking-widest text-[#c39bff] font-semibold">{t('gods.stage.final')}</span>
                          <span className="text-[10px] text-[#7a8aa0] tabular-nums">4-7</span>
                        </div>
                        <div className="bg-[#141c2e] border border-[#c39bff]/30 rounded p-2">
                          <div className="text-white text-xs font-medium">{loc.name}</div>
                          {loc.desc && (
                            <p className="text-[#a0b0c5] text-[11px] mt-1 leading-snug">{loc.desc}</p>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Stage Offerings (2-4 / 3-4 / 4-4) — collapsible */}
                  {(g.meta.stageOfferings || hasVariants) && (
                    <>
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : g.meta.id)}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 border-t border-[#1e2a3a] text-left hover:bg-[#141c2e]/50"
                      >
                        <span className="text-[10px] uppercase tracking-widest text-[#9ab0bf]">
                          {t('gods.section.offerings')}
                        </span>
                        <svg
                          className={`w-4 h-4 text-[#7a8aa0] transition-transform ${isOpen ? 'rotate-180' : ''}`}
                          fill="none" stroke="currentColor" viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {isOpen && (
                        <div className="border-t border-[#1e2a3a] p-3 space-y-3">
                          {(['2-4', '3-4', '4-4'] as const).map(stage => {
                            const offerings = g.meta.stageOfferings?.[stage] || [];
                            if (offerings.length === 0) return null;
                            return (
                              <div key={stage}>
                                <div className="flex items-baseline justify-between mb-1.5">
                                  <span className="text-[10px] uppercase tracking-widest text-[#9ab0bf]">{t('gods.section.stage')} {stage}</span>
                                  <span className="text-[10px] text-[#7a8aa0] tabular-nums">{offerings.length}</span>
                                </div>
                                <div className="space-y-1.5">
                                  {offerings.map((o, i) => {
                                    // Resolve the iconApiName via bundle.augments first, then bundle.items.
                                    // We get the same Riot icons the in-game UI uses for each offering.
                                    const bundleEntry = o.iconApiName
                                      ? (assets.augments[o.iconApiName] || assets.items[o.iconApiName])
                                      : null;
                                    const iconUrl = bundleEntry?.icon ? tftIconUrl(assets, bundleEntry.icon) : null;
                                    return (
                                      <div key={i} className="flex items-start gap-2 p-2 bg-[#141c2e] rounded">
                                        {iconUrl ? (
                                          <img src={iconUrl} alt={pickI18n(o.name, lang as Lang)} className="w-9 h-9 rounded border border-[#1e2a3a] flex-shrink-0" />
                                        ) : (
                                          <div className="w-9 h-9 rounded border border-[#1e2a3a] bg-[#0d1526] flex-shrink-0" />
                                        )}
                                        <div className="flex-1 min-w-0">
                                          <div className="text-white text-xs font-medium">{pickI18n(o.name, lang as Lang)}</div>
                                          <p className="text-[#a0b0c5] text-[11px] mt-0.5 leading-snug">{pickI18n(o.desc, lang as Lang)}</p>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                          {/* Boon variants from CDragon bundle (e.g. AurelionSol's Quest picks)
                              — show under the stages so users see all wiki info in one place. */}
                          {hasVariants && (
                            <div>
                              <div className="text-[10px] uppercase tracking-widest text-[#c39bff] mb-1.5">{t('gods.section.variants')}</div>
                              <div className="space-y-1.5">
                                {variants.map(b => {
                                  const overrideId = g.meta.boonIconOverrides?.[b.apiName];
                                  const overrideEntry = overrideId
                                    ? (assets.augments[overrideId] || assets.items[overrideId])
                                    : null;
                                  const url = overrideEntry?.icon
                                    ? tftIconUrl(assets, overrideEntry.icon)
                                    : tftIconUrl(assets, b.data.icon);
                                  const loc = tftAugmentLocalised(b.data, lang);
                                  return (
                                    <div key={b.apiName} className="flex items-start gap-2 p-2 bg-[#141c2e] rounded">
                                      {url ? (
                                        <img src={url} alt={loc.name} className="w-10 h-10 rounded border border-[#1e2a3a]" />
                                      ) : (
                                        <div className="w-10 h-10 rounded border border-[#1e2a3a] bg-[#0d1526] flex-shrink-0" />
                                      )}
                                      <div className="flex-1 min-w-0">
                                        <div className="text-white text-xs font-medium">{loc.name}</div>
                                        {loc.desc && (
                                          <p className="text-[#a0b0c5] text-[11px] mt-0.5 leading-snug">{loc.desc}</p>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </>
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
