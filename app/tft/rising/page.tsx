'use client';
import { useEffect, useState } from 'react';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import { useI18n } from '../../lib/i18n';
import { ACTIVE_REGIONS } from '../../lib/active-regions';
import RankEmblem from '../../components/tft/RankEmblem';
import { NO_DIVISION_TIERS, RANK_TIER_COLOR } from '../../lib/rank-format';
import {
  loadTftAssets, tftChampionTileUrl, tftIconUrl, findChampion, findTrait, findItem,
  type TftAssetsBundle,
} from '../../lib/tft-cdragon';
import type { RisingPlayer, RisingRank } from '../../lib/tft-hetzner-matches';

// Aufsteiger nach MetaTFT-Logik (/rising). Die URL-Form MUSS zu
// scripts/warm-tft-stats-cache.mjs passen (days vor region), sonst trifft die
// Seite nie den vorgewaermten Edge-Cache.
const DAYS = [1, 3, 5] as const;
type Days = typeof DAYS[number];
const REGIONS = ['all', ...ACTIVE_REGIONS];

function stripPrefix(id: string) {
  return id.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '');
}


function RankBadge({ r, tierName }: { r: RisingRank; tierName: (tier: string) => string }) {
  const name = tierName(r.tier);
  const division = r.rank && !NO_DIVISION_TIERS.has(r.tier) ? ` ${r.rank}` : '';
  return (
    <span className="inline-flex items-center gap-1 tabular-nums whitespace-nowrap">
      <RankEmblem tier={r.tier} label={name} className="w-6 h-6" />
      <span className="text-xs font-medium" style={{ color: RANK_TIER_COLOR[r.tier] || 'var(--fg-secondary)' }}>
        {name}{division}
      </span>
      <span className="text-[11px] text-fg-secondary">· {r.lp} LP</span>
    </span>
  );
}

function Placements({ counts }: { counts: number[] }) {
  const max = Math.max(1, ...counts);
  return (
    <div className="flex items-end gap-0.5 h-8">
      {counts.map((c, i) => (
        <div key={i} className="flex flex-col items-center justify-end h-full w-3">
          <div
            className="w-full rounded-sm"
            style={{
              height: `${Math.max(c ? 8 : 2, (c / max) * 100)}%`,
              backgroundColor: i < 4 ? '#3ecf8e' : '#e44040',
              opacity: c ? 1 : 0.25,
            }}
            title={`${i + 1}: ${c}`}
          />
          <span className="text-[8px] text-fg-muted leading-none mt-0.5">{i + 1}</span>
        </div>
      ))}
    </div>
  );
}

export default function TftRisingPage() {
  const { t } = useI18n();
  const tierName = (tier: string) => t(`tier.${tier.toLowerCase()}` as Parameters<typeof t>[0]);
  const [days, setDays] = useState<Days>(1);
  const [region, setRegion] = useState<string>('all');
  const [players, setPlayers] = useState<RisingPlayer[]>([]);
  const [loading, setLoading] = useState(false);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true); setPlayers([]);
    fetch(`/api/tft/rising?days=${days}&region=${region}`, { signal: ctrl.signal })
      .then(r => r.ok ? r.json() : { players: [] })
      .then(d => { setPlayers(d.players || []); setLoading(false); })
      .catch(err => { if (err?.name !== 'AbortError') { setPlayers([]); setLoading(false); } });
    return () => ctrl.abort();
  }, [days, region]);

  const pill = (active: boolean) => `px-3 py-1.5 text-xs uppercase tracking-widest rounded border transition-colors ${
    active
      ? 'bg-accent border-accent text-white'
      : 'bg-surface-raised border-border-subtle text-fg-secondary hover:border-accent-a40'
  }`;

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav active="rising" />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <h1 className="text-white text-2xl font-medium mb-4">{t('tft.rising.title')}</h1>

        <div className="flex flex-wrap gap-1 mb-2">
          {DAYS.map(d => (
            <button key={d} onClick={() => setDays(d)} className={pill(days === d)}>
              {t(`tft.rising.days${d}`)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1 mb-4">
          {REGIONS.map(r => (
            <button key={r} onClick={() => setRegion(r)} className={pill(region === r)}>
              {r === 'all' ? t('lb.allRegions') : r}
            </button>
          ))}
        </div>

        {loading && <div className="text-fg-secondary text-center py-8">…</div>}
        {!loading && players.length === 0 && (
          <div className="text-fg-secondary text-center py-8">—</div>
        )}

        <div className="space-y-2">
          {players.map((p, idx) => {
            const display = p.gameName || '—';
            const comp = p.topComp;
            const traitNames = (comp?.traits || []).map(tr => findTrait(assets, tr.name)?.name || stripPrefix(tr.name));
            const title = traitNames.slice(0, 2).join(' ');
            const subtitle = traitNames.slice(2, 4).join(' · ');
            const units = (comp?.units || [])
              .map(u => ({ u, champ: findChampion(assets, u.characterId) }))
              .sort((a, b) => (a.champ?.cost ?? 9) - (b.champ?.cost ?? 9));
            return (
              <div key={`${p.puuid}-${p.region}`} className="bg-surface-base border border-border-subtle rounded p-3 hover:border-accent-a30 transition-colors">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
                  <span className="text-fg-muted text-xs tabular-nums w-6 font-medium">#{idx + 1}</span>
                  <RankEmblem tier={p.after.tier} label={tierName(p.after.tier)} className="w-8 h-8 -my-1" />
                  <a
                    href={p.gameName ? `/tft/player/${encodeURIComponent(`${p.gameName}${p.tagLine ? `-${p.tagLine}` : ''}`)}?region=${p.region}` : undefined}
                    className="text-white font-medium hover:text-[#a892ff] truncate min-w-0 flex-1"
                  >
                    {display}{p.tagLine ? <span className="text-fg-muted">#{p.tagLine}</span> : null}
                  </a>
                  <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded border border-border-subtle text-fg-secondary">
                    {p.region}
                  </span>
                  <span className="text-sm font-medium tabular-nums" style={{ color: '#3ecf8e' }}>
                    +{p.lpChange} LP
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-2">
                  <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    <RankBadge r={p.before} tierName={tierName} />
                    <span className="text-fg-muted text-xs">→</span>
                    <RankBadge r={p.after} tierName={tierName} />
                  </span>
                  <span className="text-[11px] text-fg-secondary tabular-nums">
                    {p.games} {t('tft.gamesShort')}
                  </span>
                  <span className="text-[11px] text-fg-secondary tabular-nums">
                    {t('tft.avgPlacement')} {p.avgPlacement != null ? p.avgPlacement.toFixed(2) : '—'}
                  </span>
                  {p.placements.length === 8 && (
                    <span className="inline-flex items-center gap-2">
                      <span className="text-[10px] text-fg-muted">{t('tft.rising.placements')}</span>
                      <Placements counts={p.placements} />
                    </span>
                  )}
                </div>

                <div className="bg-surface-raised border border-border-subtle rounded p-2">
                  <div className="flex flex-wrap items-baseline gap-x-2 mb-1.5">
                    <span className="text-[10px] uppercase tracking-widest text-fg-muted">{t('tft.rising.topComp')}</span>
                    <span className="text-white text-xs font-medium">{comp ? (title || '—') : '—'}</span>
                    {comp && comp.avgStars != null && comp.avgStars > 2.3 && (
                      <span className="text-[10px] text-[#f0c040]">★★★</span>
                    )}
                    {subtitle && <span className="text-[10px] text-fg-muted">{subtitle}</span>}
                  </div>
                  {units.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {units.map(({ u, champ }, i) => {
                        const tile = tftChampionTileUrl(assets, champ);
                        return (
                          <div key={`${u.characterId}-${i}`} className="flex flex-col items-center w-9">
                            <span className="text-[8px] leading-none text-[#f0c040] h-2">
                              {u.star >= 2 ? '★'.repeat(Math.min(u.star, 4)) : ''}
                            </span>
                            {tile
                              ? <img src={tile} alt={champ?.name || ''} title={champ?.name || ''} className="w-9 h-9 rounded border border-border-subtle" />
                              : <div className="w-9 h-9 rounded border border-border-subtle bg-surface-overlay" />}
                            <div className="flex gap-px mt-0.5 h-3">
                              {u.items.slice(0, 3).map((it, j) => {
                                const item = findItem(assets, it);
                                const icon = item ? tftIconUrl(assets, item.icon) : null;
                                return icon ? <img key={j} src={icon} alt={item?.name || ''} title={item?.name || ''} className="w-3 h-3 rounded-sm" /> : null;
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] tabular-nums">
                    <span className="text-fg-muted">{t('tft.rising.compsPlayed')} <span className="text-white">{p.compsPlayed || '—'}</span></span>
                    <span className="text-fg-muted">{t('tft.rising.topCompRate')} <span className="text-white">{p.topCompRate != null ? `${(p.topCompRate * 100).toFixed(1)}%` : '—'}</span></span>
                    <span className="text-fg-muted">{t('tft.rising.playstyle')} <span className="text-white">{p.playstyle ? t(`tft.rising.style.${p.playstyle}`) : '—'}</span></span>
                  </div>
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
