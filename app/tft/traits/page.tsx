'use client';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import EmptyData from '../../components/tft/EmptyData';
import StatsFilterBar, {
  loadInitialFilters,
  persistFilters,
  filtersToQueryString,
  type Filters,
  type PatchInfo,
} from '../../components/tft/StatsFilterBar';
import { useI18n } from '../../lib/i18n';
import { loadTftAssets, tftIconUrl, type TftAssetsBundle, type TftTraitTier } from '../../lib/tft-cdragon';
import TftHero from '../../components/tft/TftHero';

interface TraitVelocity {
  deltaAvgPlace: number | null;
  avgPlaceNow: number | null;
  avgPlacePrev: number | null;
  gamesNow: number;
  gamesPrev: number;
  isNew: boolean;
}

interface TraitRow {
  name: string;
  activation: number;
  games: number;
  avgPlacement: number | null;
  top4Rate: number | null;
  pickRate: number | null;
  velocity?: TraitVelocity | null;
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
  velocity: TraitVelocity | null;
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

  const [filters, setFilters] = useState<Filters>(() => loadInitialFilters(new URLSearchParams(searchParams.toString())));
  const [hydrated, setHydrated] = useState(false);
  const [rows, setRows] = useState<TraitRow[]>([]);
  const [hasData, setHasData] = useState<boolean | null>(null);
  const [patches, setPatches] = useState<PatchInfo[]>([]);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => { loadTftAssets().then(setAssets); }, []);

  useEffect(() => {
    if (typeof window === 'undefined') { setHydrated(true); return; }
    const params = new URLSearchParams(window.location.search);
    const hasUrlFilters = ['patch', 'bucket', 'days', 'region', 'velocity']
      .some(k => params.has(k));
    if (!hasUrlFilters) {
      const stored = loadInitialFilters(params);
      setFilters(stored);
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (hydrated) persistFilters(filters);
  }, [filters, hydrated, pathname, router]);

  // Collapse per-activation rows into one entry per *display name* (not
  // per apiName) so multi-variant families like Stargazer's 7
  // constellations show up as a single "Stargazer" row instead of 8 rows
  // that all read "Stargazer" + force the user to click through to know
  // which is which. Stats aggregate across variants weighted by games.
  const grouped: GroupedTrait[] = useMemo(() => {
    const byKey = new Map<string, { displayName: string; rows: TraitRow[] }>();
    for (const r of rows) {
      // Prefer the display name from the asset bundle; fall back to the
      // raw apiName when assets haven't loaded yet (avoids flicker).
      const meta = assets?.traits[r.name];
      const displayName = meta?.name || r.name;
      const entry = byKey.get(displayName) || { displayName, rows: [] };
      entry.rows.push(r);
      byKey.set(displayName, entry);
    }
    const out: GroupedTrait[] = [];
    for (const [displayName, { rows: list }] of byKey) {
      const totalGames = list.reduce((s, r) => s + r.games, 0);
      const best = list.reduce<TraitRow | null>(
        (acc, r) => (acc == null || (r.avgPlacement ?? 9) < (acc.avgPlacement ?? 9)) ? r : acc, null);
      const totalTop4 = list.reduce((s, r) => s + (r.top4Rate != null ? r.top4Rate * r.games : 0), 0);
      const totalPick = list.reduce((s, r) => s + (r.pickRate != null ? r.pickRate * r.games : 0), 0);
      // Velocity: API ships one per apiName, but several apiNames can share a
      // display name (Stargazer's 7 constellations). Pick the one with the
      // most current-window games as representative — that's the variant
      // driving the headline number anyway.
      const velList = list.map(r => r.velocity).filter((v): v is TraitVelocity => !!v);
      const velocity = velList.length
        ? velList.reduce<TraitVelocity>((acc, v) => v.gamesNow > acc.gamesNow ? v : acc, velList[0])
        : null;
      out.push({
        name: displayName,
        totalGames,
        bestAvg: best?.avgPlacement ?? null,
        bestActivation: best?.activation ?? null,
        avgTop4Rate: totalGames > 0 ? totalTop4 / totalGames : null,
        pickRate: totalGames > 0 ? totalPick / totalGames : null,
        velocity,
      });
    }
    return out.sort((a, b) => (a.bestAvg ?? 9) - (b.bestAvg ?? 9));
  }, [rows, assets]);

  const visibleGrouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return grouped;
    return grouped.filter(g => g.name.toLowerCase().includes(q));
  }, [grouped, search]);

  const currentPatchLabel = patches[0]?.patch;

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav active="traits" />
      <TftHero pageTitle={t('nav.traits')} patch={currentPatchLabel} />
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 pt-2 pb-6">
        <StatsFilterBar filters={filters} patches={patches} onChange={setFilters} />

        <div className="mb-3">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('tft.search.traits')}
            className="w-full sm:w-80 bg-surface-raised border border-border-subtle rounded px-3 py-1.5 text-sm text-white placeholder:text-fg-faint outline-none focus:border-accent-a60"
          />
        </div>

        {loading && hasData === null && (
          <div className="text-fg-muted text-center py-8">{t('tft.loading')}</div>
        )}
        {hasData === false && <EmptyData />}

        {hasData && visibleGrouped.length > 0 && (
          <div className="bg-surface-base border border-border-subtle rounded overflow-hidden">
            <div className={`hidden md:grid ${filters.velocity > 0 ? 'grid-cols-[3rem_1fr_10rem_4rem_5rem_5rem_5rem_5rem_4rem]' : 'grid-cols-[3rem_1fr_10rem_4rem_5rem_5rem_5rem_5rem]'} gap-3 px-4 py-2.5 text-[11px] text-fg-secondary font-semibold whitespace-nowrap bg-surface-sunken`}>
              <div></div>
              <div>{t('nav.traits')}</div>
              <div>{t('tft.trait.tiers')}</div>
              <div className="text-right">{t('tft.trait.bestAt')}</div>
              <div className="text-center">{t('tft.avgPlacement')}</div>
              <div className="text-right">{t('tft.pickRate')}</div>
              <div className="text-right">{t('tft.top4')}</div>
              <div className="text-right">{t('tft.gamesShort')}</div>
              {filters.velocity > 0 && (
                <div className="text-right text-[#c39bff]">
                  {t('tft.velocity.deltaVs').replace('{n}', String(filters.velocity))}
                </div>
              )}
            </div>
            <div className="md:hidden px-4 py-2 text-[10px] uppercase tracking-widest text-fg-muted bg-surface-sunken">{t('nav.traits')}</div>
            {visibleGrouped.map(g => {
              // g.name is now the display name. Look up the trait by
              // matching display name across all variants and prefer the
              // root variant (no per-mechanic suffix) for the header icon.
              const variantEntries = assets
                ? Object.entries(assets.traits).filter(([, m]) => m.name === g.name)
                : [];
              const rootEntry = variantEntries.find(([apiName]) =>
                !/^TFT\d+_\w+_\w+$/.test(apiName)
              ) || variantEntries[0];
              const meta = rootEntry?.[1] || assets?.traits[g.name];
              const url = tftIconUrl(assets, meta?.icon);
              const tiers: TftTraitTier[] = (meta?.tiers || []) as TftTraitTier[];
              return (
                <a
                  key={g.name}
                  href={`/tft/traits/${encodeURIComponent(g.name)}`}
                  className={`block md:grid ${filters.velocity > 0 ? 'md:grid-cols-[3rem_1fr_10rem_4rem_5rem_5rem_5rem_5rem_4rem]' : 'md:grid-cols-[3rem_1fr_10rem_4rem_5rem_5rem_5rem_5rem]'} gap-3 px-4 py-2.5 md:items-center text-[13px] sm:text-sm border-t border-border-subtle hover:bg-white/5`}
                >
                  <div className="flex items-center gap-3 md:contents">
                    {url ? (
                      <img src={url} alt={meta!.name} className="w-10 h-10 rounded-md flex-shrink-0 shadow-sm" />
                    ) : (
                      <div className="w-10 h-10 rounded-md bg-surface-overlay flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0 md:flex-initial">
                      <div className="text-white font-medium truncate">{meta?.name || prettyTrait(g.name)}</div>
                      {/* Mobile-only: best-activation hint as small subtitle */}
                      <div className="md:hidden text-accent text-[10px]">
                        {t('tft.trait.bestAt')} {g.bestActivation ?? '—'}
                      </div>
                    </div>
                  </div>
                  <div className="mt-1.5 pl-12 md:pl-0 md:mt-0">
                    <TierStrip tiers={tiers} />
                  </div>
                  <div className="hidden md:block text-right text-accent font-medium">
                    {g.bestActivation ?? '—'}
                  </div>
                  <div className={`grid ${filters.velocity > 0 ? 'grid-cols-5' : 'grid-cols-4'} gap-2 mt-1.5 pl-12 md:pl-0 md:mt-0 md:contents`}>
                    <Cell label={t('tft.avgPlacement')} value={g.bestAvg?.toFixed(2) ?? '—'} accent="white" align="center" />
                    <Cell label={t('tft.pickRate')} value={g.pickRate != null ? `${(g.pickRate * 100).toFixed(1)}%` : '—'} />
                    <Cell label={t('tft.top4')} value={g.avgTop4Rate != null ? `${(g.avgTop4Rate * 100).toFixed(1)}%` : '—'} />
                    <Cell label={t('tft.gamesShort')} value={String(g.totalGames)} accent="muted" />
                    {filters.velocity > 0 && (
                      <VelocityCell velocity={g.velocity} label={t('tft.velocity.deltaVs').replace('{n}', String(filters.velocity))} t={t} />
                    )}
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
  if (!tiers || tiers.length === 0) return <div className="text-fg-muted text-[10px]">—</div>;
  return (
    <div className="flex gap-1 flex-wrap">
      {tiers.map((tier, i) => {
        const color = STYLE_COLORS[tier.style] || '#7a8aa0';
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

function Cell({ label, value, accent, align = 'right' }: { label: string; value: string; accent?: 'white' | 'muted'; align?: 'right' | 'center' }) {
  const valueClass = accent === 'white' ? 'text-white' : accent === 'muted' ? 'text-fg-muted' : 'text-fg-secondary';
  const alignClass = align === 'center' ? 'text-center' : 'text-right';
  return (
    <>
      <div className="md:hidden">
        <div className="text-fg-muted text-[9px] uppercase tracking-widest leading-tight">{label}</div>
        <div className={`${valueClass} tabular-nums leading-tight`}>{value}</div>
      </div>
      <div className={`hidden md:block ${alignClass} ${valueClass} tabular-nums`}>{value}</div>
    </>
  );
}

// Same Δ-cell shape as /tft/units — lila label on mobile, color-coded value
// with directional tooltip (besser/schlechter + Jetzt/Vorher).
function VelocityCell({ velocity, label, t }: {
  velocity?: TraitVelocity | null;
  label: string;
  t: (k: any) => string;
}) {
  const renderDesktop = (content: React.ReactNode, title?: string) => (
    <div className="hidden md:block text-right tabular-nums" title={title}>{content}</div>
  );
  const renderMobile = (content: React.ReactNode, title?: string) => (
    <div className="md:hidden" title={title}>
      <div className="text-[#c39bff] text-[9px] uppercase tracking-widest leading-tight">{label}</div>
      <div className="tabular-nums leading-tight">{content}</div>
    </div>
  );
  if (!velocity) {
    const tip = t('tft.velocity.notEnough') as string;
    return (<>
      {renderMobile(<span className="text-fg-faint">—</span>, tip)}
      {renderDesktop(<span className="text-fg-faint">—</span>, tip)}
    </>);
  }
  if (velocity.isNew) {
    const txt = t('tft.velocity.newComp') as string;
    return (<>
      {renderMobile(<span className="text-[#c39bff] font-semibold">{txt}</span>)}
      {renderDesktop(<span className="text-[#c39bff] font-semibold">{txt}</span>)}
    </>);
  }
  if (velocity.deltaAvgPlace == null) {
    const tip = t('tft.velocity.notEnough') as string;
    return (<>
      {renderMobile(<span className="text-fg-faint">—</span>, tip)}
      {renderDesktop(<span className="text-fg-faint">—</span>, tip)}
    </>);
  }
  const better = velocity.deltaAvgPlace < 0;
  const color = better ? '#3ecf8e' : '#e44040';
  const arrow = better ? '▲' : '▼';
  const dirLabel = better ? (t('tft.velocity.better') as string) : (t('tft.velocity.worse') as string);
  const nowStr = velocity.avgPlaceNow != null ? velocity.avgPlaceNow.toFixed(2) : '—';
  const prevStr = velocity.avgPlacePrev != null ? velocity.avgPlacePrev.toFixed(2) : '—';
  const detail = (t('tft.velocity.tooltipDetail') as string).replace('{now}', nowStr).replace('{prev}', prevStr);
  const tip = `${dirLabel} — ${detail}`;
  const value = `${arrow} ${Math.abs(velocity.deltaAvgPlace).toFixed(2)}`;
  return (<>
    {renderMobile(<span style={{ color }} className="font-medium">{value}</span>, tip)}
    {renderDesktop(<span style={{ color }} className="font-medium">{value}</span>, tip)}
  </>);
}
