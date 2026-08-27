'use client';
import { useEffect, useMemo, useState } from 'react';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import TftHero from '../../components/tft/TftHero';
import EmptyData from '../../components/tft/EmptyData';
import { useI18n } from '../../lib/i18n';
import { loadTftAssets, tftChampionTileUrl, findChampion, type TftAssetsBundle, type TftChampion } from '../../lib/tft-cdragon';
import { costColor as costColorOf } from '../../lib/tft-ui';

// W4-A: Lobby-Comp-Predictor — Pro tippt 3-5 sichtbare Units einer
// Opponent-Comp, System rankt die wahrscheinlichsten Comps. Match-Logik
// rein clientseitig gegen die bereits gecachten Comp-Daten, kein extra
// API-Endpoint nötig. Ranking-Score = pickrate × overlap (Bayes-light).

interface Comp {
  slug: string;
  clusterKey: string;
  games: number;
  avgPlacement: number | null;
  pickRate: number | null;
  typicalUnits: { characterId: string; count: number | unknown }[];
}

interface Match {
  comp: Comp;
  overlap: number;     // |selected ∩ typical| / |selected|
  score: number;       // pickRate-weighted overlap
  matchedCount: number;
  totalSelected: number;
}

const MAX_SELECT = 6;

export default function TftLobbyScoutPage() {
  const { t } = useI18n();
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  const [comps, setComps] = useState<Comp[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [costFilter, setCostFilter] = useState<number | 'all'>('all');

  useEffect(() => { loadTftAssets().then(setAssets); }, []);

  useEffect(() => {
    fetch('/api/tft/comps?region=all&bucket=master_plus&days=3')
      .then(r => r.json())
      .then(d => setComps(d.comps || []))
      .catch(() => setComps([]));
  }, []);

  // Playable-only champion catalog for the current set. CDragon ships PvE
  // mobs (cost 11, e.g. TFT17_PVE_Krug "Cosmic Bruiser", TimebreakerCore),
  // boss encounters (TFT17_Enemy_Aatrox "Apex Primordian"), and map-mechanic
  // fakes (TFT17_DarkStar_FakeUnit "Mini Black Hole") in the same dictionary
  // as the regular units — so `cost > 0` alone isn't enough. Real playable
  // units have cost 1-5 AND at least one trait; the non-playables fail one
  // of those two even when the apiName looks innocent.
  const champions = useMemo(() => {
    if (!assets) return [] as [string, TftChampion][];
    const q = query.trim().toLowerCase();
    return Object.entries(assets.champions)
      .filter(([id, c]) =>
        id.startsWith(`TFT${assets.set}_`) &&
        c.cost >= 1 && c.cost <= 5 &&
        Array.isArray(c.traits) && c.traits.length > 0,
      )
      .filter(([_, c]) => costFilter === 'all' || c.cost === costFilter)
      .filter(([_, c]) => !q || c.name.toLowerCase().includes(q))
      .sort((a, b) => a[1].cost - b[1].cost || a[1].name.localeCompare(b[1].name));
  }, [assets, query, costFilter]);

  const matches = useMemo<Match[]>(() => {
    if (selected.length === 0 || comps.length === 0) return [];
    const selectedSet = new Set(selected);
    const rows: Match[] = [];
    for (const c of comps) {
      const typical = new Set((c.typicalUnits || []).slice(0, 9).map(u => u.characterId));
      let matched = 0;
      for (const u of selectedSet) if (typical.has(u)) matched++;
      if (matched === 0) continue;
      const overlap = matched / selected.length;
      // Score weights overlap stronger than raw pickrate so a niche-but-
      // perfect-match comp (overlap 1.0) outranks an everyday comp with
      // only half the units matching — that's the lobby-reading instinct.
      const pickrate = c.pickRate ?? 0.001;
      const score = overlap * overlap * Math.sqrt(pickrate);
      rows.push({ comp: c, overlap, score, matchedCount: matched, totalSelected: selected.length });
    }
    rows.sort((a, b) => b.score - a.score);
    return rows.slice(0, 8);
  }, [selected, comps]);

  const totalScore = matches.reduce((s, m) => s + m.score, 0) || 1;

  function togglePick(id: string) {
    setSelected(prev => {
      if (prev.includes(id)) return prev.filter(p => p !== id);
      if (prev.length >= MAX_SELECT) return prev;
      return [...prev, id];
    });
  }

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav active="comps" />
      <TftHero pageTitle={t('tft.lobby.title')} subtitle={t('tft.lobby.subtitle')} />
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 pt-2 pb-6 grid grid-cols-1 lg:grid-cols-[1fr_22rem] gap-4">

        {/* Left — picker */}
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {(['all', 1, 2, 3, 4, 5] as const).map(c => (
              <button
                key={c}
                onClick={() => setCostFilter(c)}
                className={`px-2.5 py-1 rounded text-xs border transition-colors ${
                  costFilter === c
                    ? 'bg-accent-a20 border-accent-a60 text-white'
                    : 'bg-surface-raised border-border-subtle text-fg-secondary hover:border-accent-a40'
                }`}
              >
                {c === 'all' ? t('tft.lobby.allCosts') : `${c} ${t('tft.cost') || ''}`}
              </button>
            ))}
            <input
              type="text"
              placeholder={t('tft.lobby.searchPlaceholder')}
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="flex-1 min-w-[140px] bg-surface-raised border border-border-subtle rounded px-3 py-1 text-xs text-white focus:outline-none focus:border-accent-a60"
            />
          </div>

          {assets && (
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
              {champions.map(([id, c]) => {
                const url = tftChampionTileUrl(assets, c);
                const isSelected = selected.includes(id);
                return (
                  <button
                    key={id}
                    onClick={() => togglePick(id)}
                    className={`group relative bg-surface-raised rounded border-2 transition-all hover:bg-[#1a2742] ${
                      isSelected ? 'ring-2 ring-accent' : ''
                    }`}
                    style={{ borderColor: isSelected ? '#7B61FF' : costColorOf(c.cost) }}
                  >
                    {url ? (
                      <img src={url} alt={c.name} className="w-full aspect-square object-cover rounded" />
                    ) : (
                      <div className="w-full aspect-square bg-surface-overlay" />
                    )}
                    <div className="text-white text-[9px] truncate px-0.5 py-0.5">{c.name}</div>
                    {isSelected && (
                      <span className="absolute top-1 right-1 bg-accent text-white text-[9px] w-4 h-4 rounded-full flex items-center justify-center font-bold">
                        ✓
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right — selected summary + ranked matches */}
        <aside>
          <div className="sticky top-4 space-y-3">
            <div className="bg-surface-base border border-border-subtle rounded p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-fg-secondary text-xs uppercase tracking-widest">{t('tft.lobby.selected')}</span>
                <span className="text-fg-muted text-[10px] tabular-nums">{selected.length}/{MAX_SELECT}</span>
              </div>
              {selected.length === 0 ? (
                <div className="text-fg-faint text-xs text-center py-3">—</div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {selected.map(id => {
                    const c = findChampion(assets, id);
                    const url = tftChampionTileUrl(assets, c);
                    return (
                      <button
                        key={id}
                        onClick={() => togglePick(id)}
                        className="relative group"
                        title={c?.name}
                      >
                        {url ? (
                          <img src={url} alt={c?.name || id} className="w-9 h-9 rounded border-2" style={{ borderColor: c ? costColorOf(c.cost) : 'var(--border-subtle)' }} />
                        ) : (
                          <div className="w-9 h-9 rounded bg-surface-overlay" />
                        )}
                        <span className="absolute -top-1 -right-1 bg-[#e44040] text-white text-[8px] w-3.5 h-3.5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100">×</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="bg-surface-base border border-border-subtle rounded p-3">
              <h2 className="text-fg-secondary text-xs uppercase tracking-widest mb-2">{t('tft.lobby.matches')}</h2>
              {matches.length === 0 ? (
                <div className="text-fg-faint text-xs text-center py-4">
                  {selected.length === 0 ? '—' : <EmptyData />}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {matches.map(m => {
                    const parts = /^(.+)@(\d+)_(.+)$/.exec(m.comp.clusterKey);
                    const traitName = parts && assets ? (assets.traits[parts[1]]?.name || parts[1].replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '')) : '';
                    const carry = parts && assets ? assets.champions[parts[3]] : null;
                    const carryUrl = tftChampionTileUrl(assets, carry);
                    const confidence = (m.score / totalScore * 100).toFixed(0);
                    return (
                      <a
                        key={m.comp.slug}
                        href={`/tft/comps/${encodeURIComponent(m.comp.slug)}?bucket=master_plus`}
                        className="block bg-surface-raised border border-border-subtle rounded p-2 hover:border-accent-a40 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          {carryUrl ? (
                            <img src={carryUrl} alt="" className="w-8 h-8 rounded border-2 border-[#c39bff]/60" />
                          ) : (
                            <div className="w-8 h-8 rounded bg-surface-overlay" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-white text-[11px] truncate">
                              {traitName} · {carry?.name || ''}
                            </div>
                            <div className="text-fg-muted text-[10px] tabular-nums">
                              {m.matchedCount}/{m.totalSelected} {t('tft.lobby.matched')} · Ø {m.comp.avgPlacement?.toFixed(2) ?? '—'}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-accent text-sm font-medium tabular-nums">{confidence}%</div>
                          </div>
                        </div>
                        <div className="mt-1 h-1 bg-surface-base rounded overflow-hidden">
                          <div className="h-full bg-accent" style={{ width: `${confidence}%` }} />
                        </div>
                      </a>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>
      <Footer />
    </main>
  );
}
