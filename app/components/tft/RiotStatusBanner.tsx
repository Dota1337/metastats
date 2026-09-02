'use client';

// Stoerungs-Banner fuer die TFT-Seiten. Optik uebernommen vom internen
// Gegenstueck im Ops-Dashboard (app/components/internal/OpsGraph.tsx:307):
// farbiger Punkt, eine Zeile, Rahmen in der Farbe der Stufe.
//
// Drei bewusste Unterschiede zur internen Fassung:
//   * Sechssprachig statt fest auf Deutsch.
//   * Ohne Riots eigenen Meldungstext — der ist englisch, und ein englischer
//     Satz mitten auf einer koreanischen Seite ist schlechter als keiner.
//   * Nur die Regionen, die der Besucher gerade ansieht.
//
// Und wie das interne: still, wenn nichts anliegt. Kein „alles in Ordnung"
// (siehe feedback_no_info_texts).

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useI18n } from '../../lib/i18n';
import { ACTIVE_REGIONS, ACTIVE_REGIONS_ASIA, ACTIVE_REGIONS_WEST } from '../../lib/active-regions';
import { REGIONS } from '../../lib/regions';

type Severity = 'warning' | 'critical';

interface StatusRegion {
  region: string;
  status: 'ok' | 'info' | 'warning' | 'critical' | 'unknown';
  worstSeverity: 'info' | 'warning' | 'critical' | null;
  activeIncidents: number;
  activeMaintenances: number;
}

const SEVERITY_COLOR: Record<Severity, string> = {
  warning: '#f97316',
  critical: '#ef4444',
};

const LABEL_BY_REGION: Record<string, string> = Object.fromEntries(
  REGIONS.map(r => [r.value, r.label]),
);

/**
 * Welche Regionen der Besucher gerade ansieht. Die Filterleiste schreibt ihre
 * Auswahl in die Adresse (app/components/tft/StatsFilterBar.tsx:249); ohne
 * Angabe gilt „alle", genau wie dort. `west`/`asia` sind Gruppen, alles andere
 * ist eine einzelne Region.
 */
function regionsInView(param: string | null): readonly string[] {
  if (!param || param === 'all') return ACTIVE_REGIONS;
  if (param === 'west') return ACTIVE_REGIONS_WEST;
  if (param === 'asia') return ACTIVE_REGIONS_ASIA;
  return [param];
}

export default function RiotStatusBanner() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const [regions, setRegions] = useState<StatusRegion[] | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/api/tft/status', { signal: ctrl.signal })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d && Array.isArray(d.regions)) setRegions(d.regions as StatusRegion[]); })
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  const scope = regionsInView(searchParams?.get('region') ?? null);

  const affected = useMemo(() => {
    if (!regions) return [];
    const inScope = new Set(scope);
    // `info` ist bewusst draussen: Riot meldet darunter auch Belangloses, und
    // ein Dauer-Banner liest irgendwann niemand mehr. `unknown` ebenfalls —
    // dass WIR Riot nicht erreichen, ist keine Stoerung des Spiels.
    return regions.filter(r =>
      inScope.has(r.region) && (r.worstSeverity === 'warning' || r.worstSeverity === 'critical'),
    );
  }, [regions, scope]);

  if (affected.length === 0) return null;

  const worst: Severity = affected.some(r => r.worstSeverity === 'critical') ? 'critical' : 'warning';
  const color = SEVERITY_COLOR[worst];
  const names = affected.map(r => LABEL_BY_REGION[r.region] || r.region.toUpperCase()).join(', ');

  return (
    <div
      className="border rounded px-3 py-2 mb-3 bg-surface-base/95"
      style={{ borderColor: color }}
      role="status"
    >
      <div className="flex items-center gap-2 text-xs sm:text-sm">
        <span
          className="inline-block w-2 h-2 rounded-full flex-shrink-0 animate-pulse"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
        <span style={{ color }}>
          {worst === 'critical' ? t('tft.riotStatus.critical') : t('tft.riotStatus.warning')}
        </span>
        <span className="text-fg-muted">{names}</span>
      </div>
    </div>
  );
}
