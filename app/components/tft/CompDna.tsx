'use client';
import { useI18n, type TranslationKey } from '../../lib/i18n';

// Comp-DNA: Platz je Rang (+ Aggro-Index, in Set 18 leer). Zweimal auf der
// Detailseite: ab 1440 px im Kopf (CompCard, variant="header"), darunter als
// Box in der Detail-Analyse (variant="box") — User 2026-10-10.
//
// Balken (User 2026-10-10, „nicht aussagekraeftig"): Mitte = Platz 4,5, der
// Schnitt aller 8 Spieler einer Lobby. Gruen nach rechts = besser, rot nach
// links = schlechter, voller halber Balken = 2 Plaetze. Vorher Min-Max-
// normiert: der schlechteste Rang hatte immer 0 % — auch bei 0,01 Abstand.
// Das Wort „Konstant / Skill-intensiv" ist weg: es kannte keine Richtung und
// widersprach oft den Zahlen (Reviews 2026-10-10).

interface RankRow { bucket: string; games: number; avgPlacement: number }
interface DnaComp {
  aggroIndex?: number | null;
  aggroLobbyAverage?: number | null;
  skillCapBuckets?: RankRow[] | null;
}

const LOBBY_AVG = 4.5;
const SCALE = 2;
// Raenge unter 30 Spielen schwanken um gut ±0,8 Plaetze; die API filtert seit
// 2026-10-10 ebenfalls ab 30, aeltere Snapshots tragen noch Raenge ab 20.
const MIN_RANK_GAMES = 30;
// Unter 100 Spielen blasser (Zufallsfehler noch ±0,45 Plaetze).
const SOLID_RANK_GAMES = 100;

function rankRows(comp: DnaComp): RankRow[] {
  return (comp.skillCapBuckets ?? []).filter(b => b.games >= MIN_RANK_GAMES);
}

export function hasCompDna(comp: DnaComp | null | undefined): boolean {
  return !!comp && (comp.aggroIndex != null || rankRows(comp).length > 0);
}

function RankBars({ rows, twoCols }: { rows: RankRow[]; twoCols: boolean }) {
  const { t } = useI18n();
  return (
    // Zwei Spalten (ab 5 Raengen, wenn Platz ist) als Textspalten: die Raenge
    // laufen erst links von oben nach unten, dann rechts — Reihenfolge bleibt.
    <div className={`[&>*]:mb-1 ${twoCols ? '@lg:columns-2 @lg:gap-x-6' : ''}`}>
      {rows.map(bk => {
        const label = t(`tft.bucket.${bk.bucket}` as TranslationKey) || bk.bucket;
        const delta = LOBBY_AVG - bk.avgPlacement;
        const half = Math.min(1, Math.abs(delta) / SCALE) * 50;
        const better = delta >= 0;
        return (
          <div
            key={bk.bucket}
            className="flex items-center gap-2 text-[10px] tabular-nums break-inside-avoid"
            style={{ opacity: bk.games < SOLID_RANK_GAMES ? 0.55 : 1 }}
            title={`${label}: Ø ${bk.avgPlacement.toFixed(2)} · ${bk.games} ${t('tft.gamesShort')}`}
          >
            <span className="text-fg-secondary w-16 truncate">{label}</span>
            <div className="relative flex-1 h-1.5 bg-surface-overlay rounded-sm">
              <div
                className="absolute inset-y-0 rounded-sm"
                style={{
                  left: better ? '50%' : `${50 - half}%`,
                  width: `${half}%`,
                  backgroundColor: better ? '#3ecf8e' : '#e44040',
                }}
              />
              <div className="absolute -inset-y-0.5 left-1/2 w-px bg-fg-faint" aria-hidden="true" />
            </div>
            <span className="text-white w-8 text-right">{bk.avgPlacement.toFixed(2)}</span>
            <span className="text-fg-faint w-10 text-right">({bk.games})</span>
          </div>
        );
      })}
    </div>
  );
}

function AggroBlock({ comp, compact }: { comp: DnaComp; compact: boolean }) {
  const { t } = useI18n();
  if (comp.aggroIndex == null) return null;
  return (
    <div className={compact ? '' : 'bg-surface-raised border border-border-subtle rounded p-3'}>
      <div className="text-fg-muted text-[10px] uppercase tracking-widest">{t('tft.comp.aggroIndex')}</div>
      <div className="flex items-baseline gap-1.5 mt-1">
        <span className={`text-white font-medium tabular-nums ${compact ? 'text-base' : 'text-2xl'}`}>{comp.aggroIndex.toFixed(2)}</span>
        <span className="text-fg-muted text-[11px]">{t('tft.comp.aggro.perGame')}</span>
      </div>
      {comp.aggroLobbyAverage != null && (
        <div className="text-fg-faint text-[10px] tabular-nums mt-0.5">
          {t('tft.comp.aggro.lobbyAvg')}: {comp.aggroLobbyAverage.toFixed(2)}
        </div>
      )}
      <div className="text-[#c39bff] text-[11px] mt-1.5">
        {comp.aggroIndex >= 1.2 ? t('tft.comp.aggro.push')
          : comp.aggroIndex >= 0.7 ? t('tft.comp.aggro.balanced')
          : t('tft.comp.aggro.econ')}
      </div>
    </div>
  );
}

export default function CompDna({ comp, variant, className = '' }: { comp: DnaComp; variant: 'header' | 'box'; className?: string }) {
  const { t } = useI18n();
  const rows = rankRows(comp);
  if (!hasCompDna(comp)) return null;
  const aggro = comp.aggroIndex != null;
  const twoCols = rows.length >= 5;

  if (variant === 'header') {
    return (
      <div className="@container min-w-0 pl-4 border-l border-border-subtle">
        <div className="text-fg-muted text-[9px] uppercase tracking-widest mb-1.5">{t('tft.comp.compDna')}</div>
        <div className={aggro && rows.length > 0 ? 'grid grid-cols-[auto_minmax(0,1fr)] gap-x-4' : ''}>
          <AggroBlock comp={comp} compact />
          {rows.length > 0 && <RankBars rows={rows} twoCols={twoCols} />}
        </div>
      </div>
    );
  }

  return (
    <section className={`@container mt-5 bg-surface-base border border-border-subtle rounded p-4 ${className}`}>
      <h2 className="text-fg-secondary text-xs uppercase tracking-widest mb-3">{t('tft.comp.compDna')}</h2>
      <div className={aggro && rows.length > 0 ? 'grid grid-cols-1 lg:grid-cols-2 gap-4' : ''}>
        <AggroBlock comp={comp} compact={false} />
        {rows.length > 0 && <RankBars rows={rows} twoCols={twoCols} />}
      </div>
    </section>
  );
}
