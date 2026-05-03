'use client';
import { useEffect, useState } from 'react';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import TierFilter, { type TierBucket } from '../../components/tft/TierFilter';
import EmptyData from '../../components/tft/EmptyData';
import { useI18n } from '../../lib/i18n';
import { loadTftItems, loadTftSetMeta, type TftItem } from '../../lib/tft-dd-assets';

interface ItemRow {
  apiName: string;
  games: number;
  avgPlacement: number | null;
  top4Rate: number | null;
}

export default function TftItemsPage() {
  const { t } = useI18n();
  const [bucket, setBucket] = useState<TierBucket>('master_plus');
  const [items, setItems] = useState<ItemRow[]>([]);
  const [hasData, setHasData] = useState<boolean | null>(null);
  const [ddVersion, setDdVersion] = useState('');
  const [itemMap, setItemMap] = useState<Record<number, TftItem>>({});

  useEffect(() => { loadTftSetMeta().then(meta => { if (meta?.latestPatch) setDdVersion(meta.latestPatch); }); }, []);
  useEffect(() => { if (ddVersion) loadTftItems(ddVersion).then(setItemMap); }, [ddVersion]);
  useEffect(() => {
    fetch(`/api/tft/items?region=euw1&bucket=${bucket}`)
      .then(r => r.json())
      .then(d => { setHasData(!!d.hasData); setItems(d.items || []); })
      .catch(() => { setHasData(false); setItems([]); });
  }, [bucket]);

  const byApi: Record<string, TftItem> = Object.fromEntries(
    Object.values(itemMap).map(i => [(i as any).apiName || `_${i.id}`, i])
  );

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="items" />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-5">
          <h1 className="text-white text-2xl font-medium">{t('nav.items')}</h1>
          <TierFilter value={bucket} onChange={setBucket} />
        </div>

        {hasData === false && <EmptyData />}

        {hasData && items.length > 0 && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded overflow-hidden">
            <div className="hidden md:grid grid-cols-[3rem_1fr_5rem_5rem_5rem] gap-2 px-4 py-2 text-[10px] uppercase text-[#4a5a70] bg-[#0a0e1a]">
              <div></div>
              <div>{t('nav.items')}</div>
              <div className="text-right">{t('tft.avgPlacement')}</div>
              <div className="text-right">{t('tft.top4')}</div>
              <div className="text-right">{t('tft.gamesShort')}</div>
            </div>
            {items.map(it => {
              const meta = byApi[it.apiName];
              return (
                <a
                  key={it.apiName}
                  href={`/tft/items/${encodeURIComponent(it.apiName)}?bucket=${bucket}`}
                  className="grid grid-cols-[3rem_1fr_5rem_5rem_5rem] gap-2 px-4 py-2 items-center text-xs hover:bg-white/5 border-t border-[#1e2a3a]"
                >
                  {ddVersion && meta?.image?.full ? (
                    <img src={`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/tft-item/${meta.image.full}`} alt={meta.name} className="w-9 h-9 rounded" />
                  ) : (
                    <div className="w-9 h-9 rounded bg-[#1e2a3a] flex items-center justify-center text-[8px] text-[#4a5a70] px-0.5 text-center">{prettyApi(it.apiName)}</div>
                  )}
                  <div className="text-white">{meta?.name || prettyApi(it.apiName)}</div>
                  <div className="text-right text-white">{it.avgPlacement?.toFixed(2) ?? '—'}</div>
                  <div className="text-right text-[#8a9bb0]">{it.top4Rate != null ? `${(it.top4Rate * 100).toFixed(1)}%` : '—'}</div>
                  <div className="text-right text-[#4a5a70]">{it.games}</div>
                </a>
              );
            })}
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}

function prettyApi(s: string) { return s.replace(/^TFT\d*_Item_/, '').slice(0, 10); }
