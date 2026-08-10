'use client';
import { useEffect, useMemo, useState } from 'react';
import { tftPatchLabel } from '../../lib/tft-patch-label';
import {
  loadTftAssets,
  tftCompanionIconUrl,
  type TftAssetsBundle,
  type TftCompanion,
} from '../../lib/tft-cdragon';

interface TftHeroProps {
  pageTitle?: string;
  subtitle?: string;
  compact?: boolean;
  patch?: string;
  children?: React.ReactNode;
}

// Swap to the next figure every SWAP_MS with a CROSSFADE_MS-long crossfade
// between outgoing and incoming. Float-loop runs continuously underneath
// so the figure gently bobs up and down while present.
const SWAP_MS = 8000;
const CROSSFADE_MS = 900;
const FLOAT_DURATION_S = 4;

// figure = rendered size in px (one static figure per side, no scaled neighbours)
const FULL_LAYOUT = { figure: 182 };
const COMPACT_LAYOUT = { figure: 104 };

function pickRandom<T>(arr: T[], exclude?: Set<T>): T | null {
  const candidates = exclude ? arr.filter(x => !exclude.has(x)) : arr;
  if (candidates.length === 0) return arr[0] || null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function dedupeByName(arr: TftCompanion[]): TftCompanion[] {
  const seen = new Set<string>();
  const out: TftCompanion[] = [];
  for (const c of arr) {
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    out.push(c);
  }
  return out;
}

export default function TftHero({
  pageTitle,
  subtitle,
  compact = false,
  patch,
  children,
}: TftHeroProps) {
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  useEffect(() => {
    loadTftAssets().then(setAssets);
  }, []);

  // Pools curated for visual appeal:
  //  - Chibis: kMythic + kPrestige (themed skin variants — Blood Moon, K/DA, Spirit Blossom, ...).
  //    kLegendary chibis are plain "Chibi Aatrox" base versions — less striking.
  //  - Tacticians: kMythic only — the rarest Little Legends (Summer Splash Ao Shin, ...).
  const chibiPool = useMemo(() => {
    if (!assets?.chibis) return [];
    return Object.values(assets.chibis).filter(
      c => (c.rarity === 'kMythic' || c.rarity === 'kPrestige') && !!c.icon,
    );
  }, [assets]);

  const tacticianPool = useMemo(() => {
    if (!assets?.tacticians) return [];
    const mythic = Object.values(assets.tacticians).filter(
      c => c.rarity === 'kMythic' && !!c.icon,
    );
    return dedupeByName(mythic);
  }, [assets]);

  const layout = compact ? COMPACT_LAYOUT : FULL_LAYOUT;
  const setLabel = assets ? `Set ${assets.set} · ${assets.setName}` : null;
  // Hero height = figure size + small buffer for drop-shadow blur.
  // Kept tight so the gap between hero and first content box stays minimal.
  const heroMinHeight = layout.figure + 18;

  return (
    <div
      className={`relative overflow-hidden ${compact ? 'py-3' : 'py-4 sm:py-6'}`}
      style={{ minHeight: heroMinHeight }}
    >
      <style>{`
        /* Single figure per side. Gentle vertical float underneath a slow
           crossfade swap to the next pool entry every SWAP_MS. */
        @keyframes tftFloat {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-7px); }
        }
        @keyframes tftFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes tftFadeOut {
          from { opacity: 1; }
          to   { opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .tft-float-layer { animation: none !important; }
        }
      `}</style>

      {/* Gradient background */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at top, rgba(123,97,255,0.22) 0%, rgb(var(--surface-page-rgb) / 0%) 60%), linear-gradient(180deg, var(--surface-raised) 0%, var(--surface-page) 100%)',
        }}
      />
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-accent-a40 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-accent-a20 to-transparent" />

      <OrbitCluster
        side="left"
        pool={chibiPool}
        assets={assets}
        layout={layout}
        compact={compact}
      />
      <OrbitCluster
        side="right"
        pool={tacticianPool}
        assets={assets}
        layout={layout}
        compact={compact}
      />

      {/* Center content */}
      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 text-center">
        {setLabel && (
          <div className="text-accent text-[10px] sm:text-xs uppercase tracking-[0.3em] mb-2">
            {setLabel}
            {patch ? ` · Patch ${tftPatchLabel(patch)}` : ''}
          </div>
        )}
        {pageTitle && (
          <h1
            className={`text-white font-bold tracking-tight ${compact ? 'text-xl sm:text-2xl' : 'text-3xl sm:text-4xl mb-2'}`}
          >
            {pageTitle}
          </h1>
        )}
        {subtitle && !compact && (
          <p className="text-fg-secondary text-sm max-w-md mx-auto">{subtitle}</p>
        )}
        {children && <div className="mt-5">{children}</div>}
      </div>
    </div>
  );
}

function OrbitCluster({
  side,
  pool,
  assets,
  layout,
  compact,
}: {
  side: 'left' | 'right';
  pool: TftCompanion[];
  assets: TftAssetsBundle | null;
  layout: { figure: number };
  compact: boolean;
}) {
  const [current, setCurrent] = useState<TftCompanion | null>(null);
  const [previous, setPrevious] = useState<TftCompanion | null>(null);

  // Initial pick once the pool is loaded.
  useEffect(() => {
    if (pool.length === 0) return;
    setCurrent(pickRandom(pool));
  }, [pool]);

  // Periodic swap with a CROSSFADE_MS-long crossfade. Right side starts the
  // cycle offset by SWAP_MS/2 so the two sides never swap simultaneously.
  useEffect(() => {
    if (pool.length < 2) return;
    const offset = side === 'right' ? SWAP_MS / 2 : 0;
    let interval: number | null = null;
    const start = window.setTimeout(() => {
      const swap = () => {
        setCurrent(prev => {
          setPrevious(prev);
          const next = pickRandom(pool, prev ? new Set([prev]) : undefined);
          return next ?? prev;
        });
        // Drop the previous layer once the crossfade is done so it stops
        // animating + can be GC'd.
        window.setTimeout(() => setPrevious(null), CROSSFADE_MS + 50);
      };
      swap();
      interval = window.setInterval(swap, SWAP_MS);
    }, offset);
    return () => {
      window.clearTimeout(start);
      if (interval !== null) window.clearInterval(interval);
    };
  }, [pool, side]);

  const anchorClass =
    side === 'left'
      ? 'hidden sm:block absolute left-2 sm:left-4 md:left-8'
      : 'hidden sm:block absolute right-2 sm:right-4 md:right-8';

  // Offset the two sides' float keyframes so they don't bob in lockstep.
  const floatDelay = side === 'left' ? '0s' : `${FLOAT_DURATION_S / 2}s`;
  const shadow = `drop-shadow(0 ${compact ? 3 : 6}px ${compact ? 8 : 14}px rgba(123,97,255,0.35))`;

  return (
    <div
      className={anchorClass}
      style={{
        top: '50%',
        transform: 'translateY(-50%)',
        width: layout.figure,
        height: layout.figure,
        pointerEvents: 'none',
        userSelect: 'none',
      }}
      aria-hidden="true"
    >
      <div
        className="tft-float-layer relative w-full h-full"
        style={{
          animation: `tftFloat ${FLOAT_DURATION_S}s ease-in-out infinite`,
          animationDelay: floatDelay,
        }}
      >
        {previous && (
          <Figure
            key={`prev-${previous.itemId}`}
            fig={previous}
            assets={assets}
            shadow={shadow}
            fadeOut
          />
        )}
        {current && (
          <Figure
            key={`curr-${current.itemId}`}
            fig={current}
            assets={assets}
            shadow={shadow}
          />
        )}
      </div>
    </div>
  );
}

function Figure({
  fig,
  assets,
  shadow,
  fadeOut = false,
}: {
  fig: TftCompanion;
  assets: TftAssetsBundle | null;
  shadow: string;
  fadeOut?: boolean;
}) {
  const url = tftCompanionIconUrl(assets, fig.icon);
  if (!url) return null;
  return (
    <img
      src={url}
      alt=""
      title={fig.name}
      className="absolute inset-0 w-full h-full object-contain"
      style={{
        filter: shadow,
        animation: fadeOut
          ? `tftFadeOut ${CROSSFADE_MS}ms ease-out forwards`
          : `tftFadeIn ${CROSSFADE_MS}ms ease-out forwards`,
      }}
      loading="lazy"
      onError={e => {
        (e.currentTarget as HTMLImageElement).style.opacity = '0';
      }}
    />
  );
}
