'use client';
import { useEffect, useState } from 'react';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import TftHero from '../../components/tft/TftHero';
import EmptyData from '../../components/tft/EmptyData';
import { useI18n } from '../../lib/i18n';
import { loadTftAssets, tftChampionTileUrl, type TftAssetsBundle } from '../../lib/tft-cdragon';

// W5: Meta-Pulse Landing — eine Seite, vier Pro-Sichtfenster:
//   • Trending (was bewegt sich jetzt)
//   • KR-Ahead (was spielt Korea vor dem Westen)
//   • Patch-Movers (was hat der aktuelle Patch entschieden)
// Alle Daten aus /api/tft/meta-pulse (eine Roundtrip).

interface MetaPulse {
  hasData: boolean;
  currentPatch: string | null;
  previousPatch: string | null;
  bucket: string;
  rising: { clusterKey: string; deltaAvgPlace: number; avgPlaceNow: number; gamesNow: number }[];
  krAhead: { clusterKey: string; avgPlaceKr: number; avgPlaceEu: number; pickrateKr: number; pickrateEu: number; krAheadScore: number }[];
  patchWinners: { key: string; currentAvgPlacement: number; deltaAvgPlacement: number; currentGames: number }[];
  patchLosers: { key: string; currentAvgPlacement: number; deltaAvgPlacement: number; currentGames: number }[];
  counts: { rising: number; krAhead: number; patchSampled: number };
}

export default function TftMetaPulsePage() {
  const { t } = useI18n();
  const [data, setData] = useState<MetaPulse | null>(null);
  const [loading, setLoading] = useState(true);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/tft/meta-pulse?bucket=master_plus')
      .then(r => r.json())
      .then(d => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) { setData(null); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="comps" />
      <TftHero pageTitle={t('tft.metaPulse.title')} subtitle={t('tft.metaPulse.subtitle')} patch={data?.currentPatch || undefined} />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-2 pb-6">
        {loading && (
          <div className="text-[#7a8aa0] text-center py-12">…</div>
        )}
        {!loading && !data?.hasData && <EmptyData />}

        {data?.hasData && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {/* Rising — biggest Δ-avg-place vs the comparison window. */}
            <PulseSection
              title={t('tft.metaPulse.rising')}
              accent="#3ecf8e"
              empty={data.rising.length === 0}
            >
              {data.rising.map(r => (
                <PulseRow
                  key={r.clusterKey}
                  clusterKey={r.clusterKey}
                  assets={assets}
                  primary={`Ø ${r.avgPlaceNow.toFixed(2)}`}
                  secondary={`Δ ${r.deltaAvgPlace >= 0 ? '+' : ''}${r.deltaAvgPlace.toFixed(2)}`}
                  secondaryColor={r.deltaAvgPlace < 0 ? '#3ecf8e' : '#e44040'}
                  meta={`${r.gamesNow} ${t('tft.gamesShort')}`}
                />
              ))}
            </PulseSection>

            {/* KR-Ahead — what KR plays before EU. */}
            <PulseSection
              title={t('tft.metaPulse.krAhead')}
              accent="#c39bff"
              empty={data.krAhead.length === 0}
            >
              {data.krAhead.map(r => (
                <PulseRow
                  key={r.clusterKey}
                  clusterKey={r.clusterKey}
                  assets={assets}
                  primary={`KR Ø ${r.avgPlaceKr.toFixed(2)}`}
                  secondary={`EU Ø ${r.avgPlaceEu.toFixed(2)}`}
                  secondaryColor="#a0b0c5"
                  meta={`+${((r.pickrateKr - r.pickrateEu) * 100).toFixed(2)}% pick`}
                />
              ))}
            </PulseSection>

            {/* Patch-Movers — biggest avg-place gain since previous patch. */}
            <PulseSection
              title={t('tft.metaPulse.patchWinners')}
              accent="#e0c75a"
              empty={data.patchWinners.length === 0}
              footer={data.previousPatch ? `${data.previousPatch} → ${data.currentPatch}` : undefined}
            >
              {data.patchWinners.map(r => (
                <PulseRow
                  key={r.key}
                  clusterKey={r.key}
                  assets={assets}
                  primary={`Ø ${r.currentAvgPlacement.toFixed(2)}`}
                  secondary={`Δ ${r.deltaAvgPlacement.toFixed(2)}`}
                  secondaryColor={r.deltaAvgPlacement < 0 ? '#3ecf8e' : '#e44040'}
                  meta={`${r.currentGames} ${t('tft.gamesShort')}`}
                />
              ))}
            </PulseSection>
          </div>
        )}

        {/* Pro-Workflow shortcuts. Mounted independent of hasData so the
            scout link works even when crawls are still spinning up. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-6">
          <a
            href="/tft/lobby-scout"
            className="block bg-[#0d1526] border border-[#1e2a3a] rounded p-4 hover:border-[#7B61FF]/40 transition-colors"
          >
            <div className="text-[#a0b0c5] text-[10px] uppercase tracking-widest">{t('tft.metaPulse.shortcut')}</div>
            <div className="text-white text-base font-medium mt-1">{t('tft.lobby.title')} →</div>
            <div className="text-[#7a8aa0] text-xs mt-0.5">{t('tft.lobby.subtitle')}</div>
          </a>
          <a
            href="/tft/regions"
            className="block bg-[#0d1526] border border-[#1e2a3a] rounded p-4 hover:border-[#c39bff]/40 transition-colors"
          >
            <div className="text-[#a0b0c5] text-[10px] uppercase tracking-widest">{t('tft.metaPulse.shortcut')}</div>
            <div className="text-white text-base font-medium mt-1">{t('tft.regions.title')} →</div>
            <div className="text-[#7a8aa0] text-xs mt-0.5">{t('tft.regions.subtitle')}</div>
          </a>
        </div>
      </div>
      <Footer />
    </main>
  );
}

function PulseSection({
  title, accent, children, empty, footer,
}: {
  title: string;
  accent: string;
  children: React.ReactNode;
  empty?: boolean;
  footer?: string;
}) {
  return (
    <section className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs uppercase tracking-widest" style={{ color: accent }}>{title}</h2>
        {footer && <span className="text-[#7a8aa0] text-[10px] tabular-nums">{footer}</span>}
      </div>
      {empty ? (
        <div className="text-[#5a6a80] text-xs text-center py-6">—</div>
      ) : (
        <div className="space-y-1.5">{children}</div>
      )}
    </section>
  );
}

function PulseRow({
  clusterKey, assets, primary, secondary, secondaryColor, meta,
}: {
  clusterKey: string;
  assets: TftAssetsBundle | null;
  primary: string;
  secondary: string;
  secondaryColor: string;
  meta: string;
}) {
  const m = /^(.+)@(\d+)_(.+)$/.exec(clusterKey);
  const traitName = m && assets ? (assets.traits[m[1]]?.name || m[1].replace(/^TFT\d+_/, '')) : '';
  const carry = m && assets ? assets.champions[m[3]] : null;
  const carryUrl = tftChampionTileUrl(assets, carry);

  return (
    <a
      href={`/tft/comps/${encodeURIComponent(clusterKey)}?bucket=master_plus`}
      className="block bg-[#141c2e] border border-[#1e2a3a] rounded p-2 hover:border-[#7B61FF]/40 transition-colors"
    >
      <div className="flex items-center gap-2">
        {carryUrl ? (
          <img src={carryUrl} alt="" className="w-8 h-8 rounded border-2 border-[#c39bff]/60 object-cover flex-shrink-0" />
        ) : (
          <div className="w-8 h-8 rounded bg-[#1e2a3a] flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-white text-[11px] truncate">
            {traitName} · {carry?.name || (m ? m[3].replace(/^TFT\d+_/, '') : '')}
          </div>
          <div className="text-[#7a8aa0] text-[10px] tabular-nums">{meta}</div>
        </div>
        <div className="text-right">
          <div className="text-white text-xs tabular-nums">{primary}</div>
          <div className="text-[10px] tabular-nums" style={{ color: secondaryColor }}>{secondary}</div>
        </div>
      </div>
    </a>
  );
}
