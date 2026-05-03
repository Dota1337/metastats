'use client';
import { useEffect, useState } from 'react';
import TierFilter, { type TierBucket } from './TierFilter';
import EmptyData from './EmptyData';
import CompCard from './CompCard';
import { useI18n } from '../../lib/i18n';
import {
  loadTftSetMeta, loadTftChampions, loadTftItems, loadTftTraits, loadTftAugments,
  type TftChampion, type TftItem, type TftTrait, type TftAugment,
} from '../../lib/tft-dd-assets';

// Reusable comp tier list — used both on /tft (TFT landing) and /tft/comps.
// MetaTFT-style: dense card grid sorted by avg placement, S/A/B/C tier badges,
// stats prominent on the right, units row with carry highlighted.

export default function CompList() {
  const { t } = useI18n();
  const [bucket, setBucket] = useState<TierBucket>('master_plus');
  const [comps, setComps] = useState<any[]>([]);
  const [hasData, setHasData] = useState<boolean | null>(null);
  const [ddVersion, setDdVersion] = useState('');
  const [setMeta, setSetMeta] = useState<{ setNumber: number; setName: string; latestPatch: string } | null>(null);
  const [champs, setChamps] = useState<Record<string, TftChampion>>({});
  const [items, setItems] = useState<Record<number, TftItem>>({});
  const [traits, setTraits] = useState<Record<string, TftTrait>>({});
  const [augs, setAugs] = useState<Record<string, TftAugment>>({});

  useEffect(() => {
    loadTftSetMeta().then(meta => {
      if (meta?.latestPatch) setDdVersion(meta.latestPatch);
      if (meta) setSetMeta(meta as any);
    });
  }, []);
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
    <>
      {/* Set header bar */}
      {setMeta && (
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <div className="text-[#7B61FF] text-xs uppercase tracking-widest">Set {setMeta.setNumber} · {setMeta.setName}</div>
            <h1 className="text-white text-2xl font-medium mt-1">{t('nav.comps')}</h1>
          </div>
          <TierFilter value={bucket} onChange={setBucket} />
        </div>
      )}

      {hasData === false && <EmptyData />}
      {hasData && comps.length === 0 && (
        <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6 text-center text-[#8a9bb0] text-sm">
          Keine Comps mit ausreichend Spielen in diesem Tier-Bucket.
        </div>
      )}

      <div className="space-y-2">
        {comps.map((c, i) => (
          <CompCard
            key={c.slug}
            comp={c}
            rank={i + 1}
            ddVersion={ddVersion}
            champs={champs}
            items={items}
            traits={traits}
            augs={augs}
            href={`/tft/comps/${encodeURIComponent(c.slug)}?bucket=${bucket}`}
          />
        ))}
      </div>
    </>
  );
}
