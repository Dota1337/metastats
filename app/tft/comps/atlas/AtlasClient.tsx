'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import EmptyData from '../../../components/tft/EmptyData';
import StatsListPending from '../../../components/tft/StatsListPending';
import ApiUnavailable from '../../../components/ApiUnavailable';
import CompsTabs from '../../../components/tft/CompsTabs';
import StatsFilterBar from '../../../components/tft/StatsFilterBar';
import TftHero from '../../../components/tft/TftHero';
import type { CompFamily } from '../../../components/tft/CompFamilyRow';
import { useI18n, type TranslationKey } from '../../../lib/i18n';
import { tftChampionTileUrl, tftTraitDisplayName, type TftAssetsBundle } from '../../../lib/tft-cdragon';
import { namedCarries } from '../../../lib/tft-comp-roles';
import { dedupeByCarry, familyCost, visibleFamilies, familyLinkSlug, type CompApiRow, type CompSortBy } from '../../../lib/tft-comp-families';
import type { PatchDeltaPair, PatchDeltaStart } from '../../../lib/tft-patch-delta';
import { deltaTooltip } from '../../../components/tft/PatchDeltaCell';
import { compPath } from '../../../lib/tft-comp-path';
import { costColor, HEX_CLIP } from '../../../lib/tft-ui';
import { familyTierLetter, TIER_COLORS, TIER_LETTERS, TIER_NONE_COLOR, TIER_TOOLTIP_KEY, type TierLetter } from '../../../lib/tft-tier-letter';
import type { StatsInitial } from '../../../lib/seo/initial-data';
import type { Filters } from '../../../lib/tft-filters';
import { useTftCompsData } from '../../../lib/useTftCompsData';

// Comp-Uebersicht nach Unit-Kosten (User 2026-09-27, Vorbild tftable.cc/comps):
// eine Zeile je Kostenstufe, 5 oben. Dieselben Familien wie die Liste
// (tft-comp-families), Zeile = familyCost: Kosten des Haupt-Carrys laut
// Asset-Bundle, bei einem 3-Sterne-Reroll-Carry dessen Kosten (User
// 2026-09-28: Spellweaver · Veigar & LeBlanc gehoert zu 1-Cost; 22.10.2026).
// Startdaten kommen von der Server-Huelle (page.tsx), wie bei der Liste.
// Schalter „Kosten | Tier" (User 20.10.2026): die Tier-Ansicht ordnet dieselben
// Kacheln in Reihen S+ … C (tft-tier-letter.ts), Adresse ?group=tier.

export type AtlasGroup = 'cost' | 'tier';

type AtlasRow =
  | { kind: 'cost'; cost: number; families: CompFamily[] }
  | { kind: 'tier'; tier: TierLetter | null; families: CompFamily[] };

const prettyId = (s: string) => s.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '');

export default function AtlasClient({ initialFilters, initial, initialDelta = null, initialGroup = 'cost' }: {
  // Vom Server (page.tsx): Filter aus der Adresse + Standard-Rang, dazu die
  // Zeilen der 40 gezeigten Familien, falls der Zwischenstand sie hatte.
  initialFilters: Filters;
  initial: StatsInitial<CompApiRow> | null;
  // Vorpatch-Vergleich dieser Familien (Pfeile im ersten HTML).
  initialDelta?: PatchDeltaStart | null;
  // Ansicht aus der Adresse (?group=tier), damit das erste HTML schon stimmt.
  initialGroup?: AtlasGroup;
}) {
  const { t, withLang } = useI18n();
  const [group, setGroup] = useState<AtlasGroup>(initialGroup);
  // Pfeile immer gegen den Vorpatch (User 18.10.2026) — deshalb hier kein Δ-Feld.
  const {
    filters, handleFiltersChange, sortBy, chooseSort,
    hasData, patches, assets, loading, currentPatchLabel, error, retry,
    currentSetFamilies, topFamilyKeys, awaitingStored, awaitingFull, deltaView,
  } = useTftCompsData({ initialFilters, initial, deltaAlways: true, initialDelta, extraQuery: group === 'tier' ? '&group=tier' : '' });

  // Dieselben 40 Familien wie die Liste, in der gewaehlten Sortierung —
  // ohne Doppelungen (gleicher Carry + gleiches Board, bestes Ø bleibt).
  // Beide Ansichten zeigen dieselbe Menge: ohne Kosten des Carrys keine Kachel.
  const rows = useMemo((): AtlasRow[] => {
    if (!assets) return [];
    const shown = dedupeByCarry(visibleFamilies(currentSetFamilies, topFamilyKeys, '', assets))
      .map(f => ({ f, cost: familyCost(f, assets) }))
      .filter((x): x is { f: CompFamily; cost: number } => x.cost != null);
    if (group === 'tier') {
      const byTier = new Map<TierLetter | null, CompFamily[]>();
      for (const { f } of shown) {
        const tier = familyTierLetter(f);
        if (!byTier.has(tier)) byTier.set(tier, []);
        byTier.get(tier)!.push(f);
      }
      // Unter der Mindest-Spielzahl: eigene Reihe „—" ganz unten, nur wenn belegt.
      return [...TIER_LETTERS, null]
        .filter(tier => (byTier.get(tier)?.length ?? 0) > 0)
        .map(tier => ({ kind: 'tier' as const, tier, families: byTier.get(tier)! }));
    }
    const byCost = new Map<number, CompFamily[]>();
    for (const { f, cost } of shown) {
      if (!byCost.has(cost)) byCost.set(cost, []);
      byCost.get(cost)!.push(f);
    }
    return [5, 4, 3, 2, 1]
      .filter(c => (byCost.get(c)?.length ?? 0) > 0)
      .map(c => ({ kind: 'cost' as const, cost: c, families: byCost.get(c)! }));
  }, [currentSetFamilies, topFamilyKeys, assets, group]);

  const rowLabel = (cost: number) => {
    const plan = cost === 5 ? t('tft.comps.atlas.fast9')
      : cost === 4 ? t('tft.comps.atlas.fast8')
      : t('tft.comps.atlas.reroll');
    return `${t('tft.comps.atlas.cost').replace('{n}', String(cost))} · ${plan}`;
  };

  const href = (f: CompFamily) =>
    `${compPath(familyLinkSlug(f))}?bucket=${filters.bucket}&region=${filters.region}${filters.days ? `&days=${filters.days}` : ''}`;

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav active="comps" />
      <TftHero pageTitle={t('nav.comps')} subtitle={t('tft.heroSubtitle')} patch={currentPatchLabel} />
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 pt-2 pb-6">
        <StatsFilterBar
          filters={filters}
          patches={patches}
          onChange={handleFiltersChange}
          lead={<CompsTabs active="overview" filters={filters} />}
          showDelta={false}
        />

        <div className="flex items-center justify-between gap-2 mb-3 -mt-1 text-xs flex-wrap">
          <div className="flex gap-1 bg-surface-raised border border-border-subtle rounded p-0.5" role="group" aria-label={t('tft.comps.atlas.groupAria')}>
            {(['cost', 'tier'] as const).map(g => (
              <button
                key={g}
                type="button"
                aria-pressed={group === g}
                onClick={() => setGroup(g)}
                className={`px-3.5 py-1 text-sm rounded ${
                  group === g
                    ? 'bg-accent-fill text-white'
                    : 'text-fg-secondary hover:text-white'
                }`}
              >
                {t(g === 'cost' ? 'tft.comps.atlas.groupCost' : 'tft.comps.atlas.groupTier')}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-fg-muted">{t('tft.sortBy')}:</span>
            <select
              value={sortBy}
              onChange={e => chooseSort(e.target.value as CompSortBy)}
              className="bg-surface-raised border border-border-subtle rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-accent-a60"
            >
              <option value="avg">{t('tft.avgPlacement')}</option>
              <option value="top4">{t('tft.top4')}</option>
              <option value="win">{t('tft.top1')}</option>
              <option value="pick">{t('tft.pickRate')}</option>
              <option value="games">{t('tft.gamesShort')}</option>
              {deltaView && (
                <option value="velocity">{t('tft.velocity.trending')}</option>
              )}
            </select>
          </div>
        </div>

        {/* Immer im HTML: das <style> der Server-Seite blendet die Ladeanzeige
            ein, solange gespeicherte Filter noch laden (SEO-Plan E3). */}
        <StatsListPending show={!error && ((loading && hasData === null) || awaitingStored || awaitingFull)} />
        {error && (
          <ApiUnavailable messageKey="error.temporarilyUnavailable" badge={false} onRetry={retry} />
        )}
        {!error && hasData === false && !awaitingStored && <EmptyData />}

        {!error && hasData && assets && rows.length > 0 && !awaitingStored && !awaitingFull && (
          <div className="space-y-2" data-e3-rows>
            {rows.map(row => (
              <section
                key={row.kind === 'cost' ? `cost-${row.cost}` : `tier-${row.tier ?? 'none'}`}
                className="flex flex-col sm:flex-row gap-3 sm:gap-4 rounded-md border border-border-subtle bg-surface-comp-row px-3 py-3"
              >
                <div className="flex sm:flex-col items-center sm:items-start gap-2 sm:gap-0.5 sm:w-28 flex-shrink-0">
                  {row.kind === 'cost' ? (
                    <>
                      <span className="text-3xl sm:text-4xl font-bold leading-none tabular-nums" style={{ color: costColor(row.cost) }}>
                        {row.cost}
                      </span>
                      <span className="text-[11px] text-fg-secondary font-medium">{rowLabel(row.cost)}</span>
                    </>
                  ) : (
                    <span
                      className="text-3xl sm:text-4xl font-bold leading-none"
                      style={{ color: row.tier ? TIER_COLORS[row.tier] : TIER_NONE_COLOR }}
                      title={t(row.tier ? TIER_TOOLTIP_KEY[row.tier] : 'tft.tier.tooltip.empty')}
                    >
                      {row.tier ?? '—'}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-2 gap-y-3 min-w-0">
                  {row.families.map(f => (
                    <AtlasTile key={f.familyKey} family={f} assets={assets} href={withLang(href(f))} t={t} pair={deltaView?.pair ?? null} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}

function AtlasTile({
  family: f, assets, href, t, pair,
}: {
  family: CompFamily;
  assets: TftAssetsBundle;
  href: string;
  t: (k: TranslationKey) => string;
  pair: PatchDeltaPair | null;
}) {
  const { withLang, lang } = useI18n();
  const named = namedCarries({ carries: f.carries, tanks: f.tanks }, f.carry);
  const lead = named[0];
  const champ = lead ? assets.champions[lead] : null;
  const url = tftChampionTileUrl(assets, champ);
  const ring = costColor(champ?.cost ?? 1);
  const carryName = (cid: string) => assets.champions[cid]?.name || prettyId(cid);
  const name = `${tftTraitDisplayName(assets, f.trait)} · ${named.map(carryName).join(' & ')}`;
  const avg = f.weightedAvgPlacement;
  // Pfeil nur mit belastbarem Vergleich (je Patch ≥ PATCH_DELTA_MIN_GAMES Spiele).
  const trend = pair ? f.delta?.deltaAvgPlace ?? null : null;
  const tip = [
    name,
    `${t('tft.avgPlacement')}: ${avg != null ? avg.toFixed(2) : '—'}`,
    `${t('tft.top4')}: ${f.weightedTop4Rate != null ? (f.weightedTop4Rate * 100).toFixed(1) + '%' : '—'}`,
    // Nach Seitensprache, nicht Browsersprache: der Server rendert den Text
    // mit, ein abweichendes title-Attribut korrigiert React nicht.
    `${t('tft.gamesShort')}: ${f.totalGames.toLocaleString(lang)}`,
  ].join('\n');

  return (
    <Link
      href={withLang(href)}
      title={tip}
      className="group w-[76px] sm:w-[88px] flex flex-col items-center gap-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-a60"
    >
      <div className="relative w-14 h-16 sm:w-16 sm:h-[72px]">
        <div className="absolute inset-0 transition-transform group-hover:scale-105" style={{ clipPath: HEX_CLIP, backgroundColor: ring }}>
          <div className="absolute inset-[3px] bg-surface-overlay" style={{ clipPath: HEX_CLIP }}>
            {url && <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />}
          </div>
        </div>
        {avg != null && (
          <span className="absolute -top-1 -right-2 px-1 rounded bg-surface-base/90 border border-border-subtle text-xs font-semibold text-white tabular-nums">
            {avg.toFixed(2)}
          </span>
        )}
        {trend != null && trend !== 0 && (
          <span
            className="absolute -top-1 -left-1.5 text-[11px] leading-none font-bold"
            style={{ color: trend < 0 ? '#3ecf8e' : 'var(--pos-loss-text)' }}
            title={`${deltaTooltip(f.delta ?? null, pair, t, lang)} (${trend > 0 ? '+' : ''}${trend.toFixed(2)})`}
          >
            {trend < 0 ? '▲' : '▼'}
          </span>
        )}
      </div>
      <span className="text-[11px] leading-tight text-center text-fg-primary group-hover:text-white line-clamp-2 break-words w-full">
        {name}
      </span>
    </Link>
  );
}
