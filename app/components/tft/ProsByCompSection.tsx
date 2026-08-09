'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useI18n } from '../../lib/i18n';

// Zeigt die Top-Pros die diese Comp gespielt haben. Family-Mode matched alle
// Sub-Cluster (Level/Star/Augment) der gleichen <trait>__<carry>-Familie.
// Empty-State: nichts rendern, kein Info-Text (feedback_no_info_texts).
// Voraussetzung Backend: tft_player_match_cache mit unifizierter Klassifikation
// (siehe reference_tft_classification_bridge.md).

interface ProEntry {
  puuid: string;
  proName: string | null;
  gameName: string | null;
  tagLine: string | null;
  region: string | null;
  classification: string | null;
  games: number;
  avgPlacement: number | null;
  top4Rate: number | null;
  top1Rate: number | null;
}

interface Props {
  familyKey: string;
  setNumber: number;
}

function regionLabel(region: string | null): string {
  if (!region) return '';
  const map: Record<string, string> = {
    euw1: 'EUW', eun1: 'EUNE', tr1: 'TR', ru: 'RU', me1: 'ME',
    na1: 'NA', br1: 'BR', la1: 'LAN', la2: 'LAS',
    kr: 'KR', jp1: 'JP', oc1: 'OCE', sg2: 'SG', tw2: 'TW', vn2: 'VN', ph2: 'PH', th2: 'TH',
  };
  return map[region.toLowerCase()] ?? region.toUpperCase();
}

export default function ProsByCompSection({ familyKey, setNumber }: Props) {
  const { t } = useI18n();
  const [pros, setPros] = useState<ProEntry[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/tft/pros/by-comp?family=${encodeURIComponent(familyKey)}&set=${setNumber}&topN=8&minGames=2`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled) return;
        setPros(Array.isArray(data?.pros) ? data.pros : []);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setPros([]);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [familyKey, setNumber]);

  if (loading) {
    return (
      <div className="mt-6">
        <h2 className="text-lg font-semibold text-[#cfd8dc] mb-3">{t('tft.comp.detail.prosPlayingThis')}</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 bg-surface-base border border-border-subtle rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!pros || pros.length === 0) return null;

  return (
    <div className="mt-6">
      <h2 className="text-lg font-semibold text-[#cfd8dc] mb-3">{t('tft.comp.detail.prosPlayingThis')}</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {pros.map(p => {
          const display = p.proName || p.gameName || '???';
          const tag = p.tagLine ? `#${p.tagLine}` : '';
          const region = p.region || 'euw1';
          const playerHref = p.gameName && p.tagLine
            ? `/tft/player/${encodeURIComponent(p.gameName + '-' + p.tagLine)}?region=${region}`
            : null;
          const card = (
            <div className="bg-surface-base border border-border-subtle hover:border-[#2a3a4f] transition rounded p-2.5">
              <div className="flex items-baseline justify-between gap-1">
                <div className="text-sm font-medium text-white truncate" title={display + tag}>
                  {display}
                </div>
                <div className="text-[10px] text-[#6b7480] flex-shrink-0">{regionLabel(p.region)}</div>
              </div>
              <div className="flex items-baseline gap-2 mt-1.5">
                <div className="text-base font-semibold text-[#3ecf8e]">
                  {p.avgPlacement != null ? p.avgPlacement.toFixed(2) : '–'}
                </div>
                <div className="text-[10px] text-[#9aa5b1]">{p.games}g</div>
              </div>
              <div className="text-[10px] text-[#6b7480] mt-0.5">
                {p.top1Rate != null && (
                  <>Top1 {Math.round(p.top1Rate * 100)}%</>
                )}
                {p.top1Rate != null && p.top4Rate != null && ' · '}
                {p.top4Rate != null && (
                  <>Top4 {Math.round(p.top4Rate * 100)}%</>
                )}
              </div>
            </div>
          );
          return playerHref ? (
            <Link key={p.puuid} href={playerHref} className="block">
              {card}
            </Link>
          ) : (
            <div key={p.puuid}>{card}</div>
          );
        })}
      </div>
    </div>
  );
}
