'use client';
import { useEffect, useState, useMemo } from 'react';
import { withAlpha } from '../../../lib/color';
import { useSearchParams } from 'next/navigation';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import { useI18n } from '../../../lib/i18n';
import { loadTftAssets, tftIconUrl, tftChampionTileUrl, findChampion, type TftAssetsBundle } from '../../../lib/tft-cdragon';
import { loadCompGuidesBundle, allGuides, type CompGuide as CompGuideData } from '../../../lib/tft-comp-guides';

// Augment-Compare-View — zwei Augments nebeneinander mit Tier-Badge,
// Description und Reverse-Lookup auf Comps die sie spielen. User-Flow
// Stage 2-1/3-2/4-2: drei Augment-Optionen angeboten — schneller Vergleich
// statt jeden einzeln in einer separaten Tab zu öffnen.

const TIER_LABELS: Record<number, string> = { 1: 'Silver', 2: 'Gold', 3: 'Prismatic' };
const TIER_COLORS: Record<number, string> = { 1: '#9ab0bf', 2: '#e0c75a', 3: '#c39bff' };

interface CompMatch {
  slug: string;
  guide: CompGuideData;
  trait: string;
  carry: string;
}

export default function TftAugmentsComparePage() {
  const { t } = useI18n();
  const search = useSearchParams();
  const apiNameA = decodeURIComponent(search.get('a') || '');
  const apiNameB = decodeURIComponent(search.get('b') || '');
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  const [compGuidesBundle, setCompGuidesBundle] = useState<Awaited<ReturnType<typeof loadCompGuidesBundle>> | null>(null);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);
  useEffect(() => { loadCompGuidesBundle().then(setCompGuidesBundle); }, []);

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav active="augments" />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <a href="/tft/augments" className="text-accent text-xs hover:underline">← {t('nav.augments')}</a>

        <h1 className="text-white text-xl font-medium mt-2 mb-5">{t('tft.augmentsCompare.title')}</h1>

        {(!apiNameA || !apiNameB) && (
          <div className="bg-surface-base border border-border-subtle rounded p-6 text-center">
            <div className="text-white text-sm font-medium">{t('tft.augmentsCompare.pickTwo')}</div>
            <div className="text-fg-muted text-xs mt-2 leading-relaxed">
              {t('tft.augmentsCompare.pickTwo.hint')}
            </div>
            <a
              href="/tft/augments"
              className="inline-block mt-3 px-3 py-1.5 text-xs bg-accent text-white rounded hover:bg-[#8B71FF] transition-colors"
            >
              {t('tft.augmentsCompare.goToList')}
            </a>
          </div>
        )}

        {apiNameA && apiNameB && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <AugmentPanel
              apiName={apiNameA}
              assets={assets}
              compGuidesBundle={compGuidesBundle}
              t={t}
              side="a"
            />
            <AugmentPanel
              apiName={apiNameB}
              assets={assets}
              compGuidesBundle={compGuidesBundle}
              t={t}
              side="b"
            />
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}

function AugmentPanel({
  apiName, assets, compGuidesBundle, t, side,
}: {
  apiName: string;
  assets: TftAssetsBundle | null;
  compGuidesBundle: Awaited<ReturnType<typeof loadCompGuidesBundle>> | null;
  t: (k: any) => string;
  side: 'a' | 'b';
}) {
  const meta = assets?.augments[apiName];
  const tier = meta?.tier ?? 0;
  const tierColor = TIER_COLORS[tier] || '#7a8aa0';
  const iconUrl = tftIconUrl(assets, meta?.icon);
  const accentColor = side === 'a' ? '#7B61FF' : '#3ecf8e';

  const matchingComps: CompMatch[] = useMemo(
    () => allGuides(compGuidesBundle).filter(g => g.guide.augments.includes(apiName)),
    [compGuidesBundle, apiName],
  );

  if (assets && !meta) {
    return (
      <div className="bg-surface-base border border-border-subtle rounded p-4 text-center">
        <div className="text-fg-muted text-xs">{t('tft.augmentsCompare.notFound')}</div>
      </div>
    );
  }
  if (!meta) {
    return (
      <div className="bg-surface-base border border-border-subtle rounded p-4 text-center">
        <div className="text-fg-muted text-xs">…</div>
      </div>
    );
  }

  return (
    <div
      className="bg-surface-base border rounded p-4"
      style={{ borderColor: `${withAlpha(accentColor, 0x40)}` }}
    >
      <div className="flex items-start gap-3 mb-3">
        {iconUrl ? (
          <img
            src={iconUrl}
            alt={meta.name}
            className="w-14 h-14 rounded-lg border-2 flex-shrink-0"
            style={{ borderColor: tierColor }}
          />
        ) : (
          <div className="w-14 h-14 rounded-lg bg-surface-overlay flex-shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-white text-base font-medium">{meta.name}</h2>
          {tier > 0 && (
            <span
              className="inline-block mt-1 px-2 py-0.5 rounded text-[10px] uppercase tracking-widest"
              style={{ backgroundColor: `${withAlpha(tierColor, 0x20)}`, color: tierColor, border: `1px solid ${withAlpha(tierColor, 0x55)}` }}
            >
              {TIER_LABELS[tier]}
            </span>
          )}
        </div>
      </div>

      {meta.desc && (
        <p className="text-fg-secondary text-xs leading-relaxed whitespace-pre-line mb-3">{meta.desc}</p>
      )}

      <div className="border-t border-border-subtle pt-3">
        <div className="text-fg-muted text-[10px] uppercase tracking-widest mb-2">
          {(t('tft.augmentsCompare.compsCount') as string).replace('{n}', String(matchingComps.length))}
        </div>
        {matchingComps.length === 0 ? (
          <div className="text-fg-faint text-xs">—</div>
        ) : (
          <div className="space-y-1.5">
            {matchingComps.slice(0, 6).map(m => {
              const traitMeta = assets?.traits[m.trait];
              const traitName = traitMeta?.name || m.trait.replace(/^TFT\d+_/, '');
              const carryChamp = findChampion(assets, m.carry);
              const carryName = carryChamp?.name || m.carry.replace(/^TFT\d+_/, '');
              const carryUrl = tftChampionTileUrl(assets, carryChamp);
              const compSlug = `${m.trait}@6_${m.carry}`;
              return (
                <a
                  key={m.slug}
                  href={`/tft/comps/${encodeURIComponent(compSlug)}`}
                  className="flex items-center gap-2 p-2 rounded bg-surface-raised border border-border-subtle hover:border-accent-a50 transition-colors"
                >
                  {carryUrl ? (
                    <img
                      src={carryUrl}
                      alt=""
                      className="w-7 h-7 rounded border border-[#c39bff]/50 object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded bg-surface-overlay flex-shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-white text-xs font-medium truncate">{carryName}</div>
                    <div className="text-fg-muted text-[10px] truncate">{traitName}</div>
                  </div>
                  {m.guide.difficulty && (
                    <span className="text-[9px] text-fg-muted uppercase tracking-wider flex-shrink-0">
                      {m.guide.difficulty}
                    </span>
                  )}
                </a>
              );
            })}
            {matchingComps.length > 6 && (
              <div className="text-fg-faint text-[10px] italic">
                + {matchingComps.length - 6} {t('tft.augmentsCompare.more')}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
