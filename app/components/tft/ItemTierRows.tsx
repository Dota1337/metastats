'use client';
// Reihen S+ bis C der Items-Seite. Kachel wie im Comps-Atlas (Ø oben rechts,
// Pfeil gegen den Vorpatch oben links), aber ein echter Link auf die Detailseite:
// Strg-/Mittelklick oeffnet sie, Google liest sie, der normale Klick oeffnet das
// Fenster rechts.
import { withAlpha } from '../../lib/color';
import { useI18n, type TranslationKey } from '../../lib/i18n';
import { tftIconUrl, tftLabel, type TftAssetsBundle } from '../../lib/tft-cdragon';
import { TIER_COLORS, TIER_NONE_COLOR, TIER_TOOLTIP_KEY } from '../../lib/tft-tier-letter';
import { patchDeltaOf, type PatchDeltaIndex, type PatchDeltaPair } from '../../lib/tft-patch-delta';
import type { ItemRow, ItemTierRow } from '../../lib/tft-item-tier-rows';
import { deltaTooltip } from './PatchDeltaCell';

// Wie die alte Δ-Spalte: darunter galt der Wert als unveraendert.
const TREND_MIN = 0.02;

const prettyApi = (s: string) => s.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?(?:Item_)?/, '').slice(0, 10);

export default function ItemTierRows({ rows, assets, selected, onSelect, hrefOf, deltaIndex, pair }: {
  rows: ItemTierRow[];
  assets: TftAssetsBundle | null;
  selected: string | null;
  onSelect: (apiName: string, el: HTMLElement) => void;
  hrefOf: (apiName: string) => string;
  deltaIndex: PatchDeltaIndex | null;
  pair: PatchDeltaPair | null;
}) {
  const { t, lang } = useI18n();
  return (
    <div className="space-y-2 flex-1 min-w-0">
      {rows.map(row => {
        const color = row.tier ? TIER_COLORS[row.tier] : TIER_NONE_COLOR;
        const n = row.items.length;
        return (
          <section
            key={row.tier ?? 'none'}
            className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 rounded-lg border border-border-subtle px-3 py-3 bg-surface-comp-row"
            style={row.tier ? {
              borderColor: withAlpha(color, 0x40),
              backgroundImage: `linear-gradient(90deg, ${withAlpha(color, 0x1a)}, transparent 45%)`,
            } : undefined}
          >
            <div className="flex items-center justify-between sm:contents">
              <div className="flex items-center gap-1 sm:w-16 flex-shrink-0 sm:order-1">
                <span
                  className="text-3xl sm:text-4xl font-bold leading-none"
                  style={{ color }}
                  title={row.tier ? t(TIER_TOOLTIP_KEY[row.tier]) : undefined}
                >
                  {row.tier ?? '—'}
                </span>
                {(row.tier === 'S+' || row.tier === 'S') && (
                  <span aria-hidden="true" className="text-sm leading-none" style={{ color }}>✦</span>
                )}
              </div>
              <span className="text-xs text-fg-secondary whitespace-nowrap flex-shrink-0 sm:order-3 tabular-nums">
                {n === 1 ? t('tft.item.countOne') : t('tft.item.count').replace('{n}', String(n))}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-2.5 min-w-0 flex-1 sm:order-2 pt-1 pr-1.5">
              {row.items.map(it => (
                <ItemTile
                  key={it.apiName}
                  item={it}
                  assets={assets}
                  rated={!!row.tier}
                  selected={it.apiName === selected}
                  onSelect={onSelect}
                  href={hrefOf(it.apiName)}
                  deltaIndex={deltaIndex}
                  pair={pair}
                  t={t}
                  lang={lang}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ItemTile({ item: it, assets, rated, selected, onSelect, href, deltaIndex, pair, t, lang }: {
  item: ItemRow;
  assets: TftAssetsBundle | null;
  rated: boolean;
  selected: boolean;
  onSelect: (apiName: string, el: HTMLElement) => void;
  href: string;
  deltaIndex: PatchDeltaIndex | null;
  pair: PatchDeltaPair | null;
  t: (k: TranslationKey) => string;
  lang: ReturnType<typeof useI18n>['lang'];
}) {
  const meta = assets?.items[it.apiName];
  const url = tftIconUrl(assets, meta?.icon);
  const name = tftLabel(meta, lang) || prettyApi(it.apiName);
  const avg = it.avgPlacement;
  const delta = rated ? patchDeltaOf(deltaIndex, it.apiName) : null;
  const trend = delta?.deltaAvgPlace ?? null;
  const tip = [
    name,
    `${t('tft.avgPlacement')}: ${avg != null ? avg.toFixed(2) : '—'}`,
    `${t('tft.top4')}: ${it.top4Rate != null ? `${(it.top4Rate * 100).toFixed(1)}%` : '—'}`,
    // Nach Seitensprache: der Server rendert den Text mit.
    `${t('tft.gamesShort')}: ${it.games.toLocaleString(lang)}`,
  ].join('\n');

  return (
    <a
      href={href}
      title={tip}
      aria-label={name}
      aria-current={selected ? 'true' : undefined}
      onClick={e => {
        // Strg/Cmd/Umschalt/Alt und andere Tasten bleiben normale Link-Klicks.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        onSelect(it.apiName, e.currentTarget);
      }}
      className="group relative block w-10 h-10 sm:w-11 sm:h-11 rounded-md flex-shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-a60"
    >
      {url ? (
        <img
          src={url}
          alt={name}
          loading="lazy"
          decoding="async"
          className={`w-full h-full rounded-md object-cover shadow-sm border transition-transform group-hover:scale-105 ${selected ? 'border-white ring-2 ring-white' : 'border-border-default'}`}
        />
      ) : (
        <div className={`w-full h-full rounded-md bg-surface-overlay border flex items-center justify-center text-[9px] text-fg-muted px-0.5 text-center ${selected ? 'border-white ring-2 ring-white' : 'border-border-default'}`}>
          {prettyApi(it.apiName)}
        </div>
      )}
      {avg != null && (
        <span className="absolute -top-1.5 -right-1.5 px-0.5 rounded bg-surface-base/90 border border-border-subtle text-[10px] leading-[14px] font-semibold text-white tabular-nums">
          {avg.toFixed(2)}
        </span>
      )}
      {trend != null && Math.abs(trend) >= TREND_MIN && (
        <span
          className="absolute -top-1 -left-1 text-[11px] leading-none font-bold"
          style={{ color: trend < 0 ? '#3ecf8e' : 'var(--pos-loss-text)' }}
          title={`${deltaTooltip(delta, pair, t, lang)} (${trend > 0 ? '+' : ''}${trend.toFixed(2)})`}
        >
          {trend < 0 ? '▲' : '▼'}
        </span>
      )}
    </a>
  );
}
