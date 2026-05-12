'use client';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import { useI18n } from '../../../lib/i18n';
import { loadTftAssets, tftIconUrl, type TftAssetsBundle } from '../../../lib/tft-cdragon';

// Per-patch winners/losers page. Diffs the current patch against the
// previous one using /api/tft/patch-diff. Three entity tabs (units / items
// / traits) — augments would be a fourth but Set 17 doesn't ship augments
// so we hide it until the data lands.

type Entity = 'unit' | 'item' | 'trait';
const ENTITIES: Entity[] = ['unit', 'item', 'trait'];

interface DiffEntry {
  key: string;
  currentGames: number;
  previousGames: number;
  currentAvgPlacement: number;
  previousAvgPlacement: number;
  deltaAvgPlacement: number;
  currentPickRate: number;
  previousPickRate: number;
  deltaPickRate: number;
  currentTop4Rate: number;
  previousTop4Rate: number;
  deltaTop4Rate: number;
}

interface DiffResponse {
  hasData: boolean;
  currentPatch?: string;
  previousPatch?: string | null;
  entity?: Entity;
  sampleSize?: number;
  winners?: DiffEntry[];
  losers?: DiffEntry[];
  reason?: string;
}

export default function TftPatchDetailPage() {
  const { t } = useI18n();
  const params = useParams();
  const search = useSearchParams();
  const version = decodeURIComponent(String(params?.version || ''));
  const [entity, setEntity] = useState<Entity>('unit');
  const [bucket, setBucket] = useState<string>(search.get('bucket') || 'master_plus');
  const [diff, setDiff] = useState<DiffResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/tft/patch-diff?patch=${encodeURIComponent(version)}&entity=${entity}&bucket=${bucket}`)
      .then(r => r.json())
      .then(d => { setDiff(d); setLoading(false); })
      .catch(() => { setDiff({ hasData: false }); setLoading(false); });
  }, [version, entity, bucket]);

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="comps" />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <a href="/tft/patch" className="text-[#7B61FF] text-xs hover:underline">← {t('tft.patchNotes.title')}</a>

        <h1 className="text-white text-2xl font-medium mt-3 mb-1">Patch {version}</h1>
        {diff?.previousPatch && (
          <p className="text-[#8a9bb0] text-sm mb-4">
            {t('tft.patchNotes.comparedTo')} <strong className="text-white">Patch {diff.previousPatch}</strong>
            {diff.sampleSize != null && ` · ${diff.sampleSize} ${t('tft.patchNotes.entitiesCompared')}`}
          </p>
        )}

        {/* Entity tabs */}
        <div className="flex gap-1 border-b border-[#1e2a3a] mb-4">
          {ENTITIES.map(e => (
            <button
              key={e}
              onClick={() => setEntity(e)}
              className={`px-4 py-2 text-xs font-medium uppercase tracking-widest ${
                entity === e ? 'text-white border-b-2 border-[#7B61FF]' : 'text-[#8a9bb0] hover:text-white'
              }`}
            >
              {t(`tft.patchNotes.entity.${e}` as const)}
            </button>
          ))}
        </div>

        {/* Tier-Bucket filter */}
        <div className="flex flex-wrap gap-1 mb-4">
          {['master_plus', 'challenger', 'grandmaster', 'master', 'diamond'].map(b => (
            <button
              key={b}
              onClick={() => setBucket(b)}
              className={`px-3 py-1 rounded text-xs ${bucket === b ? 'bg-[#7B61FF] text-white' : 'bg-[#141c2e] text-[#8a9bb0] hover:text-white'}`}
            >
              {b.replace('_plus', '+').replace(/^./, c => c.toUpperCase())}
            </button>
          ))}
        </div>

        {loading && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6 text-center text-[#8a9bb0] text-sm">
            {t('tft.loading')}
          </div>
        )}

        {!loading && (!diff?.hasData) && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6 text-center text-[#8a9bb0] text-sm">
            {diff?.reason === 'single_patch'
              ? t('tft.patchNotes.singlePatch')
              : t('tft.patchNotes.empty')}
          </div>
        )}

        {!loading && diff?.hasData && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DiffColumn
              title={t('tft.patchNotes.winners')}
              entries={diff.winners || []}
              direction="up"
              entity={entity}
              assets={assets}
            />
            <DiffColumn
              title={t('tft.patchNotes.losers')}
              entries={diff.losers || []}
              direction="down"
              entity={entity}
              assets={assets}
            />
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}

function DiffColumn({
  title, entries, direction, entity, assets,
}: {
  title: string;
  entries: DiffEntry[];
  direction: 'up' | 'down';
  entity: Entity;
  assets: TftAssetsBundle | null;
}) {
  const headerColor = direction === 'up' ? 'text-[#3ecf8e]' : 'text-[#e44040]';
  return (
    <div className="bg-[#0d1526] border border-[#1e2a3a] rounded overflow-hidden">
      <div className={`px-4 py-2 bg-[#0a0e1a] text-xs uppercase tracking-widest ${headerColor}`}>
        {direction === 'up' ? '▲' : '▼'} {title}
      </div>
      {entries.length === 0 ? (
        <div className="p-4 text-[#4a5a70] text-xs text-center">—</div>
      ) : entries.map(e => (
        <DiffRow key={e.key} entry={e} entity={entity} assets={assets} />
      ))}
    </div>
  );
}

function DiffRow({ entry, entity, assets }: { entry: DiffEntry; entity: Entity; assets: TftAssetsBundle | null }) {
  const meta = entity === 'unit'
    ? assets?.champions[entry.key]
    : entity === 'item'
      ? assets?.items[entry.key]
      : assets?.traits[entry.key];
  const url = tftIconUrl(assets, meta?.icon);
  const linkBase = entity === 'unit' ? '/tft/units'
    : entity === 'item' ? '/tft/items'
    : '/tft/traits';
  const deltaColor = entry.deltaAvgPlacement < 0 ? '#3ecf8e' : '#e44040';
  return (
    <a
      href={`${linkBase}/${encodeURIComponent(entry.key)}`}
      className="grid grid-cols-[2.5rem_1fr_5rem_4rem] gap-2 px-4 py-2 items-center text-xs border-t border-[#1e2a3a] hover:bg-white/5"
    >
      {url ? (
        <img src={url} alt={meta!.name} className="w-9 h-9 rounded" />
      ) : (
        <div className="w-9 h-9 rounded bg-[#1e2a3a]" />
      )}
      <div className="text-white truncate">
        {meta?.name || entry.key}
        <div className="text-[#4a5a70] text-[10px]">
          {entry.currentAvgPlacement.toFixed(2)} ← {entry.previousAvgPlacement.toFixed(2)}
        </div>
      </div>
      <div className="text-right tabular-nums">
        <div className="font-medium" style={{ color: deltaColor }}>
          {entry.deltaAvgPlacement > 0 ? '+' : ''}{entry.deltaAvgPlacement.toFixed(2)}
        </div>
        <div className="text-[#4a5a70] text-[10px]">avg Δ</div>
      </div>
      <div className="text-right text-[#4a5a70] text-[10px]">
        {entry.currentGames.toLocaleString()}
      </div>
    </a>
  );
}
