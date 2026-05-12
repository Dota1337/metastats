'use client';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import EmptyData from '../../components/tft/EmptyData';
import StatsFilterBar, {
  filtersFromSearchParams,
  filtersToQueryString,
  type Filters,
  type PatchInfo,
} from '../../components/tft/StatsFilterBar';
import { useI18n } from '../../lib/i18n';
import { loadTftAssets, tftIconUrl, type TftAssetsBundle, type TftTraitTier } from '../../lib/tft-cdragon';
import TftHero from '../../components/tft/TftHero';

interface TraitRow {
  name: string;
  activation: number;
  games: number;
  avgPlacement: number | null;
  top4Rate: number | null;
  pickRate: number | null;
}

// One row per trait — collapsing the per-activation rows the API returns.
// We surface the best activation level's avg-placement as the "headline"
// number and show all tier breakpoints as pills so users see the trait's
// full activation curve at a glance.
interface GroupedTrait {
  name: string;
  totalGames: number;
  bestAvg: number | null;
  bestActivation: number | null;
  avgTop4Rate: number | null;
  pickRate: number | null;
}

// Visual map for trait activation styles — mirrors the in-game frame colors.
const STYLE_COLORS: Record<number, string> = {
  1: '#a07a4d',   // bronze
  3: '#cfd6dc',   // silver
  4: '#e0c75a',   // gold
  5: '#c39bff',   // prismatic
};

export default function TftTraitsPage() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [filters, setFilters] = useState<Filters>(() => filtersFromSearchParams(new URLSearchParams(searchParams.toString())));
  const [rows, setRows] = useState<TraitRow[]>([]);
  const [hasData, setHasData] = useState<boolean | null>(null);
  const [patches, setPatches] = useState<PatchInfo[]>([]);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);

  useEffect(() => {
    setLoading(true);
    const qs = filtersToQueryString(filters);
    fetch(`/api/tft/traits?${qs}`)
      .then(r => r.json())
      .then(d => {
        setHasData(!!d.hasData);
        setRows(d.traits || []);
        setPatches(d.patches || []);
        setLoading(false);
      })
      .catch(() => { setHasData(false); setRows([]); setLoading(false); });
    const url = `${pathname}?${qs}`;
    if (typeof window !== 'undefined' && window.location.pathname + window.location.search !== url) {
      router.replace(url, { scroll: false });
    }
  }, [filters, pathname, router]);

  // Collapse per-activation rows into one entry per trait. "Best" = activation
  // level with the lowest (best) average placement, weighted by games.
  const grouped: GroupedTrait[] = useMemo(() => {
    const byName = new Map<string, TraitRow[]>();
    for (const r of rows) {
      const list = byName.get(r.name) || [];
      list.push(r);
      byName.set(r.name, list);
    }
    const out: GroupedTrait[] = [];
    for (const [name, list] of byName) {
      const totalGames = list.reduce((s, r) => s + r.games, 0);
      const best = list.reduce<TraitRow | null>(
        (acc, r) => (acc == null || (r.avgPlacement ?? 9) < (acc.avgPlacement ?? 9)) ? r : acc, null);
      const totalTop4 = list.reduce((s, r) => s + (r.top4Rate != null ? r.top4Rate * r.games : 0), 0);
      const totalPick = list.reduce((s, r) => s + (r.pickRate != null ? r.pickRate * r.games : 0), 0);
      out.push({
        name,
        totalGames,
        bestAvg: best?.avgPlacement ?? null,
        bestActivation: best?.activation ?? null,
        avgTop4Rate: totalGames > 0 ? totalTop4 / totalGames : null,
        pickRate: totalGames > 0 ? totalPick / totalGames : null,
      });
    }
    return out.sort((a, b) => (a.bestAvg ?? 9) - (b.bestAvg ?? 9));
  }, [rows]);

  const currentPatchLabel = patches[0]?.patch;

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="traits" />
      <TftHero pageTitle={t('nav.traits')} patch={currentPatchLabel} />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-2 pb-6">
        <StatsFilterBar filters={filters} patches={patches} onChange={setFilters} />

        {loading && hasData === null && (
          <div className="text-[#4a5a70] text-center py-8">{t('tft.loading')}</div>
        )}
        {hasData === false && <EmptyData />}

        {hasData && grouped.length > 0 && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded overflow-hidden">
            <div className="hidden md:grid grid-cols-[3rem_1fr_10rem_4rem_5rem_5rem_5rem_5rem] gap-2 px-4 py-2 text-[10px] uppercase text-[#4a5a70] bg-[#0a0e1a]">
              <div></div>
              <div>{t('nav.traits')}</div>
              <div>{t('tft.trait.tiers')}</div>
              <div className="text-right">{t('tft.trait.bestAt')}</div>
              <div className="text-right">{t('tft.avgPlacement')}</div>
              <div className="text-right">{t('tft.pickRate')}</div>
              <div className="text-right">{t('tft.top4')}</div>
              <div className="text-right">{t('tft.gamesShort')}</div>
            </div>
            <div className="md:hidden px-4 py-2 text-[10px] uppercase tracking-widest text-[#4a5a70] bg-[#0a0e1a]">{t('nav.traits')}</div>
            {grouped.map(g => {
              const meta = assets?.traits[g.name];
              const url = tftIconUrl(assets, meta?.icon);
              const tiers: TftTraitTier[] = meta?.tiers || [];
              return (
                <a
                  key={g.name}
                  href={`/tft/traits/${encodeURIComponent(g.name)}`}
                  className="block md:grid md:grid-cols-[3rem_1fr_10rem_4rem_5rem_5rem_5rem_5rem] gap-2 px-4 py-2 md:items-center text-xs border-t border-[#1e2a3a] hover:bg-white/5"
                >
                  <div className="flex items-center gap-3 md:contents">
                    {url ? (
                      <img src={url} alt={meta!.name} className="w-9 h-9 rounded flex-shrink-0" />
                    ) : (
                      <div className="w-9 h-9 rounded bg-[#1e2a3a] flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0 md:flex-initial">
                      <div className="text-white truncate">{meta?.name || prettyTrait(g.name)}</div>
                      {/* Mobile-only: best-activation hint as small subtitle */}
                      <div className="md:hidden text-[#7B61FF] text-[10px]">
                        {t('tft.trait.bestAt')} {g.bestActivation ?? '—'}
                      </div>
                    </div>
                  </div>
                  <div className="mt-1.5 pl-12 md:pl-0 md:mt-0">
                    <TierStrip tiers={tiers} />
                  </div>
                  <div className="hidden md:block text-right text-[#7B61FF] font-medium">
                    {g.bestActivation ?? '—'}
                  </div>
                  <div className="grid grid-cols-4 gap-2 mt-1.5 pl-12 md:pl-0 md:mt-0 md:contents">
                    <Cell label={t('tft.avgPlacement')} value={g.bestAvg?.toFixed(2) ?? '—'} accent="white" />
                    <Cell label={t('tft.pickRate')} value={g.pickRate != null ? `${(g.pickRate * 100).toFixed(1)}%` : '—'} />
                    <Cell label={t('tft.top4')} value={g.avgTop4Rate != null ? `${(g.avgTop4Rate * 100).toFixed(1)}%` : '—'} />
                    <Cell label={t('tft.gamesShort')} value={String(g.totalGames)} accent="muted" />
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}

// Compact horizontal tier strip — one square per breakpoint, color-coded
// by the style index from CommunityDragon. Mirrors the in-game trait
// activation row in the hex grid.
function TierStrip({ tiers }: { tiers: TftTraitTier[] }) {
  if (!tiers || tiers.length === 0) return <div className="text-[#4a5a70] text-[10px]">—</div>;
  return (
    <div className="flex gap-1 flex-wrap">
      {tiers.map((tier, i) => {
        const color = STYLE_COLORS[tier.style] || '#4a5a70';
        return (
          <div
            key={i}
            className="rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
            style={{ backgroundColor: `${color}22`, color, border: `1px solid ${color}55` }}
          >
            {tier.minUnits}
          </div>
        );
      })}
    </div>
  );
}

function prettyTrait(s: string) { return s.replace(/^TFT\d+_/, '').replace(/Trait$/, ''); }

function Cell({ label, value, accent }: { label: string; value: string; accent?: 'white' | 'muted' }) {
  const valueClass = accent === 'white' ? 'text-white' : accent === 'muted' ? 'text-[#4a5a70]' : 'text-[#8a9bb0]';
  return (
    <>
      <div className="md:hidden">
        <div className="text-[#4a5a70] text-[9px] uppercase tracking-widest leading-tight">{label}</div>
        <div className={`${valueClass} tabular-nums leading-tight`}>{value}</div>
      </div>
      <div className={`hidden md:block text-right ${valueClass} tabular-nums`}>{value}</div>
    </>
  );
}
