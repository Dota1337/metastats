'use client';
// Fenster zu einem Item (User 01.11.2026): Desktop rechts neben den Reihen, Handy
// als Blatt von unten. Liest nur die Listenzeile, Zahlen und Kachel koennen also
// nicht auseinanderlaufen, und kein Klick loest eine Abfrage aus. Kein Portal: das
// Ausblenden fuer gespeicherte Filter wirkt nur auf Nachfahren (stats-pending.ts).
import { forwardRef } from 'react';
import { withAlpha } from '../../lib/color';
import { useI18n } from '../../lib/i18n';
import { formatTftDesc, tftChampionTileUrl, tftIconUrl, tftLabel, type TftAssetsBundle } from '../../lib/tft-cdragon';
import { itemTextFor, type ItemTexts } from '../../lib/tft-item-texts';
import { holderDeltaColor, holderDeltaText, holderView, placementBlocks, type HolderSort, type ItemRow } from '../../lib/tft-item-tier-rows';
import { TIER_COLORS, TIER_TOOLTIP_KEY, type TierLetter } from '../../lib/tft-tier-letter';
import { costColor } from '../../lib/tft-ui';
import ItemStatLine from './ItemStatLine';

const pct = (v: number | null) => (v != null ? `${(v * 100).toFixed(1)}%` : '—');
const prettyId = (s: string) => s.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?(?:Item_)?/, '');

const ItemDetailPanel = forwardRef<HTMLElement, {
  item: ItemRow;
  letter: TierLetter | null;
  assets: TftAssetsBundle | null;
  texts: ItemTexts | null;
  textsPending: boolean;
  detailHref: string;
  unitHref: (characterId: string) => string;
  holderSort: HolderSort;
  onHolderSort: (by: HolderSort) => void;
  onClose: () => void;
}>(function ItemDetailPanel({ item: it, letter, assets, texts, textsPending, detailHref, unitHref, holderSort, onHolderSort, onClose }, ref) {
  const { t, lang } = useI18n();
  const meta = assets?.items[it.apiName];
  const url = tftIconUrl(assets, meta?.icon);
  const name = tftLabel(meta, lang) || prettyId(it.apiName);
  const text = itemTextFor(texts, it.apiName, lang);
  const desc = text?.desc ?? (textsPending ? null : meta?.desc ? formatTftDesc(meta.desc) : null);
  // Ohne Delta gibt es nichts umzuschalten: die Reihe zeigt dann schon die meistgespielten.
  const { holders, toggle, best } = holderView(it, holderSort);
  const sortButtons: { key: HolderSort; label: string; title: string }[] = [
    { key: 'delta', label: t('tft.item.sortDelta'), title: t('tft.item.holderDelta') },
    { key: 'common', label: t('tft.topUsers'), title: t('tft.topUsers') },
  ];
  const blocks = placementBlocks(it);
  const bars = blocks ? [
    { key: 'first', label: t('tft.item.place1'), value: blocks.first },
    { key: 'second', label: t('tft.item.place24'), value: blocks.second },
    { key: 'third', label: t('tft.item.place58'), value: blocks.third },
  ] : [];
  const maxBar = Math.max(...bars.map(b => b.value), 0.0001);
  const tierColor = letter ? TIER_COLORS[letter] : null;

  return (
    <aside
      ref={ref}
      tabIndex={-1}
      aria-label={name}
      style={{ outline: 'none' }}
      className="fixed inset-x-0 bottom-0 z-[61] max-h-[85vh] overflow-y-auto overscroll-contain rounded-t-2xl border-t border-border-subtle bg-surface-base p-4 shadow-xl lg:sticky lg:inset-auto lg:top-4 lg:z-auto lg:w-[340px] lg:flex-shrink-0 lg:max-h-[calc(100vh-2rem)] lg:rounded-xl lg:border"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={t('tft.item.close')}
        className="absolute right-2 top-2 w-9 h-9 flex items-center justify-center rounded text-fg-secondary hover:text-white"
      >
        <svg aria-hidden="true" viewBox="0 0 12 12" className="w-3.5 h-3.5">
          <path d="m2 2 8 8M10 2l-8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      <div className="flex items-center gap-3 pr-8">
        {url ? (
          <img src={url} alt={name} className="w-16 h-16 rounded-lg border border-border-default object-cover flex-shrink-0" />
        ) : (
          <div className="w-16 h-16 rounded-lg bg-surface-overlay flex-shrink-0" />
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-semibold text-white leading-tight break-words">{name}</h2>
            {letter && tierColor && (
              <span
                className="inline-flex items-center justify-center min-w-7 h-6 px-1.5 rounded text-[11px] font-bold"
                style={{ color: tierColor, backgroundColor: withAlpha(tierColor, 0x1f), border: `1px solid ${withAlpha(tierColor, 0x50)}` }}
                title={t(TIER_TOOLTIP_KEY[letter])}
              >{letter}</span>
            )}
          </div>
          <div className="text-xs text-fg-secondary mt-0.5 tabular-nums">
            {it.games.toLocaleString(lang)} {t('tft.gamesShort')}
          </div>
        </div>
      </div>

      {text && text.stats.length > 0 && <ItemStatLine stats={text.stats} className="text-xs mt-3" />}
      {desc ? (
        <p className={`text-fg-secondary text-xs whitespace-pre-line ${text && text.stats.length > 0 ? 'mt-1.5' : 'mt-3'}`}>{desc}</p>
      ) : textsPending ? (
        <div className="mt-3 space-y-1.5" aria-hidden="true">
          <div className="h-3 rounded bg-surface-raised" />
          <div className="h-3 w-2/3 rounded bg-surface-raised" />
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-2 mt-3">
        <StatBox label={t('tft.avgPlacement')} value={it.avgPlacement != null ? it.avgPlacement.toFixed(2) : '—'} />
        <StatBox label={t('tft.top4')} value={pct(it.top4Rate)} />
        <StatBox label={t('tft.top1')} value={pct(it.top1Rate)} />
      </div>

      <div className="mt-4 pt-3 border-t border-border-subtle">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="text-xs font-semibold text-white">{t(best ? 'tft.item.bestHolders' : 'tft.topUsers')}</h3>
          <a href={detailHref} className="text-xs text-accent hover:text-white whitespace-nowrap">
            {t('tft.item.seeAll')} →
          </a>
        </div>
        {toggle && (
          <div role="group" aria-label={t('tft.sortBy')} className="flex flex-wrap gap-1.5 mb-2.5">
            {sortButtons.map(b => (
              <button
                key={b.key}
                type="button"
                aria-pressed={holderSort === b.key}
                title={b.title}
                onClick={() => onHolderSort(b.key)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium ${holderSort === b.key ? 'bg-accent-fill text-white' : 'bg-surface-raised border border-border-subtle text-fg-secondary hover:text-white'}`}
              >
                {b.label}
              </button>
            ))}
          </div>
        )}
        {holders.length > 0 && (
          <div className="grid grid-cols-5 gap-x-2 gap-y-2.5">
            {holders.slice(0, 10).map(([cid, avg, delta]) => {
              const ch = assets?.champions[cid];
              const tile = tftChampionTileUrl(assets, ch);
              const fallback = tftIconUrl(assets, ch?.icon);
              const unitName = tftLabel(ch, lang) || prettyId(cid);
              return (
                <a key={cid} href={unitHref(cid)} title={unitName} className="block min-w-0 group">
                  <span className="block aspect-square rounded-md border-2 overflow-hidden" style={{ borderColor: costColor(ch?.cost ?? 1) }}>
                    {tile ? (
                      <img
                        src={tile}
                        alt={unitName}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover transition-transform group-hover:scale-105"
                        onError={e => {
                          const img = e.currentTarget;
                          if (fallback && img.src !== fallback) img.src = fallback;
                        }}
                      />
                    ) : (
                      <span className="block w-full h-full bg-surface-overlay" />
                    )}
                  </span>
                  <span className="block mt-1 text-[11px] leading-tight text-center text-fg-primary truncate">{unitName}</span>
                  <span className="block mt-0.5 text-[11px] leading-tight text-center text-fg-secondary tabular-nums" title={t('tft.avgPlacement')}>
                    {avg != null ? `Ø ${avg.toFixed(2)}` : '—'}
                  </span>
                  {delta != null && (
                    <span
                      className="block text-[11px] leading-tight text-center font-semibold tabular-nums"
                      style={{ color: holderDeltaColor(delta) }}
                      title={t('tft.item.holderDelta')}
                    >
                      {holderDeltaText(delta)}
                    </span>
                  )}
                </a>
              );
            })}
          </div>
        )}
      </div>

      {bars.length > 0 && (
        <div className="mt-4 pt-3 border-t border-border-subtle">
          <h3 className="text-xs font-semibold text-white mb-2">{t('tft.explorer.x.placeDist')}</h3>
          <div className="grid grid-cols-3 gap-3 items-end">
            {bars.map(b => (
              <div key={b.key} className="flex flex-col items-center">
                <div className="text-xs font-semibold text-white tabular-nums mb-1">{pct(b.value)}</div>
                <div className="w-full h-16 flex items-end border-b border-border-subtle">
                  <div className="w-full rounded-t bg-accent-fill" style={{ height: `${Math.max(3, (b.value / maxBar) * 100)}%` }} />
                </div>
                <div className="text-[11px] text-fg-secondary mt-1 text-center">{b.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
});

export default ItemDetailPanel;

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-surface-raised border border-border-subtle px-1.5 py-2 text-center min-w-0">
      <div className="text-base font-bold text-white tabular-nums leading-tight">{value}</div>
      <div className="text-[11px] text-fg-secondary mt-0.5 leading-tight">{label}</div>
    </div>
  );
}
