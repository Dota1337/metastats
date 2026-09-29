'use client';
// Neue Bloecke der Comp-Detailseite aus get_tft_comp_outcome (Migration 0078):
// Platzverteilung, Items je Unit mit Stufe und 3er-Kombis, Unit-Wirkung,
// Endlevel. Rechnung in app/lib/tft-comp-outcome.ts — hier nur Anzeige.
// Wirkung = Ø Platz mit − Ø Platz ohne; negativ ist gut.
import { useState } from 'react';
import { tftChampionTileUrl, findChampion, type TftAssetsBundle } from '../../lib/tft-cdragon';
import type { TranslationKey } from '../../lib/i18n';
import { costColor } from '../../lib/tft-ui';
import TftItemIcon from './TftItemIcon';
import type {
  CompOutcome, Effect, ItemGrade, ItemGroup, ItemOutcome, UnitOutcome,
} from '../../lib/tft-comp-outcome';

type T = (k: TranslationKey) => string;

const GOOD = '#3ecf8e';
const BAD = '#e44040';
const GOLD = '#e0c75a';
const WARN = '#e0a040';

const GROUP_ORDER: ItemGroup[] = ['standard', 'artifact', 'radiant', 'emblem', 'tactician'];
const MAX_ITEMS: Record<ItemGroup, number> = { standard: 12, artifact: 6, radiant: 6, emblem: 6, tactician: 3 };
const MAX_UNIT_TABS = 8;
const MAX_COMBOS = 5;

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

function unitName(assets: TftAssetsBundle | null, cid: string) {
  return findChampion(assets, cid)?.name || cid.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '');
}

function LowData({ t }: { t: T }) {
  return (
    <span
      className="text-[8px] uppercase tracking-wider px-1 py-[1px] rounded whitespace-nowrap"
      style={{ color: WARN, backgroundColor: 'rgba(224,160,64,0.12)', border: '1px solid rgba(224,160,64,0.35)' }}
    >
      {t('tft.comp.outcome.lowData')}
    </span>
  );
}

function EffectCell({ effect }: { effect: Effect | null }) {
  if (!effect) return <span className="text-fg-muted">—</span>;
  const sure = effect.delta + effect.ci < 0 ? GOOD : effect.delta - effect.ci > 0 ? BAD : null;
  const sign = effect.delta > 0 ? '+' : effect.delta < 0 ? '−' : '±';
  return (
    <span className="whitespace-nowrap">
      <span className="font-medium" style={{ color: sure ?? 'var(--fg-primary, #fff)' }}>
        {sign}{Math.abs(effect.delta).toFixed(2)}
      </span>
      <span className="hidden sm:inline text-fg-muted text-[10px]"> ±{effect.ci.toFixed(2)}</span>
    </span>
  );
}

function GradeChip({ grade, t }: { grade: ItemGrade; t: T }) {
  if (!grade) return <span className="text-fg-muted">—</span>;
  const color = grade === 'core' ? GOLD : grade === 'strong' ? GOOD : grade === 'weak' ? BAD : '#9aa6b2';
  return (
    <span
      className="text-[10px] font-medium px-1.5 py-[1px] rounded whitespace-nowrap"
      style={{ color, backgroundColor: `${color}1f`, border: `1px solid ${color}59` }}
    >
      {t(`tft.comp.outcome.grade.${grade}` as TranslationKey)}
    </span>
  );
}

function UnitTile({ cid, assets, size = 'w-10 h-10' }: { cid: string; assets: TftAssetsBundle | null; size?: string }) {
  const ch = findChampion(assets, cid);
  const url = tftChampionTileUrl(assets, ch);
  return (
    <span
      className={`${size} rounded-md border-2 overflow-hidden block flex-shrink-0 bg-surface-overlay`}
      style={{ borderColor: costColor(ch?.cost ?? 1) }}
      title={ch?.name || cid}
    >
      {url && <img src={url} alt={ch?.name || ''} className="w-full h-full object-cover" />}
    </span>
  );
}

/** Platz 1-8 als Saeulen; Top 4 gruen, Rest grau. */
export function OutcomePlacement({ outcome, t }: { outcome: CompOutcome; t: T }) {
  const max = Math.max(...outcome.placementShare, 0);
  if (max <= 0) return null;
  return (
    <section className="mt-5 bg-surface-base border border-border-subtle rounded p-4">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-fg-secondary text-xs uppercase tracking-widest">{t('tft.comp.outcome.placement')}</h2>
        {outcome.lowData && <LowData t={t} />}
        <span className="ml-auto text-fg-muted text-xs tabular-nums">{outcome.games} {t('tft.gamesShort')}</span>
      </div>
      <div className="grid grid-cols-8 gap-1.5 sm:gap-2 items-end h-28">
        {outcome.placementShare.map((v, i) => (
          <div key={i} className="flex flex-col items-center justify-end h-full" title={`${i + 1}: ${(v * 100).toFixed(1)}%`}>
            <span className="text-[10px] text-fg-secondary tabular-nums mb-1">{pct(v)}</span>
            <div
              className="w-full rounded-t"
              style={{ height: `${Math.max(2, (v / max) * 100)}%`, backgroundColor: i < 4 ? GOOD : '#6b7785', opacity: i < 4 ? 0.85 : 0.6 }}
            />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-8 gap-1.5 sm:gap-2 mt-1">
        {outcome.placementShare.map((_, i) => (
          <span key={i} className="text-center text-[11px] text-fg-muted tabular-nums">{i + 1}</span>
        ))}
      </div>
    </section>
  );
}

function ItemRow({ it, assets, bucket, t }: { it: ItemOutcome; assets: TftAssetsBundle | null; bucket: string; t: T }) {
  const name = assets?.items[it.item]?.name || it.item.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?(?:Item_)?/, '');
  return (
    <tr className="border-t border-border-subtle">
      <td className="py-1.5 pr-1 sm:pr-2">
        <a href={`/tft/items/${encodeURIComponent(it.item)}?bucket=${bucket}`} title={name} aria-label={name} className="flex items-center gap-1.5 sm:gap-2 hover:text-accent min-w-0">
          <TftItemIcon apiName={it.item} assets={assets} className="w-7 h-7 flex-shrink-0" />
          <span className="hidden sm:inline text-white truncate sm:max-w-[14rem]">{name}</span>
          {it.perCopy >= 1.5 && <span className="text-fg-muted text-[10px] tabular-nums">×{it.perCopy.toFixed(1)}</span>}
          {it.lowData && <LowData t={t} />}
        </a>
      </td>
      <td className="py-1.5 px-1 sm:px-2 text-right tabular-nums text-fg-secondary">{pct(it.share)}</td>
      <td className="py-1.5 px-1 sm:px-2 text-right tabular-nums text-white">{it.avgPlacement.toFixed(2)}</td>
      <td className="py-1.5 px-1 sm:px-2 text-right tabular-nums text-fg-secondary hidden sm:table-cell">{pct(it.top4Rate)}</td>
      <td className="py-1.5 px-1 sm:px-2 text-right tabular-nums"><EffectCell effect={it.effect} /></td>
      <td className="py-1.5 pl-1 sm:pl-2 text-right"><GradeChip grade={it.grade} t={t} /></td>
    </tr>
  );
}

/** Items je Unit: Unit waehlen, darunter Items nach Gruppe und die haeufigsten 3er-Kombis. */
export function OutcomeItems({ outcome, assets, bucket, t }: {
  outcome: CompOutcome; assets: TftAssetsBundle | null; bucket: string; t: T;
}) {
  const units = outcome.units
    .filter(u => u.itemCopies > 0 && u.items.length > 0)
    .sort((a, b) => b.itemCopies - a.itemCopies)
    .slice(0, MAX_UNIT_TABS);
  const [selected, setSelected] = useState<string | null>(null);
  if (units.length === 0) return null;
  const unit: UnitOutcome = units.find(u => u.characterId === selected) ?? units[0];

  return (
    <section className="mt-5 bg-surface-base border border-border-subtle rounded p-4">
      <h2 className="text-fg-secondary text-xs uppercase tracking-widest mb-3">{t('tft.comp.outcome.items')}</h2>
      <div className="flex flex-wrap gap-1.5 mb-3" role="tablist">
        {units.map(u => {
          const active = u.characterId === unit.characterId;
          return (
            <button
              key={u.characterId}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSelected(u.characterId)}
              className={`flex items-center gap-1.5 pl-1 pr-2 py-1 rounded border text-xs transition-colors ${active ? 'border-accent bg-surface-raised text-white' : 'border-border-subtle text-fg-secondary hover:text-white'}`}
            >
              <UnitTile cid={u.characterId} assets={assets} size="w-7 h-7" />
              <span className="hidden sm:inline">{unitName(assets, u.characterId)}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2 text-xs tabular-nums">
        <span className="text-white font-medium">{unitName(assets, unit.characterId)}</span>
        <span className="text-fg-muted">{unit.games} {t('tft.gamesShort')}</span>
        <span><span className="text-fg-muted">{t('tft.avgPlacement')} </span><span className="text-white">{unit.avgPlacement.toFixed(2)}</span></span>
        {unit.lowData && <LowData t={t} />}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-fg-muted text-[10px] uppercase tracking-widest">
              <th className="text-left font-normal pb-1 pr-1 sm:pr-2">{t('tft.comp.outcome.item')}</th>
              <th className="text-right font-normal pb-1 px-1 sm:px-2">{t('tft.comp.outcome.share')}</th>
              <th className="text-right font-normal pb-1 px-1 sm:px-2"><span className="sm:hidden">{t('tft.comp.outcome.avgShort')}</span><span className="hidden sm:inline">{t('tft.avgPlacement')}</span></th>
              <th className="text-right font-normal pb-1 px-1 sm:px-2 hidden sm:table-cell">{t('tft.top4')}</th>
              <th className="text-right font-normal pb-1 px-1 sm:px-2">{t('tft.comp.outcome.effect')}</th>
              <th className="text-right font-normal pb-1 pl-1 sm:pl-2">{t('tft.comp.outcome.grade')}</th>
            </tr>
          </thead>
          {GROUP_ORDER.map(g => {
            const rows = unit.items.filter(i => i.group === g).slice(0, MAX_ITEMS[g]);
            if (rows.length === 0) return null;
            return (
              <tbody key={g}>
                {g !== 'standard' && (
                  <tr>
                    <td colSpan={6} className="pt-3 pb-1 text-fg-muted text-[10px] uppercase tracking-widest">
                      {t(`tft.comp.outcome.group.${g}` as TranslationKey)}
                    </td>
                  </tr>
                )}
                {rows.map(it => <ItemRow key={it.item} it={it} assets={assets} bucket={bucket} t={t} />)}
              </tbody>
            );
          })}
        </table>
      </div>

      {unit.sets.length > 0 && (
        <div className="mt-4">
          <div className="text-fg-muted text-[10px] uppercase tracking-widest mb-2">{t('tft.comp.outcome.combos')}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {unit.sets.slice(0, MAX_COMBOS).map(s => (
              <div key={s.items.join('|')} className="flex items-center gap-2 bg-surface-raised border border-border-subtle rounded p-2">
                <div className="flex gap-1">
                  {s.items.map((it, j) => <TftItemIcon key={j} apiName={it} assets={assets} className="w-7 h-7" />)}
                </div>
                <div className="ml-auto text-right text-[11px] tabular-nums leading-tight">
                  <div className="text-white">{s.avgPlacement.toFixed(2)}</div>
                  <div className="text-fg-muted">{pct(s.share)} · {s.copies}</div>
                </div>
                {s.copies < 200 && <LowData t={t} />}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/** Unit-Wirkung: nur Units, fuer die es eine Ohne-Seite gibt; beste zuerst. */
export function OutcomeUnitEffect({ outcome, assets, bucket, t }: {
  outcome: CompOutcome; assets: TftAssetsBundle | null; bucket: string; t: T;
}) {
  const rows = outcome.units
    .filter(u => u.effect != null)
    .sort((a, b) => a.effect!.delta - b.effect!.delta);
  if (rows.length === 0) return null;
  return (
    <section className="mt-5 bg-surface-base border border-border-subtle rounded p-4">
      <h2 className="text-fg-secondary text-xs uppercase tracking-widest mb-3">{t('tft.comp.outcome.unitEffect')}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-fg-muted text-[10px] uppercase tracking-widest">
              <th className="text-left font-normal pb-1 pr-2" />
              <th className="text-right font-normal pb-1 px-1 sm:px-2">{t('tft.comp.outcome.presence')}</th>
              <th className="text-right font-normal pb-1 px-1 sm:px-2"><span className="sm:hidden">{t('tft.comp.outcome.avgShort')}</span><span className="hidden sm:inline">{t('tft.avgPlacement')}</span></th>
              <th className="text-right font-normal pb-1 pl-2">{t('tft.comp.outcome.effect')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(u => (
              <tr key={u.characterId} className="border-t border-border-subtle">
                <td className="py-1.5 pr-2">
                  <a href={`/tft/units/${encodeURIComponent(u.characterId)}?bucket=${bucket}`} className="flex items-center gap-2 hover:text-accent">
                    <UnitTile cid={u.characterId} assets={assets} size="w-7 h-7" />
                    <span className="text-white truncate max-w-[9rem] sm:max-w-none">{unitName(assets, u.characterId)}</span>
                    {u.lowData && <LowData t={t} />}
                  </a>
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums text-fg-secondary">{pct(u.presence)}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-white">{u.avgPlacement.toFixed(2)}</td>
                <td className="py-1.5 pl-2 text-right tabular-nums"><EffectCell effect={u.effect} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Endlevel der Boards, die Stage 5 erreicht haben. */
export function OutcomeEndLevel({ outcome, t }: { outcome: CompOutcome; t: T }) {
  const rows = outcome.levelsStage5;
  if (rows.length < 2) return null;
  const best = Math.min(...rows.filter(r => r.games >= 30).map(r => r.avgPlacement));
  return (
    <section className="mt-5 bg-surface-base border border-border-subtle rounded p-4">
      <h2 className="text-fg-secondary text-xs uppercase tracking-widest mb-3">{t('tft.comp.outcome.endLevel')}</h2>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-fg-muted text-[10px] uppercase tracking-widest">
            <th className="text-left font-normal pb-1 pr-2">{t('tft.comp.outcome.level')}</th>
            <th className="text-left font-normal pb-1 px-2 w-1/3">{t('tft.comp.outcome.share')}</th>
            <th className="text-right font-normal pb-1 px-2"><span className="sm:hidden">{t('tft.comp.outcome.avgShort')}</span><span className="hidden sm:inline">{t('tft.avgPlacement')}</span></th>
            <th className="text-right font-normal pb-1 px-2">{t('tft.top4')}</th>
            <th className="text-right font-normal pb-1 pl-2 hidden sm:table-cell">{t('tft.top1')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.level} className="border-t border-border-subtle" style={{ opacity: r.games < 30 ? 0.55 : 1 }}>
              <td className="py-1.5 pr-2 text-white font-medium tabular-nums">{r.level}</td>
              <td className="py-1.5 px-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-surface-overlay rounded overflow-hidden">
                    <div className="h-full bg-accent" style={{ width: `${r.share * 100}%` }} />
                  </div>
                  <span className="text-fg-secondary tabular-nums w-9 text-right">{pct(r.share)}</span>
                </div>
              </td>
              <td className="py-1.5 px-2 text-right tabular-nums font-medium" style={{ color: r.avgPlacement === best ? GOOD : undefined }}>
                <span className={r.avgPlacement === best ? '' : 'text-white'}>{r.avgPlacement.toFixed(2)}</span>
              </td>
              <td className="py-1.5 px-2 text-right tabular-nums text-fg-secondary">{pct(r.top4Rate)}</td>
              <td className="py-1.5 pl-2 text-right tabular-nums text-fg-secondary hidden sm:table-cell">{pct(r.top1Rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
