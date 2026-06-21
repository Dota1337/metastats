'use client';
import { useMemo } from 'react';
import type { TftAssetsBundle } from '../../lib/tft-cdragon';
import { tftIconUrl, tftTraitDescription } from '../../lib/tft-cdragon';
import { useI18n } from '../../lib/i18n';
import {
  computeActiveTraits,
  activeTraitStyleColor,
  type ActiveTrait,
} from '../../lib/tft-active-traits';

// CompActiveTraits — rendert die aktiven Synergien aus comp.typicalUnits
// gegen das Bundle gematcht. Eine Pill pro aktivem Trait mit Icon + Name +
// Count und Style-Color-Akzent (Bronze/Silver/Gold/Prismatic/Chromatic).
// Sortierung: höchster Style zuerst, dann Count desc.

interface TypicalUnit {
  characterId: string;
  count?: number | unknown;
  multiplicity?: number;
}

export default function CompActiveTraits({
  typicalUnits,
  clusterKey,
  assets,
}: {
  typicalUnits: TypicalUnit[] | undefined | null;
  clusterKey: string;
  assets: TftAssetsBundle | null;
}) {
  const { t } = useI18n();
  const traits = useMemo(
    () => computeActiveTraits(typicalUnits, clusterKey, assets),
    [typicalUnits, clusterKey, assets],
  );

  if (traits.length === 0) return null;

  return (
    <section className="mt-5 bg-[#0d1526] border border-[#1e2a3a] rounded p-4">
      <h2 className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">
        {t('tft.comp.activeTraits')}
      </h2>
      <div className="flex flex-wrap gap-2">
        {traits.map(tr => (
          <TraitPill key={tr.apiName} trait={tr} assets={assets} t={t} />
        ))}
      </div>
    </section>
  );
}

function TraitPill({
  trait, assets, t,
}: {
  trait: ActiveTrait;
  assets: TftAssetsBundle | null;
  t: (k: any) => string;
}) {
  const color = activeTraitStyleColor(trait.style);
  const iconUrl = trait.icon ? tftIconUrl(assets, trait.icon) : null;
  const tooltip = tftTraitDescription(assets, trait.apiName) || trait.displayName;
  const nextHint = trait.nextStyleMinUnits != null
    ? (t('tft.comp.activeTraits.nextHint') as string)
        .replace('{n}', String(trait.nextStyleMinUnits - trait.count))
    : null;
  return (
    <div
      className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border bg-[#141c2e]"
      style={{ borderColor: `${color}66` }}
      title={tooltip}
    >
      {iconUrl ? (
        <img
          src={iconUrl}
          alt={trait.displayName}
          className="w-5 h-5"
          style={{
            // Riot-Trait-Icons sind oft weiß auf transparent — färben gegen
            // die Style-Color-Border, damit die Pill visuell zusammenhängt.
            filter: `drop-shadow(0 0 2px ${color})`,
          }}
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
        <span className="text-[#7a8aa0] text-[10px] tabular-nums">{nextHint}</span>
      )}
    </div>
  );
}
