'use client';
import { useEffect, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import EmptyData from '../../components/tft/EmptyData';
import StatsFilterBar, {
  filtersFromSearchParams,
  filtersToQueryString,
  type Filters,
  type PatchInfo,
} from '../../components/tft/StatsFilterBar';
import { useI18n } from '../../lib/i18n';
import { loadTftAssets, tftIconUrl, type TftAssetsBundle } from '../../lib/tft-cdragon';
import TftHero from '../../components/tft/TftHero';

interface AugRow {
  apiName: string;
  slot: number | null;
  games: number;
  avgPlacement: number | null;
  top4Rate: number | null;
  pickRate: number | null;
}

const SLOT_LABELS: Record<string, string> = { all: 'Alle', '0': '2-1', '1': '3-2', '2': '4-2' };
const TIER_LABELS: Record<number, string> = { 1: 'Silver', 2: 'Gold', 3: 'Prismatic' };
const TIER_COLORS: Record<number, string> = { 1: '#9ab0bf', 2: '#e0c75a', 3: '#c39bff' };

export default function TftAugmentsPage() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [filters, setFilters] = useState<Filters>(() => filtersFromSearchParams(new URLSearchParams(searchParams.toString())));
  const [slot, setSlot] = useState<string>('all');
  const [rows, setRows] = useState<AugRow[]>([]);
  const [hasData, setHasData] = useState<boolean | null>(null);
  const [patches, setPatches] = useState<PatchInfo[]>([]);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);

  useEffect(() => {
    setLoading(true);
    const qs = filtersToQueryString(filters) + (slot !== 'all' ? `&slot=${slot}` : '');
    fetch(`/api/tft/augments?${qs}`)
      .then(r => r.json())
      .then(d => {
        setHasData(!!d.hasData);
        setRows(d.augments || []);
        setPatches(d.patches || []);
        setLoading(false);
      })
      .catch(() => { setHasData(false); setRows([]); setLoading(false); });
    const url = `${pathname}?${filtersToQueryString(filters)}`;
    if (typeof window !== 'undefined' && window.location.pathname + window.location.search !== url) {
      router.replace(url, { scroll: false });
    }
  }, [filters, slot, pathname, router]);

  const currentPatchLabel = patches[0]?.patch;

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="augments" />
      <TftHero pageTitle={t('nav.augments')} patch={currentPatchLabel} />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-2 pb-6">
        <StatsFilterBar filters={filters} patches={patches} onChange={setFilters} />

        <div className="flex flex-wrap gap-1 mb-4">
          <span className="text-[#7a8aa0] text-xs self-center mr-2">{t('tft.slot')}:</span>
          {['all', '0', '1', '2'].map(s => (
            <button
              key={s}
              onClick={() => setSlot(s)}
              className={`px-3 py-1 rounded text-xs ${slot === s ? 'bg-[#7B61FF] text-white' : 'bg-[#141c2e] text-[#a0b0c5] hover:text-white'}`}
            >
              {SLOT_LABELS[s] || s}
            </button>
          ))}
        </div>

        {loading && hasData === null && (
          <div className="text-[#7a8aa0] text-center py-8">{t('tft.noDataYet').replace('Noch keine Daten', 'Lade')}</div>
        )}
        {hasData === false && <EmptyData />}
        {hasData && rows.length === 0 && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6 text-center text-[#a0b0c5] text-sm">
            Set 17 enthält keine Augments — die Sektion füllt sich, sobald Riot das Augment-Feld in einem Set wieder ausliefert.
          </div>
        )}

        {hasData && rows.length > 0 && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded overflow-hidden">
            <div className="hidden md:grid grid-cols-[3rem_1fr_5rem_5rem_5rem_5rem_5rem] gap-2 px-4 py-2 text-[10px] uppercase text-[#7a8aa0] bg-[#0a0e1a]">
              <div></div>
              <div>Augment</div>
              <div className="text-right">Tier</div>
              <div className="text-right">{t('tft.avgPlacement')}</div>
              <div className="text-right">{t('tft.pickRate')}</div>
              <div className="text-right">{t('tft.top4')}</div>
              <div className="text-right">{t('tft.gamesShort')}</div>
            </div>
            <div className="md:hidden px-4 py-2 text-[10px] uppercase tracking-widest text-[#7a8aa0] bg-[#0a0e1a]">Augment</div>
            {rows.map(r => {
              const meta = assets?.augments[r.apiName];
              const tierColor = TIER_COLORS[meta?.tier ?? 0] || '#7a8aa0';
              const url = tftIconUrl(assets, meta?.icon);
              return (
                <a key={`${r.apiName}-${r.slot ?? 'all'}`}
                   href={`/tft/augments/${encodeURIComponent(r.apiName)}?bucket=${filters.bucket}`}
                   className="block md:grid md:grid-cols-[3rem_1fr_5rem_5rem_5rem_5rem_5rem] gap-2 px-4 py-2 md:items-center text-xs border-t border-[#1e2a3a] hover:bg-white/5">
                  <div className="flex items-center gap-3 md:contents">
                    {url ? (
                      <img src={url} alt={meta!.name} className="w-9 h-9 rounded border-2 flex-shrink-0" style={{ borderColor: tierColor }} />
                    ) : (
                      <div className="w-9 h-9 rounded border-2 bg-[#1e2a3a] flex items-center justify-center text-[8px] text-[#7a8aa0] flex-shrink-0" style={{ borderColor: tierColor }}>{prettyAug(r.apiName)}</div>
                    )}
                    <div className="flex-1 min-w-0 md:flex-initial">
                      <div className="text-white truncate">{meta?.name || prettyAug(r.apiName)}</div>
                      <div className="md:hidden text-[10px]" style={{ color: tierColor }}>
                        {TIER_LABELS[meta?.tier ?? 0] || '—'}
                      </div>
                    </div>
                  </div>
                  <div className="hidden md:block text-right text-xs" style={{ color: tierColor }}>{TIER_LABELS[meta?.tier ?? 0] || '—'}</div>
                  <div className="grid grid-cols-4 gap-2 mt-1.5 pl-12 md:pl-0 md:mt-0 md:contents">
                    <Cell label={t('tft.avgPlacement')} value={r.avgPlacement?.toFixed(2) ?? '—'} accent="white" />
                    <Cell label={t('tft.pickRate')} value={r.pickRate != null ? `${(r.pickRate * 100).toFixed(1)}%` : '—'} />
                    <Cell label={t('tft.top4')} value={r.top4Rate != null ? `${(r.top4Rate * 100).toFixed(1)}%` : '—'} />
                    <Cell label={t('tft.gamesShort')} value={String(r.games)} accent="muted" />
                  </div>
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

function prettyAug(s: string) { return s.replace(/^TFT\d+_Augment_/, '').slice(0, 10); }

function Cell({ label, value, accent }: { label: string; value: string; accent?: 'white' | 'muted' }) {
  const valueClass = accent === 'white' ? 'text-white' : accent === 'muted' ? 'text-[#7a8aa0]' : 'text-[#a0b0c5]';
  return (
    <>
      <div className="md:hidden">
        <div className="text-[#7a8aa0] text-[9px] uppercase tracking-widest leading-tight">{label}</div>
        <div className={`${valueClass} tabular-nums leading-tight`}>{value}</div>
      </div>
      <div className={`hidden md:block text-right ${valueClass} tabular-nums`}>{value}</div>
    </>
  );
}
