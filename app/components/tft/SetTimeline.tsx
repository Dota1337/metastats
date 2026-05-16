'use client';
import { useI18n, type Lang } from '../../lib/i18n';

// Compact "set X · name · N days left" indicator under the marketvalue
// sparkline. Replaces the older visual timeline that showed start/end
// dates, patch ticks and a progress bar — the sparkline above already
// anchors visually to set-start, so all that's left to say is how much
// of the current set is still ahead.

export interface SetInfo {
  setNumber: number;
  setName: string;
  startDate: string | null;
  endDate: string | null;
  today: string;
  progressPct: number | null;
  currentPatch?: string;
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 86_400_000,
  );
}

export default function SetTimeline({ lang: _lang, info }: { lang: Lang; info: SetInfo }) {
  const { t } = useI18n();
  if (!info.startDate || !info.endDate) return null;

  const remainingDays = Math.max(0, daysBetween(info.today, info.endDate));

  return (
    <div className="mt-4 pt-3 border-t border-[#1e2a3a] flex items-center gap-2 text-xs text-[#a0b0c5]">
      <span className="text-white font-medium">
        {t('tft.setTimeline.setLabel').replace('{n}', String(info.setNumber))}
      </span>
      <span className="text-[#7a8aa0]">·</span>
      <span>{info.setName}</span>
      <span className="text-[#7a8aa0]">·</span>
      <span className="tabular-nums">
        {t('tft.setTimeline.remaining').replace('{r}', String(remainingDays))}
      </span>
    </div>
  );
}
