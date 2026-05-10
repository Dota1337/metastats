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
const ORBIT_DURATION_S = 36; // Slow & calm — one full revolution every 36s.
// Per-slot content swap intervals — different prime-ish gaps so slots never
// re-sync. The slot picks a different chibi/tactician each tick.
const SWAP_MS = [6300, 7700, 9100, 10500];

const FULL_LAYOUT = { figure: 120, radius: 140 };
const COMPACT_LAYOUT = { figure: 70, radius: 80 };

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
  // Hero needs to be at least tall enough for the orbit circle + margin.
  const heroMinHeight = (layout.radius + layout.figure) * 2 + 20;

  return (
    <div
      className={`relative overflow-hidden ${compact ? 'py-6' : 'py-10 sm:py-14'}`}
      style={{ minHeight: heroMinHeight }}
    >
      <style>{`
        @keyframes tftOrbitCW {
          from { transform: rotate(0deg)   translateX(var(--orbit-r)) rotate(0deg); }
          to   { transform: rotate(360deg) translateX(var(--orbit-r)) rotate(-360deg); }
        }
        @keyframes tftOrbitCCW {
          from { transform: rotate(0deg)    translateX(var(--orbit-r)) rotate(0deg); }
          to   { transform: rotate(-360deg) translateX(var(--orbit-r)) rotate(360deg); }
        }
        @keyframes tftFigFade {
          from { opacity: 0; filter: blur(3px); }
          to   { opacity: 1; filter: blur(0); }
        }
        .tft-fig-img { animation: tftFigFade 0.9s ease-out; }
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
          <p className="text-[#8a9bb0] text-sm max-w-md mx-auto">{subtitle}</p>
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
    setSlots(prev => {
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

  // Orbit box wraps the 4 figures around a center anchor.
  // Width/height = 2 * (radius + half-figure); figures positioned at the
  // center and rotated outward by the keyframe.
  const boxSize = layout.radius * 2 + layout.figure;
  const anchorClass =
    side === 'left'
      ? 'hidden sm:block absolute left-0 sm:-left-4 md:left-0 lg:left-6'
      : 'hidden sm:block absolute right-0 sm:-right-4 md:right-0 lg:right-6';

  // Soft fade toward the hero center keeps headline legible.
  const maskDirection = side === 'left' ? 'to right' : 'to left';
  const orbitDirection = side === 'left' ? 'tftOrbitCW' : 'tftOrbitCCW';

  return (
    <div
      className={anchorClass}
      style={{
        top: '50%',
        transform: 'translateY(-50%)',
        width: boxSize,
        height: boxSize,
        pointerEvents: 'none',
        userSelect: 'none',
        maskImage: `linear-gradient(${maskDirection}, rgba(0,0,0,1) 0%, rgba(0,0,0,0.95) 55%, rgba(0,0,0,0) 100%)`,
        WebkitMaskImage: `linear-gradient(${maskDirection}, rgba(0,0,0,1) 0%, rgba(0,0,0,0.95) 55%, rgba(0,0,0,0) 100%)`,
      }}
      aria-hidden="true"
    >
      {/* Orbit center — 0px point at the cluster middle. Children orbit
          around this via translateX(radius) inside their keyframe. */}
      <div className="absolute left-1/2 top-1/2" style={{ width: 0, height: 0 }}>
        {slots.map((fig, i) => {
          const url = tftCompanionIconUrl(assets, fig?.icon);
          // animationDelay phase-shifts each slot so they sit 90° apart on
          // the circle. Negative delay starts the animation already in progress.
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
                animation: `${orbitDirection} ${ORBIT_DURATION_S}s linear infinite`,
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
                    filter: `drop-shadow(0 ${compact ? 6 : 12}px ${compact ? 12 : 24}px rgba(123,97,255,0.35))`,
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
