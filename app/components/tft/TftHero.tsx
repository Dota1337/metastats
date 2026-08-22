'use client';
import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { tftPatchLabel } from '../../lib/tft-patch-label';
import { CURRENT_SET_LABEL } from '../../lib/current-set';
import { TFT_HERO_HEIGHT } from '../../lib/tft-hero-metrics';
import { loadTftAssets, type TftAssetsBundle } from '../../lib/tft-cdragon';
import { tftHeroUnitPool, pickPairForSeed } from '../../lib/ddragon-splash';
import TftHeroSideArt from './TftHeroSideArt';

interface TftHeroProps {
  pageTitle?: string;
  subtitle?: string;
  patch?: string;
  children?: React.ReactNode;
}

// Zwei Set-Splashes links und rechts, Text in der Mitte (Entwurf T1 aus
// /internal/design-lab). Vorher standen hier zwei Chibi-Figuren, die alle 8 s
// per Timer wechselten — das zog pro offenem Tab und Stunde rund 24 MB nach.
//
// Die Auswahl haengt am Seitenpfad, nicht am Zufall: eine Seite soll bei jedem
// Besuch dasselbe Bild tragen (Wiedererkennung), und ein Zufallswert wuerde
// zwischen Server- und Client-Render auseinanderlaufen.
export default function TftHero({
  pageTitle,
  subtitle,
  patch,
  children,
}: TftHeroProps) {
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  useEffect(() => {
    loadTftAssets().then(setAssets);
  }, []);

  const pathname = usePathname();
  const pool = useMemo(() => tftHeroUnitPool(assets), [assets]);
  const pair = useMemo(
    () => pickPairForSeed(pool, pathname || '/tft'),
    [pool, pathname],
  );

  return (
    <div
      className="relative overflow-hidden py-4 sm:py-6"
      style={{ minHeight: TFT_HERO_HEIGHT }}
    >
      {/* Verlaufs-Hintergrund */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at top, rgba(123,97,255,0.22) 0%, rgb(var(--surface-page-rgb) / 0%) 60%), linear-gradient(180deg, var(--surface-raised) 0%, var(--surface-page) 100%)',
        }}
      />
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-accent-a40 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-accent-a20 to-transparent" />

      {/* Kein Bild, solange der Pool nicht mindestens zwei Einheiten hat.
          `pickPairForSeed` liefert dann `null`, und die Kopfzone bleibt
          Verlauf plus Text — sichtbar leer waere schlimmer als schlicht.
          Der Pool haengt seit diesem Umbau am laufenden Set; damit ein
          leergelaufener Pool nicht erst dem Nutzer auffaellt, prueft
          scripts/check-tft-hero-pool.mjs ihn im verify-Lauf mit. */}
      {pair && (
        <>
          <TftHeroSideArt unit={pair[0]} side="left" />
          <TftHeroSideArt unit={pair[1]} side="right" />
        </>
      )}

      {/* Mittiger Text */}
      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 text-center">
        <div className="text-accent text-[10px] sm:text-xs uppercase tracking-[0.3em] mb-2">
          {CURRENT_SET_LABEL}
          {patch ? ` · Patch ${tftPatchLabel(patch)}` : ''}
        </div>
        {pageTitle && (
          <h1 className="text-white font-bold tracking-tight text-3xl sm:text-4xl mb-2">
            {pageTitle}
          </h1>
        )}
        {subtitle && (
          <p className="text-fg-secondary text-sm max-w-md mx-auto">{subtitle}</p>
        )}
        {children && <div className="mt-5">{children}</div>}
      </div>
    </div>
  );
}
