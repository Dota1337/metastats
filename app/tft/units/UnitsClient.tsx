'use client';
import { useState, useMemo, useSyncExternalStore } from 'react';
import { withAlpha } from '../../lib/color';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import EmptyData from '../../components/tft/EmptyData';
import StatsFilterBar from '../../components/tft/StatsFilterBar';
import type { Filters } from '../../lib/tft-filters';
import type { StatsInitial } from '../../lib/seo/initial-data';
import { useTftStatsList } from '../../lib/useTftStatsList';
import { useI18n } from '../../lib/i18n';
import { tftChampionTileUrl, tftTraitDisplayName } from '../../lib/tft-cdragon';
import { tierLetterOfSync, TIER_COLORS, type TierLetter } from '../../lib/tft-tier-letter';
import TftHero from '../../components/tft/TftHero';
import TftItemIcon from '../../components/tft/TftItemIcon';

interface UnitVelocity {
  deltaAvgPlace: number | null;
  avgPlaceNow: number | null;
  avgPlacePrev: number | null;
  gamesNow: number;
  gamesPrev: number;
  isNew: boolean;
}

export interface UnitRow {
  characterId: string;
  games: number;
  avgPlacement: number | null;
  top4Rate: number | null;
  top1Rate: number | null;
  pickRate: number | null;
  winShare?: number | null;
  top4Share?: number | null;
  velocity?: UnitVelocity | null;
  topItems?: { item: string; games: number }[];
}

export default function UnitsClient({ initialFilters, initial }: {
  // Vom Server (page.tsx): Filter aus der Adresse + Standard-Rang, dazu die
  // fertige Standardansicht, falls der Zwischenstand sie hatte. Server und
  // erstes Client-Rendern nutzen dieselben Werte (sonst Hydration-Fehler).
  initialFilters: Filters;
  initial: StatsInitial<UnitRow> | null;
}) {
  const { withLang } = useI18n();
  const { t } = useI18n();
  // Laden, Startdaten, gespeicherte Filter: gemeinsam mit Items/Traits.
  const { filters, setFilters, rows: units, hasData, patches, loading, awaitingStored, assets, tierCutoffs } =
    useTftStatsList<UnitRow>({ endpoint: '/api/tft/units', field: 'units', initialFilters, initial });
  const [costFilter, setCostFilter] = useState<number | null>(null);
  const [traitFilter, setTraitFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Trait options derive from the loaded units (architect: not from the full
  // assets.traits list — avoids stale/inactive traits surviving past set drops
  // when a manifest-reload lag hits the picker first). Drops the MF "Choose
  // Trait" stub (data-skeptic: it's a placeholder, not a real synergy line).
  const traitOptions = useMemo(() => {
    if (!assets) return [] as { id: string; name: string }[];
    const set = new Set<string>();
    for (const u of units) {
      const ch = assets.champions[u.characterId];
      if (!ch?.traits) continue;
      for (const tr of ch.traits) {
        if (/Choose.?Trait/i.test(tr)) continue;
        set.add(tr);
      }
    }
    return [...set]
      .map(id => ({ id, name: tftTraitDisplayName(assets, id) || id.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '') }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [units, assets]);

  // Riot lists shapeshift forms as separate units (Set 18: Lux has ten, one per
  // trait) — in the shop they are one champion and all share the same icon.
  // The list shows only the most-played row per icon; the forms keep their own
  // ids elsewhere (trait pages need them, each form carries its own trait).
  // Units whose icon is a hash placeholder instead of a character path
  // (Teemo, Alune, Riftbeasts) are keyed by their own id so they never merge.
  const shownIds = useMemo(() => {
    const best = new Map<string, UnitRow>();
    for (const u of units) {
      const icon = assets?.champions[u.characterId]?.icon;
      const key = icon && /characters\/[^/]+\//i.test(icon) ? `i:${icon}` : `n:${u.characterId}`;
      const cur = best.get(key);
      if (!cur || u.games > cur.games) best.set(key, u);
    }
    return new Set([...best.values()].map(u => u.characterId));
  }, [units, assets]);

  const filtered = useMemo(() => {
    const keep = shownIds;
    const q = search.trim().toLowerCase();
    const passFilter = units.filter(u => {
      const ch = assets?.champions[u.characterId];
      if (costFilter != null && (ch?.cost ?? -1) !== costFilter) return false;
      if (traitFilter && !ch?.traits?.includes(traitFilter)) return false;
      if (q) {
        const name = (ch?.name || u.characterId.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '')).toLowerCase();
        if (!name.includes(q) && !u.characterId.toLowerCase().includes(q)) return false;
      }
      return true;
    }).filter(u => keep.has(u.characterId));
    // Same sub-gate sort as /tft/items: untiered (low-sample) units go to
    // the bottom, tiered units keep their api-sorted order. Without this a
    // niche unit with 200 games + 3.2 avg sits above the popular meta carry
    // with 50k games + 3.4 avg, which doesn't match user intent.
    if (!tierCutoffs) return passFilter;
    const tiered: UnitRow[] = [];
    const untiered: UnitRow[] = [];
    for (const u of passFilter) {
      if (tierLetterOfSync({ avgPlacement: u.avgPlacement, pickRate: u.pickRate, games: u.games }, 'units', tierCutoffs)) {
        tiered.push(u);
      } else {
        untiered.push(u);
      }
    }
    return [...tiered, ...untiered];
  }, [units, assets, costFilter, traitFilter, search, tierCutoffs, shownIds]);

  // Over all loaded units, not `filtered`, so the item column doesn't shift
  // while searching or filtering by cost/trait. Character count doesn't
  // predict rendered width ("Brambleback" renders wider than "Lux (Inferno)"),
  // so the widest name is picked by measuring with the page font; the
  // longest-by-characters stays in the stack as a fallback.
  // Gemessen wird erst nach dem Mount: das Server-HTML kennt nur die
  // Zeichen-Variante, das erste Client-Rendern muss dasselbe liefern.
  // (useSyncExternalStore: false auf dem Server und beim Hydrieren, danach true.)
  const measure = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const longestNames = useMemo(() => {
    const names = [...new Set(units.filter(u => shownIds.has(u.characterId)).map(u => assets?.champions[u.characterId]?.name || prettyCharId(u.characterId)))];
    if (names.length === 0) return [];
    const byChars = names.reduce((a, b) => (b.length > a.length ? b : a));
    const ctx = measure ? document.createElement('canvas').getContext('2d') : null;
    if (!ctx) return [byChars];
    ctx.font = `500 14px ${getComputedStyle(document.body).fontFamily}`;
    const byPixels = names.reduce((a, b) => (ctx.measureText(b).width > ctx.measureText(a).width ? b : a));
    return byPixels === byChars ? [byChars] : [byPixels, byChars];
  }, [units, assets, shownIds, measure]);

  const currentPatchLabel = patches[0]?.patch;

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav active="units" />
      <TftHero pageTitle={t('nav.units')} patch={currentPatchLabel} />
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 pt-2 pb-6">
        <StatsFilterBar filters={filters} patches={patches} onChange={setFilters} />

        <div className="mb-3">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('tft.search.units')}
            className="w-full sm:w-80 bg-surface-raised border border-border-subtle rounded px-3 py-1.5 text-sm text-white placeholder:text-fg-faint outline-none focus:border-accent-a60"
          />
        </div>
        <div className="flex flex-wrap gap-1 mb-4 items-center">
          <button
            onClick={() => setCostFilter(null)}
            className={`px-3 py-1 rounded text-xs ${costFilter == null ? 'bg-accent text-white' : 'bg-surface-raised text-fg-secondary hover:text-white'}`}
          >
            {t('tft.bucket.all')}
          </button>
          {[1, 2, 3, 4, 5].map(c => (
            <button
              key={c}
              onClick={() => setCostFilter(c)}
              className={`px-3 py-1 rounded text-xs ${costFilter === c ? 'bg-accent text-white' : 'bg-surface-raised text-fg-secondary hover:text-white'}`}
            >
              {c}-Cost
            </button>
          ))}
          <div className="w-px h-5 bg-surface-overlay mx-1" />
          <select
            value={traitFilter ?? ''}
            onChange={e => setTraitFilter(e.target.value || null)}
            className="px-2 py-1 rounded text-xs bg-surface-raised text-fg-secondary border border-border-subtle focus:outline-none focus:border-accent-a60"
          >
            <option value="">{t('tft.unit.trait.allTraits')}</option>
            {traitOptions.map(tr => (
              <option key={tr.id} value={tr.id}>{tr.name}</option>
            ))}
          </select>
        </div>

        {/* Steht immer im HTML: das Vorab-Skript blendet es ueber das <style>
            der Seite ein, solange gespeicherte Filter geladen werden. */}
        <div data-e3-wait className={`${(loading && hasData === null) || awaitingStored ? '' : 'hidden '}text-fg-muted text-center py-8`}>{t('tft.noDataYet').replace('Noch keine Daten', 'Lade')}</div>
        {hasData === false && !awaitingStored && <EmptyData />}

        {hasData && filtered.length > 0 && !awaitingStored && (
          <div data-e3-rows className="bg-surface-base border border-border-subtle rounded overflow-hidden">
            <div className={`hidden md:grid ${filters.velocity > 0 ? 'grid-cols-[2rem_3rem_1fr_5rem_5rem_5rem_5rem_5rem_4rem]' : 'grid-cols-[2rem_3rem_1fr_5rem_5rem_5rem_5rem_5rem]'} gap-3 px-4 py-2.5 text-[11px] text-fg-secondary font-semibold whitespace-nowrap bg-surface-sunken`}>
              <div></div>
              <div></div>
              <div>{t('tft.champion')}</div>
              <div className="text-center">{t('tft.avgPlacement')}</div>
              <div className="text-right">{t('tft.pickRate')}</div>
              <div className="text-right">{t('tft.top4')}</div>
              <div className="text-right">{t('tft.top1')}</div>
              <div className="text-right">{t('tft.gamesShort')}</div>
              {filters.velocity > 0 && (
                <div className="text-right text-[#c39bff]">
                  {t('tft.velocity.deltaVs').replace('{n}', String(filters.velocity))}
                </div>
              )}
            </div>
            {/* Mobile-only column hint */}
            <div className="md:hidden px-4 py-2 text-[10px] uppercase tracking-widest text-fg-muted bg-surface-sunken">
              Champion
            </div>
            {filtered.map(u => {
              const ch = assets?.champions[u.characterId];
              const cost = ch?.cost ?? 1;
              const costColor = costColorOf(cost);
              const url = tftChampionTileUrl(assets, ch);
              const letter = tierCutoffs ? tierLetterOfSync({ avgPlacement: u.avgPlacement, pickRate: u.pickRate, games: u.games }, 'units', tierCutoffs) : null;
              const top4ShareTip = u.top4Share != null
                ? t('tft.shares.top4ShareTooltip.unit').replace('{share}', (u.top4Share * 100).toFixed(1))
                : undefined;
              const winShareTip = u.winShare != null
                ? t('tft.shares.winShareTooltip.unit').replace('{share}', (u.winShare * 100).toFixed(1))
                : undefined;
              return (
                <a
                  key={u.characterId}
                  href={withLang(`/tft/units/${encodeURIComponent(u.characterId)}?bucket=${filters.bucket}&region=${filters.region}&days=${filters.days}`)}
                  className={`block md:grid ${filters.velocity > 0 ? 'md:grid-cols-[2rem_3rem_1fr_5rem_5rem_5rem_5rem_5rem_4rem]' : 'md:grid-cols-[2rem_3rem_1fr_5rem_5rem_5rem_5rem_5rem]'} gap-3 px-4 py-2.5 md:items-center text-[13px] sm:text-sm hover:bg-white/5 border-t border-border-subtle`}
                >
                  {/* Mobile: tier badge inline next to the icon; desktop has its own column. */}
                  <div className="hidden md:flex justify-center">
                    <TierBadge letter={letter} t={t} />
                  </div>
                  <div className="flex items-center gap-3 md:contents">
                    <div className="md:hidden">
                      <TierBadge letter={letter} t={t} />
                    </div>
                    <div className="w-10 h-10 rounded-md border-2 overflow-hidden flex-shrink-0 shadow-sm" style={{ borderColor: costColor }}>
                      {url && <img src={url} alt={ch!.name} className="w-full h-full object-cover" />}
                    </div>
                    <div className="min-w-0 flex-1 md:flex-initial flex flex-col md:flex-row md:items-center gap-1 md:gap-3">
                      {/* From lg up an invisible copy of the longest name shares the
                          grid cell, so every item row starts at the same x. */}
                      <div className="grid min-w-0">
                        <div className="[grid-area:1/1] text-white font-medium truncate">{ch?.name || prettyCharId(u.characterId)}</div>
                        {longestNames.map(n => (
                          <div key={n} aria-hidden className="[grid-area:1/1] hidden lg:block invisible font-medium whitespace-nowrap">{n}</div>
                        ))}
                      </div>
                      {u.topItems && u.topItems.length > 0 && (
                        <div className="flex gap-0.5 flex-shrink-0">
                          {u.topItems.map(it => (
                            <TftItemIcon key={it.item} apiName={it.item} assets={assets} />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className={`grid ${filters.velocity > 0 ? 'grid-cols-5' : 'grid-cols-4'} gap-2 mt-1.5 pl-12 md:pl-0 md:mt-0 md:contents`}>
                    <Cell label={t('tft.avgPlacement')} value={u.avgPlacement?.toFixed(2) ?? '—'} accent="white" align="center" />
                    <Cell label={t('tft.pickRate')} value={u.pickRate != null ? `${(u.pickRate * 100).toFixed(1)}%` : '—'} title={top4ShareTip} />
                    <Cell label={t('tft.top4')} value={u.top4Rate != null ? `${(u.top4Rate * 100).toFixed(1)}%` : '—'} title={top4ShareTip} />
                    <Cell label={t('tft.top1')} value={u.top1Rate != null ? `${(u.top1Rate * 100).toFixed(1)}%` : '—'} title={winShareTip} />
                    <div className="hidden md:block text-right text-fg-muted">{u.games}</div>
                    {filters.velocity > 0 && (
                      <VelocityCell velocity={u.velocity} label={t('tft.velocity.deltaVs').replace('{n}', String(filters.velocity))} t={t} />
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

function noopSubscribe() { return () => {}; }

function costColorOf(cost: number) {
  return cost === 1 ? '#9aa6b2' : cost === 2 ? '#3a8' : cost === 3 ? '#3a8ddc' : cost === 4 ? '#c39bff' : '#e0c75a';
}
function prettyCharId(id: string) {
  return id.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '');
}

// Stat cell that reflows between mobile (label-above-value pair, left-
// aligned in a 4-col mobile grid) and desktop (right-aligned single value
// in the parent's explicit grid column). `display: contents` on the
// desktop side makes the parent grid pull this through transparently.
function Cell({ label, value, accent, title, align = 'right' }: { label: string; value: string; accent?: 'white'; title?: string; align?: 'right' | 'center' }) {
  const valueClass = accent === 'white' ? 'text-white' : 'text-fg-secondary';
  const alignClass = align === 'center' ? 'text-center' : 'text-right';
  return (
    <>
      <div className="md:hidden" title={title}>
        <div className="text-fg-muted text-[9px] uppercase tracking-widest leading-tight">{label}</div>
        <div className={`${valueClass} tabular-nums leading-tight`}>{value}</div>
      </div>
      <div className={`hidden md:block ${alignClass} ${valueClass} tabular-nums`} title={title}>{value}</div>
    </>
  );
}

// Tier-letter badge — S/A/B/C/D, color-coded. Renders "—" when the entity
// is below the sample gate for its kind (handled by tierLetterOfSync).
// Tooltip carries the verbal label so users know what S/A/B/C/D means.
function TierBadge({ letter, t }: { letter: TierLetter | null; t: (k: any) => string }) {
  if (!letter) {
    return (
      <span
        className="inline-flex items-center justify-center w-7 h-6 rounded text-[10px] font-medium text-fg-faint bg-surface-raised border border-border-subtle"
        title={t('tft.tier.tooltip.empty')}
      >—</span>
    );
  }
  const color = TIER_COLORS[letter];
  return (
    <span
      className="inline-flex items-center justify-center w-7 h-6 rounded text-[11px] font-bold tabular-nums"
      style={{ color, backgroundColor: `${withAlpha(color, 0x1f)}`, border: `1px solid ${withAlpha(color, 0x50)}` }}
      title={t(`tft.tier.tooltip.${letter}` as any)}
    >{letter}</span>
  );
}

// Δ-Vergleich-Zelle für die Units-Liste. Lila Trennlinie zur Stats-Strip,
// grün/rot Pfeil mit Wert, "NEU" für frisch erschienene Units. Tooltip
// liefert Jetzt/Vorher-Werte (damit die Zahl im Kontext steht).
function VelocityCell({ velocity, label, t }: {
  velocity?: { deltaAvgPlace: number | null; avgPlaceNow: number | null; avgPlacePrev: number | null; isNew: boolean } | null;
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
    const tip = t('tft.velocity.notEnough');
    return (<>
      {renderMobile(<span className="text-fg-faint">—</span>, tip)}
      {renderDesktop(<span className="text-fg-faint">—</span>, tip)}
    </>);
  }
  if (velocity.isNew) {
    const txt = t('tft.velocity.newComp');
    return (<>
      {renderMobile(<span className="text-[#c39bff] font-semibold">{txt}</span>)}
      {renderDesktop(<span className="text-[#c39bff] font-semibold">{txt}</span>)}
    </>);
  }
  if (velocity.deltaAvgPlace == null) {
    const tip = t('tft.velocity.notEnough');
    return (<>
      {renderMobile(<span className="text-fg-faint">—</span>, tip)}
      {renderDesktop(<span className="text-fg-faint">—</span>, tip)}
    </>);
  }
  const better = velocity.deltaAvgPlace < 0;
  const color = better ? '#3ecf8e' : '#e44040';
  const arrow = better ? '▲' : '▼';
  const dirLabel = better ? t('tft.velocity.better') : t('tft.velocity.worse');
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
