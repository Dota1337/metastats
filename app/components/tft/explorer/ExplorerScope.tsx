'use client';
import { useI18n, type TranslationKey } from '../../../lib/i18n';
import { regionShortLabel } from '../StatsFilterBar';
import {
  EXPLORER_RANKS, EXPLORER_RANK_STAGES, LATEST_PATCH, barPatches, rankStageOf, stageRanks,
  type ExplorerMeta, type ExplorerQuery, type ExplorerRank, type ExplorerRankStage,
} from '../../../lib/tft-explorer-query';
import { seg } from './explorer-ui';

// Grundmenge: Patch, Region, Rang. Seit 25.10.2026 drei Knoepfe mit
// Aufklappfenster vorn in der Filterleiste (ExplorerFilters, PlainChip); hier
// stehen Beschriftung und Fensterinhalt. Die Auswahl kommt aus dem, was im
// Speicher tatsaechlich liegt (meta), nicht aus festen Listen.

export const RANK_LABEL: Record<ExplorerRank, TranslationKey> = {
  CHALLENGER: 'tft.bucket.challenger',
  GRANDMASTER: 'tft.bucket.grandmaster',
  MASTER: 'tft.bucket.master',
  DIAMOND: 'tft.bucket.diamond',
  EMERALD: 'tft.bucket.emerald',
};

// Gleiche Beschriftung wie die Rang-Auswahl der uebrigen TFT-Seiten (StatsFilterBar).
const STAGE_LABEL: Record<ExplorerRankStage, TranslationKey> = {
  challenger: 'tft.bucket.challenger',
  grandmaster_plus: 'tft.filter.grandmasterPlus',
  master_plus: 'tft.filter.masterPlus',
  diamond_plus: 'tft.filter.diamondPlus',
  emerald_plus: 'tft.filter.emeraldPlus',
};

type T = ReturnType<typeof useI18n>['t'];
type Scope = { query: ExplorerQuery; setQuery: (q: ExplorerQuery) => void };

const isLatestQ = (q: ExplorerQuery) => q.patches[0] === LATEST_PATCH;

// Knopf-Beschriftung: value = Abweichung vom Standard (hervorgehoben, mit ×),
// hint = Standard (Neuester Patch / Alle Regionen / Alle Raenge), voll lesbar,
// weil er alle Zahlen darunter bestimmt.
export function patchValue(q: ExplorerQuery, t: T): string | null {
  if (isLatestQ(q)) return null;
  return q.patches.length === 0 ? t('tft.explorer.x.patch.all') : `${t('tft.filter.patch')} ${q.patches.join(', ')}`;
}
export const patchHint = (t: T, resolvedPatch: string | null) =>
  `${t('tft.explorer.x.patch.latest')}${resolvedPatch ? ` · ${resolvedPatch}` : ''}`;

export const regionValue = (q: ExplorerQuery) => (q.region === 'all' ? null : regionShortLabel(q.region));

// Stufen statt Einzelraenge. Eine Auswahl, die keine Stufe ist (alter Link,
// Klick im Reiter Rang), steht als Wert auf dem Knopf und laesst sich per × entfernen.
export function rankValue(q: ExplorerQuery, t: T): string | null {
  const stage = rankStageOf(q.ranks);
  if (stage === 'all') return null;
  return stage ? t(STAGE_LABEL[stage])
    : EXPLORER_RANKS.filter(r => q.ranks.includes(r)).map(r => t(RANK_LABEL[r])).join(', ');
}

// Mehrfachwahl: Fenster bleibt offen. Leiste = aktuelle Patch-Familie + vorige
// (barPatches). Ohne meta (erstes Laden, Abfrage gescheitert) stehen die
// gewaehlten Patches dort, damit die Auswahl sichtbar und abwaehlbar bleibt.
export function PatchOptions({ query, setQuery, meta, resolvedPatch }: Scope & { meta: ExplorerMeta | null; resolvedPatch: string | null }) {
  const { t } = useI18n();
  const isLatest = isLatestQ(query);
  const isAll = query.patches.length === 0;
  const bar = meta ? barPatches(meta.patches.map(p => p.patch)) : isLatest || isAll ? [] : query.patches;
  const showBar = meta ? bar.length > 1 : bar.length > 0;
  const inBar = (p: string) => showBar && bar.includes(p);

  // Eine Alt-Auswahl (Link auf einen aelteren Patch) bleibt beim Dazuklicken
  // erhalten; „Alle Patches" (alter Link) enthaelt schon jeden und wird ersetzt.
  const togglePatch = (p: string) => {
    const cur = isLatest || isAll ? [] : query.patches;
    const next = cur.includes(p) ? cur.filter(x => x !== p) : [...cur, p];
    setQuery({ ...query, patches: next.length ? next.sort() : [LATEST_PATCH] });
  };
  // Auswahl ausserhalb der Leiste (alte Links, Unit-Seite) als eigener Knopf.
  // × behaelt die gewaehlten Leisten-Patches, sonst Neuester.
  const loosePatches = isLatest ? null
    : isAll ? t('tft.explorer.x.patch.all')
      : query.patches.filter(p => !inBar(p)).join(', ') || null;
  const dropLoose = () => {
    const keep = isAll ? [] : query.patches.filter(inBar);
    setQuery({ ...query, patches: keep.length ? keep : [LATEST_PATCH] });
  };

  return (
    <>
      <button type="button" className={seg(isLatest)} aria-pressed={isLatest} onClick={() => setQuery({ ...query, patches: [LATEST_PATCH] })}>
        {patchHint(t, isLatest ? resolvedPatch : null)}
      </button>
      {showBar && bar.map(p => {
        const on = !isLatest && !isAll && query.patches.includes(p);
        return (
          <button key={p} type="button" className={seg(on)} aria-pressed={on} onClick={() => togglePatch(p)}>
            {p}
          </button>
        );
      })}
      {loosePatches && (
        <span className={`${seg(true)} inline-flex items-center gap-1.5 pr-1`}>
          {loosePatches}
          <button type="button" onClick={dropLoose}
            aria-label={t('tft.explorer.x.remove')} title={t('tft.explorer.x.remove')}
            className="text-fg-muted hover:text-fg-primary">{'×'}</button>
        </span>
      )}
    </>
  );
}

// Eine Wahl: onPick schliesst das Fenster.
export function RegionOptions({ query, setQuery, meta, onPick }: Scope & { meta: ExplorerMeta | null; onPick: () => void }) {
  const { t } = useI18n();
  const regions = (meta?.regions ?? []).map(r => r.region);
  // Region aus einem Link, die gerade nicht im Speicher liegt, bleibt waehlbar sichtbar.
  if (query.region !== 'all' && !regions.includes(query.region)) regions.push(query.region);
  const pick = (region: string) => { setQuery({ ...query, region }); onPick(); };
  return (
    <>
      <button type="button" className={seg(query.region === 'all')} aria-pressed={query.region === 'all'} onClick={() => pick('all')}>
        {t('tft.filter.allRegions')}
      </button>
      {regions.map(r => (
        <button key={r} type="button" className={seg(query.region === r)} aria-pressed={query.region === r} onClick={() => pick(r)}>
          {regionShortLabel(r)}
        </button>
      ))}
    </>
  );
}

export function RankOptions({ query, setQuery, onPick }: Scope & { onPick: () => void }) {
  const { t } = useI18n();
  const stage = rankStageOf(query.ranks);
  const pick = (ranks: ExplorerRank[]) => { setQuery({ ...query, ranks }); onPick(); };
  return (
    <>
      <button type="button" className={seg(stage === 'all')} aria-pressed={stage === 'all'} onClick={() => pick([])}>
        {t('tft.filter.allRanks')}
      </button>
      {EXPLORER_RANK_STAGES.map(s => (
        <button key={s} type="button" className={seg(stage === s)} aria-pressed={stage === s} onClick={() => pick(stageRanks(s))}>
          {t(STAGE_LABEL[s])}
        </button>
      ))}
    </>
  );
}
