'use client';
import { useState, useMemo, useSyncExternalStore } from 'react';
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
import { patchDeltaOf } from '../../lib/tft-patch-delta';
import PatchDeltaCell, { deltaHeader } from '../../components/tft/PatchDeltaCell';
import { useI18n } from '../../lib/i18n';
import { tftChampionTileUrl, tftTraitDisplayName, type TftAssetsBundle } from '../../lib/tft-cdragon';
import { tierLetterOfSync, TIER_COLORS, type TierLetter } from '../../lib/tft-tier-letter';
import TftHero from '../../components/tft/TftHero';
import TftItemIcon from '../../components/tft/TftItemIcon';

// Ein Item der Reihe; games = Kopien der Unit mit dem Item. Werte fehlen in
// gespeicherten Staenden von vor 0097.
export interface UnitItem {
  item: string;
  games: number;
  avgPlacement?: number | null;
  top4Rate?: number | null;
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
  topItems?: UnitItem[];
  artifacts?: UnitItem[];
  emblems?: UnitItem[];
}

// Ø-Platz unter einem Item erst ab 30 Kopien, Farbe erst ab 100 Kopien und
// 0,15 Abstand zum Schnitt der gezeigten Items — darunter ist der Unterschied
// Rauschen (data-skeptic 17.10.: Unsicherheit ~0,23 bei 100 Kopien). Verglichen
// wird mit den gezeigten Items, nicht mit der Unit: deren Schnitt enthaelt
// Kopien ohne Items, dann waere fast jedes Item gruen.
const ITEM_VALUE_MIN = 30;
const ITEM_COLOR_MIN = 100;
const ITEM_COLOR_DELTA = 0.15;
// Artefakte/Embleme rechts: ab 30 Kopien und 2 % der Kopien der Unit, ohne Farbe
// (Artefakte kommen aus Augments/Beute und stuenden immer gut da).
const EXTRA_MIN_SHARE = 0.02;
const BETTER_COLOR = '#3ecf8e';
const WORSE_COLOR = '#e44040';

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
  // Vergleich „vs Vorpatch" (User 18.10.2026): eigene Abfrage, die Liste bleibt
  // dieselbe. Ohne Vorpatch-Paar (Set-Start, zu junger Patch) keine Spalte.
  const delta = usePatchDelta({ entity: 'unit', filters, patches, enabled: filters.velocity > 0 });
  const deltaOn = filters.velocity > 0 && !!delta.pair;
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
        <StatsListPending show={(loading && hasData === null) || awaitingStored} />
        {hasData === false && !awaitingStored && <EmptyData />}

        {hasData && filtered.length > 0 && !awaitingStored && (
          <div data-e3-rows className="bg-surface-base border border-border-subtle rounded overflow-hidden">
            <div className={`hidden md:grid ${deltaOn ? 'grid-cols-[2rem_3rem_1fr_5rem_5rem_5rem_5rem_5rem_4rem]' : 'grid-cols-[2rem_3rem_1fr_5rem_5rem_5rem_5rem_5rem]'} gap-3 px-4 py-2.5 text-[11px] text-fg-secondary font-semibold whitespace-nowrap bg-surface-sunken`}>
              <div></div>
              <div></div>
              <div>{t('tft.champion')}</div>
              <div className="text-center">{t('tft.avgPlacement')}</div>
              <div className="text-right">{t('tft.pickRate')}</div>
              <div className="text-right">{t('tft.top4')}</div>
              <div className="text-right">{t('tft.top1')}</div>
              <div className="text-right">{t('tft.gamesShort')}</div>
              {deltaOn && (
                <div className="text-right text-[#c39bff]">
                  {deltaHeader(t, delta.pair)}
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
                  className={`block md:grid ${deltaOn ? 'md:grid-cols-[2rem_3rem_1fr_5rem_5rem_5rem_5rem_5rem_4rem]' : 'md:grid-cols-[2rem_3rem_1fr_5rem_5rem_5rem_5rem_5rem]'} gap-3 px-4 py-2.5 md:items-center text-[13px] sm:text-sm hover:bg-white/5 border-t border-border-subtle`}
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
                      <UnitItemRow u={u} assets={assets} t={t} />
                    </div>
                  </div>
                  <div className={`grid ${deltaOn ? 'grid-cols-5' : 'grid-cols-4'} gap-2 mt-1.5 pl-12 md:pl-0 md:mt-0 md:contents`}>
                    <Cell label={t('tft.avgPlacement')} value={u.avgPlacement?.toFixed(2) ?? '—'} accent="white" align="center" />
                    <Cell label={t('tft.pickRate')} value={u.pickRate != null ? `${(u.pickRate * 100).toFixed(1)}%` : '—'} title={top4ShareTip} />
                    <Cell label={t('tft.top4')} value={u.top4Rate != null ? `${(u.top4Rate * 100).toFixed(1)}%` : '—'} title={top4ShareTip} />
                    <Cell label={t('tft.top1')} value={u.top1Rate != null ? `${(u.top1Rate * 100).toFixed(1)}%` : '—'} title={winShareTip} />
                    <div className="hidden md:block text-right text-fg-muted">{u.games}</div>
                    {deltaOn && (
                      <PatchDeltaCell delta={patchDeltaOf(delta.index, u.characterId)} pair={delta.pair} loading={delta.loading} label={deltaHeader(t, delta.pair)} />
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

// Item-Reihe einer Unit: links die meistgebauten Items, rechts davon zwei eigene
// Bloecke mit je einer Linie — zuerst Artefakte, dann Embleme. Der Artefakt-Block
// haelt immer Platz fuer drei Bilder frei, damit die Embleme in jeder Zeile an
// derselben Stelle stehen. Reicht der Platz nicht, rutschen beide Bloecke
// gemeinsam in die naechste Zeile.
const EXTRA_BLOCK = 'flex gap-0.5 border-l border-border-subtle pl-3';
// 3 Bilder x 28 px + 2 Abstaende x 2 px + 12 px Innenabstand + 1 px Linie.
const ARTIFACT_SLOT_WIDTH = 'min-w-[101px]';

function UnitItemRow({ u, assets, t }: { u: UnitRow; assets: TftAssetsBundle | null; t: (k: any) => string }) {
  const items = u.topItems || [];
  const extraOk = (it: UnitItem) => it.games >= ITEM_VALUE_MIN && it.games >= u.games * EXTRA_MIN_SHARE;
  const artifacts = (u.artifacts || []).filter(extraOk);
  const emblems = (u.emblems || []).filter(extraOk);
  if (items.length === 0 && artifacts.length === 0 && emblems.length === 0) return null;
  // Vergleichswert der Farbe: Ø-Platz aller gezeigten Items mit Wert, nach Kopien gewichtet.
  let sum = 0;
  let n = 0;
  for (const it of items) {
    if (it.avgPlacement == null || it.games < ITEM_VALUE_MIN) continue;
    sum += it.avgPlacement * it.games;
    n += it.games;
  }
  const base = n > 0 ? sum / n : null;
  const colorOf = (it: UnitItem) => {
    if (base == null || it.avgPlacement == null || it.games < ITEM_COLOR_MIN) return undefined;
    const d = it.avgPlacement - base;
    if (Math.abs(d) < ITEM_COLOR_DELTA) return undefined;
    return d < 0 ? BETTER_COLOR : WORSE_COLOR;
  };
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
      {items.length > 0 && (
        <div className="flex gap-0.5 flex-shrink-0">
          {items.map(it => <ItemWithValue key={it.item} it={it} unitGames={u.games} color={colorOf(it)} assets={assets} t={t} />)}
        </div>
      )}
      {(artifacts.length > 0 || emblems.length > 0) && (
        <div className="flex gap-3 flex-shrink-0">
          {artifacts.length > 0 ? (
            <div className={`${EXTRA_BLOCK} ${ARTIFACT_SLOT_WIDTH}`}>
              {artifacts.map(it => <ItemWithValue key={it.item} it={it} unitGames={u.games} assets={assets} t={t} />)}
            </div>
          ) : (
            <div className={ARTIFACT_SLOT_WIDTH} aria-hidden />
          )}
          {emblems.length > 0 && (
            <div className={EXTRA_BLOCK}>
              {emblems.map(it => <ItemWithValue key={it.item} it={it} unitGames={u.games} assets={assets} t={t} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ItemWithValue({ it, unitGames, color, assets, t }: {
  it: UnitItem; unitGames: number; color?: string; assets: TftAssetsBundle | null; t: (k: any) => string;
}) {
  const showValue = it.avgPlacement != null && it.games >= ITEM_VALUE_MIN;
  const name = assets?.items[it.item]?.name || it.item;
  const parts = [name];
  if (showValue) {
    parts.push(`${t('tft.avgPlacement')}: ${it.avgPlacement!.toFixed(2)}`);
    if (it.top4Rate != null) parts.push(`${t('tft.top4')}: ${(it.top4Rate * 100).toFixed(1)}%`);
    if (unitGames > 0) parts.push(`${t('tft.pickRate')}: ${((it.games / unitGames) * 100).toFixed(1)}%`);
    parts.push(`${t('tft.gamesShort')}: ${it.games}`);
  }
  return (
    <div className="flex flex-col items-center w-7">
      <TftItemIcon apiName={it.item} assets={assets} className="w-7 h-7" title={parts.join('\n')} />
      <span
        className={`h-3 mt-0.5 text-[10px] leading-3 tabular-nums ${color ? '' : 'text-fg-secondary'}`}
        style={color ? { color } : undefined}
      >
        {showValue ? it.avgPlacement!.toFixed(2) : ''}
      </span>
    </div>
  );
}

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
