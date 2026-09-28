'use client';
import Link from 'next/link';
import { useMemo } from 'react';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import EmptyData from '../../../components/tft/EmptyData';
import CompsTabs from '../../../components/tft/CompsTabs';
import StatsFilterBar from '../../../components/tft/StatsFilterBar';
import TftHero from '../../../components/tft/TftHero';
import type { CompFamily } from '../../../components/tft/CompFamilyRow';
import { useI18n } from '../../../lib/i18n';
import { tftChampionTileUrl, tftTraitDisplayName, type TftAssetsBundle } from '../../../lib/tft-cdragon';
import { namedCarries } from '../../../lib/tft-comp-roles';
import { dedupeByCarry, visibleFamilies, familyTrend, type CompSortBy } from '../../../lib/tft-comp-families';
import { costColor, HEX_CLIP } from '../../../lib/tft-ui';
import { useTftCompsData } from '../../../lib/useTftCompsData';

// Comp-Uebersicht nach Unit-Kosten (User 2026-09-27, Vorbild tftable.cc/comps):
// eine Zeile je Kostenstufe, 5 oben. Dieselben Familien wie die Liste
// (tft-comp-families), Zeile = Kosten des Haupt-Carrys laut Asset-Bundle
// (User 2026-09-28: Spellweaver · Veigar & LeBlanc gehoert zu 1-Cost).

const prettyId = (s: string) => s.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '');

function familyCost(f: CompFamily, assets: TftAssetsBundle): number | null {
  const costs = namedCarries({ carries: f.carries, tanks: f.tanks }, f.carry)
    .map(cid => assets.champions[cid]?.cost)
    .filter((c): c is number => typeof c === 'number' && c >= 1 && c <= 5);
  return costs[0] ?? null;
}

export default function TftCompsAtlasPage() {
  const { t } = useI18n();
  const {
    filters, handleFiltersChange, sortBy, chooseSort,
    hasData, patches, assets, loading, currentPatchLabel,
    currentSetFamilies, topFamilyKeys,
  } = useTftCompsData();

  // Dieselben 40 Familien wie die Liste, in der gewaehlten Sortierung —
  // ohne Doppelungen (gleicher Carry + gleiches Board, bestes Ø bleibt).
  const rows = useMemo(() => {
    if (!assets) return [];
    const shown = dedupeByCarry(visibleFamilies(currentSetFamilies, topFamilyKeys, '', assets));
    const byCost = new Map<number, CompFamily[]>();
    for (const f of shown) {
      const c = familyCost(f, assets);
      if (c == null) continue;
      if (!byCost.has(c)) byCost.set(c, []);
      byCost.get(c)!.push(f);
    }
    return [5, 4, 3, 2, 1]
      .filter(c => (byCost.get(c)?.length ?? 0) > 0)
      .map(c => ({ cost: c, families: byCost.get(c)! }));
  }, [currentSetFamilies, topFamilyKeys, assets]);

  const rowLabel = (cost: number) => {
    const plan = cost === 5 ? t('tft.comps.atlas.fast9')
      : cost === 4 ? t('tft.comps.atlas.fast8')
      : t('tft.comps.atlas.reroll');
    return `${t('tft.comps.atlas.cost').replace('{n}', String(cost))} · ${plan}`;
  };

  const href = (f: CompFamily) =>
    `/tft/comps/${encodeURIComponent(f.mainComp.slug)}?bucket=${filters.bucket}&region=${filters.region}${filters.days ? `&days=${filters.days}` : ''}`;

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav active="comps" />
      <TftHero pageTitle={t('nav.comps')} subtitle={t('tft.heroSubtitle')} patch={currentPatchLabel}>
        <CompsTabs active="overview" filters={filters} />
      </TftHero>
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 pt-2 pb-6">
        <StatsFilterBar filters={filters} patches={patches} onChange={handleFiltersChange} />

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
            <option value="games">{t('tft.gamesShort')}</option>
            {filters.velocity > 0 && (
              <option value="velocity">{t('tft.velocity.trending')}</option>
            )}
          </select>
        </div>

        {loading && hasData === null && (
          <div className="text-fg-muted text-center py-8">{t('tft.noDataYet').replace('Noch keine Daten', 'Lade')}</div>
        )}
        {hasData === false && <EmptyData />}

        {hasData && assets && rows.length > 0 && (
          <div className="space-y-2">
            {rows.map(row => (
              <section
                key={row.cost}
                className="flex flex-col sm:flex-row gap-3 sm:gap-4 rounded-md border border-border-subtle bg-surface-comp-row px-3 py-3"
              >
                <div className="flex sm:flex-col items-center sm:items-start gap-2 sm:gap-0.5 sm:w-28 flex-shrink-0">
                  <span className="text-3xl sm:text-4xl font-bold leading-none tabular-nums" style={{ color: costColor(row.cost) }}>
                    {row.cost}
                  </span>
                  <span className="text-[11px] text-fg-secondary font-medium">{rowLabel(row.cost)}</span>
                </div>
                <div className="flex flex-wrap gap-x-2 gap-y-3 min-w-0">
                  {row.families.map(f => (
                    <AtlasTile key={f.familyKey} family={f} assets={assets} href={href(f)} t={t} />
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
  family: f, assets, href, t,
}: {
  family: CompFamily;
  assets: TftAssetsBundle;
  href: string;
  t: (k: any) => string;
}) {
  const named = namedCarries({ carries: f.carries, tanks: f.tanks }, f.carry);
  const lead = named[0];
  const champ = lead ? assets.champions[lead] : null;
  const url = tftChampionTileUrl(assets, champ);
  const ring = costColor(champ?.cost ?? 1);
  const carryName = (cid: string) => assets.champions[cid]?.name || prettyId(cid);
  const name = `${tftTraitDisplayName(assets, f.trait)} · ${named.map(carryName).join(' & ')}`;
  const avg = f.weightedAvgPlacement;
  const trend = familyTrend(f);
  const tip = [
    name,
    `${t('tft.avgPlacement')}: ${avg != null ? avg.toFixed(2) : '—'}`,
    `${t('tft.top4')}: ${f.weightedTop4Rate != null ? (f.weightedTop4Rate * 100).toFixed(1) + '%' : '—'}`,
    `${t('tft.gamesShort')}: ${f.totalGames.toLocaleString()}`,
  ].join('\n');

  return (
    <Link
      href={href}
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
          <span className="absolute -top-1 -right-2 px-1 rounded bg-surface-base/90 border border-border-subtle text-[10px] font-semibold text-white tabular-nums">
            {avg.toFixed(2)}
          </span>
        )}
        {trend != null && trend !== 0 && (
          <span
            className="absolute -top-1 -left-1.5 text-[11px] leading-none font-bold"
            style={{ color: trend < 0 ? '#3ecf8e' : '#e44040' }}
            title={`${trend < 0 ? t('tft.velocity.better') : t('tft.velocity.worse')} (${trend > 0 ? '+' : ''}${trend.toFixed(2)})`}
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
