'use client';
import { useState, useCallback } from 'react';
import type { TftAssetsBundle } from '../../lib/tft-cdragon';
import { buildPlanAheadCode } from '../../lib/tft-plan-ahead-code';
import { useI18n } from '../../lib/i18n';

// In-Game Team Planner Code → Clipboard. Reusable across Comp-Liste, CompCard,
// /tft/comps/[slug] und /tft/builder. Setzt für 1.5s einen "Kopiert!"-Status.
// Bewusst minimal — kein Modal, kein Erklär-Text (Memory: keine Info-Texte
// ohne Anfrage). Der Code landet direkt im Clipboard, der User pastet ihn
// in den Riot-Client.
export default function PlanAheadButton({
  characterIds,
  setNumber,
  assets,
  size = 'sm',
  className = '',
}: {
  characterIds: string[];
  setNumber: number;
  assets: TftAssetsBundle | null;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  const onClick = useCallback(async (e: React.MouseEvent) => {
    // Wenn der Button in einer klickbaren Card sitzt, soll der Card-Klick
    // nicht zur Detail-Page springen.
    e.preventDefault();
    e.stopPropagation();
    const result = buildPlanAheadCode(characterIds, setNumber, assets);
    if (!result || !result.code) {
      setStatus('failed');
      setTimeout(() => setStatus('idle'), 1500);
      return;
    }
    try {
      await navigator.clipboard.writeText(result.code);
      setStatus('copied');
      setTimeout(() => setStatus('idle'), 1500);
    } catch {
      setStatus('failed');
      setTimeout(() => setStatus('idle'), 1500);
    }
  }, [characterIds, setNumber, assets]);

  const dims = size === 'md' ? 'w-7 h-7 text-xs' : 'w-6 h-6 text-[10px]';
  const tooltip = status === 'copied'
    ? t('tft.planAhead.copied')
    : status === 'failed'
    ? t('tft.planAhead.failed')
    : t('tft.planAhead.copy');

  // Bei copied: kurzes grünes Checkmark; bei failed rotes ×; sonst Listen-Icon
  // (drei stacked bars wie ein in-game team-planner cheatsheet aussieht).
  return (
    <button
      type="button"
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); } }}
      title={tooltip}
      aria-label={tooltip}
      className={`${dims} flex items-center justify-center rounded border transition-colors ${
        status === 'copied'
          ? 'bg-[#3ecf8e]/15 border-[#3ecf8e]/50 text-[#3ecf8e]'
          : status === 'failed'
          ? 'bg-[#e44040]/15 border-[#e44040]/50 text-[#e44040]'
          : 'bg-surface-raised border-border-subtle text-fg-secondary hover:border-accent-a60 hover:text-[#c39bff]'
      } ${className}`}
    >
      {status === 'copied' ? '✓' : status === 'failed' ? '✕' : (
        // Cheatsheet-Icon: drei horizontale Linien wie der TFT-Sidebar-Plan
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <line x1="2" y1="3" x2="10" y2="3" />
          <line x1="2" y1="6" x2="10" y2="6" />
          <line x1="2" y1="9" x2="7" y2="9" />
        </svg>
      )}
    </button>
  );
}
