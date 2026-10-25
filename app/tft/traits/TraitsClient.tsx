'use client';
import { useMemo, useState } from 'react';
import { TRAIT_STYLE_COLOR } from '../../lib/tft-trait-style';
import { withAlpha } from '../../lib/color';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import EmptyData from '../../components/tft/EmptyData';
import StatsListPending from '../../components/tft/StatsListPending';
import StatsFilterBar from '../../components/tft/StatsFilterBar';
import type { Filters } from '../../lib/tft-filters';
import type { StatsInitial } from '../../lib/seo/initial-data';
import { useTftStatsList } from '../../lib/useTftStatsList';
import { usePatchDelta } from '../../lib/usePatchDelta';
import { patchDeltaOf, traitDeltaKey } from '../../lib/tft-patch-delta';
import PatchDeltaCell, { deltaHeader } from '../../components/tft/PatchDeltaCell';
import { useI18n } from '../../lib/i18n';
import { tftIconUrl, traitTierMinUnits, type TftTraitTier } from '../../lib/tft-cdragon';
import TftHero from '../../components/tft/TftHero';

export interface TraitRow {
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
  // apiName der gezeigten Stufe — ihr Vorpatch-Vergleich (O1: gleiche Stufe).
  bestName: string | null;
  avgTop4Rate: number | null;
  pickRate: number | null;
  rare: boolean;
}

// Visual map for trait activation styles — mirrors the in-game frame colors.
const STYLE_COLORS = TRAIT_STYLE_COLOR;

export default function TraitsClient({ initialFilters, initial }: {
  // Vom Server (page.tsx), siehe UnitsClient.tsx.
  initialFilters: Filters;
  initial: StatsInitial<TraitRow> | null;
}) {
  const { withLang } = useI18n();
  const { t } = useI18n();
  // Laden, Startdaten, gespeicherte Filter: gemeinsam mit Units/Items. Die
  // Liste zeigt keine Tier-Buchstaben → keine Grenzen laden.
  const { filters, setFilters, rows, hasData, patches, dataEnd, loading, awaitingStored, assets } =
    useTftStatsList<TraitRow>({ endpoint: '/api/tft/traits', field: 'traits', initialFilters, initial });
  // Vergleich „vs Vorpatch" (User 18.10.2026): eigene Abfrage, die Liste bleibt
  // dieselbe. Ohne Vorpatch-Paar (Set-Start, zu junger Patch) keine Spalte.
  const delta = usePatchDelta({ entity: 'trait', filters, patches, dataEnd, enabled: filters.velocity > 0 });
  const deltaOn = filters.velocity > 0 && !!delta.pair;
  const [search, setSearch] = useState('');

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
      // Meistgespielte Stufe statt der mit dem besten Schnitt — seltene
      // Hochstufen mit einer Handvoll Spielen verzerren sonst die Liste.
      const best = list.reduce<TraitRow | null>(
        (acc, r) => (acc == null || r.games > acc.games) ? r : acc, null);
      const groupPick = list.reduce((s, r) => s + (r.pickRate ?? 0), 0);
      const totalTop4 = list.reduce((s, r) => s + (r.top4Rate != null ? r.top4Rate * r.games : 0), 0);
      const totalPick = list.reduce((s, r) => s + (r.pickRate != null ? r.pickRate * r.games : 0), 0);
      out.push({
        name: displayName,
        totalGames,
        bestAvg: best?.avgPlacement ?? null,
        bestActivation: best?.activation ?? null,
        bestName: best?.name ?? null,
        avgTop4Rate: totalGames > 0 ? totalTop4 / totalGames : null,
        pickRate: totalGames > 0 ? totalPick / totalGames : null,
        rare: groupPick < 0.005,
      });
    }
    // Seltene Synergien (unter 0,5 % der Spielerpartien) ans Ende.
    return out.sort((a, b) => Number(a.rare) - Number(b.rare) || (a.bestAvg ?? 9) - (b.bestAvg ?? 9));
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
        <StatsFilterBar filters={filters} patches={patches} dataEnd={dataEnd} onChange={setFilters} />

        <div className="mb-3">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('tft.search.traits')}
            className="w-full sm:w-80 bg-surface-raised border border-border-subtle rounded px-3 py-1.5 text-sm text-white placeholder:text-fg-faint outline-none focus:border-accent-a60"
          />
        </div>

        {/* Steht immer im HTML: das Vorab-Skript blendet es ueber das <style>
            der Seite ein, solange gespeicherte Filter geladen werden. */}
        <StatsListPending show={(loading && hasData === null) || awaitingStored} />
        {hasData === false && !awaitingStored && <EmptyData />}

        {hasData && visibleGrouped.length > 0 && !awaitingStored && (
          <div data-e3-rows className="bg-surface-base border border-border-subtle rounded overflow-hidden">
            <div className={`hidden md:grid ${deltaOn ? 'grid-cols-[3rem_1fr_10rem_4rem_5rem_5rem_5rem_5rem_4rem]' : 'grid-cols-[3rem_1fr_10rem_4rem_5rem_5rem_5rem_5rem]'} gap-3 px-4 py-2.5 text-[11px] text-fg-secondary font-semibold whitespace-nowrap bg-surface-sunken`}>
              <div></div>
              <div>{t('nav.traits')}</div>
              <div>{t('tft.trait.tiers')}</div>
              <div className="text-right">{t('tft.trait.bestAt')}</div>
              <div className="text-center">{t('tft.avgPlacement')}</div>
              <div className="text-right">{t('tft.pickRate')}</div>
              <div className="text-right">{t('tft.top4')}</div>
              <div className="text-right">{t('tft.gamesShort')}</div>
              {deltaOn && (
                <div className="text-right text-[#c39bff]">
                  {deltaHeader(t, delta.pair)}
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
                !/_/.test(apiName.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, ''))
              ) || variantEntries[0];
              const meta = rootEntry?.[1] || assets?.traits[g.name];
              const url = tftIconUrl(assets, meta?.icon);
              const tiers: TftTraitTier[] = (meta?.tiers || []) as TftTraitTier[];
              // Stufe → Unit-Zahl wie im Stufen-Streifen daneben (User 18.10.2026).
              const bestUnits = g.bestName != null && g.bestActivation != null
                ? traitTierMinUnits(assets, g.bestName, g.bestActivation) : null;
              return (
                <a
                  key={g.name}
                  href={withLang(`/tft/traits/${encodeURIComponent(g.name)}`)}
                  className={`block md:grid ${deltaOn ? 'md:grid-cols-[3rem_1fr_10rem_4rem_5rem_5rem_5rem_5rem_4rem]' : 'md:grid-cols-[3rem_1fr_10rem_4rem_5rem_5rem_5rem_5rem]'} gap-3 px-4 py-2.5 md:items-center text-[13px] sm:text-sm border-t border-border-subtle hover:bg-white/5`}
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
                        {t('tft.trait.bestAt')} {bestUnits ?? '—'}
                      </div>
                    </div>
                  </div>
                  <div className="mt-1.5 pl-12 md:pl-0 md:mt-0">
                    <TierStrip tiers={tiers} />
                  </div>
                  <div className="hidden md:block text-right text-accent font-medium">
                    {bestUnits ?? '—'}
                  </div>
                  <div className={`grid ${deltaOn ? 'grid-cols-5' : 'grid-cols-4'} gap-2 mt-1.5 pl-12 md:pl-0 md:mt-0 md:contents`}>
                    <Cell label={t('tft.avgPlacement')} value={g.bestAvg?.toFixed(2) ?? '—'} accent="white" align="center" />
                    <Cell label={t('tft.pickRate')} value={g.pickRate != null ? `${(g.pickRate * 100).toFixed(1)}%` : '—'} />
                    <Cell label={t('tft.top4')} value={g.avgTop4Rate != null ? `${(g.avgTop4Rate * 100).toFixed(1)}%` : '—'} />
                    <Cell label={t('tft.gamesShort')} value={String(g.totalGames)} accent="muted" />
                    {deltaOn && (
                      <PatchDeltaCell
                        delta={g.bestName != null && g.bestActivation != null ? patchDeltaOf(delta.index, traitDeltaKey(g.bestName, g.bestActivation)) : null}
                        pair={delta.pair}
                        loading={delta.loading}
                        label={deltaHeader(t, delta.pair)}
                      />
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
        const color = STYLE_COLORS[tier.style] || 'var(--fg-muted)';
        return (
          <div
            key={i}
            className="rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
            style={{ backgroundColor: `${withAlpha(color, 0x22)}`, color, border: `1px solid ${withAlpha(color, 0x55)}` }}
          >
            {tier.minUnits}
          </div>
        );
      })}
    </div>
  );
}

function prettyTrait(s: string) { return s.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '').replace(/Trait$/, ''); }

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
