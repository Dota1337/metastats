'use client';
import { useEffect, useState } from 'react';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import { useI18n } from '../../lib/i18n';
import { loadTftAssets, tftChampionTileUrl, type TftAssetsBundle } from '../../lib/tft-cdragon';

const REGIONS = ['euw1', 'kr', 'na1', 'eun1', 'br1', 'jp1', 'oc1', 'la1', 'la2', 'tr1', 'ru'] as const;
type Region = typeof REGIONS[number];

interface SignatureComp {
  clusterKey: string;
  games: number;
  share: number;
  avgPlacement: number | null;
}
interface OneTrick {
  puuid: string;
  gameName: string | null;
  tagLine: string | null;
  tier: string;
  finalValue: number;
  totalGames: number;
  top1Share: number;
  top2Share: number;
  signatureComps: SignatureComp[];
}

function parseCluster(key: string) {
  const m = /^(.+)@(\d+)_(.+)$/.exec(key);
  return m ? { trait: m[1], level: Number(m[2]), carry: m[3] } : null;
}

export default function TftOneTricksPage() {
  const { t } = useI18n();
  const [region, setRegion] = useState<Region>('euw1');
  const [data, setData] = useState<OneTrick[]>([]);
  const [loading, setLoading] = useState(false);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setData([]);
    fetch(`/api/tft/onetricks?region=${region}`)
      .then(r => r.ok ? r.json() : { onetricks: [] })
      .then(d => { if (!cancelled) { setData(d.onetricks || []); setLoading(false); } })
      .catch(() => { if (!cancelled) { setData([]); setLoading(false); } });
    return () => { cancelled = true; };
  }, [region]);

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="onetricks" />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <h1 className="text-white text-2xl font-medium mb-1">{t('tft.onetricks.title')}</h1>
        <p className="text-[#a0b0c5] text-sm mb-5">{t('tft.onetricks.subtitle')}</p>

        <div className="flex flex-wrap gap-1 mb-4">
          {REGIONS.map(r => (
            <button
              key={r}
              onClick={() => setRegion(r)}
              className={`px-3 py-1.5 text-xs uppercase tracking-widest rounded border transition-colors ${
                region === r
                  ? 'bg-[#7B61FF] border-[#7B61FF] text-white'
                  : 'bg-[#141c2e] border-[#1e2a3a] text-[#a0b0c5] hover:border-[#7B61FF]/40'
              }`}
            >{r}</button>
          ))}
        </div>

        {loading && <div className="text-[#a0b0c5] text-center py-8">…</div>}
        {!loading && data.length === 0 && (
          <div className="text-[#a0b0c5] text-center py-8">{t('tft.onetricks.empty')}</div>
        )}

        <div className="space-y-2">
          {data.map((p, idx) => {
            const display = p.gameName || '—';
            return (
              <div key={p.puuid} className="bg-[#0d1526] border border-[#1e2a3a] rounded p-3">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-[#7a8aa0] text-xs tabular-nums w-6">#{idx + 1}</span>
                  <a
                    href={`/tft/player/${encodeURIComponent(display)}?region=${region}`}
                    className="text-white font-medium hover:text-[#a892ff] flex-1 truncate"
                  >
                    {display}{p.tagLine ? <span className="text-[#7a8aa0]">#{p.tagLine}</span> : null}
                  </a>
                  <span className="text-[10px] text-[#a892ff] tabular-nums">{p.tier}</span>
                  <span className="text-[11px] text-[#3ecf8e] tabular-nums">
                    {(p.top2Share * 100).toFixed(0)}% {t('tft.onetricks.specialty')}
                  </span>
                  <span className="text-[10px] text-[#7a8aa0] tabular-nums">{p.totalGames}g</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {p.signatureComps.map(c => {
                    const parts = parseCluster(c.clusterKey);
                    const traitName = parts && assets?.traits[parts.trait]?.name
                      ? assets.traits[parts.trait].name
                      : parts ? parts.trait.replace(/^TFT\d+_/, '') : '';
                    const carry = parts && assets ? assets.champions[parts.carry] : null;
                    return (
                      <a
                        key={c.clusterKey}
                        href={`/tft/comps/${encodeURIComponent(c.clusterKey)}`}
                        className="flex items-center gap-2 bg-[#141c2e] border border-[#1e2a3a] rounded p-2 hover:border-[#7B61FF]/40"
                      >
                        {tftChampionTileUrl(assets, carry) && (
                          <img src={tftChampionTileUrl(assets, carry)!} alt="" className="w-8 h-8 rounded border border-[#c39bff]/60 flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-white text-[11px] truncate">
                            {traitName} · {carry?.name || (parts ? parts.carry.replace(/^TFT\d+_/, '') : '')}
                          </div>
                          <div className="text-[10px] text-[#7a8aa0] tabular-nums">
                            {(c.share * 100).toFixed(0)}% · Ø {c.avgPlacement?.toFixed(2) ?? '—'}
                          </div>
                        </div>
                      </a>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <Footer />
    </main>
  );
}
