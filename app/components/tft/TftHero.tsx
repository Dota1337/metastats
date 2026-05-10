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

const ROTATION_MS = 3500;
const COUNT_FULL = 5;
const COUNT_COMPACT = 3;

function pickRandomDistinct(
  pool: TftCompanion[],
  n: number,
  exclude: Set<string>,
): TftCompanion[] {
  const candidates = pool.filter(c => !exclude.has(c.species + '|' + c.name));
  const picked: TftCompanion[] = [];
  const taken = new Set<string>();
  while (picked.length < n && taken.size < candidates.length) {
    const idx = Math.floor(Math.random() * candidates.length);
    const c = candidates[idx];
    const key = c.species + '|' + c.name;
    if (taken.has(key)) continue;
    taken.add(key);
    picked.push(c);
  }
  return picked;
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

  const pool = useMemo(() => {
    if (!assets?.chibis) return [];
    return Object.values(assets.chibis).filter(
      c => (c.rarity === 'kMythic' || c.rarity === 'kLegendary') && !!c.icon,
    );
  }, [assets]);

  const count = compact ? COUNT_COMPACT : COUNT_FULL;
  const [slots, setSlots] = useState<(TftCompanion | null)[]>(() =>
    Array(count).fill(null),
  );

  useEffect(() => {
    if (pool.length === 0) return;
    const initial = pickRandomDistinct(pool, count, new Set());
    setSlots(() => {
      const next: (TftCompanion | null)[] = Array(count).fill(null);
      for (let i = 0; i < count; i++) next[i] = initial[i] || null;
      return next;
    });
  }, [pool, count]);

  useEffect(() => {
    if (pool.length === 0) return;
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    const id = window.setInterval(() => {
      setSlots(prev => {
        const next = [...prev];
        const slotIdx = Math.floor(Math.random() * count);
        const exclude = new Set(
          prev.filter(Boolean).map(c => c!.species + '|' + c!.name),
        );
        const [pickedNew] = pickRandomDistinct(pool, 1, exclude);
        if (pickedNew) next[slotIdx] = pickedNew;
        return next;
      });
    }, ROTATION_MS);
    return () => window.clearInterval(id);
  }, [pool, count]);

  const avatarSize = compact ? 56 : 84;
  const setLabel = assets ? `Set ${assets.set} · ${assets.setName}` : null;

  return (
    <div
      className={`relative overflow-hidden ${compact ? 'py-5' : 'py-8 sm:py-12'}`}
    >
      <style>{`
        @keyframes tftChibiFade {
          from { opacity: 0; transform: scale(0.88); filter: blur(2px); }
          to   { opacity: 1; transform: scale(1);    filter: blur(0); }
        }
        .tft-chibi-img { animation: tftChibiFade 0.7s ease-out; }
        @keyframes tftGlowPulse {
          0%, 100% { box-shadow: 0 0 18px rgba(123,97,255,0.18); }
          50%      { box-shadow: 0 0 32px rgba(123,97,255,0.40); }
        }
        .tft-chibi-glow { animation: tftGlowPulse 4s ease-in-out infinite; }
      `}</style>

      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at top, rgba(123,97,255,0.22) 0%, rgba(14,21,37,0) 60%), linear-gradient(180deg, #141a2e 0%, #0e1525 100%)',
        }}
      />
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#7B61FF]/40 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#7B61FF]/20 to-transparent" />

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 text-center">
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
          <p className="text-[#8a9bb0] text-sm mb-4 max-w-md mx-auto">
            {subtitle}
          </p>
        )}

        <div
          className={`flex justify-center items-center gap-3 sm:gap-5 ${compact ? 'mt-2' : 'mt-4'}`}
          aria-hidden="true"
        >
          {slots.map((chibi, i) => (
            <ChibiSlot
              key={i}
              chibi={chibi}
              assets={assets}
              size={avatarSize}
            />
          ))}
        </div>

        {children && <div className="mt-5">{children}</div>}
      </div>
    </div>
  );
}

function ChibiSlot({
  chibi,
  assets,
  size,
}: {
  chibi: TftCompanion | null;
  assets: TftAssetsBundle | null;
  size: number;
}) {
  const url = tftCompanionIconUrl(assets, chibi?.icon);
  return (
    <div
      className="tft-chibi-glow relative rounded-full overflow-hidden border border-[#7B61FF]/30"
      style={{ width: size, height: size }}
    >
      {url ? (
        <img
          key={chibi!.itemId}
          src={url}
          alt=""
          title={chibi?.name}
          className="tft-chibi-img w-full h-full object-cover"
          loading="lazy"
          onError={e => {
            (e.currentTarget as HTMLImageElement).style.opacity = '0';
          }}
        />
      ) : (
        <div className="w-full h-full bg-gradient-to-br from-[#1a2438] to-[#0d1526] animate-pulse" />
      )}
    </div>
  );
}
