'use client';
import { useMemo, useState } from 'react';
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
import { patchDeltaOf, type PatchDelta, type PatchDeltaPair } from '../../lib/tft-patch-delta';
import { deltaHeader, deltaTooltip } from '../../components/tft/PatchDeltaCell';
import { useI18n } from '../../lib/i18n';
import { tftIconUrl, tftChampionTileUrl } from '../../lib/tft-cdragon';
import { itemBucketOf, ITEM_BUCKETS, type ItemBucket } from '../../lib/tft-item-bucket';
import { tierLetterOfSync, TIER_COLORS, type TierLetter } from '../../lib/tft-tier-letter';
import TftHero from '../../components/tft/TftHero';

export interface ItemRow {
  apiName: string;
  games: number;
  avgPlacement: number | null;
  top4Rate: number | null;
  top1Rate: number | null;
  pickRate: number | null;
  topUsers: string[];
}

export default function ItemsClient({ initialFilters, initial }: {
  // Vom Server (page.tsx), siehe UnitsClient.tsx.
  initialFilters: Filters;
  initial: StatsInitial<ItemRow> | null;
}) {
  const { withLang } = useI18n();
  const { t } = useI18n();
  // Laden, Startdaten, gespeicherte Filter: gemeinsam mit Units/Traits.
  const { filters, setFilters, rows: items, hasData, patches, loading, awaitingStored, assets, tierCutoffs } =
    useTftStatsList<ItemRow>({ endpoint: '/api/tft/items', field: 'items', initialFilters, initial });
  // Vergleich „vs Vorpatch" (User 18.10.2026): eigene Abfrage, die Liste bleibt
  // dieselbe. Ohne Vorpatch-Paar (Set-Start, zu junger Patch) keine Spalte.
  const delta = usePatchDelta({ entity: 'item', filters, patches, enabled: filters.velocity > 0 });
  const deltaOn = filters.velocity > 0 && !!delta.pair;
  // Client-side bucket filter analog to /tft/units cost-filter pattern.
  // null = "Alle" (default). Other items (PsyOps base, AnimaSquad tier) fall
  // into "other" and are only reachable via "Alle".
  const [bucket, setBucket] = useState<ItemBucket | null>(null);
  const [search, setSearch] = useState('');

  const currentPatchLabel = patches[0]?.patch;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const inBucket = items.filter(it => {
      if (bucket && itemBucketOf(it.apiName, assets) !== bucket) return false;
      if (q) {
        const name = (assets?.items[it.apiName]?.name || it.apiName.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?(?:Item_)?/, '')).toLowerCase();
        if (!name.includes(q) && !it.apiName.toLowerCase().includes(q)) return false;
      }
      return true;
    });
    // Sub-150-game items lose their tier-badge (Items min-games gate) — sorting
    // them to the bottom keeps the noisy 1.4-avg-with-56-games entries from
    // dominating the top of the list. Within each segment, existing avg-place
    // sort stays. tierCutoffs is loaded async, so during the brief window
    // before it lands we keep the original order.
    if (!tierCutoffs) return inBucket;
    const tiered: ItemRow[] = [];
    const untiered: ItemRow[] = [];
    for (const it of inBucket) {
      if (tierLetterOfSync({ avgPlacement: it.avgPlacement, pickRate: it.pickRate, games: it.games }, 'items', tierCutoffs)) {
        tiered.push(it);
      } else {
        untiered.push(it);
      }
    }
    return [...tiered, ...untiered];
  }, [items, bucket, search, assets, tierCutoffs]);

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav active="items" />
      <TftHero pageTitle={t('nav.items')} patch={currentPatchLabel} />
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 pt-2 pb-6">
        <StatsFilterBar filters={filters} patches={patches} onChange={setFilters} />

        <div className="mb-3">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('tft.search.items')}
            className="w-full sm:w-80 bg-surface-raised border border-border-subtle rounded px-3 py-1.5 text-sm text-white placeholder:text-fg-faint outline-none focus:border-accent-a60"
          />
        </div>
        <div className="flex flex-wrap gap-1 mb-4">
          <button
            onClick={() => setBucket(null)}
            className={`px-3 py-1 rounded text-xs ${bucket == null ? 'bg-accent text-white' : 'bg-surface-raised text-fg-secondary hover:text-white'}`}
          >
            {t('tft.item.bucket.all')}
          </button>
          {ITEM_BUCKETS.map(b => (
            <button
              key={b}
              onClick={() => setBucket(b)}
              className={`px-3 py-1 rounded text-xs ${bucket === b ? 'bg-accent text-white' : 'bg-surface-raised text-fg-secondary hover:text-white'}`}
            >
              {t(`tft.item.bucket.${b}` as any)}
            </button>
          ))}
        </div>

        {/* Steht immer im HTML: das Vorab-Skript blendet es ueber das <style>
            der Seite ein, solange gespeicherte Filter geladen werden. */}
        <StatsListPending show={(loading && hasData === null) || awaitingStored} />
        {hasData === false && !awaitingStored && <EmptyData />}

        {hasData && filtered.length > 0 && !awaitingStored && (
          <div data-e3-rows className="bg-surface-base border border-border-subtle rounded overflow-hidden">
            {/* Grid: icon (3rem) → name (12rem) → TopUsers (1fr, grows to
                fill the row) → 4 stat columns. Name moves from 1fr to a
                fixed 12rem so the TopUsers row gets the slack — that's
                where the cost-bordered champion tiles want to breathe. */}
            <div className={`hidden md:grid ${deltaOn ? 'grid-cols-[2rem_3rem_12rem_1fr_5rem_5rem_5rem_5rem_5rem_4rem]' : 'grid-cols-[2rem_3rem_12rem_1fr_5rem_5rem_5rem_5rem_5rem]'} gap-3 px-4 py-2.5 text-[11px] text-fg-secondary font-semibold whitespace-nowrap bg-surface-sunken`}>
              <div></div>
              <div></div>
              <div>{t('nav.items')}</div>
              <div>{t('tft.topUsers')}</div>
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
            <div className="md:hidden px-4 py-2 text-[10px] uppercase tracking-widest text-fg-muted bg-surface-sunken">
              {t('nav.items')}
            </div>
            {filtered.map(it => {
              const meta = assets?.items[it.apiName];
              const url = tftIconUrl(assets, meta?.icon);
              const letter = tierCutoffs ? tierLetterOfSync({ avgPlacement: it.avgPlacement, pickRate: it.pickRate, games: it.games }, 'items', tierCutoffs) : null;
              // Zeile = div, nicht <a>: sie enthaelt die Champion-Links, und ein
              // Link im Link wird im Server-HTML vom Parser zerlegt (zwei
              // Item-Links je Zeile, React verwirft das HTML). Der Item-Name ist
              // der Link und spannt seine Klickflaeche per ::after ueber die
              // ganze Zeile; die Champion-Links liegen darueber (z-10).
              return (
                <div
                  key={it.apiName}
                  className={`relative block md:grid ${deltaOn ? 'md:grid-cols-[2rem_3rem_12rem_1fr_5rem_5rem_5rem_5rem_5rem_4rem]' : 'md:grid-cols-[2rem_3rem_12rem_1fr_5rem_5rem_5rem_5rem_5rem]'} gap-3 px-4 py-2.5 md:items-center text-[13px] sm:text-sm hover:bg-white/5 border-t border-border-subtle`}
                >
                  <div className="hidden md:flex justify-center">
                    <TierBadge letter={letter} t={t} />
                  </div>
                  <div className="flex items-center gap-3 md:contents">
                    <div className="md:hidden">
                      <TierBadge letter={letter} t={t} />
                    </div>
                    {url ? (
                      <img src={url} alt={meta!.name} className="w-10 h-10 rounded-md flex-shrink-0 shadow-sm" />
                    ) : (
                      <div className="w-10 h-10 rounded-md bg-surface-overlay flex items-center justify-center text-[9px] text-fg-muted px-0.5 text-center flex-shrink-0">{prettyApi(it.apiName)}</div>
                    )}
                    <a
                      href={withLang(`/tft/items/${encodeURIComponent(it.apiName)}?bucket=${filters.bucket}&region=${filters.region}&days=${filters.days}`)}
                      className="block text-white font-medium truncate flex-1 md:flex-initial after:absolute after:inset-0"
                    >{meta?.name || prettyApi(it.apiName)}</a>
                  </div>
                  {/* Top users — 8 cost-bordered champion tiles. On mobile
                      the row still scrolls horizontally (overflow-x-auto)
                      because 8×32px doesn't fit on small screens; on
                      desktop the column is wide enough to render them all
                      inline without scrolling. */}
                  {/* Handy: die Reihe liegt ueber der Zeilen-Klickflaeche, sonst
                      faengt die das seitliche Wischen in Einrueckung und Luecken
                      ab; w-fit, damit rechts daneben die Zeile klickbar bleibt.
                      Desktop: nur die Kacheln liegen oben (z-10 am Link). */}
                  <div className="relative z-10 w-fit max-w-full md:static md:z-auto md:w-auto md:max-w-none flex items-center gap-1.5 mt-2 md:mt-0 pl-12 md:pl-6 overflow-x-auto md:overflow-visible">
                    {(it.topUsers || []).slice(0, 8).map((cid, i) => {
                      const ch = assets?.champions[cid];
                      const tileUrl = tftChampionTileUrl(assets, ch);
                      const fallbackUrl = tftIconUrl(assets, ch?.icon);
                      const borderColor = costToColor(ch?.cost ?? 1);
                      return (
                        <a
                          key={i}
                          href={withLang(`/tft/units/${encodeURIComponent(cid)}?bucket=${filters.bucket}&region=${filters.region}&days=${filters.days}`)}
                          className="relative z-10 w-10 h-10 rounded-md border-2 overflow-hidden flex-shrink-0 hover:scale-110 transition shadow-sm"
                          style={{ borderColor }}
                          title={ch?.name}
                        >
                          {tileUrl ? (
                            <img
                              src={tileUrl}
                              alt={ch?.name || ''}
                              className="w-full h-full object-cover"
                              onError={e => {
                                const img = e.currentTarget;
                                if (fallbackUrl && img.src !== fallbackUrl) img.src = fallbackUrl;
                              }}
                            />
                          ) : (
                            <div className="w-full h-full bg-surface-overlay" />
                          )}
                        </a>
                      );
                    })}
                  </div>
                  {/* Stats: 4-column grid on mobile under the icon/users
                      block; explicit cells on desktop via contents. */}
                  <div className={`grid ${deltaOn ? 'grid-cols-6' : 'grid-cols-5'} gap-2 mt-1.5 pl-12 md:pl-0 md:mt-0 md:contents`}>
                    <Cell label={t('tft.avgPlacement')} value={it.avgPlacement?.toFixed(2) ?? '—'} accent="white" align="center" />
                    <Cell label={t('tft.pickRate')} value={it.pickRate != null ? `${(it.pickRate * 100).toFixed(1)}%` : '—'} />
                    <Cell label={t('tft.top4')} value={it.top4Rate != null ? `${(it.top4Rate * 100).toFixed(1)}%` : '—'} />
                    <Cell label={t('tft.top1')} value={it.top1Rate != null ? `${(it.top1Rate * 100).toFixed(1)}%` : '—'} />
                    <Cell label={t('tft.gamesShort')} value={String(it.games)} accent="muted" />
                    {deltaOn && (
                      <DeltaCell delta={patchDeltaOf(delta.index, it.apiName)} pair={delta.pair} loading={delta.loading} label={deltaHeader(t, delta.pair)} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}

function prettyApi(s: string) { return s.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?(?:Item_)?/, '').slice(0, 10); }

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

function costToColor(cost: number) {
  return cost === 1 ? '#9aa6b2' : cost === 2 ? '#3a8' : cost === 3 ? '#3a8ddc' : cost === 4 ? '#c39bff' : '#e0c75a';
}

// Same reflow trick as /tft/units — mobile shows label-above-value pairs
// in a 4-col grid, desktop pulls the value through to the parent grid via
// `display: contents`. Wait — there are 5 desktop columns (avg/pick/top4/
// games hidden on mobile but visible on desktop), but Cell only emits 1
// desktop cell. The extra `<div className="hidden md:block">{games}</div>`
// after the Cells covers the 5th column.
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

// Δ-Spalte „vs Vorpatch". Negatives Δ Ø-Platz = besser geworden = gruen,
// positives = schlechter = rot. „NEW", wenn das Item im Vorpatch fehlt; „—"
// unter der Mindestzahl Spiele. Waehrend des Ladens leer.
function DeltaCell({ delta, pair, loading, label }: {
  delta: PatchDelta | null;
  pair: PatchDeltaPair | null;
  loading: boolean;
  label: string;
}) {
  const { t, lang } = useI18n();
  const tip = loading ? undefined : deltaTooltip(delta, pair, t, lang);
  const render = (content: React.ReactNode, cls: string, style?: React.CSSProperties) => (
    <>
      <div className="md:hidden" title={tip}>
        <div className="text-fg-muted text-[9px] uppercase tracking-widest leading-tight">{label}</div>
        <div className={`${cls} tabular-nums leading-tight`} style={style}>{content}</div>
      </div>
      <div className={`hidden md:block text-right ${cls} tabular-nums`} style={style} title={tip}>{content}</div>
    </>
  );
  if (loading) return render(null, '');
  if (delta?.isNew) return render('NEW', 'text-accent');
  if (delta?.deltaAvgPlace == null) return render('—', 'text-fg-faint');
  const d = delta.deltaAvgPlace;
  const sign = d < 0 ? '−' : d > 0 ? '+' : '';
  const color = d < -0.02 ? '#3ecf8e' : d > 0.02 ? '#e44040' : 'var(--fg-secondary)';
  return render(`${sign}${Math.abs(d).toFixed(2)}`, 'font-medium', { color });
}
