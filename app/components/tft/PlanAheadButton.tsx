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
  size?: 'sm' | 'md' | 'lg';
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

  // 'lg' ist die Leisten-Groesse auf /tft/comps (32px, gleich hoch wie
  // Compare und Favorit). Nur dort traegt der Button im Ruhezustand die
  // Accent-Kontur — die Copy-Funktion ist dort die wichtigste Aktion der Zeile.
  // 'md' (Kopf der Comp-Detailseite): 36 px, voll lila wie der aktive
  // Rang-Filter, damit man ihn sofort sieht (User 2026-10-10).
  const dims = size === 'lg' ? 'w-8 h-8 text-sm' : size === 'md' ? 'w-9 h-9 text-sm' : 'w-6 h-6 text-[10px]';
  const iconPx = size === 'lg' ? 15 : size === 'md' ? 16 : 12;
  const idleClass = size === 'lg'
    ? 'bg-surface-overlay border-accent-a80 text-series-purple hover:border-accent hover:bg-accent-a15'
    : size === 'md'
    ? 'bg-accent border-accent text-white hover:brightness-110'
    : 'bg-surface-raised border-border-subtle text-fg-secondary hover:border-accent-a60 hover:text-[#c39bff]';
  const tooltip = status === 'copied'
    ? t('tft.planAhead.copied')
    : status === 'failed'
    ? t('tft.planAhead.failed')
    : t('tft.planAhead.copy');

  // Bei copied: kurzes grünes Checkmark; bei failed rotes ×; sonst das
  // uebliche Kopier-Zeichen (zwei versetzte Blaetter) — User 2026-10-10:
  // „Copy Team" mit einem Zeichen, das sofort als Kopieren erkennbar ist.
  return (
    <button
      type="button"
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); } }}
      title={tooltip}
      aria-label={tooltip}
      className={`${dims} flex items-center justify-center rounded-md border transition-colors ${
        status === 'copied'
          ? 'bg-[#3ecf8e]/15 border-[#3ecf8e]/50 text-[#3ecf8e]'
          : status === 'failed'
          ? 'bg-[#e44040]/15 border-[#e44040]/50 text-[#e44040]'
          : idleClass
      } ${className}`}
    >
      {status === 'copied' ? '✓' : status === 'failed' ? '✕' : (
        <svg width={iconPx} height={iconPx} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}
