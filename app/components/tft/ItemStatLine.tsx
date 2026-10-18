'use client';
// Werte-Zeile eines Items: "55% AD · 10% Schadensverstaerkung". Gemeinsam fuer
// Comp-Builder (Infokarte, Unit-Panel) und Item-Detailseite.
import { useI18n, type TranslationKey } from '../../lib/i18n';
import type { ItemStat } from '../../lib/tft-item-texts';

export default function ItemStatLine({ stats, className = '' }: { stats: ItemStat[]; className?: string }) {
  const { t } = useI18n();
  // Bezeichnung aus tft.stat.<Symbol>; unbekanntes Symbol → Schluessel ohne "scale".
  const label = (key: string): string => {
    const k = `tft.stat.${key}`;
    const v = t(k as TranslationKey);
    return v && v !== k ? v : key.replace(/^scale/, '');
  };
  return (
    <div className={`flex flex-wrap gap-x-2 gap-y-0.5 text-fg-secondary ${className}`}>
      {stats.map((s, i) => (
        <span key={i}>
          <span className="text-white tabular-nums">{s.value}</span> {label(s.key)}
        </span>
      ))}
    </div>
  );
}
