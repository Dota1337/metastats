'use client';
import { useEffect, useState } from 'react';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import TierFilter, { type TierBucket } from '../../components/tft/TierFilter';
import EmptyData from '../../components/tft/EmptyData';
import CompCard from '../../components/tft/CompCard';
import { useI18n } from '../../lib/i18n';
import {
  loadTftSetMeta, loadTftChampions, loadTftItems, loadTftTraits, loadTftAugments,
  type TftChampion, type TftItem, type TftTrait, type TftAugment,
} from '../../lib/tft-dd-assets';

export default function TftCompsPage() {
  const { t } = useI18n();
  const [bucket, setBucket] = useState<TierBucket>('master_plus');
  const [comps, setComps] = useState<any[]>([]);
  const [hasData, setHasData] = useState<boolean | null>(null);
  const [ddVersion, setDdVersion] = useState('');
  const [champs, setChamps] = useState<Record<string, TftChampion>>({});
  const [items, setItems] = useState<Record<number, TftItem>>({});
  const [traits, setTraits] = useState<Record<string, TftTrait>>({});
  const [augs, setAugs] = useState<Record<string, TftAugment>>({});

  useEffect(() => { loadTftSetMeta().then(meta => { if (meta?.latestPatch) setDdVersion(meta.latestPatch); }); }, []);
  useEffect(() => {
    if (!ddVersion) return;
    loadTftChampions(ddVersion).then(setChamps);
    loadTftItems(ddVersion).then(setItems);
    loadTftTraits(ddVersion).then(setTraits);
    loadTftAugments(ddVersion).then(setAugs);
  }, [ddVersion]);
  useEffect(() => {
    fetch(`/api/tft/comps?region=euw1&bucket=${bucket}&source=data`)
      .then(r => r.json())
      .then(d => { setHasData(!!d.hasData); setComps(d.comps || []); })
      .catch(() => { setHasData(false); setComps([]); });
  }, [bucket]);

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="comps" />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-5">
          <h1 className="text-white text-2xl font-medium">{t('nav.comps')}</h1>
          <TierFilter value={bucket} onChange={setBucket} />
        </div>

        {hasData === false && <EmptyData />}
        {hasData && comps.length === 0 && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6 text-center text-[#8a9bb0] text-sm">
            Keine Comps mit ausreichend Spielen in diesem Tier-Bucket.
          </div>
        )}

        <div className="space-y-3">
          {comps.map(c => (
            <CompCard
              key={c.slug}
              comp={c}
              ddVersion={ddVersion}
              champs={champs}
              items={items}
              traits={traits}
              augs={augs}
              href={`/tft/comps/${encodeURIComponent(c.slug)}?bucket=${bucket}`}
            />
          ))}
        </div>
      </div>
      <Footer />
    </main>
  );
}
