'use client';
import { useEffect, useState, useMemo } from 'react';
import { withAlpha } from '../../../lib/color';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import TierFilter, { type TierBucket } from '../../../components/tft/TierFilter';
import { useI18n } from '../../../lib/i18n';
import { loadTftAssets, tftIconUrl, tftChampionTileUrl, findChampion, tftTraitDisplayName, type TftAssetsBundle } from '../../../lib/tft-cdragon';
import { parseClusterKey } from '../../../lib/tft-cluster';
import { costColor as costColorOf } from '../../../lib/tft-ui';
import { computeActiveTraits, activeTraitStyleColor, type ActiveTrait } from '../../../lib/tft-active-traits';

// Comp-Comparison-View — zwei Comps nebeneinander mit Δ-Stats und
// Active-Traits-Diff. Zugang via URL-Param `?a=<slug>&b=<slug>` oder
// (geplant) Compare-Button von Listing-Page.
//
// User-Mehrwert: schnelle Patch-Decision „welche Comp ist diesen Patch
// staerker?". Ohne Page-Switching.

export default function TftCompsComparePage() {
  const { t } = useI18n();
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const slugA = search.get('a') || '';
  const slugB = search.get('b') || '';
  const [bucket, setBucket] = useState<TierBucket>((search.get('bucket') as TierBucket) || 'master_plus');
  const [region, setRegion] = useState<string>(search.get('region') || 'all');
  const [compA, setCompA] = useState<any | null | undefined>(undefined);
  const [compB, setCompB] = useState<any | null | undefined>(undefined);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);

  useEffect(() => {
    if (!pathname) return;
    const next = new URLSearchParams(search.toString());
    if (region === 'all') next.delete('region'); else next.set('region', region);
    if (bucket === 'master_plus') next.delete('bucket'); else next.set('bucket', bucket);
    const q = next.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }, [region, bucket, pathname, router, search]);

  useEffect(() => {
    if (!slugA || !slugB) return;
    const url = (slug: string) =>
      `/api/tft/comps?region=${region}&bucket=${bucket}&slug=${encodeURIComponent(slug)}&days=14&minGames=30&variant=family`;
    Promise.all([
      fetch(url(slugA)).then(r => r.json()).catch(() => ({ comp: null })),
      fetch(url(slugB)).then(r => r.json()).catch(() => ({ comp: null })),
    ]).then(([a, b]) => {
      setCompA(a.comp || null);
      setCompB(b.comp || null);
    });
  }, [slugA, slugB, bucket, region]);

  const traitsA = useMemo(() => compA ? computeActiveTraits(compA.typicalUnits, compA.clusterKey, assets) : [], [compA, assets]);
  const traitsB = useMemo(() => compB ? computeActiveTraits(compB.typicalUnits, compB.clusterKey, assets) : [], [compB, assets]);

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav active="comps" />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <a href="/tft/comps" className="text-accent text-xs hover:underline">← {t('nav.comps')}</a>

        <div className="flex flex-wrap items-center justify-between gap-3 mt-2 mb-5">
          <h1 className="text-white text-xl font-medium">{t('tft.compare.title')}</h1>
          <div className="flex items-center gap-2">
            <TierFilter value={bucket} onChange={setBucket} />
          </div>
        </div>

        {(!slugA || !slugB) && (
          <div className="bg-surface-base border border-border-subtle rounded p-6 text-center">
            <div className="text-white text-sm font-medium">{t('tft.compare.pickTwo')}</div>
            <div className="text-fg-muted text-xs mt-2 leading-relaxed">
              {t('tft.compare.pickTwo.hint')}
            </div>
            <a
              href="/tft/comps"
              className="inline-block mt-3 px-3 py-1.5 text-xs bg-accent text-white rounded hover:bg-[#8B71FF] transition-colors"
            >
              {t('tft.compare.goToList')}
            </a>
          </div>
        )}

        {slugA && slugB && compA !== undefined && compB !== undefined && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <CompPanel comp={compA} assets={assets} t={t} side="a" />
            <CompPanel comp={compB} assets={assets} t={t} side="b" />
            {compA && compB && (
              <>
                <DiffPanel
                  title={t('tft.avgPlacement')}
                  a={compA.avgPlacement}
                  b={compB.avgPlacement}
                  fmt={n => n.toFixed(2)}
                  lowerIsBetter
                />
                <DiffPanel
                  title={t('tft.top4')}
                  a={compA.top4Rate}
                  b={compB.top4Rate}
                  fmt={n => `${(n * 100).toFixed(1)}%`}
                />
                <DiffPanel
                  title={t('tft.top1')}
                  a={compA.top1Rate}
                  b={compB.top1Rate}
                  fmt={n => `${(n * 100).toFixed(1)}%`}
                />
                <DiffPanel
                  title={t('tft.pickRate')}
                  a={compA.pickRate}
                  b={compB.pickRate}
                  fmt={n => `${(n * 100).toFixed(2)}%`}
                />
                <TraitsCompare
                  traitsA={traitsA}
                  traitsB={traitsB}
                  assets={assets}
                  t={t}
                />
              </>
            )}
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}

function CompPanel({
  comp, assets, t, side,
}: {
  comp: any | null;
  assets: TftAssetsBundle | null;
  t: (k: any) => string;
  side: 'a' | 'b';
}) {
  if (!comp) {
    return (
      <div className="bg-surface-base border border-border-subtle rounded p-4 text-center">
        <div className="text-fg-muted text-xs">{t('tft.compare.notFound')}</div>
      </div>
    );
  }
  const parts = parseClusterKey(comp.clusterKey);
  const traitName = parts ? (tftTraitDisplayName(assets, parts.trait) || parts.trait.replace(/^TFT\d+_/, '')) : '';
  const carry = parts && assets ? assets.champions[parts.carry] : null;
  const carryUrl = tftChampionTileUrl(assets, carry);
  const accentColor = side === 'a' ? '#7B61FF' : '#3ecf8e';
  return (
    <div
      className="bg-surface-base border rounded p-4"
      style={{ borderColor: `${withAlpha(accentColor, 0x40)}` }}
    >
      <div className="flex items-center gap-3 mb-3">
        {carryUrl ? (
          <img src={carryUrl} alt="" className="w-12 h-12 rounded-md border-2" style={{ borderColor: '#c39bff' }} />
        ) : (
          <div className="w-12 h-12 rounded-md bg-surface-overlay" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-fg-bright text-xs truncate">{traitName}</div>
          <div className="text-white text-base font-medium truncate">{carry?.name || ''}</div>
        </div>
      </div>
      {comp.typicalUnits && comp.typicalUnits.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {comp.typicalUnits.slice(0, 8).map((u: { characterId: string }) => {
            const ch = findChampion(assets, u.characterId);
            const url = tftChampionTileUrl(assets, ch);
            const cost = ch?.cost ?? 1;
            return (
              <div key={u.characterId} className="flex flex-col items-center">
                <div
                  className="w-9 h-9 rounded-md border-2 overflow-hidden"
                  style={{ borderColor: costColorOf(cost) }}
                  title={ch?.name || u.characterId}
                >
                  {url && <img src={url} alt={ch?.name || ''} className="w-full h-full object-cover" />}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DiffPanel({
  title, a, b, fmt, lowerIsBetter,
}: {
  title: string;
  a: number | null;
  b: number | null;
  fmt: (n: number) => string;
  lowerIsBetter?: boolean;
}) {
  if (a == null || b == null) {
    return (
      <div className="bg-surface-base border border-border-subtle rounded p-4 col-span-1 lg:col-span-2">
        <div className="text-fg-secondary text-xs uppercase tracking-widest mb-2">{title}</div>
        <div className="text-fg-muted text-sm">—</div>
      </div>
    );
  }
  const diff = a - b;
  const aIsBetter = lowerIsBetter ? a < b : a > b;
  const tieClass = Math.abs(diff) < 0.001;
  return (
    <div className="bg-surface-base border border-border-subtle rounded p-4 col-span-1 lg:col-span-2">
      <div className="text-fg-secondary text-xs uppercase tracking-widest mb-2">{title}</div>
      <div className="grid grid-cols-3 items-center gap-2">
        <div
          className="text-right text-lg font-medium tabular-nums"
          style={{ color: tieClass ? 'var(--fg-bright)' : aIsBetter ? '#3ecf8e' : '#e44040' }}
        >
          {fmt(a)}
        </div>
        <div className="text-center text-fg-muted text-xs tabular-nums">
          {tieClass ? '=' : (
            <span style={{ color: lowerIsBetter ? (diff < 0 ? '#3ecf8e' : '#e44040') : (diff > 0 ? '#3ecf8e' : '#e44040') }}>
              Δ {fmt(Math.abs(diff))}
            </span>
          )}
        </div>
        <div
          className="text-left text-lg font-medium tabular-nums"
          style={{ color: tieClass ? 'var(--fg-bright)' : !aIsBetter ? '#3ecf8e' : '#e44040' }}
        >
          {fmt(b)}
        </div>
      </div>
    </div>
  );
}

function TraitsCompare({
  traitsA, traitsB, assets, t,
}: {
  traitsA: ActiveTrait[];
  traitsB: ActiveTrait[];
  assets: TftAssetsBundle | null;
  t: (k: any) => string;
}) {
  const setA = new Set(traitsA.map(tr => tr.apiName));
  const setB = new Set(traitsB.map(tr => tr.apiName));
  const shared = traitsA.filter(tr => setB.has(tr.apiName));
  const onlyA = traitsA.filter(tr => !setB.has(tr.apiName));
  const onlyB = traitsB.filter(tr => !setA.has(tr.apiName));
  return (
    <div className="bg-surface-base border border-border-subtle rounded p-4 col-span-1 lg:col-span-2">
      <div className="text-fg-secondary text-xs uppercase tracking-widest mb-3">{t('tft.compare.traits')}</div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <TraitColumn title={t('tft.compare.traits.shared')} traits={shared} assets={assets} accent="var(--fg-bright)" />
        <TraitColumn title={t('tft.compare.traits.onlyA')} traits={onlyA} assets={assets} accent="#7B61FF" />
        <TraitColumn title={t('tft.compare.traits.onlyB')} traits={onlyB} assets={assets} accent="#3ecf8e" />
      </div>
    </div>
  );
}

function TraitColumn({
  title, traits, assets, accent,
}: {
  title: string;
  traits: ActiveTrait[];
  assets: TftAssetsBundle | null;
  accent: string;
}) {
  return (
    <div className="bg-surface-raised border border-border-subtle rounded p-3">
      <div className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: accent }}>{title}</div>
      {traits.length === 0 ? (
        <div className="text-fg-faint text-[11px]">—</div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {traits.map(tr => {
            const color = activeTraitStyleColor(tr.style);
            const iconUrl = tr.icon ? tftIconUrl(assets, tr.icon) : null;
            return (
              <div
                key={tr.apiName}
                className="flex items-center gap-1 px-1.5 py-1 rounded border bg-surface-sunken"
                style={{ borderColor: `${withAlpha(color, 0x55)}` }}
                title={tr.displayName}
              >
                {iconUrl && <img src={iconUrl} alt="" className="w-4 h-4" style={{ filter: `drop-shadow(0 0 2px ${color})` }} />}
                <span className="text-[10px] font-bold tabular-nums" style={{ color }}>{tr.count}</span>
                <span className="text-white text-[11px]">{tr.displayName}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
