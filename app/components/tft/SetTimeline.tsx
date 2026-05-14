'use client';
import { useEffect, useState } from 'react';
import { useI18n, LOCALE_MAP, type Lang } from '../../lib/i18n';

// Horizontal timeline from set-start to set-end. Shows:
//   - major patch ticks (17.1 / 17.2 / 17.3) — taller, in accent purple
//   - hotfix / mini-patch ticks (17.3b, 17.3c) — shorter, in muted grey
//   - today marker (filled circle on the line)
// Lives directly underneath the 30d sparkline in MarketValueHero so the
// user gets the "where are we in this season" context at a glance.

interface PatchPoint { version: string; date: string; isMajor: boolean; isHotfix: boolean }
interface SetInfo {
  setNumber: number;
  setName: string;
  startDate: string | null;
  endDate: string | null;
  today: string;
  progressPct: number | null;
  currentPatch: string;
  patches: PatchPoint[];
}

function fmtShort(iso: string, lang: Lang): string {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString(LOCALE_MAP[lang], { day: '2-digit', month: 'short' });
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 86_400_000);
}

export default function SetTimeline({ lang }: { lang: Lang }) {
  const { t } = useI18n();
  const [info, setInfo] = useState<SetInfo | null>(null);
  const [hoverPatch, setHoverPatch] = useState<PatchPoint | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/tft/sets/current')
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (!cancelled && j && !j.error) setInfo(j); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!info || !info.startDate || !info.endDate || info.progressPct == null) {
    return null;
  }

  const totalDays = daysBetween(info.startDate, info.endDate);
  const elapsedDays = Math.max(0, daysBetween(info.startDate, info.today));
  const remainingDays = Math.max(0, totalDays - elapsedDays);

  // x-position helper: 0..100% along the line
  const xPct = (iso: string) => {
    const d = daysBetween(info.startDate!, iso);
    return Math.max(0, Math.min(100, (d / totalDays) * 100));
  };

  return (
    <div className="mt-4 pt-4 border-t border-[#1e2a3a]">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <div>
          <div className="text-white text-sm font-medium">
            {t('tft.setTimeline.setLabel').replace('{n}', String(info.setNumber))} · {info.setName}
          </div>
          <div className="text-[#a0b0c5] text-xs mt-0.5">
            {t('tft.setTimeline.dayOf')
              .replace('{d}', String(elapsedDays))
              .replace('{t}', String(totalDays))}
            {' · '}
            {t('tft.setTimeline.remaining').replace('{r}', String(remainingDays))}
          </div>
        </div>
        <div className="text-[#a0b0c5] text-xs tabular-nums hidden sm:block">
          {info.progressPct.toFixed(0)}%
        </div>
      </div>

      <div className="relative h-10">
        {/* Base rail */}
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[2px] bg-[#1e2a3a] rounded-full" />
        {/* Elapsed (filled) portion */}
        <div
          className="absolute left-0 top-1/2 -translate-y-1/2 h-[2px] bg-gradient-to-r from-[#7B61FF] to-[#9d48e0] rounded-full"
          style={{ width: `${info.progressPct}%` }}
        />

        {/* Patch ticks */}
        {info.patches.map(p => {
          const x = xPct(p.date);
          const major = p.isMajor;
          const future = p.date > info.today;
          return (
            <div
              key={p.version}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
              style={{ left: `${x}%` }}
              onMouseEnter={() => setHoverPatch(p)}
              onMouseLeave={() => setHoverPatch(null)}
            >
              <div
                className={
                  major
                    ? `w-[2px] ${future ? 'bg-[#3a4a64]' : 'bg-[#a0b0c5]'} h-3`
                    : `w-[1px] ${future ? 'bg-[#2a3a50]' : 'bg-[#7a8aa0]'} h-2`
                }
              />
            </div>
          );
        })}

        {/* Today marker */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
          style={{ left: `${info.progressPct}%` }}
          title={`${t('tft.setTimeline.today')}: ${info.today}`}
        >
          <div className="w-3 h-3 rounded-full bg-[#7B61FF] ring-2 ring-[#0d1526] shadow-[0_0_8px_rgba(123,97,255,0.6)]" />
        </div>

        {/* Patch tooltip on hover */}
        {hoverPatch && (
          <div
            className="absolute -top-1 -translate-x-1/2 -translate-y-full bg-[#0d1526] border border-[#1e2a3a] rounded px-2 py-1 text-[10px] text-white whitespace-nowrap pointer-events-none z-10"
            style={{ left: `${xPct(hoverPatch.date)}%` }}
          >
            <span className="font-medium">{hoverPatch.version}</span>
            <span className="text-[#a0b0c5] ml-1.5">
              {fmtShort(hoverPatch.date, lang)}
              {hoverPatch.isHotfix ? ` · ${t('tft.setTimeline.hotfix')}` : ''}
            </span>
          </div>
        )}
      </div>

      <div className="flex justify-between mt-1.5 text-[10px] text-[#a0b0c5] tabular-nums">
        <span>{fmtShort(info.startDate, lang)}</span>
        <span>{fmtShort(info.endDate, lang)}</span>
      </div>
    </div>
  );
}
