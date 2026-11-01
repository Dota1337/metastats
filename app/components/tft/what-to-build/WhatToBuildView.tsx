'use client';
// Seite „What to build" (Plan 01.11.2026): Suchleiste, Filter und bis zu 6 Boxen
// nebeneinander. Logik in app/lib/tft-what-to-build.ts, Abfragen in useBuildExplorer.
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useI18n, type TranslationKey } from '../../../lib/i18n';
import { loadTftAssets, type TftAssetsBundle } from '../../../lib/tft-cdragon';
import { loadItemTexts, type ItemTexts } from '../../../lib/tft-item-texts';
import { loadUnitInfo, type UnitInfoFile } from '../../../lib/tft-unit-info';
import { itemBucketOf } from '../../../lib/tft-item-bucket';
import { costColor } from '../../../lib/tft-ui';
import {
  EXPLORER_RANK_STAGES, LATEST_PATCH, barPatches, rankStageOf, stageRanks,
  type ExplorerMeta, type ExplorerRankStage,
} from '../../../lib/tft-explorer-query';
import {
  MAX_BOXES, applyQuestion, boxFromQuestion, buildQuestionDict, effectiveStar, emptyBox, itemsQuery, parseBuildParams,
  parseBuildQuestion, rowsAreDisjoint, serializeBuildParams, splitQueries, starsQuery, targetStarOf, traitFilterFor,
  type BuildBox, type BuildScope, type ParsedQuestion,
} from '../../../lib/tft-what-to-build';
import { regionShortLabel } from '../StatsFilterBar';
import { OptIcon } from '../explorer/ExplorerSearchBox';
import { browseUnits } from '../explorer/explorer-search';
import { buildExplorerOptions } from '../explorer/explorer-options';
import { queryKey, useBuildExplorer, type QueryResults } from './useBuildExplorer';
import BuildBoxCard from './BuildBoxCard';

const STAGE_LABEL: Record<ExplorerRankStage, TranslationKey> = {
  challenger: 'tft.bucket.challenger',
  grandmaster_plus: 'tft.filter.grandmasterPlus',
  master_plus: 'tft.filter.masterPlus',
  diamond_plus: 'tft.filter.diamondPlus',
  emerald_plus: 'tft.filter.emeraldPlus',
};
const selectCls = 'bg-surface-raised rounded px-2.5 py-1.5 text-xs text-fg-primary border border-border-subtle focus:outline-none focus:border-accent-a60';

export default function WhatToBuildView() {
  const { t, lang } = useI18n();
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [{ boxes: rawBoxes, scope }, setState] = useState(() => parseBuildParams(params));
  const setBoxes = (fn: (b: BuildBox[]) => BuildBox[]) => setState(s => ({ ...s, boxes: fn(s.boxes) }));
  const setScope = (next: BuildScope) => setState(s => ({ ...s, scope: next }));

  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  useEffect(() => {
    let alive = true;
    loadTftAssets().then(a => { if (alive) setAssets(a); });
    return () => { alive = false; };
  }, []);
  const options = useMemo(() => buildExplorerOptions(assets), [assets]);
  const kindOf = useMemo(() => (id: string) => itemBucketOf(id, assets), [assets]);

  // Unbekannte Unit in der Adresse (alter Link, anderes Set): keine leere Box.
  const ready = options.units.length > 0;
  const boxes = useMemo(() => (ready ? rawBoxes.filter(x => options.unitById.has(x.unit)) : rawBoxes), [ready, rawBoxes, options]);

  // Adresse folgt der Auswahl; sie ist der teilbare Link.
  const qs = serializeBuildParams(boxes, scope);
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    // Nur die Auswahl loest das aus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs]);

  // Abfragen je Box in Anzeige-Reihenfolge: erst Sterne (fuer den Standard-Stern),
  // dann Items, dann die getrennten Seiten eines Vergleichs.
  const [results, setResults] = useState<QueryResults>({});
  const plans = useMemo(() => boxes.map(b => {
    const trait = b.trait ? traitFilterFor(b.trait, options.traitById.get(b.trait)?.mins ?? []) : null;
    const stars = b.star === 'auto' ? starsQuery(b.unit, scope) : null;
    // Standard-Stern aus der Stern-Abfrage; bei Fehler alle Sterne. Vor den Assets
    // keine Items-Abfrage: ohne Trait-Stufen waere es die falsche.
    const starsDone = stars ? results[queryKey(stars)] : null;
    const known = ready && (!stars || !!starsDone);
    const star = known ? effectiveStar(b, starsDone?.data ? targetStarOf(starsDone.data.rows, b.unit) : null) : null;
    const items = known ? itemsQuery(b, scope, star, trait) : null;
    const split = known && b.compare.length === 2 && !rowsAreDisjoint(b)
      ? splitQueries(b, scope, star, trait, b.compare[0], b.compare[1]) : null;
    return { box: b, starsQ: stars, star, known, items, split };
  }), [boxes, scope, options, results, ready]);

  const wanted = useMemo(() => plans.flatMap(p => [
    ...(p.starsQ ? [p.starsQ] : []),
    ...(p.items ? [p.items] : []),
    ...(p.split ?? []),
  ]), [plans]);
  const { get, retry } = useBuildExplorer(wanted, results, setResults);

  // Filterwerte aus der letzten Antwort.
  const meta = useMemo(() => {
    let m: ExplorerMeta | null = null;
    for (const r of Object.values(results)) if (r.data?.meta) m = r.data.meta;
    return m as ExplorerMeta | null;
  }, [results]);

  // ── Suchleiste ──
  const [text, setText] = useState('');
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<ParsedQuestion | null>(null);
  const [names, setNames] = useState<{ texts: ItemTexts | null; info: UnitInfoFile | null } | null>(null);
  // Namen je Sprache erst beim ersten Fokus laden (~80 KB).
  const loadNames = () => {
    if (names) return;
    Promise.all([loadItemTexts(), loadUnitInfo()]).then(([texts, info]) => setNames({ texts, info }));
  };
  const dict = useMemo(() => buildQuestionDict(options, {
    itemNames: id => {
      const out: Record<string, string> = {};
      for (const [l, v] of Object.entries(names?.texts?.items[id]?.i18n ?? {})) {
        const n = (v as { name?: string } | undefined)?.name;
        if (n) out[l] = n;
      }
      return out;
    },
    unitNames: id => names?.info?.units[id]?.name,
  }), [options, names]);
  const parsed = useMemo(() => (text.trim() ? parseBuildQuestion(text, dict, lang, choices) : null), [text, dict, lang, choices]);
  const hasAny = !!parsed && (parsed.units.length + parsed.fixed.length + parsed.compare.length + parsed.ambiguous.length > 0);
  const submit = () => {
    if (!parsed || parsed.ambiguous.length) return;
    if (!parsed.units.length) {
      if (parsed.fixed.length || parsed.compare.length) setPending(parsed);
      return;
    }
    setBoxes(b => applyQuestion(b, parsed, kindOf));
    setPending(null);
    setText('');
    setChoices({});
  };
  const addUnit = (unit: string) => {
    const box = pending ? boxFromQuestion(unit, pending, kindOf) : emptyBox(unit);
    setBoxes(b => [...b, box]);
    if (pending) { setPending(null); setText(''); setChoices({}); }
  };

  const itemIcon = (id: string, cls = 'w-5 h-5') => <OptIcon src={options.itemById.get(id)?.img ?? null} alt={options.itemById.get(id)?.name ?? id} className={cls} />;
  const itemLabel = (id: string) => options.itemById.get(id)?.name ?? id;

  const unitRows = useMemo(() => browseUnits(options.units), [options.units]);
  const taken = useMemo(() => new Set(boxes.map(b => b.unit)), [boxes]);
  const stage = rankStageOf(scope.ranks);
  const patches = meta ? barPatches(meta.patches.map(p => p.patch)) : [];
  const resolvedPatch = meta?.patches[0]?.patch ?? null;
  const patchValue = scope.patches[0] ?? LATEST_PATCH;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-fg-bright text-xl font-medium">{t('tft.build.title')}</h1>

      <div className="flex flex-col gap-2 max-w-3xl">
        <div className="flex items-center gap-2 rounded-md border border-border-subtle focus-within:border-accent-a50 bg-surface-base pl-2.5 pr-1">
          <svg aria-hidden="true" viewBox="0 0 20 20" className="w-4 h-4 text-fg-muted shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="8.5" cy="8.5" r="5.5" /><path d="M13 13l4 4" strokeLinecap="round" />
          </svg>
          <input
            value={text}
            onChange={e => { setText(e.target.value); setPending(null); }}
            onFocus={loadNames}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
            placeholder={t('tft.build.placeholder')}
            aria-label={t('tft.build.placeholder')}
            style={{ outline: 'none' }}
            className="flex-1 min-w-0 bg-transparent py-2 text-sm text-fg-primary placeholder:text-fg-faint"
          />
          {hasAny && (
            <button type="button" onClick={submit} disabled={!!parsed?.ambiguous.length}
              className="shrink-0 px-2.5 py-1 rounded text-xs border border-accent-a50 bg-accent-a15 text-fg-bright hover:bg-accent-a25 disabled:opacity-40 disabled:cursor-not-allowed">
              {t('tft.explorer.x.apply')} ↵
            </button>
          )}
        </div>

        {parsed && !hasAny && (
          <div className="text-[11px] text-pos-loss-text">{t('tft.explorer.x.notFound')}</div>
        )}
        {parsed && hasAny && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {parsed.units.map(id => (
              <span key={id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border-subtle text-fg-primary">
                <OptIcon src={options.unitById.get(id)?.img ?? null} alt={options.unitById.get(id)?.name ?? id} className="w-5 h-5" border={costColor(options.unitById.get(id)?.cost ?? 1)} />
                {options.unitById.get(id)?.name ?? id}
              </span>
            ))}
            {parsed.fixed.map((id, i) => (
              <span key={`${id}-${i}`} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-accent-a40 bg-accent-a8 text-fg-primary">
                {itemIcon(id)}{itemLabel(id)}
              </span>
            ))}
            {parsed.compare.map((id, i) => (
              <span key={id} className="inline-flex items-center gap-1">
                {i > 0 && <span className="text-fg-muted">{t('tft.explorer.x.or')}</span>}
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border-default text-fg-primary">{itemIcon(id)}{itemLabel(id)}</span>
              </span>
            ))}
            {parsed.ambiguous.map(a => (
              <span key={a.term} className="inline-flex flex-wrap items-center gap-1">
                <span className="text-fg-muted">{a.term}:</span>
                {a.ids.map(id => (
                  <button key={id} type="button" onClick={() => setChoices(c => ({ ...c, [a.term]: id }))}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-accent-a50 text-fg-bright hover:bg-accent-a15">
                    {itemIcon(id)}{itemLabel(id)}
                  </button>
                ))}
              </span>
            ))}
          </div>
        )}
      </div>

      {boxes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label={t('tft.filter.patch')} className={selectCls} value={patchValue}
            onChange={e => setScope({ ...scope, patches: [e.target.value] })}>
            <option value={LATEST_PATCH}>{t('tft.explorer.x.patch.latest')}{resolvedPatch ? ` · ${resolvedPatch}` : ''}</option>
            {patches.filter(p => p !== resolvedPatch).map(p => <option key={p} value={p}>{p}</option>)}
            {patchValue !== LATEST_PATCH && !patches.includes(patchValue) && <option value={patchValue}>{patchValue}</option>}
          </select>
          <select aria-label={t('tft.filter.allRegions')} className={selectCls} value={scope.region}
            onChange={e => setScope({ ...scope, region: e.target.value })}>
            <option value="all">{t('tft.filter.allRegions')}</option>
            {(meta?.regions ?? []).map(r => <option key={r.region} value={r.region}>{regionShortLabel(r.region)}</option>)}
            {scope.region !== 'all' && !(meta?.regions ?? []).some(r => r.region === scope.region) && <option value={scope.region}>{regionShortLabel(scope.region)}</option>}
          </select>
          <select aria-label={t('tft.filter.allRanks')} className={selectCls} value={stage ?? 'master_plus'}
            onChange={e => setScope({ ...scope, ranks: e.target.value === 'all' ? [] : stageRanks(e.target.value as ExplorerRankStage) })}>
            <option value="all">{t('tft.filter.allRanks')}</option>
            {EXPLORER_RANK_STAGES.map(s => <option key={s} value={s}>{t(STAGE_LABEL[s])}</option>)}
          </select>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 items-start">
        {plans.map(p => (
          <BuildBoxCard
            key={p.box.unit}
            box={p.box}
            options={options}
            assets={assets}
            kindOf={kindOf}
            star={p.star}
            starReady={p.known}
            items={get(p.items)}
            split={p.split ? [get(p.split[0]), get(p.split[1])] : null}
            onChange={fn => setBoxes(all => all.map(b => (b.unit === p.box.unit ? fn(b) : b)))}
            onRemove={() => setBoxes(all => all.filter(b => b.unit !== p.box.unit))}
            onRetry={() => retry([p.starsQ, p.items, ...(p.split ?? [])].filter((q): q is NonNullable<typeof q> => !!q))}
          />
        ))}
        {boxes.length < MAX_BOXES && (
          <PlusBox unitRows={unitRows} taken={taken} highlight={!!pending} onPick={addUnit} />
        )}
      </div>
    </div>
  );
}

function PlusBox({ unitRows, taken, highlight, onPick }: {
  unitRows: ReturnType<typeof browseUnits>;
  taken: Set<string>;
  highlight: boolean;
  onPick: (unit: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={box} onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}
      className={`rounded-xl border border-dashed bg-surface-base min-h-[16rem] ${highlight ? 'border-accent ring-2 ring-accent-a50' : 'border-border-default'} ${open ? 'p-2' : 'flex items-center justify-center'}`}>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} aria-label={t('tft.build.addUnit')} title={t('tft.build.addUnit')}
          className={`w-14 h-14 rounded-full border-2 flex items-center justify-center text-fg-secondary hover:text-fg-bright hover:border-accent-a60 ${highlight ? 'border-accent text-fg-bright animate-pulse' : 'border-border-default'}`}>
          <svg aria-hidden="true" viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>
        </button>
      ) : (
        <div className="max-h-[26rem] overflow-y-auto p-1 space-y-1.5">
          {unitRows.map((row, ri) => (
            <div key={ri} className="grid grid-cols-[repeat(auto-fill,2.25rem)] gap-1">
              {row.map(u => {
                const off = taken.has(u.id);
                return (
                  <button key={u.id} type="button" disabled={off} aria-label={u.name} title={u.name}
                    autoFocus={ri === 0 && u === row[0]}
                    onClick={() => { setOpen(false); onPick(u.id); }}
                    className={`w-9 h-9 rounded ${off ? 'opacity-30 cursor-not-allowed' : 'hover:ring-2 hover:ring-accent-a60'}`}>
                    <OptIcon src={u.img} alt={u.name} className="w-9 h-9" border={costColor(u.cost)} />
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
