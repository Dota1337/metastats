'use client';
// CompFlexUnits — Detail-Page-Sektion. Zeigt Units, die NICHT zum Core-Roster
// gehören, aber von ≥ 10 % der Comp-Lobbies gepickt werden. Win-Rate wird erst
// ab n ≥ 50 Picks angezeigt (Binomial-σ ≈ 4.7 pp), Avg-Placement ab n ≥ 20.
// Phase-1-Backfill: alte Snapshot-Rows ohne Outcome-Felder zählen NICHT in
// gamesWithUnitOutcome → Win-Rate bleibt grayed-out bis genug neue Daten da
// sind. Keine erfundenen Werte (`feedback_no_fake_values`).
import { tftChampionTileUrl, findChampion, type TftAssetsBundle } from '../../lib/tft-cdragon';
import type { TranslationKey } from '../../lib/i18n';

export interface FlexUnit {
  characterId: string;
  pickrate: number;            // pickN / games  (0..1)
  n: number;                   // Σ Picks (gamesWithUnit)
  nOutcome: number;            // Σ Picks der Outcome-tragenden Rows (Win-Rate-Nenner)
  avgPlacement: number | null; // null wenn nOutcome < 20
  top1Rate: number | null;     // null wenn nOutcome < 50
  top4Rate: number | null;     // null wenn nOutcome < 30
}

function costColor(cost: number) {
  return cost === 1 ? '#9aa6b2'
    : cost === 2 ? '#3a8'
    : cost === 3 ? '#3a8ddc'
    : cost === 4 ? '#c39bff'
    : '#e0c75a';
}

function fmtPct(v: number | null): string {
  if (v == null) return '—';
  return `${(v * 100).toFixed(0)}%`;
}

function fmtPlace(v: number | null): string {
  if (v == null) return '—';
  return v.toFixed(2);
}

export default function CompFlexUnits({
  units, assets, bucket, t,
}: {
  units: FlexUnit[];
  assets: TftAssetsBundle | null;
  bucket: string;
  t: (k: TranslationKey) => string;
}) {
  if (!units || units.length === 0) return null;
  return (
    <section className="mt-5 bg-surface-base border border-border-subtle rounded p-4">
      <h2 className="text-fg-secondary text-xs uppercase tracking-widest mb-3">
        {t('tft.comp.flexUnits.title')}
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {units.map(u => {
          const ch = findChampion(assets, u.characterId);
          const url = tftChampionTileUrl(assets, ch);
          const cost = ch?.cost ?? 1;
          const name = ch?.name || u.characterId.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '');
          return (
            <a
              key={u.characterId}
              href={`/tft/units/${encodeURIComponent(u.characterId)}?bucket=${bucket}`}
              className="flex items-center gap-3 bg-surface-sunken border border-border-subtle rounded p-2 hover:border-[#2a3d57] transition"
              title={`n = ${u.n} picks${u.nOutcome > 0 ? ` · outcome n = ${u.nOutcome}` : ''}`}
            >
              {url ? (
                <img
                  src={url}
                  alt={name}
                  loading="lazy"
                  className="w-10 h-10 rounded object-cover border-2 flex-shrink-0"
                  style={{ borderColor: costColor(cost) }}
                />
              ) : (
                <div className="w-10 h-10 rounded bg-surface-overlay flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-white text-xs font-semibold truncate">{name}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-fg-secondary">
                    <span className="text-fg-muted">{t('tft.comp.flexUnits.pickrate')} </span>
                    <span className="text-white font-semibold">{fmtPct(u.pickrate)}</span>
                  </span>
                  <span className={`text-[10px] ${u.top1Rate != null ? 'text-fg-secondary' : 'text-[#4a5468]'}`}>
                    <span className="text-fg-muted">{t('tft.comp.flexUnits.top1')} </span>
                    <span className={u.top1Rate != null ? 'text-white font-semibold' : ''}>{fmtPct(u.top1Rate)}</span>
                  </span>
                  <span className={`text-[10px] ${u.avgPlacement != null ? 'text-fg-secondary' : 'text-[#4a5468]'}`}>
                    <span className="text-fg-muted">{t('tft.comp.flexUnits.avgPlc')} </span>
                    <span className={u.avgPlacement != null ? 'text-white font-semibold' : ''}>{fmtPlace(u.avgPlacement)}</span>
                  </span>
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}
