'use client';
import { useEffect, useState } from 'react';
import { withAlpha } from '../../lib/color';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import { useI18n } from '../../lib/i18n';
import { loadTftAssets, tftChampionTileUrl, findChampion, findTrait, type TftAssetsBundle } from '../../lib/tft-cdragon';

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
  const [search, setSearch] = useState('');

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
    <main className="min-h-screen bg-surface-page">
      <Nav active="onetricks" />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <h1 className="text-white text-2xl font-medium mb-1">{t('tft.onetricks.title')}</h1>
        <p className="text-fg-secondary text-sm mb-5">{t('tft.onetricks.subtitle')}</p>

        <div className="mb-3">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('tft.search.player')}
            className="w-full sm:w-80 bg-surface-raised border border-border-subtle rounded px-3 py-1.5 text-sm text-white placeholder:text-fg-faint outline-none focus:border-accent-a60"
          />
        </div>

        <div className="flex flex-wrap gap-1 mb-4">
          {REGIONS.map(r => (
            <button
              key={r}
              onClick={() => setRegion(r)}
              className={`px-3 py-1.5 text-xs uppercase tracking-widest rounded border transition-colors ${
                region === r
                  ? 'bg-accent border-accent text-white'
                  : 'bg-surface-raised border-border-subtle text-fg-secondary hover:border-accent-a40'
              }`}
            >{r}</button>
          ))}
        </div>

        {loading && <div className="text-fg-secondary text-center py-8">…</div>}
        {!loading && data.length === 0 && (
          <div className="text-fg-secondary text-center py-8">{t('tft.onetricks.empty')}</div>
        )}

        <div className="space-y-2">
          {data
            .filter(p => {
              const q = search.trim().toLowerCase();
              if (!q) return true;
              return (p.gameName || '').toLowerCase().includes(q)
                || (p.tagLine || '').toLowerCase().includes(q);
            })
            .map((p, idx) => {
            const display = p.gameName || '—';
            // Tier-color the specialty score: 90%+=purple, 75-90%=violet, else green
            const specPct = p.top2Share * 100;
            const specColor = specPct >= 90 ? '#a892ff' : specPct >= 75 ? '#7B61FF' : '#3ecf8e';
            const tierBg = p.tier === 'CHALLENGER' ? '#f0c040'
              : p.tier === 'GRANDMASTER' ? '#e44040'
              : p.tier === 'MASTER' ? '#9d48e0'
              : '#3a8ddc';
            const top1Width = p.top2Share > 0 ? (p.signatureComps[0]?.share ?? 0) / p.top2Share * 100 : 0;
            return (
              <div key={p.puuid} className="bg-surface-base border border-border-subtle rounded p-3 hover:border-accent-a30 transition-colors">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-fg-muted text-xs tabular-nums w-6 font-medium">#{idx + 1}</span>
                  <span className="text-[9px] tabular-nums uppercase tracking-widest px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: `${withAlpha(tierBg, 0x20)}`, color: tierBg }}>
                    {p.tier.slice(0, 3)}
                  </span>
                  <a
                    href={`/tft/player/${encodeURIComponent(display)}?region=${region}`}
                    className="text-white font-medium hover:text-[#a892ff] flex-1 truncate"
                  >
                    {display}{p.tagLine ? <span className="text-fg-muted">#{p.tagLine}</span> : null}
                  </a>
                  <span className="text-[10px] text-fg-muted tabular-nums">{p.totalGames} {t('tft.gamesShort')}</span>
                </div>
                {/* Specialty-bar: visualizes top1 vs top2 share split */}
                <div className="mb-2.5">
                  <div className="flex justify-between text-[10px] mb-1">
                    <span className="text-fg-muted">{t('tft.onetricks.specialty')}</span>
                    <span className="tabular-nums font-medium" style={{ color: specColor }}>{specPct.toFixed(0)}%</span>
                  </div>
                  <div className="h-1.5 bg-surface-overlay rounded overflow-hidden flex">
                    <div className="h-full" style={{ width: `${(p.top2Share * top1Width / 100 * 100).toFixed(0)}%`, backgroundColor: specColor }} />
                    <div className="h-full" style={{ width: `${(p.top2Share * (1 - top1Width / 100) * 100).toFixed(0)}%`, backgroundColor: `${withAlpha(specColor, 0x80)}` }} />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {p.signatureComps.map(c => {
                    const parts = parseCluster(c.clusterKey);
                    const trait = parts ? findTrait(assets, parts.trait) : null;
                    const traitName = trait?.name || (parts ? parts.trait.replace(/^TFT\d+_/, '') : '');
                    const carry = parts ? findChampion(assets, parts.carry) : null;
                    return (
                      <a
                        key={c.clusterKey}
                        href={`/tft/comps/${encodeURIComponent(c.clusterKey)}`}
                        className="flex items-center gap-2 bg-surface-raised border border-border-subtle rounded p-2 hover:border-accent-a40"
                      >
                        {tftChampionTileUrl(assets, carry) && (
                          <img src={tftChampionTileUrl(assets, carry)!} alt="" className="w-8 h-8 rounded border border-[#c39bff]/60 flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-white text-[11px] truncate">
                            {traitName} · {carry?.name || (parts ? parts.carry.replace(/^TFT\d+_/, '') : '')}
                          </div>
                          <div className="text-[10px] text-fg-muted tabular-nums">
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
