'use client';
import { useEffect, useState, useMemo } from 'react';
import { withAlpha } from '../../../lib/color';
import { useParams } from 'next/navigation';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import { useI18n } from '../../../lib/i18n';
import { loadTftAssets, tftIconUrl, tftChampionTileUrl, findChampion, type TftAssetsBundle } from '../../../lib/tft-cdragon';
import { loadCompGuidesBundle, allGuides, type CompGuide } from '../../../lib/tft-comp-guides';
import {
  loadAugmentStages,
  augmentStagesFor,
  stageColor,
  type AugmentStage,
  type AugmentStagesOverride,
} from '../../../lib/tft-augment-stages';

// Pure reference detail — Riot has restricted augment-statistics display, so
// this page intentionally surfaces only name + description + tier from the
// CommunityDragon asset bundle. No Match-V1 derived metrics.
//
// Plus #5 Augment-Driven Comp-Picker (2026-06-21): Reverse-Lookup auf
// tft-metatft-comps-17.json zeigt welche Comps dieses Augment in ihrer
// Augment-Liste haben.
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
  const [stagesOverride, setStagesOverride] = useState<AugmentStagesOverride | null>(null);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);
  useEffect(() => { loadCompGuidesBundle().then(setCompGuidesBundle); }, []);
  useEffect(() => { loadAugmentStages().then(setStagesOverride); }, []);

  const meta = assets?.augments[apiName];
  const tier = meta?.tier ?? 0;
  const tierColor = TIER_COLORS[tier] || 'var(--fg-muted)';
  const iconUrl = tftIconUrl(assets, meta?.icon);
  const augStages = augmentStagesFor(stagesOverride, apiName);

  // Reverse-Lookup: alle Comps die dieses Augment listen. allGuides liefert
  // trait+carry aus der Familien-Map mit — ein Cluster kann dabei unter
  // mehreren Familien erscheinen, was gewollt ist (Dual-Carry-Comps).
  const matchingComps: CompMatch[] = useMemo(
    () => allGuides(compGuidesBundle).filter(g => g.guide.augments.includes(apiName)),
    [compGuidesBundle, apiName],
  );

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav active="augments" />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <a href="/tft/augments" className="text-accent text-xs hover:underline">← {t('nav.augments')}</a>
          {meta && (
            <a
              href={`/tft/augments/compare?a=${encodeURIComponent(apiName)}`}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-surface-raised border border-border-subtle text-fg-secondary hover:text-white hover:border-accent-a50 text-xs transition-colors"
              title={t('tft.augmentsCompare.fromDetail')}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="17 1 21 5 17 9" />
                <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                <polyline points="7 23 3 19 7 15" />
                <path d="M21 13v2a4 4 0 0 1-4 4H3" />
              </svg>
              <span className="hidden sm:inline">{t('tft.augmentsCompare.fromDetail')}</span>
            </a>
          )}
        </div>

        {assets && !meta && (
          <div className="mt-4 bg-surface-base border border-border-subtle rounded p-6 text-center text-fg-secondary text-sm">
            —
          </div>
        )}

        {meta && (
          <div className="mt-2 bg-surface-base border border-border-subtle rounded-lg p-5">
            <div className="flex items-start gap-4 flex-wrap">
              {iconUrl ? (
                <img src={iconUrl} alt={meta.name} className="w-20 h-20 rounded-lg border-2" style={{ borderColor: tierColor }} />
              ) : (
                <div className="w-20 h-20 rounded-lg bg-surface-overlay" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-white text-2xl font-medium">{meta.name}</h1>
                  {tier > 0 && (
                    <span
                      className="px-2 py-0.5 rounded text-[10px] uppercase tracking-widest"
                      style={{ backgroundColor: `${withAlpha(tierColor, 0x20)}`, color: tierColor, border: `1px solid ${withAlpha(tierColor, 0x55)}` }}
                    >
                      {TIER_LABELS[tier]}
                    </span>
                  )}
                </div>
                {meta.desc && (
                  <p className="text-fg-secondary text-sm mt-3 leading-relaxed whitespace-pre-line">{meta.desc}</p>
                )}
              </div>
            </div>
            {/* Stage-Constraint-Anzeige aus tactics.tools-Override
                (refresh-augment-stages.mjs). Wir rendern alle 3 Stage-Pills
                (2-1/3-2/4-2), inactive sind dezent grayed-out. KEIN
                Verteilungs-Chart mit Counts/Stats (feedback_no_augment_stats
                Zeile 13: „Augment-by-Stage-Charts mit Stats" verboten). */}
            <div className="mt-4 pt-4 border-t border-border-subtle">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-fg-secondary text-[10px] uppercase tracking-widest">
                  {t('tft.augment.stage.appearsIn')}
                </span>
              </div>
              {augStages ? (
                <div className="flex flex-wrap gap-2">
                  {(['2-1', '3-2', '4-2'] as const).map(s => {
                    const c = stageColor(s);
                    const isActive = augStages.includes(s);
                    return (
                      <span
                        key={s}
                        className="text-xs tabular-nums px-3 py-1 rounded border font-medium transition-opacity"
                        style={{
                          color: isActive ? c : 'var(--fg-faint)',
                          backgroundColor: isActive ? `${withAlpha(c, 0x1a)}` : 'transparent',
                          borderColor: isActive ? `${withAlpha(c, 0x55)}` : 'var(--border-subtle)',
                          opacity: isActive ? 1 : 0.45,
                        }}
                      >
                        Stage {s}
                      </span>
                    );
                  })}
                </div>
              ) : (
                <div className="text-fg-muted text-[11px] italic">
                  {t('tft.augment.stage.unknown')}
                </div>
              )}
              <div className="text-fg-faint text-[10px] italic mt-2">
                {t('tft.augment.stage.sourceFooter')}
              </div>
            </div>
          </div>
        )}

        {/* #5 — Comps die dieses Augment kuratiert spielen. Reine Display-
            Sektion ohne Stats (feedback_no_augment_stats: Augment-Stats
            verboten, kuratierte Comp-Liste pro Augment ist erlaubt). */}
        {meta && matchingComps.length > 0 && (
          <div className="mt-5 bg-surface-base border border-border-subtle rounded-lg p-5">
            <h2 className="text-fg-secondary text-xs uppercase tracking-widest mb-3">
              {t('tft.augment.compsPlayingThis')}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {matchingComps.map(m => {
                const traitMeta = assets?.traits[m.trait];
                const traitName = traitMeta?.name || m.trait.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '');
                const carryChamp = findChampion(assets, m.carry);
                const carryName = carryChamp?.name || m.carry.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '');
                const carryUrl = tftChampionTileUrl(assets, carryChamp);
                // Cluster-Key heuristisch konstruieren — Comp-Detail nimmt
                // jeden Slug an und auflöst zum besten Match.
                const compSlug = `${m.trait}@6_${m.carry}`;
                return (
                  <a
                    key={m.slug}
                    href={`/tft/comps/${encodeURIComponent(compSlug)}`}
                    className="flex items-center gap-3 p-3 rounded-md bg-surface-raised border border-border-subtle hover:border-accent-a50 transition-colors"
                  >
                    {carryUrl ? (
                      <img
                        src={carryUrl}
                        alt={carryName}
                        className="w-10 h-10 rounded-md border-2 border-[#c39bff]/50 object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-md bg-surface-overlay flex-shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-white text-sm font-medium truncate">{carryName}</div>
                      <div className="text-fg-secondary text-[11px] truncate">{traitName}</div>
                      {m.guide.difficulty && (
                        <div className="text-[10px] text-fg-muted uppercase tracking-wider mt-0.5">
                          {m.guide.difficulty}
                        </div>
                      )}
                    </div>
                  </a>
                );
              })}
            </div>
            <div className="text-fg-faint text-[10px] mt-3 italic">
              {t('tft.augment.compsPlayingThis.note')}
            </div>
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}
