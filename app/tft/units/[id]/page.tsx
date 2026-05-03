'use client';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import TierFilter, { type TierBucket } from '../../../components/tft/TierFilter';
import EmptyData from '../../../components/tft/EmptyData';
import { useI18n } from '../../../lib/i18n';
import { loadTftChampions, loadTftItems, loadTftSetMeta, loadTftTraits, type TftChampion, type TftItem, type TftTrait } from '../../../lib/tft-dd-assets';

interface UnitDetail {
  characterId: string;
  games: number;
  avgPlacement: number | null;
  top4Rate: number | null;
  top1Rate: number | null;
  topItems: { item: string; games: number; avgPlacement: number | null; top4Rate: number | null }[];
  topItemSets: { items: string[]; games: number; avgPlacement: number | null; top4Rate: number | null }[];
}

export default function TftUnitDetailPage() {
  const { t } = useI18n();
  const params = useParams();
  const search = useSearchParams();
  const id = decodeURIComponent(String(params?.id || ''));
  const initialBucket = (search.get('bucket') as TierBucket) || 'master_plus';
  const [bucket, setBucket] = useState<TierBucket>(initialBucket);
  const [data, setData] = useState<UnitDetail | null | undefined>(undefined); // undefined = loading
  const [hasData, setHasData] = useState<boolean | null>(null);
  const [ddVersion, setDdVersion] = useState('');
  const [champ, setChamp] = useState<TftChampion | null>(null);
  const [items, setItems] = useState<Record<number, TftItem>>({});
  const [traits, setTraits] = useState<Record<string, TftTrait>>({});

  useEffect(() => {
    loadTftSetMeta().then(meta => { if (meta?.latestPatch) setDdVersion(meta.latestPatch); });
  }, []);
  useEffect(() => {
    if (!ddVersion) return;
    loadTftChampions(ddVersion).then(map => setChamp(map[id] || null));
    loadTftItems(ddVersion).then(setItems);
    loadTftTraits(ddVersion).then(setTraits);
  }, [ddVersion, id]);

  useEffect(() => {
    fetch(`/api/tft/units?region=euw1&bucket=${bucket}&id=${encodeURIComponent(id)}`)
      .then(r => r.json())
      .then(d => { setHasData(!!d.hasData); setData(d.unit || null); })
      .catch(() => { setHasData(false); setData(null); });
  }, [bucket, id]);

  // Build a quick apiName -> item lookup. Match-V1 uses apiName strings
  // ("TFT_Item_GiantSlayer"), Data Dragon keys items by integer id but
  // exposes the apiName via `apiName` on the item object.
  const itemsByApiName: Record<string, TftItem> = Object.fromEntries(
    Object.values(items).map(i => [(i as any).apiName || `unknown_${i.id}`, i])
  );
  // Also try suffix match: api name is something like "TFT_Item_GiantSlayer"
  // and image is something like "TFT_Item_GiantSlayer.png" — direct image
  // path for any unknown apiName.

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="units" />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-5 mb-5">
          <a href="/tft/units" className="text-[#7B61FF] text-xs hover:underline">← {t('nav.units')}</a>
          <div className="flex items-center gap-4 mt-2">
            {ddVersion && champ?.image?.full && (
              <img
                src={`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/tft-champion/${champ.image.full}`}
                alt={champ.name}
                className="w-16 h-16 rounded-lg border-2 border-[#7B61FF]"
              />
            )}
            <div className="flex-1">
              <h1 className="text-white text-2xl font-medium">{champ?.name || id}</h1>
              <div className="text-[#8a9bb0] text-xs mt-0.5">
                {champ?.cost ? `${champ.cost}-Cost` : ''}
                {champ?.traits?.length ? ' · ' + champ.traits.map(t => traits[t]?.name || t).join(' · ') : ''}
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end mb-4">
          <TierFilter value={bucket} onChange={setBucket} />
        </div>

        {hasData === false && <EmptyData />}
        {data === null && hasData && (
          <div className="text-[#8a9bb0] text-center py-8">{t('tft.unit.notFound')}</div>
        )}
        {data && (
          <>
            {/* Stat strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              <Stat label={t('tft.avgPlacement')} value={data.avgPlacement?.toFixed(2) ?? '—'} />
              <Stat label={t('tft.top4')} value={data.top4Rate != null ? `${(data.top4Rate * 100).toFixed(1)}%` : '—'} />
              <Stat label={t('tft.top1')} value={data.top1Rate != null ? `${(data.top1Rate * 100).toFixed(1)}%` : '—'} />
              <Stat label={t('tft.gamesShort')} value={data.games.toLocaleString('de-DE')} />
            </div>

            {/* Top item builds — User-Top-Prio: 5 häufigste 3-Item-Combos */}
            {data.topItemSets.length > 0 && (
              <Section title={t('tft.topBuilds')}>
                <div className="space-y-2">
                  {data.topItemSets.map((s, i) => (
                    <div key={i} className="flex items-center gap-3 bg-[#141c2e] border border-[#1e2a3a] rounded p-3">
                      <div className="flex gap-1.5">
                        {s.items.map((it, j) => (
                          <ItemIcon key={j} apiName={it} ddVersion={ddVersion} byApiName={itemsByApiName} />
                        ))}
                      </div>
                      <div className="flex-1" />
                      <div className="text-right text-xs">
                        <div className="text-white">Ø {s.avgPlacement?.toFixed(2) ?? '—'}</div>
                        <div className="text-[#4a5a70]">
                          {s.top4Rate != null ? `${(s.top4Rate * 100).toFixed(0)}% T4` : ''} · {s.games}g
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Most-used items across all slots */}
            {data.topItems.length > 0 && (
              <Section title={t('tft.mostUsedItems')}>
                <div className="flex flex-wrap gap-2">
                  {data.topItems.map((it, i) => (
                    <div key={i} className="flex flex-col items-center gap-1 bg-[#141c2e] border border-[#1e2a3a] rounded p-1.5 w-16">
                      <ItemIcon apiName={it.item} ddVersion={ddVersion} byApiName={itemsByApiName} size={9} />
                      <div className="text-[10px] text-white">Ø {it.avgPlacement?.toFixed(1) ?? '—'}</div>
                      <div className="text-[10px] text-[#4a5a70]">{it.games}g</div>
                    </div>
                  ))}
                </div>
              </Section>
            )}
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
      <div className="text-[#4a5a70] text-[10px] uppercase tracking-widest">{label}</div>
      <div className="text-white text-lg font-medium mt-1">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h2 className="text-[#8a9bb0] text-xs uppercase tracking-widest mb-2">{title}</h2>
      {children}
    </div>
  );
}

function ItemIcon({ apiName, ddVersion, byApiName, size = 10 }: { apiName: string; ddVersion: string; byApiName: Record<string, TftItem>; size?: number }) {
  const item = byApiName[apiName];
  const sizeClass = size === 10 ? 'w-10 h-10' : 'w-9 h-9';
  if (!ddVersion || !item?.image?.full) {
    return <div className={`${sizeClass} rounded bg-[#1e2a3a] flex items-center justify-center text-[8px] text-[#4a5a70] text-center px-0.5`} title={apiName}>{prettyItem(apiName)}</div>;
  }
  return (
    <img
      src={`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/tft-item/${item.image.full}`}
      alt={item.name}
      title={item.name}
      className={`${sizeClass} rounded`}
    />
  );
}

function prettyItem(apiName: string) {
  return apiName.replace(/^TFT\d*_Item_/, '').slice(0, 8);
}
