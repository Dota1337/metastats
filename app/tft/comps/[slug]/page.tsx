'use client';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import TierFilter, { type TierBucket } from '../../../components/tft/TierFilter';
import EmptyData from '../../../components/tft/EmptyData';
import CompCard from '../../../components/tft/CompCard';
import { useI18n } from '../../../lib/i18n';
import { loadTftAssets, type TftAssetsBundle } from '../../../lib/tft-cdragon';

export default function TftCompDetailPage() {
  const { t } = useI18n();
  const params = useParams();
  const search = useSearchParams();
  const slug = decodeURIComponent(String(params?.slug || ''));
  const [bucket, setBucket] = useState<TierBucket>((search.get('bucket') as TierBucket) || 'master_plus');
  const [comp, setComp] = useState<any | null | undefined>(undefined);
  const [hasData, setHasData] = useState<boolean | null>(null);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);
  useEffect(() => {
    fetch(`/api/tft/comps?region=euw1&bucket=${bucket}&slug=${encodeURIComponent(slug)}`)
      .then(r => r.json())
      .then(d => { setHasData(!!d.hasData); setComp(d.comp || null); })
      .catch(() => { setHasData(false); setComp(null); });
  }, [bucket, slug]);

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="comps" />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <a href="/tft/comps" className="text-[#7B61FF] text-xs hover:underline">← {t('nav.comps')}</a>

        <div className="flex justify-end mt-2 mb-4">
          <TierFilter value={bucket} onChange={setBucket} />
        </div>

        {hasData === false && <EmptyData />}
        {comp === null && hasData && (
          <div className="text-[#8a9bb0] text-center py-8">Comp nicht gefunden.</div>
        )}

        {comp && (
          <>
            <CompCard comp={comp} assets={assets} />

            {/* Counters from KG */}
            {comp.counters && (comp.counters.beats?.length > 0 || comp.counters.losesTo?.length > 0) && (
              <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <h3 className="text-green-400 text-xs uppercase tracking-widest mb-2">Stark gegen</h3>
                  <div className="space-y-1.5">
                    {(comp.counters.beats || []).length === 0 && <div className="text-[#4a5a70] text-xs">Keine signifikanten Daten</div>}
                    {(comp.counters.beats || []).map((c: any, i: number) => (
                      <a key={i} href={`/tft/comps/${encodeURIComponent(c.b)}?bucket=${bucket}`}
                         className="flex items-center justify-between bg-[#0d1526] border border-[#1e2a3a] rounded px-3 py-2 hover:border-green-500/40">
                        <span className="text-white text-xs truncate">{prettyComp(c.b)}</span>
                        <span className="text-green-400 text-xs">{Math.round(c.aWinRate * 100)}% · {c.games}g</span>
                      </a>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="text-red-400 text-xs uppercase tracking-widest mb-2">Schwach gegen</h3>
                  <div className="space-y-1.5">
                    {(comp.counters.losesTo || []).length === 0 && <div className="text-[#4a5a70] text-xs">Keine signifikanten Daten</div>}
                    {(comp.counters.losesTo || []).map((c: any, i: number) => (
                      <a key={i} href={`/tft/comps/${encodeURIComponent(c.a)}?bucket=${bucket}`}
                         className="flex items-center justify-between bg-[#0d1526] border border-[#1e2a3a] rounded px-3 py-2 hover:border-red-500/40">
                        <span className="text-white text-xs truncate">{prettyComp(c.a)}</span>
                        <span className="text-red-400 text-xs">{Math.round(c.aWinRate * 100)}% · {c.games}g</span>
                      </a>
                    ))}
                  </div>
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

function prettyComp(slug: string) {
  const m = /^(.+)@(\d+)_(.+)$/.exec(slug);
  if (!m) return slug;
  return `${m[1].replace(/^TFT\d+_/, '')} ${m[2]} · ${m[3].replace(/^TFT\d+_/, '')}`;
}
