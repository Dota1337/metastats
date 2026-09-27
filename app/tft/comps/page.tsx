'use client';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import EmptyData from '../../components/tft/EmptyData';
import CompFamilyRow, { type CompFamily } from '../../components/tft/CompFamilyRow';
import CompsTabs from '../../components/tft/CompsTabs';
import StatsFilterBar from '../../components/tft/StatsFilterBar';
import { useI18n } from '../../lib/i18n';
import { tftChampionTileUrl, type TftAssetsBundle } from '../../lib/tft-cdragon';
import TftHero from '../../components/tft/TftHero';
import AdvancedCompFilters from '../../components/tft/AdvancedCompFilters';
import { visibleFamilies as pickVisibleFamilies, type CompSortBy } from '../../lib/tft-comp-families';
import { useTftCompsData } from '../../lib/useTftCompsData';

// Filter shape and URL-sync mirror /tft/units and /tft/items so the
// three stats pages behave identically (patch / bucket / days / region).
// Filter, Abruf und Familienbildung teilt die Liste mit der Uebersicht
// (/tft/comps/atlas): useTftCompsData + tft-comp-families.
export default function TftCompsPage() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const {
    filters, handleFiltersChange, adv, setAdv, sortBy, chooseSort,
    comps, filteredComps, hasData, patches, assets, loading, tierCutoffs,
    currentPatchLabel, families, currentSetFamilies, topFamilyKeys,
  } = useTftCompsData();

  // Search-Filter (client-side): trim+lowercase auf Trait-Display + Carry-Name
  // + raw apiNames. Bei leerer Query passiert nichts. Memo-Stage nach
  // families damit Sort + Family-Aggregation intakt bleiben.
  const [search, setSearch] = useState('');

  // Compare-Selection State (für /tft/comps/compare User-Flow): bis zu 2 Slugs
  // gleichzeitig. Bei 3. Click rotiert die Liste (FIFO) — User kann ohne Reset
  // schnell die zweite Comp wechseln.
  //
  // Pre-Population aus URL-Param ?compareA=<slug>: wenn User vom Compare-
  // Button auf der Comp-Detail-Page hierher navigiert, ist die erste Comp
  // bereits vorbelegt — User wählt nur noch die zweite.
  const initialCompareA = searchParams.get('compareA');
  const [compareSelection, setCompareSelection] = useState<string[]>(
    initialCompareA ? [decodeURIComponent(initialCompareA)] : [],
  );
  const toggleCompare = (slug: string) => {
    setCompareSelection(prev => {
      if (prev.includes(slug)) return prev.filter(s => s !== slug);
      if (prev.length < 2) return [...prev, slug];
      return [prev[1], slug];
    });
  };

  const visibleFamilies = useMemo(
    () => pickVisibleFamilies(currentSetFamilies, topFamilyKeys, search, assets),
    [currentSetFamilies, topFamilyKeys, search, assets],
  );

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav active="comps" />
      <TftHero pageTitle={t('nav.comps')} subtitle={t('tft.heroSubtitle')} patch={currentPatchLabel} />
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 pt-2 pb-6">
        <CompsTabs active="list" filters={filters} />
        <StatsFilterBar filters={filters} patches={patches} onChange={handleFiltersChange} />

        <div className="mb-3">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('tft.search.comps')}
            className="w-full sm:w-96 bg-surface-raised border border-border-subtle rounded px-3 py-1.5 text-sm text-white placeholder:text-fg-faint outline-none focus:border-accent-a60"
          />
        </div>

        <AdvancedCompFilters
          filters={adv}
          onChange={setAdv}
          resultCount={filteredComps.length}
          totalCount={comps.length}
        />

        {compareSelection.length > 0 && (
          <CompareBanner
            selection={compareSelection}
            families={families}
            assets={assets}
            t={t}
            onReset={() => setCompareSelection([])}
          />
        )}

        <div className="flex items-center justify-end gap-2 mb-3 -mt-1 text-xs">
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
            {filters.velocity > 0 && (
              <option value="velocity">{t('tft.velocity.trending')}</option>
            )}
          </select>
        </div>

        {loading && hasData === null && (
          <div className="text-fg-muted text-center py-8">{t('tft.noDataYet').replace('Noch keine Daten', 'Lade')}</div>
        )}
        {hasData === false && <EmptyData />}

        {hasData && visibleFamilies.length > 0 && (
          <>
            <div className={`hidden sm:grid items-center gap-4 px-3.5 py-2 text-[11px] text-fg-secondary font-semibold whitespace-nowrap ${
              filters.velocity > 0
                ? 'grid-cols-[1.5rem_1.75rem_minmax(13rem,1fr)_minmax(0,auto)_5rem_3.5rem_3.5rem_3.5rem_3.5rem_3.75rem_7rem]'
                : 'grid-cols-[1.5rem_1.75rem_minmax(13rem,1fr)_minmax(0,auto)_5rem_3.5rem_3.5rem_3.5rem_3.5rem_7rem]'
            }`}>
              <div></div>
              <div></div>
              <div>{t('nav.comps')}</div>
              <div></div>
              <div className="text-center">{t('tft.avgPlacement')}</div>
              <div className="text-right">{t('tft.top4')}</div>
              <div className="text-right">{t('tft.top1')}</div>
              <div className="text-right">{t('tft.pickRate')}</div>
              <div className="text-right">{t('tft.gamesShort')}</div>
              {filters.velocity > 0 && (
                <div className="text-right text-[#c39bff]">
                  {t('tft.velocity.deltaVs').replace('{n}', String(filters.velocity))}
                </div>
              )}
              <div></div>
            </div>
            <div className="space-y-1.5">
              {visibleFamilies.map((f, i) => (
                <CompFamilyRow
                  key={f.familyKey}
                  family={f}
                  rank={i + 1}
                  assets={assets}
                  region={filters.region}
                  bucket={filters.bucket}
                  days={filters.days}
                  showVelocity={filters.velocity > 0}
                  velocityShift={filters.velocity}
                  tierCutoffs={tierCutoffs}
                  compareSelected={compareSelection.includes(f.mainComp.slug)}
                  onCompareToggle={() => toggleCompare(f.mainComp.slug)}
                />
              ))}
            </div>
          </>
        )}
      </div>
      <Footer />
    </main>
  );
}

// Compare-Banner: zeigt selected Slugs + Mini-Carry-Preview + Compare-CTA
// (aktiv ab 2 selected) + Reset. Sticky am Viewport-Top damit User beim
// Scrollen weiter selecten kann ohne den CTA zu verlieren.
function CompareBanner({
  selection, families, assets, t, onReset,
}: {
  selection: string[];
  families: CompFamily[];
  assets: TftAssetsBundle | null;
  t: (k: any) => string;
  onReset: () => void;
}) {
  const selectedFamilies = selection
    .map(slug => families.find(f => f.mainComp.slug === slug))
    .filter(Boolean) as CompFamily[];
  const canCompare = selection.length === 2;
  const compareHref = canCompare
    ? `/tft/comps/compare?a=${encodeURIComponent(selection[0])}&b=${encodeURIComponent(selection[1])}`
    : '#';
  return (
    <div className="sticky top-2 z-30 mb-3">
      <div className="bg-surface-base/95 backdrop-blur-sm border border-accent-a50 rounded-lg px-3 py-2 shadow-lg flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className="text-white text-xs font-medium whitespace-nowrap">
            {(t('tft.compare.selectedCount') as string).replace('{n}', String(selection.length))}
          </span>
          <div className="flex items-center gap-2 min-w-0">
            {selectedFamilies.map(f => {
              // Erster Carry wie im Comp-Namen (tft-comp-roles), sonst der aus dem Key.
              const lead = f.carries[0] || f.carry;
              const carry = lead && assets ? assets.champions[lead] : null;
              const url = tftChampionTileUrl(assets, carry);
              return (
                <div key={f.familyKey} className="flex items-center gap-1.5 min-w-0">
                  {url ? (
                    <img src={url} alt="" className="w-6 h-6 rounded border border-accent-a60 flex-shrink-0" />
                  ) : (
                    <div className="w-6 h-6 rounded bg-surface-overlay flex-shrink-0" />
                  )}
                  <span className="text-white text-[11px] truncate hidden sm:inline">
                    {carry?.name || lead.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '')}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={onReset}
            className="text-fg-secondary text-[11px] hover:text-white px-2 py-1 transition-colors"
          >
            {t('tft.compare.reset')}
          </button>
          {canCompare ? (
            <a
              href={compareHref}
              className="bg-accent hover:bg-[#8B71FF] text-white text-xs font-medium px-3 py-1.5 rounded transition-colors"
            >
              {t('tft.compare.action')} →
            </a>
          ) : (
            <span className="bg-surface-overlay text-fg-faint text-xs font-medium px-3 py-1.5 rounded cursor-not-allowed">
              {t('tft.compare.action')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
