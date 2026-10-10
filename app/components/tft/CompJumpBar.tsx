'use client';
import { useEffect, useRef, useState } from 'react';
import { useI18n, type TranslationKey } from '../../lib/i18n';

// Mitlaufende Sprungleiste der Comp-Detailseite am Handy (User 2026-10-10,
// Variante D). Pflegt die Sichtbarkeits-Bedingungen der Boxen NICHT selbst:
// sie liest die Ziele aus der Seite (`[data-jump]` mit Inhalt) und folgt per
// MutationObserver, wenn Guide, Assets oder Outcome spaeter nachladen.
// Ziel-IDs sind `cj-<schluessel>`; ein geteilter Link mit #cj-… springt, sobald
// das Ziel steht (vorher gibt es es nicht, der Browser liefe ins Leere).
export default function CompJumpBar({ rootId }: { rootId: string }) {
  const { t } = useI18n();
  const [keys, setKeys] = useState<string[]>([]);
  const jumped = useRef(false);

  useEffect(() => {
    const root = document.getElementById(rootId);
    if (!root) return;
    // Beim Oeffnen merken: bis das Ziel nachgeladen ist, kann der Router die
    // Adresse schon ohne #… neu geschrieben haben.
    const hash = decodeURIComponent(window.location.hash.slice(1));
    let frame = 0;
    const scan = () => {
      frame = 0;
      const found = [...root.querySelectorAll<HTMLElement>('[data-jump]')]
        .filter(el => el.childElementCount > 0 && el.dataset.jump)
        .map(el => el.dataset.jump as string);
      setKeys(prev => (prev.join('|') === found.join('|') ? prev : found));
      if (!jumped.current && hash.startsWith('cj-')) {
        const target = document.getElementById(hash);
        if (target && target.childElementCount > 0) {
          jumped.current = true;
          target.scrollIntoView();
        }
      }
    };
    // Diagramme aendern das DOM laufend — hoechstens einmal je Bild pruefen.
    const schedule = () => { if (!frame) frame = requestAnimationFrame(scan); };
    scan();
    const mo = new MutationObserver(schedule);
    mo.observe(root, { childList: true, subtree: true });
    return () => { mo.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [rootId]);

  if (keys.length < 2) return null;
  return (
    <nav
      aria-label={t('tft.comp.jump.nav')}
      className="lg:hidden sticky top-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2 mt-3 bg-surface-page/95 backdrop-blur border-b border-border-subtle"
    >
      <div className="flex gap-1.5 overflow-x-auto">
        {keys.map(k => (
          <a
            key={k}
            href={`#cj-${k}`}
            className="shrink-0 px-3 py-1.5 rounded-full border border-border-subtle bg-surface-raised text-xs text-fg-secondary hover:text-white hover:border-accent-a50 transition-colors"
          >
            {t(`tft.comp.jump.${k}` as TranslationKey)}
          </a>
        ))}
      </div>
    </nav>
  );
}
