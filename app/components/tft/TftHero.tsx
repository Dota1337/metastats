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

// Slot layout for each side. The first slot is the "front" (largest); the rest
// are layered behind with smaller sizes and pixel offsets relative to the front.
// Offsets are mirrored automatically for the right-side cluster.
interface SlotConfig {
  size: number;
  offsetX: number; // positive = further from edge (toward center)
  offsetY: number; // positive = down
  opacity: number;
  rotateMs: number;
  z: number;
}

const FULL_SLOTS: SlotConfig[] = [
  { size: 240, offsetX: 0,   offsetY: 0,    opacity: 1.0, rotateMs: 5400, z: 3 },
  { size: 160, offsetX: 110, offsetY: -70,  opacity: 0.80, rotateMs: 6800, z: 1 },
  { size: 140, offsetX: 100, offsetY: 80,   opacity: 0.75, rotateMs: 8200, z: 2 },
];

const COMPACT_SLOTS: SlotConfig[] = [
  { size: 130, offsetX: 0,  offsetY: 0,   opacity: 1.0,  rotateMs: 5400, z: 2 },
  { size: 90,  offsetX: 70, offsetY: -28, opacity: 0.78, rotateMs: 7200, z: 1 },
];

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
  //    kLegendary chibis are plain "Chibi Aatrox" base versions — less striking visually.
  //  - Tacticians: kMythic only — the rarest Little Legends like Summer Splash Ao Shin.
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

  const slotConfig = compact ? COMPACT_SLOTS : FULL_SLOTS;
  const setLabel = assets ? `Set ${assets.set} · ${assets.setName}` : null;
  const heroMinHeight = compact ? 150 : 300;

  return (
    <div
      className={`relative overflow-hidden ${compact ? 'py-6' : 'py-10 sm:py-14'}`}
      style={{ minHeight: heroMinHeight }}
    >
      <style>{`
        @keyframes tftFigFade {
          from { opacity: 0; transform: translateY(8px) scale(0.94); filter: blur(3px); }
          to   { opacity: 1; transform: translateY(0)   scale(1);    filter: blur(0); }
        }
        .tft-fig-img { animation: tftFigFade 0.9s ease-out; }
        @keyframes tftFigFloatA {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-6px); }
        }
        @keyframes tftFigFloatB {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-4px); }
        }
        @keyframes tftFigFloatC {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-8px); }
        }
        .tft-fig-float-0 { animation: tftFigFloatA 6s ease-in-out infinite; }
        .tft-fig-float-1 { animation: tftFigFloatB 7s ease-in-out infinite 0.5s; }
        .tft-fig-float-2 { animation: tftFigFloatC 8s ease-in-out infinite 1s; }
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

      {/* LEFT cluster (Chibis) */}
      <SideCluster
        side="left"
        pool={chibiPool}
        assets={assets}
        slotConfig={slotConfig}
        compact={compact}
      />

      {/* RIGHT cluster (Tacticians) */}
      <SideCluster
        side="right"
        pool={tacticianPool}
        assets={assets}
        slotConfig={slotConfig}
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

function SideCluster({
  side,
  pool,
  assets,
  slotConfig,
  compact,
}: {
  side: 'left' | 'right';
  pool: TftCompanion[];
  assets: TftAssetsBundle | null;
  slotConfig: SlotConfig[];
  compact: boolean;
}) {
  const [slots, setSlots] = useState<(TftCompanion | null)[]>(() =>
    Array(slotConfig.length).fill(null),
  );

  // Initial fill with distinct figures
  useEffect(() => {
    if (pool.length === 0) return;
    const initial = pickInitial(pool, slotConfig.length);
    setSlots(prev => {
      const next: (TftCompanion | null)[] = Array(slotConfig.length).fill(null);
      for (let i = 0; i < slotConfig.length; i++) next[i] = initial[i] || null;
      return next;
    });
  }, [pool, slotConfig.length]);

  // Each slot rotates on its own timer. Tied to slot index so different slots
  // change at different times — gives an organic, never-synced feel.
  useEffect(() => {
    if (pool.length < 2) return;
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    const timers = slotConfig.map((cfg, i) =>
      window.setInterval(() => {
        setSlots(prev => {
          const next = [...prev];
          const inUse = new Set(prev.filter(Boolean) as TftCompanion[]);
          const candidate = pickRandom(pool, inUse);
          if (candidate) next[i] = candidate;
          return next;
        });
      }, cfg.rotateMs),
    );
    return () => {
      for (const t of timers) window.clearInterval(t);
    };
  }, [pool, slotConfig]);

  // Cluster anchor — figures position absolutely relative to it.
  const anchorClass =
    side === 'left'
      ? 'hidden sm:block absolute left-0 sm:left-2 md:left-6 lg:left-10'
      : 'hidden sm:block absolute right-0 sm:right-2 md:right-6 lg:right-10';

  // Cluster mask — figures fade toward the center so headline stays legible.
  const maskDirection = side === 'left' ? 'to right' : 'to left';

  // Width/height of the cluster bounding box — base on slot 0 + extension.
  const front = slotConfig[0];
  const clusterWidth = front.size + (slotConfig[1]?.offsetX || 0) + (slotConfig[1]?.size || 0) * 0.4;
  const clusterHeight = front.size + Math.max(0, ...slotConfig.slice(1).map(s => Math.abs(s.offsetY)));

  return (
    <div
      className={anchorClass}
      style={{
        top: '50%',
        transform: 'translateY(-50%)',
        width: clusterWidth,
        height: clusterHeight,
        pointerEvents: 'none',
        userSelect: 'none',
        maskImage: `linear-gradient(${maskDirection}, rgba(0,0,0,1) 0%, rgba(0,0,0,0.95) 55%, rgba(0,0,0,0) 100%)`,
        WebkitMaskImage: `linear-gradient(${maskDirection}, rgba(0,0,0,1) 0%, rgba(0,0,0,0.95) 55%, rgba(0,0,0,0) 100%)`,
      }}
      aria-hidden="true"
    >
      {slotConfig.map((cfg, i) => {
        const fig = slots[i];
        const url = tftCompanionIconUrl(assets, fig?.icon);
        // Mirror offsetX for the right cluster.
        const x = side === 'left' ? cfg.offsetX : clusterWidth - cfg.offsetX - cfg.size;
        const y = (clusterHeight - cfg.size) / 2 + cfg.offsetY;
        return (
          <div
            key={i}
            className={`absolute tft-fig-float-${i % 3}`}
            style={{
              left: x,
              top: y,
              width: cfg.size,
              height: cfg.size,
              zIndex: cfg.z,
              opacity: cfg.opacity,
            }}
          >
            {url ? (
              <img
                key={fig!.itemId}
                src={url}
                alt=""
                title={fig?.name}
                className="tft-fig-img w-full h-full object-contain"
                style={{
                  filter: `drop-shadow(0 ${compact ? 6 : 12}px ${compact ? 12 : 24}px rgba(123,97,255,${0.25 + cfg.opacity * 0.15}))`,
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
  );
}
