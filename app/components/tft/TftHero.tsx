'use client';
import { useEffect, useMemo, useState } from 'react';
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

const SLOT_COUNT = 4;
const ORBIT_DURATION_S = 20;
// Per-slot content swap intervals — different prime-ish gaps so the cast
// keeps cycling. Each slot picks a different figure than the others.
const SWAP_MS = [7500, 9100, 10700, 12300];

// Layout sizes:
//   figure = front-figure rendered size (px) — back figure scales down by 0.45.
//   radius = horizontal swing radius — keeps the cluster narrow.
const FULL_LAYOUT = { figure: 182, radius: 91 };
const COMPACT_LAYOUT = { figure: 104, radius: 47 };

function pickRandom<T>(arr: T[], exclude?: Set<T>): T | null {
  const candidates = exclude ? arr.filter(x => !exclude.has(x)) : arr;
  if (candidates.length === 0) return arr[0] || null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function pickInitial<T>(arr: T[], n: number): T[] {
  const taken = new Set<T>();
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    const pick = pickRandom(arr, taken);
    if (!pick) break;
    taken.add(pick);
    out.push(pick);
  }
  return out;
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
        /* Pseudo-3D carousel — figures swing horizontally on an elliptical path
           with depth simulated via scale + opacity + z-index. The "front"
           figure (0%/100% keyframe) is always crisp and centered on the slot
           anchor; "back" (50%) is small and dim behind it; sides (25%/75%)
           are medium width and partial-opacity. One slot is always near front
           so the headline always has a clean focal figure beside it. */
        @keyframes tftCarousel3DLeft {
          0%,100% { transform: translateX(0)                     scale(1.00); opacity: 1.0;  z-index: 3; }
          25%     { transform: translateX(var(--orbit-r))         scale(0.65); opacity: 0.82; z-index: 2; }
          50%     { transform: translateX(0)                     scale(0.45); opacity: 0.45; z-index: 0; }
          75%     { transform: translateX(calc(-1 * var(--orbit-r))) scale(0.65); opacity: 0.82; z-index: 2; }
        }
        @keyframes tftCarousel3DRight {
          0%,100% { transform: translateX(0)                     scale(1.00); opacity: 1.0;  z-index: 3; }
          25%     { transform: translateX(calc(-1 * var(--orbit-r))) scale(0.65); opacity: 0.82; z-index: 2; }
          50%     { transform: translateX(0)                     scale(0.45); opacity: 0.45; z-index: 0; }
          75%     { transform: translateX(var(--orbit-r))         scale(0.65); opacity: 0.82; z-index: 2; }
        }
        @keyframes tftFigFade {
          from { opacity: 0; filter: blur(3px); }
          to   { opacity: 1; filter: blur(0); }
        }
        .tft-fig-img { animation: tftFigFade 0.8s ease-out; }
        @media (prefers-reduced-motion: reduce) {
          .tft-orbit-item { animation: none !important; }
        }
      `}</style>

      {/* Gradient background */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at top, rgba(123,97,255,0.22) 0%, rgba(14,21,37,0) 60%), linear-gradient(180deg, #141a2e 0%, #0e1525 100%)',
        }}
      />
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#7B61FF]/40 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#7B61FF]/20 to-transparent" />

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
          <div className="text-[#7B61FF] text-[10px] sm:text-xs uppercase tracking-[0.3em] mb-2">
            {setLabel}
            {patch ? ` · Patch ${patch}` : ''}
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
          <p className="text-[#a0b0c5] text-sm max-w-md mx-auto">{subtitle}</p>
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
  layout: { figure: number; radius: number };
  compact: boolean;
}) {
  const [slots, setSlots] = useState<(TftCompanion | null)[]>(() =>
    Array(SLOT_COUNT).fill(null),
  );

  useEffect(() => {
    if (pool.length === 0) return;
    const initial = pickInitial(pool, SLOT_COUNT);
    setSlots(() => {
      const next: (TftCompanion | null)[] = Array(SLOT_COUNT).fill(null);
      for (let i = 0; i < SLOT_COUNT; i++) next[i] = initial[i] || null;
      return next;
    });
  }, [pool]);

  useEffect(() => {
    if (pool.length < 2) return;
    const timers = SWAP_MS.map((ms, i) =>
      window.setInterval(() => {
        setSlots(prev => {
          const next = [...prev];
          const inUse = new Set(prev.filter(Boolean) as TftCompanion[]);
          const candidate = pickRandom(pool, inUse);
          if (candidate) next[i] = candidate;
          return next;
        });
      }, ms),
    );
    return () => {
      for (const t of timers) window.clearInterval(t);
    };
  }, [pool]);

  // Bounding box just needs to contain the side-position figures.
  // Side figure render size = layout.figure * 0.65; centered on x = ±radius.
  // Half-extent = radius + (figure * 0.65 / 2).
  const halfExtent = layout.radius + (layout.figure * 0.65) / 2;
  const boxWidth = halfExtent * 2;
  const boxHeight = layout.figure + 24; // generous for drop-shadow + scale

  const anchorClass =
    side === 'left'
      ? 'hidden sm:block absolute left-2 sm:left-4 md:left-8'
      : 'hidden sm:block absolute right-2 sm:right-4 md:right-8';

  const keyframeName =
    side === 'left' ? 'tftCarousel3DLeft' : 'tftCarousel3DRight';

  return (
    <div
      className={anchorClass}
      style={{
        top: '50%',
        transform: 'translateY(-50%)',
        width: boxWidth,
        height: boxHeight,
        pointerEvents: 'none',
        userSelect: 'none',
      }}
      aria-hidden="true"
    >
      {/* Carousel anchor — 0px point at the cluster center. Children orbit
          relative to this via translateX + scale in their keyframe. */}
      <div className="absolute left-1/2 top-1/2" style={{ width: 0, height: 0 }}>
        {slots.map((fig, i) => {
          const url = tftCompanionIconUrl(assets, fig?.icon);
          // Phase each slot 1/4 cycle ahead so all 4 positions
          // (front / one side / back / other side) are always occupied.
          const delay = -(i / SLOT_COUNT) * ORBIT_DURATION_S;
          return (
            <div
              key={i}
              className="tft-orbit-item absolute"
              style={{
                width: layout.figure,
                height: layout.figure,
                marginLeft: -layout.figure / 2,
                marginTop: -layout.figure / 2,
                animation: `${keyframeName} ${ORBIT_DURATION_S}s linear infinite`,
                animationDelay: `${delay}s`,
                ['--orbit-r' as unknown as string]: `${layout.radius}px`,
              } as React.CSSProperties}
            >
              {url ? (
                <img
                  key={fig!.itemId}
                  src={url}
                  alt=""
                  title={fig?.name}
                  className="tft-fig-img w-full h-full object-contain"
                  style={{
                    filter: `drop-shadow(0 ${compact ? 3 : 6}px ${compact ? 8 : 14}px rgba(123,97,255,0.35))`,
                  }}
                  loading="lazy"
                  onError={e => {
                    (e.currentTarget as HTMLImageElement).style.opacity = '0';
                  }}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
