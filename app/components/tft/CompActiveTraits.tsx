'use client';
import { useMemo, useState } from 'react';
import type { TftAssetsBundle } from '../../lib/tft-cdragon';
import { tftIconUrl, tftChampionTileUrl, findChampion, tftTraitDescription } from '../../lib/tft-cdragon';
import { costColor as costColorOf } from '../../lib/tft-ui';
import { useI18n } from '../../lib/i18n';
import {
  computeActiveTraits,
  activeTraitStyleColor,
  type ActiveTrait,
} from '../../lib/tft-active-traits';

// CompActiveTraits — rendert die aktiven Synergien aus comp.typicalUnits
// gegen das Bundle gematcht. Eine Pill pro aktivem Trait mit Icon + Name +
// Count und Style-Color-Akzent. Click auf eine Pill expandiert eine Sub-
// Strip mit den Units die zur Trait-Aktivierung beitragen (multiplicity-
// aware mit ×2-Badge bei TwoTanky-Stacks).

interface TypicalUnit {
  characterId: string;
  count?: number | unknown;
  multiplicity?: number;
}

export default function CompActiveTraits({
  typicalUnits,
  clusterKey,
  assets,
  bucket,
}: {
  typicalUnits: TypicalUnit[] | undefined | null;
  clusterKey: string;
  assets: TftAssetsBundle | null;
  bucket?: string;
}) {
  const { t } = useI18n();
  const traits = useMemo(
    () => computeActiveTraits(typicalUnits, clusterKey, assets),
    [typicalUnits, clusterKey, assets],
  );
  const [expanded, setExpanded] = useState<string | null>(null);

  if (traits.length === 0) return null;

  return (
    <section className="mt-5 bg-surface-base border border-border-subtle rounded p-4">
      <h2 className="text-fg-secondary text-xs uppercase tracking-widest mb-3">
        {t('tft.comp.activeTraits')}
      </h2>
      <div className="flex flex-wrap gap-2">
        {traits.map(tr => (
          <TraitPill
            key={tr.apiName}
            trait={tr}
            assets={assets}
            t={t}
            isExpanded={expanded === tr.apiName}
            onToggle={() => setExpanded(expanded === tr.apiName ? null : tr.apiName)}
          />
        ))}
      </div>
      {expanded && (() => {
        const tr = traits.find(x => x.apiName === expanded);
        if (!tr) return null;
        return (
          <TraitDrillDown
            trait={tr}
            assets={assets}
            t={t}
            bucket={bucket}
          />
        );
      })()}
    </section>
  );
}

function TraitPill({
  trait, assets, t, isExpanded, onToggle,
}: {
  trait: ActiveTrait;
  assets: TftAssetsBundle | null;
  t: (k: any) => string;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const color = activeTraitStyleColor(trait.style);
  const iconUrl = trait.icon ? tftIconUrl(assets, trait.icon) : null;
  const tooltip = tftTraitDescription(assets, trait.apiName) || trait.displayName;
  const nextHint = trait.nextStyleMinUnits != null
    ? (t('tft.comp.activeTraits.nextHint') as string)
        .replace('{n}', String(trait.nextStyleMinUnits - trait.count))
    : null;
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border bg-surface-raised hover:bg-[#1a2238] transition-colors cursor-pointer"
      style={{
        borderColor: isExpanded ? color : `${color}66`,
        borderWidth: isExpanded ? 2 : 1,
      }}
      title={tooltip}
      aria-expanded={isExpanded}
    >
      {iconUrl ? (
        <img
          src={iconUrl}
          alt={trait.displayName}
          className="w-5 h-5"
          style={{ filter: `drop-shadow(0 0 2px ${color})` }}
        />
      ) : (
        <div className="w-5 h-5 rounded-sm" style={{ backgroundColor: `${color}33` }} />
      )}
      <span
        className="text-[11px] font-bold tabular-nums w-5 text-center"
        style={{ color }}
      >
        {trait.count}
      </span>
      <span className="text-white text-xs font-medium">{trait.displayName}</span>
      {nextHint && (
        <span className="text-fg-muted text-[10px] tabular-nums">{nextHint}</span>
      )}
    </button>
  );
}

// Drill-Down-Panel: zeigt die contributing Units für den ausgewählten Trait.
// Multiplicity-stack rendert als ×2-Badge auf der Unit-Tile. Lina zum
// jeweiligen /tft/units/[id]?bucket=… damit User direkt durchklickt.
function TraitDrillDown({
  trait, assets, t, bucket,
}: {
  trait: ActiveTrait;
  assets: TftAssetsBundle | null;
  t: (k: any) => string;
  bucket?: string;
}) {
  const color = activeTraitStyleColor(trait.style);
  return (
    <div
      className="mt-3 p-3 rounded-md border bg-surface-sunken"
      style={{ borderColor: `${color}40` }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] uppercase tracking-widest font-semibold" style={{ color }}>
          {(t('tft.comp.activeTraits.contributors') as string).replace('{n}', String(trait.contributingUnits.length))}
        </span>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        {trait.contributingUnits.map((u, idx) => {
          const ch = findChampion(assets, u.characterId);
          const url = tftChampionTileUrl(assets, ch);
          const cost = ch?.cost ?? 1;
          const href = bucket
            ? `/tft/units/${encodeURIComponent(u.characterId)}?bucket=${bucket}`
            : `/tft/units/${encodeURIComponent(u.characterId)}`;
          return (
            <a
              key={`${u.characterId}-${idx}`}
              href={href}
              className="flex flex-col items-center gap-1 hover:scale-105 transition-transform"
              title={ch?.name || u.characterId}
            >
              <div className="relative">
                {url ? (
                  <img
                    src={url}
                    alt={ch?.name || u.characterId}
                    className="w-10 h-10 rounded-md border-2 object-cover"
                    style={{ borderColor: costColorOf(cost) }}
                  />
                ) : (
                  <div className="w-10 h-10 rounded-md bg-surface-overlay" />
                )}
                {u.stack >= 2 && (
                  <div
                    className="absolute -top-1 -right-1 bg-[#7B61FF] text-white text-[8px] font-bold rounded-full w-4 h-4 flex items-center justify-center shadow leading-none"
                    title={t('tft.comp.activeTraits.multiplicityStack')}
                  >
                    ×2
                  </div>
                )}
              </div>
              <div className="text-white text-[10px] text-center max-w-[55px] truncate">
                {ch?.name || u.characterId.replace(/^TFT\d+_/, '')}
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
