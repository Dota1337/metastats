'use client';
import { useI18n } from '../../../lib/i18n';
import { costColor } from '../../../lib/tft-ui';
import type { TftAssetsBundle } from '../../../lib/tft-cdragon';
import { regionShortLabel } from '../StatsFilterBar';
import { EXPLORER_RANKS, roundLabel, type ExplorerGame, type ExplorerRank } from '../../../lib/tft-explorer-query';
import { itemImg, itemName, traitImg, traitName, unitImg, unitName, type ExplorerOptions } from './explorer-options';
import { RANK_LABEL } from './ExplorerScope';

// Spiele-Reiter: die neuesten Bretter der Auswahl (der Dienst liefert 20),
// je Brett Platz, Spieler mit Link auf seine Seite, Traits und Units.
// games = null: Daten gehoeren noch zur vorigen Auswahl → Platzhalter.

const placeClass = (p: number) =>
  p === 1 ? 'text-gold-earnings border-gold-earnings' : p <= 4 ? 'text-pos-win border-pos-win' : 'text-fg-muted border-border-subtle';

export default function ExplorerGames({
  games, options, assets,
}: { games: ExplorerGame[] | null; options: ExplorerOptions; assets: TftAssetsBundle | null }) {
  const { t, lang, withLang } = useI18n();
  const locale = lang === 'de' ? 'de-DE' : lang;
  if (games == null) {
    return (
      <ul>
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="px-3 py-2.5 border-b border-border-subtle last:border-0">
            <div className="h-16 rounded bg-surface-raised animate-pulse" />
          </li>
        ))}
      </ul>
    );
  }
  if (games.length === 0) return <div className="px-3 py-6 text-center text-xs text-fg-muted">{t('tft.explorer.noResults')}</div>;
  const cost = (id: string) => options.unitById.get(id)?.cost ?? 1;
  return (
    <ul>
      {games.map((g, n) => {
        const units = [...g.units].sort((a, b) => cost(a.id) - cost(b.id) || b.s - a.s);
        const rank = g.rank && (EXPLORER_RANKS as readonly string[]).includes(g.rank) ? t(RANK_LABEL[g.rank as ExplorerRank]) : null;
        return (
          <li key={`${g.ts}-${n}`} className="flex flex-col gap-2 px-3 py-2.5 border-b border-border-subtle last:border-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className={`inline-flex items-center justify-center w-7 h-6 rounded border font-semibold tabular-nums ${placeClass(g.placement)}`}>
                {g.placement}
              </span>
              {g.player ? (
                <a href={withLang(g.player.href)} className="text-fg-primary hover:text-fg-bright hover:underline underline-offset-2 truncate max-w-[14rem]">
                  {g.player.name}<span className="text-fg-muted">#{g.player.tag}</span>
                </a>
              ) : <span className="text-fg-muted">{'—'}</span>}
              <span className="text-fg-muted tabular-nums">
                {[regionShortLabel(g.region), rank, `${t('tft.explorer.x.lv')} ${g.level}`, roundLabel(g.round), g.patch].filter(Boolean).join(' · ')}
              </span>
              <span className="ml-auto text-fg-faint tabular-nums">
                {new Date(g.ts * 1000).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })}
              </span>
            </div>
            {g.traits.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {g.traits.map(tr => {
                  const src = traitImg(options, assets, tr.id);
                  const name = traitName(options, assets, tr.id);
                  return (
                    <span key={tr.id} title={name} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-raised text-[11px] text-fg-secondary tabular-nums">
                      {src && <img src={src} alt={name} loading="lazy" className="w-4 h-4" />}
                      {tr.n}
                    </span>
                  );
                })}
              </div>
            )}
            <div className="flex flex-wrap items-start gap-1.5">
              {units.map((u, i) => {
                const src = unitImg(options, assets, u.id);
                const name = unitName(options, assets, u.id);
                return (
                  <div key={`${u.id}-${i}`} className="flex flex-col items-center w-10" title={name}>
                    <span className="text-[9px] leading-none text-gold-earnings h-2.5">{'★'.repeat(Math.min(u.s, 4))}</span>
                    {src
                      ? <img src={src} alt={name} loading="lazy" className="w-10 h-10 rounded object-cover" style={{ boxShadow: `inset 0 0 0 1.5px ${costColor(cost(u.id))}` }} />
                      : <span className="w-10 h-10 rounded bg-surface-overlay" />}
                    <span className="flex gap-px mt-0.5 h-3.5">
                      {u.it.map((it, k) => {
                        const s = itemImg(options, assets, it);
                        return s ? <img key={`${it}${k}`} src={s} alt={itemName(options, assets, it)} title={itemName(options, assets, it)} loading="lazy" className="w-3.5 h-3.5 rounded-sm" /> : null;
                      })}
                    </span>
                  </div>
                );
              })}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
