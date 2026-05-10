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

// Independent rotation intervals so the two sides don't change at the same moment.
const LEFT_ROTATE_MS = 5400;
const RIGHT_ROTATE_MS = 6200;

function pickRandom<T>(arr: T[], exclude?: T): T | null {
  if (arr.length === 0) return null;
  if (arr.length === 1) return arr[0];
  let pick: T | null = null;
  for (let i = 0; i < 6; i++) {
    pick = arr[Math.floor(Math.random() * arr.length)];
    if (pick !== exclude) return pick;
  }
  return pick;
}

// Dedupe tacticians by name — the API ships level 1/2/3 evolutions with the
// same name and similar visuals; one entry per skin is enough for the rotation.
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
  //  - Chibis: kMythic + kPrestige are the themed skin variants (Blood Moon, K/DA, Spirit Blossom, ...).
  //    kLegendary chibis are plain "Chibi Aatrox" base versions — less striking.
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

  const [leftFigure, setLeftFigure] = useState<TftCompanion | null>(null);
  const [rightFigure, setRightFigure] = useState<TftCompanion | null>(null);

  useEffect(() => {
    if (chibiPool.length > 0) setLeftFigure(pickRandom(chibiPool));
  }, [chibiPool]);

  useEffect(() => {
    if (tacticianPool.length > 0) setRightFigure(pickRandom(tacticianPool));
  }, [tacticianPool]);

  useEffect(() => {
    if (chibiPool.length < 2) return;
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    const id = window.setInterval(() => {
      setLeftFigure(prev => pickRandom(chibiPool, prev || undefined));
    }, LEFT_ROTATE_MS);
    return () => window.clearInterval(id);
  }, [chibiPool]);

  useEffect(() => {
    if (tacticianPool.length < 2) return;
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    const id = window.setInterval(() => {
      setRightFigure(prev => pickRandom(tacticianPool, prev || undefined));
    }, RIGHT_ROTATE_MS);
    return () => window.clearInterval(id);
  }, [tacticianPool]);

  const setLabel = assets ? `Set ${assets.set} · ${assets.setName}` : null;
  const figureSize = compact ? 140 : 240;

  return (
    <div
      className={`relative overflow-hidden ${compact ? 'py-6' : 'py-10 sm:py-14'}`}
      style={{ minHeight: compact ? 120 : 220 }}
    >
      <style>{`
        @keyframes tftFigFade {
          from { opacity: 0; transform: translateY(8px) scale(0.96); filter: blur(3px); }
          to   { opacity: 1; transform: translateY(0)   scale(1);    filter: blur(0); }
        }
        .tft-fig-img { animation: tftFigFade 0.9s ease-out; }
        @keyframes tftFigFloat {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-6px); }
        }
        .tft-fig-float { animation: tftFigFloat 6s ease-in-out infinite; }
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

      {/* LEFT figure (Chibi) — hidden on mobile */}
      <SideFigure
        side="left"
        figure={leftFigure}
        assets={assets}
        size={figureSize}
        compact={compact}
      />

      {/* RIGHT figure (Tactician) — hidden on mobile */}
      <SideFigure
        side="right"
        figure={rightFigure}
        assets={assets}
        size={figureSize}
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

function SideFigure({
  side,
  figure,
  assets,
  size,
  compact,
}: {
  side: 'left' | 'right';
  figure: TftCompanion | null;
  assets: TftAssetsBundle | null;
  size: number;
  compact: boolean;
}) {
  const url = tftCompanionIconUrl(assets, figure?.icon);
  // Soft inward fade so text in the middle stays legible.
  const maskDirection = side === 'left' ? 'to right' : 'to left';
  const positionClass =
    side === 'left'
      ? 'left-0 sm:left-2 md:left-6 lg:left-12'
      : 'right-0 sm:right-2 md:right-6 lg:right-12';

  return (
    <div
      className={`hidden sm:block absolute ${positionClass} pointer-events-none select-none`}
      style={{
        width: size,
        height: size,
        top: '50%',
        transform: 'translateY(-50%)',
        maskImage: `linear-gradient(${maskDirection}, rgba(0,0,0,1) 0%, rgba(0,0,0,0.9) 60%, rgba(0,0,0,0) 100%)`,
        WebkitMaskImage: `linear-gradient(${maskDirection}, rgba(0,0,0,1) 0%, rgba(0,0,0,0.9) 60%, rgba(0,0,0,0) 100%)`,
      }}
      aria-hidden="true"
    >
      {url ? (
        <div className="tft-fig-float w-full h-full">
          <img
            key={figure!.itemId}
            src={url}
            alt=""
            title={figure?.name}
            className="tft-fig-img w-full h-full object-contain"
            style={{ filter: `drop-shadow(0 ${compact ? 6 : 12}px ${compact ? 12 : 24}px rgba(123,97,255,0.35))` }}
            loading="lazy"
            onError={e => {
              (e.currentTarget as HTMLImageElement).style.opacity = '0';
            }}
          />
        </div>
      ) : (
        <div className="w-full h-full" />
      )}
    </div>
  );
}
