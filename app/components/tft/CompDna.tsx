'use client';
import { useI18n, type TranslationKey } from '../../lib/i18n';

// Comp-DNA: Platz je Rang (+ Aggro-Index, in Set 18 leer). Zweimal auf der
// Detailseite: ab 1440 px im Kopf (CompCard, variant="header"), darunter als
// Box in der Detail-Analyse (variant="box") — User 2026-10-10.
//
// Balken (User 2026-10-10): Look wie vorher (duenn, von links), aber auf der
// ganzen Platz-Skala: voll = Platz 1, halb = Platz 4,5 (Schnitt aller 8
// Spieler einer Lobby). Farbe aus dem Abstand zu 4,5: gruen besser, gelb
// gleich, rot schlechter. Vorher Min-Max-normiert: der schlechteste Rang hatte
// immer 0 % — auch bei 0,01 Abstand. Die Raenge liegen meist nur 0,1 Plaetze
// auseinander; den Unterschied zeigt dann die Zahl daneben, nicht die Laenge.
// Das Wort „Konstant / Skill-intensiv" ist weg: es kannte keine Richtung und
// widersprach oft den Zahlen (Reviews 2026-10-10).

interface RankRow { bucket: string; games: number; avgPlacement: number }
interface DnaComp {
  aggroIndex?: number | null;
  aggroLobbyAverage?: number | null;
  skillCapBuckets?: RankRow[] | null;
}

const LOBBY_AVG = 4.5;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
// Raenge unter 30 Spielen schwanken um gut ±0,8 Plaetze; die API filtert seit
// 2026-10-10 ebenfalls ab 30, aeltere Snapshots tragen noch Raenge ab 20.
const MIN_RANK_GAMES = 30;
// Unter 100 Spielen blasser (Zufallsfehler noch ±0,45 Plaetze).
const SOLID_RANK_GAMES = 100;

function rankRows(comp: DnaComp): RankRow[] {
  // Ohne Platzsumme rechnet die API NaN (route.ts, sum_placement / games).
  return (comp.skillCapBuckets ?? []).filter(b => b.games >= MIN_RANK_GAMES && Number.isFinite(b.avgPlacement));
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
        const share = clamp((8 - bk.avgPlacement) / 7, 0, 1);
        const hue = Math.round(60 + 60 * clamp(LOBBY_AVG - bk.avgPlacement, -1, 1));
        return (
          <div
            key={bk.bucket}
            className="flex items-center gap-2 text-[11px] tabular-nums break-inside-avoid"
            style={{ opacity: bk.games < SOLID_RANK_GAMES ? 0.55 : 1 }}
            title={`${label}: Ø ${bk.avgPlacement.toFixed(2)} · ${bk.games} ${t('tft.gamesShort')}`}
          >
            {/* 4.75rem statt w-16 seit 11 px (2026-10-18): „Grand Maestro“ braucht 74 px */}
            <span className="text-fg-secondary w-[4.75rem] truncate">{label}</span>
            <div className="flex-1 h-1 bg-surface-overlay rounded overflow-hidden">
              <div className="h-full" style={{ width: `${(share * 100).toFixed(0)}%`, backgroundColor: `hsl(${hue}, 60%, 50%)` }} />
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
      <div className="text-fg-muted text-[11px] uppercase tracking-widest">{t('tft.comp.aggroIndex')}</div>
      <div className="flex items-baseline gap-1.5 mt-1">
        <span className={`text-white font-medium tabular-nums ${compact ? 'text-base' : 'text-2xl'}`}>{comp.aggroIndex.toFixed(2)}</span>
        <span className="text-fg-muted text-xs">{t('tft.comp.aggro.perGame')}</span>
      </div>
      {comp.aggroLobbyAverage != null && (
        <div className="text-fg-faint text-[11px] tabular-nums mt-0.5">
          {t('tft.comp.aggro.lobbyAvg')}: {comp.aggroLobbyAverage.toFixed(2)}
        </div>
      )}
      <div className="text-[#c39bff] text-xs mt-1.5">
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
      // ml-6 + Raster-Luecke 16 px = 40 px bis zum Strich (User 2026-10-10: mehr Abstand zu den Werten).
      <div className="@container min-w-0 ml-6 pl-6 border-l border-border-subtle">
        <div className="text-fg-muted text-[11px] uppercase tracking-widest mb-1.5">{t('tft.comp.compDna')}</div>
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
