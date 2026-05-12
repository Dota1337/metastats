'use client';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import { useI18n } from '../../../lib/i18n';
import { loadTftAssets, tftIconUrl, type TftAssetsBundle } from '../../../lib/tft-cdragon';
import type { TftMatchSummary, TftParticipantSummary } from '../../../lib/tft-match-processor';

// Permanent URL for one TFT match. Reuses the same match-shaped data as the
// inline expansion in MatchCard but laid out vertically for shareability —
// 8 participant cards sorted by placement, one per row, with full unit
// boards / augments / traits visible without click-to-expand.

export default function TftMatchDetailPage() {
  const { t } = useI18n();
  const params = useParams();
  const searchParams = useSearchParams();
  const region = (searchParams.get('region') || 'euw1').toLowerCase();
  const matchId = decodeURIComponent(String(params?.id || ''));

  const [match, setMatch] = useState<TftMatchSummary | null>(null);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    fetch(`/api/tft/matches?ids=${encodeURIComponent(matchId)}&region=${region}&queue=all`)
      .then(async r => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then(d => {
        if (cancelled) return;
        const m = (d.matches || [])[0];
        if (!m) throw new Error(t('tft.match.notFound'));
        setMatch(m);
        setLoading(false);
      })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [matchId, region, t]);

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="search" />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <h1 className="text-white text-xl font-medium mb-2">{t('tft.match.title')}</h1>
        <div className="text-[#4a5a70] text-xs font-mono mb-5 truncate">{matchId}</div>

        {loading && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6 text-center text-[#8a9bb0] text-sm">
            {t('tft.match.loading')}
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded p-4 text-red-400 text-sm">{error}</div>
        )}

        {!loading && !error && match && (
          <>
            <MatchHeader match={match} />
            <div className="space-y-2 mt-4">
              {match.participants
                .slice()
                .sort((a, b) => a.placement - b.placement)
                .map(p => (
                  <ParticipantCard
                    key={p.puuid}
                    participant={p}
                    region={region}
                    assets={assets}
                  />
                ))}
            </div>
          </>
        )}
      </div>
      <Footer />
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// match-level header (date, length, set)
// ─────────────────────────────────────────────────────────────────────────────

function MatchHeader({ match }: { match: TftMatchSummary }) {
  const { t } = useI18n();
  const date = match.gameDatetime ? new Date(match.gameDatetime).toLocaleString() : '—';
  const minutes = Math.floor(match.gameLength / 60);
  const seconds = Math.floor(match.gameLength % 60).toString().padStart(2, '0');
  return (
    <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
      <Stat label={t('tft.match.date')} value={date} />
      <Stat label={t('tft.match.length')} value={`${minutes}:${seconds}`} />
      <Stat label={t('tft.set')} value={match.setNumber ? `Set ${match.setNumber}` : '—'} />
      <Stat label={t('tft.match.patch')} value={match.gameVersion?.split(' ')[1] || '—'} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[#4a5a70] text-[10px] uppercase tracking-widest mb-0.5">{label}</div>
      <div className="text-white">{value}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// one participant card — placement + name + traits + board + augments
// ─────────────────────────────────────────────────────────────────────────────

function ParticipantCard({
  participant, region, assets,
}: {
  participant: TftParticipantSummary;
  region: string;
  assets: TftAssetsBundle | null;
}) {
  const { t } = useI18n();
  const placement = participant.placement;
  const top4 = placement <= 4;
  const barColor = top4 ? 'border-green-500' : 'border-red-500';
  const bg = top4 ? 'bg-[#0a1f0a]' : 'bg-[#1f0a0a]';

  const riotId = (participant as any).riotIdName as string | null;
  const [gameName, tagLine] = riotId ? riotId.split('#') : [null, null];
  const slug = gameName
    ? `${encodeURIComponent(gameName)}--${encodeURIComponent(tagLine || 'EUW')}`
    : null;

  return (
    <div className={`border-l-4 rounded p-3 ${barColor} ${bg}`}>
      <div className="flex items-start gap-3 flex-wrap">
        <PlacementBadge placement={placement} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {slug ? (
              <a
                href={`/tft/player/${slug}?region=${region}`}
                className="text-white text-sm font-medium hover:text-[#7B61FF]"
              >
                {gameName}
                {tagLine && <span className="text-[#4a5a70] text-xs"> #{tagLine}</span>}
              </a>
            ) : (
              <span className="text-[#4a5a70] text-sm font-mono">
                {participant.puuid.slice(0, 10)}…
              </span>
            )}
            <span className="text-[#4a5a70] text-[10px]">
              Lvl {participant.level} · Stage {formatStage(participant.lastRound)} · {participant.goldLeft}g
              {participant.playersEliminated > 0 && ` · ${participant.playersEliminated} ${t('tft.match.eliminated')}`}
            </span>
          </div>
          <div className="mt-1.5">
            <ActivatedTraits participant={participant} assets={assets} />
          </div>
          <div className="mt-3 flex gap-2 flex-wrap">
            {participant.units.map((u, i) => (
              <UnitTile key={i} unit={u} assets={assets} />
            ))}
          </div>
        </div>
        <AugmentColumn augments={participant.augments} assets={assets} />
      </div>
    </div>
  );
}

function PlacementBadge({ placement }: { placement: number }) {
  const color = placement === 1 ? '#f0c040' : placement <= 4 ? '#3a8' : '#888';
  const ordinal = placement === 1 ? '1st' : placement === 2 ? '2nd' : placement === 3 ? '3rd' : `${placement}th`;
  return (
    <div
      className="flex flex-col items-center justify-center w-12 h-12 rounded-lg border-2 flex-shrink-0"
      style={{ borderColor: color }}
    >
      <div className="text-lg font-bold leading-none" style={{ color }}>{placement}</div>
      <div className="text-[9px] text-[#8a9bb0]">{ordinal}</div>
    </div>
  );
}

function ActivatedTraits({
  participant, assets,
}: { participant: TftParticipantSummary; assets: TftAssetsBundle | null }) {
  const active = participant.traits.filter(t => t.tierCurrent > 0);
  return (
    <div className="flex gap-1 flex-wrap">
      {active.map(tr => {
        const info = assets?.traits[tr.name];
        const styleColor = traitStyleColor(tr.style);
        const url = tftIconUrl(assets, info?.icon);
        return (
          <a
            key={tr.name}
            href={`/tft/traits/${encodeURIComponent(tr.name)}`}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] hover:brightness-125 transition"
            style={{ backgroundColor: `${styleColor}25`, color: styleColor }}
          >
            {url && <img src={url} alt={info!.name} className="w-3 h-3" />}
            <span>{tr.numUnits} {info?.name || prettyTraitName(tr.name)}</span>
          </a>
        );
      })}
    </div>
  );
}

function UnitTile({ unit, assets }: { unit: any; assets: TftAssetsBundle | null }) {
  const info = assets?.champions[unit.characterId];
  const cost = (info?.cost ?? unit.rarity + 1) || 1;
  const costColor = costToColor(cost);
  const url = tftIconUrl(assets, info?.icon);
  const name = info?.name || prettyCharId(unit.characterId);
  const stars = unit.tier > 1 ? ` ${'★'.repeat(unit.tier)}` : '';
  const itemNames = (unit.items || [])
    .map((it: string) => assets?.items[it]?.name || it.replace(/^TFT\d*_Item_/, ''))
    .join(', ');
  const tooltip = `${name}${stars}${itemNames ? ` — ${itemNames}` : ''}`;
  const starColor = unit.tier === 3 ? '#f0c040' : '#ffffff';

  return (
    <a
      href={`/tft/units/${encodeURIComponent(unit.characterId)}`}
      title={tooltip}
      className="flex flex-col items-center gap-0.5 hover:scale-105 transition"
    >
      <div className="relative w-12 h-12 rounded border-2 overflow-hidden" style={{ borderColor: costColor }}>
        {url
          ? <img src={url} alt={name} className="w-full h-full object-cover" />
          : <div className="w-full h-full bg-[#1e2a3a]" />}
        {unit.tier > 1 && (
          <div
            className="absolute bottom-0 left-1/2 -translate-x-1/2 text-[9px] leading-tight px-1 rounded-t bg-black/70 font-bold"
            style={{ color: starColor, textShadow: '0 0 2px rgba(0,0,0,0.9)' }}
          >
            {'★'.repeat(unit.tier)}
          </div>
        )}
      </div>
      {unit.items?.length > 0 && (
        <div className="flex gap-px">
          {unit.items.slice(0, 3).map((it: string, i: number) => {
            const itemInfo = assets?.items[it];
            const iurl = tftIconUrl(assets, itemInfo?.icon);
            return iurl ? (
              <img key={i} src={iurl} alt={itemInfo!.name} title={itemInfo!.name} className="w-4 h-4 rounded-sm" />
            ) : (
              <div key={i} className="w-4 h-4 rounded-sm bg-[#1e2a3a]" title={it} />
            );
          })}
        </div>
      )}
    </a>
  );
}

function AugmentColumn({ augments, assets }: { augments: string[]; assets: TftAssetsBundle | null }) {
  if (!augments?.length) return null;
  return (
    <div className="flex flex-col gap-1 flex-shrink-0">
      {augments.map((a, i) => {
        const info = assets?.augments[a];
        const tierColor = info?.tier === 3 ? '#c39bff' : info?.tier === 2 ? '#e0c75a' : '#9ab0bf';
        const url = tftIconUrl(assets, info?.icon);
        const inner = url ? (
          <img
            src={url}
            alt={info!.name}
            title={info!.name}
            className="w-8 h-8 rounded border-2 hover:scale-110 transition"
            style={{ borderColor: tierColor }}
          />
        ) : (
          <div
            className="w-8 h-8 rounded border-2 bg-[#141c2e] flex items-center justify-center hover:brightness-125 transition"
            style={{ borderColor: tierColor }}
            title={info?.name || a}
          >
            <span className="text-[8px] text-[#8a9bb0] truncate px-0.5">{(info?.name || a).slice(0, 4)}</span>
          </div>
        );
        return (
          <a key={i} href={`/tft/augments/${encodeURIComponent(a)}`}>
            {inner}
          </a>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// helpers — small duplications from MatchCard.tsx so the page is self-contained
// and we can iterate the detail view without touching the inline expansion.
// ─────────────────────────────────────────────────────────────────────────────

function formatStage(lastRound: number): string {
  if (lastRound <= 0) return '—';
  if (lastRound <= 4) return `1-${lastRound}`;
  const offset = lastRound - 4;
  const stage = Math.floor((offset - 1) / 7) + 2;
  const round = ((offset - 1) % 7) + 1;
  return `${stage}-${round}`;
}

function prettyCharId(id: string) {
  return id.replace(/^TFT\d+_/, '');
}

function costToColor(cost: number) {
  return cost === 1 ? '#9aa6b2'
    : cost === 2 ? '#3a8'
    : cost === 3 ? '#3a8ddc'
    : cost === 4 ? '#c39bff'
    : '#e0c75a';
}

function traitStyleColor(style: number) {
  return style === 5 ? '#c39bff'
    : style === 4 ? '#e0c75a'
    : style === 3 ? '#cfd6dc'
    : style === 1 ? '#a07a4d'
    : '#4a5a70';
}

function prettyTraitName(raw: string) {
  return raw.replace(/^TFT\d+_/, '').replace(/([A-Z])/g, ' $1').trim();
}
