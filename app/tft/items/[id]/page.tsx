'use client';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import TierFilter, { type TierBucket } from '../../../components/tft/TierFilter';
import EmptyData from '../../../components/tft/EmptyData';
import { useI18n } from '../../../lib/i18n';
import { loadTftAssets, tftIconUrl, type TftAssetsBundle } from '../../../lib/tft-cdragon';

interface ItemDetail {
  apiName: string;
  games: number;
  avgPlacement: number | null;
  top4Rate: number | null;
  topUsers: { characterId: string; games: number; avgPlacement: number | null }[];
}

export default function TftItemDetailPage() {
  const { t } = useI18n();
  const params = useParams();
  const search = useSearchParams();
  const id = decodeURIComponent(String(params?.id || ''));
  const [bucket, setBucket] = useState<TierBucket>((search.get('bucket') as TierBucket) || 'master_plus');
  const [data, setData] = useState<ItemDetail | null | undefined>(undefined);
  const [hasData, setHasData] = useState<boolean | null>(null);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);
  useEffect(() => {
    fetch(`/api/tft/items?region=euw1&bucket=${bucket}&id=${encodeURIComponent(id)}`)
      .then(r => r.json())
      .then(d => { setHasData(!!d.hasData); setData(d.item || null); })
      .catch(() => { setHasData(false); setData(null); });
  }, [bucket, id]);

  const itemMeta = assets?.items[id];
  const url = tftIconUrl(assets, itemMeta?.icon);

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="items" />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-5 mb-5">
          <a href="/tft/items" className="text-[#7B61FF] text-xs hover:underline">← {t('nav.items')}</a>
          <div className="flex items-center gap-4 mt-2">
            {url ? (
              <img src={url} alt={itemMeta!.name} className="w-16 h-16 rounded-lg border-2 border-[#7B61FF]" />
            ) : (
              <div className="w-16 h-16 rounded-lg bg-[#1e2a3a]" />
            )}
            <div className="flex-1">
              <h1 className="text-white text-2xl font-medium">{itemMeta?.name || prettyApi(id)}</h1>
              {itemMeta?.desc && <p className="text-[#8a9bb0] text-xs mt-1 max-w-prose">{itemMeta.desc}</p>}
            </div>
          </div>
        </div>

        <div className="flex justify-end mb-4">
          <TierFilter value={bucket} onChange={setBucket} />
        </div>

        {hasData === false && <EmptyData />}
        {data && (
          <>
            <div className="grid grid-cols-3 gap-3 mb-5">
              <Stat label={t('tft.avgPlacement')} value={data.avgPlacement?.toFixed(2) ?? '—'} />
              <Stat label={t('tft.top4')} value={data.top4Rate != null ? `${(data.top4Rate * 100).toFixed(1)}%` : '—'} />
              <Stat label={t('tft.gamesShort')} value={data.games.toLocaleString('de-DE')} />
            </div>

            {data.topUsers.length > 0 && (
              <div className="mb-5">
                <h2 className="text-[#8a9bb0] text-xs uppercase tracking-widest mb-2">{t('tft.topUsers')}</h2>
                <div className="flex flex-wrap gap-2">
                  {data.topUsers.map(u => {
                    const ch = assets?.champions[u.characterId];
                    const churl = tftIconUrl(assets, ch?.icon);
                    return (
                      <a key={u.characterId} href={`/tft/units/${encodeURIComponent(u.characterId)}?bucket=${bucket}`}
                         className="flex flex-col items-center gap-1 bg-[#141c2e] border border-[#1e2a3a] rounded p-2 w-20 hover:border-[#7B61FF]/50">
                        {churl
                          ? <img src={churl} alt={ch!.name} className="w-10 h-10 rounded object-cover" />
                          : <div className="w-10 h-10 rounded bg-[#1e2a3a]" />}
                        <div className="text-[10px] text-white text-center truncate w-full">{ch?.name || prettyChar(u.characterId)}</div>
                        <div className="text-[10px] text-[#4a5a70]">{u.games} {t('tft.gamesShort')}</div>
                      </a>
                    );
                  })}
                </div>
              </div>
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
function prettyApi(s: string) { return s.replace(/^TFT\d*_Item_/, ''); }
function prettyChar(id: string) { return id.replace(/^TFT\d+_/, ''); }
