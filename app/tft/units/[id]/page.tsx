'use client';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import TierFilter, { type TierBucket } from '../../../components/tft/TierFilter';
import EmptyData from '../../../components/tft/EmptyData';
import { useI18n } from '../../../lib/i18n';
import { loadTftAssets, tftIconUrl, tftChampionTileUrl, type TftAssetsBundle } from '../../../lib/tft-cdragon';

interface UnitDetail {
  characterId: string;
  games: number;
  avgPlacement: number | null;
  top4Rate: number | null;
  top1Rate: number | null;
  topItems: { item: string; games: number; avgPlacement: number | null; top4Rate: number | null }[];
  topItemSets: { items: string[]; games: number; avgPlacement: number | null; top4Rate: number | null }[];
}

interface CompWithUnit {
  slug: string;
  clusterKey: string;
  games: number;
  avgPlacement: number | null;
  top4Rate: number | null;
}

export default function TftUnitDetailPage() {
  const { t } = useI18n();
  const params = useParams();
  const search = useSearchParams();
  const id = decodeURIComponent(String(params?.id || ''));
  const initialBucket = (search.get('bucket') as TierBucket) || 'master_plus';
  const [bucket, setBucket] = useState<TierBucket>(initialBucket);
  const [data, setData] = useState<UnitDetail | null | undefined>(undefined);
  const [hasData, setHasData] = useState<boolean | null>(null);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  const [comps, setComps] = useState<CompWithUnit[]>([]);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);
  useEffect(() => {
    fetch(`/api/tft/units?region=euw1&bucket=${bucket}&id=${encodeURIComponent(id)}`)
      .then(r => r.json())
      .then(d => { setHasData(!!d.hasData); setData(d.unit || null); })
      .catch(() => { setHasData(false); setData(null); });
    // Pull comps and filter client-side for ones containing this champion as
    // a typical unit. Pro-Frage „in welchen Comps spielt der Champion?" auf
    // der Detail-Seite ohne extra API surface.
    fetch(`/api/tft/comps?region=euw1&bucket=${bucket}&days=3&patch=current&source=data`)
      .then(r => r.json())
      .then(d => {
        const withUnit = (d.comps || [])
          .filter((c: any) => (c.typicalUnits || []).some((u: any) => u.characterId === id))
          .slice(0, 6)
          .map((c: any) => ({
            slug: c.slug,
            clusterKey: c.clusterKey,
            games: c.games,
            avgPlacement: c.avgPlacement,
            top4Rate: c.top4Rate,
          }));
        setComps(withUnit);
      })
      .catch(() => setComps([]));
  }, [bucket, id]);

  const champ = assets?.champions[id];

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="units" />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-5 mb-5">
          <a href="/tft/units" className="text-[#7B61FF] text-xs hover:underline">← {t('nav.units')}</a>
          <div className="flex items-center gap-4 mt-2">
            {tftChampionTileUrl(assets, champ) ? (
              <img src={tftChampionTileUrl(assets, champ)!} alt={champ!.name} className="w-16 h-16 rounded-lg border-2 border-[#7B61FF] object-cover" />
            ) : (
              <div className="w-16 h-16 rounded-lg bg-[#1e2a3a]" />
            )}
            <div className="flex-1">
              <h1 className="text-white text-2xl font-medium">{champ?.name || prettyChar(id)}</h1>
              <div className="text-[#a0b0c5] text-xs mt-0.5">
                {champ?.cost ? `${champ.cost}-Cost` : ''}
                {champ?.traits?.length ? ' · ' + champ.traits.map(tr => assets?.traits[tr]?.name || prettyChar(tr)).join(' · ') : ''}
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end mb-4">
          <TierFilter value={bucket} onChange={setBucket} />
        </div>

        {hasData === false && <EmptyData />}
        {data === null && hasData && (
          <div className="text-[#a0b0c5] text-center py-8">{t('tft.unit.notFound')}</div>
        )}
        {data && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              <Stat label={t('tft.avgPlacement')} value={data.avgPlacement?.toFixed(2) ?? '—'} />
              <Stat label={t('tft.top4')} value={data.top4Rate != null ? `${(data.top4Rate * 100).toFixed(1)}%` : '—'} />
              <Stat label={t('tft.top1')} value={data.top1Rate != null ? `${(data.top1Rate * 100).toFixed(1)}%` : '—'} />
              <Stat label={t('tft.gamesShort')} value={data.games.toLocaleString('de-DE')} />
            </div>

            {/* Single-screen grid: Item-Sets, Single-Items, Comps with unit. */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {data.topItemSets.length > 0 && (
                <Section title={t('tft.topBuilds')}>
                  <div className="space-y-2">
                    {data.topItemSets.slice(0, 5).map((s, i) => (
                      <div key={i} className="flex items-center gap-3 bg-[#141c2e] border border-[#1e2a3a] rounded p-2.5">
                        <div className="flex gap-1">
                          {s.items.map((it, j) => <ItemIcon key={j} apiName={it} assets={assets} size={9} />)}
                        </div>
                        <div className="flex-1" />
                        <div className="text-right text-[11px] leading-tight">
                          <div className="text-white tabular-nums">Ø {s.avgPlacement?.toFixed(2) ?? '—'}</div>
                          <div className="text-[#7a8aa0] tabular-nums">
                            {s.top4Rate != null ? `${(s.top4Rate * 100).toFixed(0)}% T4` : ''}
                            <span className="text-[#5a6a80]"> · {s.games}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {data.topItems.length > 0 && (
                <Section title={t('tft.mostUsedItems')}>
                  <div className="grid grid-cols-4 gap-1.5">
                    {data.topItems.slice(0, 12).map((it, i) => (
                      <div key={i} className="flex flex-col items-center gap-0.5 bg-[#141c2e] border border-[#1e2a3a] rounded p-1.5">
                        <ItemIcon apiName={it.item} assets={assets} size={9} />
                        <div className="text-[10px] text-white tabular-nums">Ø{it.avgPlacement?.toFixed(1) ?? '—'}</div>
                        <div className="text-[9px] text-[#7a8aa0] tabular-nums">{it.games}</div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {comps.length > 0 && (
                <Section title={t('tft.compsWithUnit')}>
                  <div className="space-y-1.5">
                    {comps.map(c => {
                      const parts = parseClusterKey(c.clusterKey);
                      const traitName = parts && assets?.traits[parts.trait]?.name
                        ? assets.traits[parts.trait].name
                        : parts ? prettyChar(parts.trait) : '';
                      const variant = parts ? extractTraitVariant(parts.trait, traitName) : null;
                      const carry = parts && assets ? assets.champions[parts.carry] : null;
                      const carryUrl = tftChampionTileUrl(assets, carry);
                      return (
                        <a
                          key={c.slug}
                          href={`/tft/comps/${encodeURIComponent(c.slug)}?bucket=${bucket}&region=euw1`}
                          className="flex items-center gap-2 bg-[#141c2e] border border-[#1e2a3a] rounded p-2 hover:border-[#7B61FF]/40 transition-colors"
                        >
                          {carryUrl && (
                            <img src={carryUrl} alt="" className="w-8 h-8 rounded border border-[#c39bff]/60 object-cover flex-shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-white text-[11px] font-medium truncate leading-tight">
                              {traitName}
                              {variant && <span className="text-[#a892ff]"> · {variant}</span>}
                              {' '}{parts?.level ?? ''}
                            </div>
                            <div className="text-[10px] text-[#7a8aa0] truncate">
                              {carry?.name || (parts ? prettyChar(parts.carry) : '')}
                            </div>
                          </div>
                          <div className="text-right text-[11px] tabular-nums leading-tight">
                            <div className="text-white">Ø {c.avgPlacement?.toFixed(2) ?? '—'}</div>
                            <div className="text-[#7a8aa0]">{c.games}</div>
                          </div>
                        </a>
                      );
                    })}
                  </div>
                </Section>
              )}
            </div>
          </>
        )}
      </div>
      <Footer />
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-3">
      <div className="text-[#7a8aa0] text-[10px] uppercase tracking-widest">{label}</div>
      <div className="text-white text-lg font-medium mt-1">{value}</div>
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h2 className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-2">{title}</h2>
      {children}
    </div>
  );
}
function ItemIcon({ apiName, assets, size = 10 }: { apiName: string; assets: TftAssetsBundle | null; size?: number }) {
  const item = assets?.items[apiName];
  const sizeClass = size === 10 ? 'w-10 h-10' : 'w-9 h-9';
  const url = tftIconUrl(assets, item?.icon);
  if (!url) {
    return <div className={`${sizeClass} rounded bg-[#1e2a3a] flex items-center justify-center text-[8px] text-[#7a8aa0] text-center px-0.5`} title={apiName}>{prettyItem(apiName)}</div>;
  }
  return <img src={url} alt={item!.name} title={item!.name} className={`${sizeClass} rounded`} />;
}
function prettyItem(s: string) { return s.replace(/^TFT\d*_Item_/, '').slice(0, 8); }
function prettyChar(s: string) { return s.replace(/^TFT\d+_/, ''); }

function parseClusterKey(key: string) {
  const m = /^(.+)@(\d+)_(.+)$/.exec(key);
  if (!m) return null;
  return { trait: m[1], level: Number(m[2]), carry: m[3] };
}

function extractTraitVariant(traitApiName: string, traitDisplayName: string): string | null {
  const stripped = traitApiName.replace(/^TFT\d+_/, '');
  if (!stripped.includes('_')) return null;
  const variant = stripped.split('_').slice(1).join(' ');
  if (!variant) return null;
  if (variant.toLowerCase() === traitDisplayName.toLowerCase()) return null;
  return variant;
}
