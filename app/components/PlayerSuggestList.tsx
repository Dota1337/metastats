'use client';
// Vorschlagsliste zu usePlayerSuggest. Zeilen wie das Spieler-Dropdown der
// Kopfleiste (Nav.tsx). Per Portal am Feld statt im Formular: der Kopf der
// LoL-Startseite schneidet Ueberstehendes ab (overflow-hidden, HomeClient.tsx)
// und wird animiert. Die Lage wird nur bei offener Liste nachgefuehrt, hoechstens
// einmal je Bild und direkt am Element, ohne neues Zeichnen durch React.
import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../lib/i18n';
import { tftRankLabel, tftRegionLabel } from '../lib/tft-player-search';
import type { PlayerSuggest } from '../lib/usePlayerSuggest';

const GAP = 4;
const EDGE = 8;
const MIN_W = 260; // wie die Liste der Kopfleiste
const MAX_H = 480; // 10 Treffer ohne Scrollen

export default function PlayerSuggestList({ s, game }: { s: PlayerSuggest; game: 'lol' | 'tft' }) {
  const { t } = useI18n();
  const boxRef = useRef<HTMLDivElement>(null);
  const { open, anchor, hits } = s;

  useLayoutEffect(() => {
    if (!open) return;
    let raf = 0;
    const place = () => {
      raf = 0;
      const el = anchor.current;
      const box = boxRef.current;
      if (!el || !box) return;
      const r = el.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vv = window.visualViewport;
      const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      const w = Math.min(Math.max(r.width, MIN_W), vw - 2 * EDGE);
      box.style.left = `${Math.max(EDGE, Math.min(r.left, vw - EDGE - w))}px`;
      box.style.top = `${r.bottom + GAP}px`;
      box.style.width = `${w}px`;
      box.style.maxHeight = `${Math.max(120, Math.min(MAX_H, bottom - r.bottom - GAP - EDGE))}px`;
    };
    const schedule = (e?: Event) => {
      // Scrollen in der Liste selbst verschiebt das Feld nicht.
      if (e && e.target instanceof Node && boxRef.current?.contains(e.target)) return;
      if (!raf) raf = requestAnimationFrame(place);
    };
    place();
    const opts = { capture: true, passive: true } as const;
    window.addEventListener('scroll', schedule, opts);
    window.addEventListener('resize', schedule, { passive: true });
    window.visualViewport?.addEventListener('resize', schedule, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('scroll', schedule, opts);
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
    };
    // hits: jede neue Trefferliste richtet neu aus — die Seite kann sich seit
    // dem Oeffnen ohne Scrollen verschoben haben (nachladende Bloecke).
  }, [open, anchor, hits]);

  if (!open) return null;

  return createPortal(
    <div
      ref={boxRef}
      id={s.listId}
      role="listbox"
      aria-label={t('nav.searchPlayer')}
      // Fokus bleibt im Feld (Tastatur, Handy-Tastatur bleibt offen).
      onMouseDown={e => e.preventDefault()}
      className="fixed z-[70] bg-surface-base border border-border-subtle rounded shadow-xl overflow-y-auto"
    >
      {s.hits.map((h, i) => {
        const regionLabel = tftRegionLabel(h.region);
        const rank = game === 'tft' ? tftRankLabel(h, l => t(`tier.${l}` as Parameters<typeof t>[0])) : '';
        return (
          <button
            key={h.puuid}
            id={s.optionId(i)}
            type="button"
            role="option"
            aria-selected={i === s.hi}
            tabIndex={-1}
            onMouseEnter={() => s.setHi(i)}
            onClick={() => s.pick(h)}
            className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${i === s.hi ? 'bg-surface-raised' : 'hover:bg-surface-raised'}`}
          >
            <div className="w-6 h-6 rounded bg-surface-overlay flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-fg-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-white text-xs font-medium truncate">{h.gameName}#{h.tagLine}</div>
              <div className="text-fg-muted text-[10px]">{rank ? `${regionLabel} · ${rank}` : regionLabel}</div>
            </div>
            <svg className="w-3 h-3 text-fg-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

/** Server-Kuerzel im Feld, wenn ein Vorschlag dessen Region festgelegt hat.
 *  Lage (right-…) gibt das Feld vor; ohne Erklaertext (feedback_no_info_texts). */
export function RegionTag({ region, className = 'right-2' }: { region: string | null; className?: string }) {
  if (!region) return null;
  return (
    <span className={`pointer-events-none absolute top-1/2 -translate-y-1/2 px-1 py-0.5 rounded bg-surface-overlay text-fg-secondary text-[10px] font-medium leading-none ${className}`}>
      {tftRegionLabel(region)}
    </span>
  );
}
