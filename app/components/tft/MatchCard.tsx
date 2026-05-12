'use client';
import { useState, useEffect } from 'react';
import { loadTftAssets, tftIconUrl, tftChampionTileUrl, type TftAssetsBundle } from '../../lib/tft-cdragon';
import type { TftMatchSummary, TftParticipantSummary } from '../../lib/tft-match-processor';

interface Props {
  match: TftMatchSummary;
  selfPuuid: string;
  ddVersion?: string;        // legacy prop, no longer used
  region?: string;           // platform routing for participant-link slugs
}

export default function MatchCard({ match, selfPuuid, region }: Props) {
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);

  const me = match.participants.find(p => p.puuid === selfPuuid) || match.participants[0];
  const placement = me.placement;
  const placedTopFour = placement <= 4;
  const minutes = Math.floor(match.gameLength / 60);
  const seconds = Math.floor(match.gameLength % 60).toString().padStart(2, '0');
  const ago = timeAgo(match.gameDatetime);

  // Placement-coloured bar runs on the left of the header AND of the
  // expanded dropdown, with the dropdown's bar inset along with the
  // dropdown itself — so the bar visually "steps in" together with the
  // expansion, like metatft does.
  const barColor = placedTopFour ? 'border-green-500' : 'border-red-500';
  const headerBg = placedTopFour ? 'bg-[#0a1f0a]' : 'bg-[#1f0a0a]';

  return (
    <div className="rounded">
      <div
        className={`border-l-4 rounded p-3 cursor-pointer hover:bg-white/5 ${barColor} ${headerBg}`}
        onClick={() => setOpen(o => !o)}
      >
        {/* Top row: placement + meta + augments. Wraps on phone so the
            augments don't get squashed off-screen — they're core context. */}
        <div className="flex items-start sm:items-center gap-3 flex-wrap">
          <PlacementBadge placement={placement} />
          <div className="flex-1 min-w-0">
            <ActivatedTraits participant={me} assets={assets} />
            <div className="text-[#8a9bb0] text-xs mt-1">
              Lvl {me.level} · Stage {formatStage(me.lastRound)} · {minutes}:{seconds} · {ago}
            </div>
          </div>
          <AugmentRow augments={me.augments} assets={assets} />
        </div>
        {/* Units row — every unit a click-through to /tft/units/[id]. On
            mobile, indent only slightly (ml-2) so all 9 tiles get the
            horizontal space they need; desktop indents under meta. */}
        <div className="mt-4 sm:mt-5 ml-2 sm:ml-15 flex gap-1.5 sm:gap-2 flex-wrap">
          {me.units.map((u, i) => (
            <UnitTile key={i} unit={u} assets={assets} interactive />
          ))}
        </div>
      </div>

      {/* Expanded participants list indented from the left edge of the
          card. The placement-coloured bar continues down its left edge so
          the user keeps the win/loss signal while the panel itself sits
          offset to the right. */}
      {open && (
        <div className={`ml-12 mr-3 mt-2 rounded border-l-4 ${barColor} bg-[#0a0e1a] p-3 space-y-2`}>
          {match.participants.slice().sort((a, b) => a.placement - b.placement).map(p => (
            <ParticipantRow key={p.puuid} participant={p} isSelf={p.puuid === selfPuuid} assets={assets} region={region || regionFromMatchId(match.matchId)} />
          ))}
          <a
            href={`/tft/match/${encodeURIComponent(match.matchId)}`}
            onClick={e => e.stopPropagation()}
            className="block text-right text-[10px] text-[#7B61FF] hover:text-[#a892ff] uppercase tracking-widest pt-1 border-t border-[#1e2a3a]"
          >
            Match-Detail →
          </a>
        </div>
      )}
    </div>
  );
}

// Convert Riot's flat `last_round` integer to the TFT stage-round label
// players read on screen. Stage 1 has 4 rounds (carousel + 3 PvE), every
// stage after that has 7. So last_round=4 is "1-4", 5 is "2-1", 12 is
// "3-1", 40 is "7-1", and so on. Set 17 still follows this scheme; if Riot
// changes the per-stage round count in a future set we'll bump it here.
function formatStage(lastRound: number): string {
  if (lastRound <= 0) return '—';
  if (lastRound <= 4) return `1-${lastRound}`;
  const offset = lastRound - 4;
  const stage = Math.floor((offset - 1) / 7) + 2;
  const round = ((offset - 1) % 7) + 1;
  return `${stage}-${round}`;
}

function PlacementBadge({ placement }: { placement: number }) {
  const color = placement === 1 ? '#f0c040' : placement <= 4 ? '#3a8' : '#888';
  const ordinal = placement === 1 ? '1st' : placement === 2 ? '2nd' : placement === 3 ? '3rd' : `${placement}th`;
  return (
    <div className="flex flex-col items-center justify-center w-12 h-12 rounded-lg border-2" style={{ borderColor: color }}>
      <div className="text-lg font-bold leading-none" style={{ color }}>{placement}</div>
      <div className="text-[9px] text-[#8a9bb0]">{ordinal}</div>
    </div>
  );
}

function ActivatedTraits({ participant, assets }: { participant: TftParticipantSummary; assets: TftAssetsBundle | null }) {
  const active = participant.traits.filter(t => t.tierCurrent > 0).slice(0, 6);
  return (
    <div className="flex gap-1 flex-wrap">
      {active.map(t => {
        const info = assets?.traits[t.name];
        const styleColor = traitStyleColor(t.style);
        const url = tftIconUrl(assets, info?.icon);
        return (
          <a
            key={t.name}
            href={`/tft/traits/${encodeURIComponent(t.name)}`}
            onClick={e => e.stopPropagation()}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] hover:brightness-125 transition"
            style={{ backgroundColor: `${styleColor}25`, color: styleColor }}
          >
            {url && <img src={url} alt={info!.name} className="w-3 h-3" />}
            <span>{t.numUnits} {info?.name || prettyTraitName(t.name)}</span>
          </a>
        );
      })}
    </div>
  );
}

// (Old BoardPreview is gone — units render directly in the match card's
// own full-width row now.)

function AugmentRow({ augments, assets }: { augments: string[]; assets: TftAssetsBundle | null }) {
  if (!augments?.length) return null;
  // Used to be hidden on <lg — but augments are core context. Show them
  // everywhere; just size them down on small screens so they don't crowd.
  return (
    <div className="flex gap-1 flex-shrink-0">
      {augments.map((a, i) => {
        const info = assets?.augments[a];
        const tierColor = info?.tier === 3 ? '#c39bff' : info?.tier === 2 ? '#e0c75a' : '#9ab0bf';
        const url = tftIconUrl(assets, info?.icon);
        const inner = url ? (
          <img src={url} alt={info!.name} title={info!.name} className="w-6 h-6 sm:w-7 sm:h-7 rounded border-2 hover:scale-110 transition" style={{ borderColor: tierColor }} />
        ) : (
          <div className="w-6 h-6 sm:w-7 sm:h-7 rounded border-2 bg-[#141c2e] flex items-center justify-center hover:brightness-125 transition" style={{ borderColor: tierColor }} title={info?.name || a}>
            <span className="text-[7px] sm:text-[8px] text-[#8a9bb0] truncate px-0.5">{(info?.name || a).slice(0, 4)}</span>
          </div>
        );
        return (
          <a key={i} href={`/tft/augments/${encodeURIComponent(a)}`} onClick={e => e.stopPropagation()}>
            {inner}
          </a>
        );
      })}
    </div>
  );
}

function ParticipantRow({ participant, isSelf, assets, region }: { participant: TftParticipantSummary; isSelf: boolean; assets: TftAssetsBundle | null; region: string }) {
  const riotId = (participant as any).riotIdName as string | null;
  const [gameName, tagLine] = riotId ? riotId.split('#') : [null, null];
  const slug = gameName
    ? `${encodeURIComponent(gameName)}--${encodeURIComponent(tagLine || region.replace(/\d+$/, '').toUpperCase())}`
    : null;
  const displayName = gameName || participant.puuid.slice(0, 8);
  return (
    <div className={`flex flex-col md:flex-row md:items-center gap-2 px-2 py-2 rounded ${isSelf ? 'bg-[#7B61FF]/10 border border-[#7B61FF]/30' : 'hover:bg-white/5'}`}>
      <div className="flex items-center gap-2 md:w-44 flex-shrink-0">
        <PlacementBadge placement={participant.placement} />
        <div className="min-w-0 flex-1">
          {slug ? (
            <a
              href={`/tft/player/${slug}?region=${region}`}
              onClick={e => e.stopPropagation()}
              className="text-white text-xs truncate block hover:text-[#7B61FF] transition-colors"
            >
              {displayName}
            </a>
          ) : (
            <div className="text-[#4a5a70] text-xs truncate">{displayName}</div>
          )}
          <div className="text-[#4a5a70] text-[10px]">Lvl {participant.level} · R{participant.lastRound}</div>
        </div>
      </div>
      <div className="flex-1 flex flex-wrap items-center gap-1.5">
        <ActivatedTraits participant={participant} assets={assets} />
      </div>
      <div className="flex flex-wrap gap-1">
        {participant.units.map((u, i) => <UnitTile key={i} unit={u} assets={assets} interactive />)}
      </div>
      <AugmentRow augments={participant.augments} assets={assets} />
    </div>
  );
}

// Derive platform routing from a TFT match ID. Match IDs come in
// "PLATFORM_NUMBER" format (e.g. "EUW1_7850388638", "KR_5912348321").
// Lower-case the prefix for our internal region convention.
function regionFromMatchId(matchId: string | undefined): string {
  if (!matchId) return 'euw1';
  const underscore = matchId.indexOf('_');
  if (underscore <= 0) return 'euw1';
  return matchId.slice(0, underscore).toLowerCase();
}

function UnitTile({ unit, assets, small, interactive }: { unit: any; assets: TftAssetsBundle | null; small?: boolean; interactive?: boolean }) {
  const info = assets?.champions[unit.characterId];
  const sz = small ? 'w-9 h-9' : 'w-12 h-12';
  const itemSz = small ? 'w-3 h-3' : 'w-4 h-4';
  const cost = (info?.cost ?? unit.rarity + 1) || 1;
  const costColor = costToColor(cost);
  // Square HUD tile rather than splash-centered — same change applied
  // across CompCard / units list / unit-detail. The wide art cropped the
  // champion's face under `object-cover` and looked offset.
  const url = tftChampionTileUrl(assets, info);
  const name = info?.name || prettyCharId(unit.characterId);
  const stars = unit.tier > 1 ? ` ${'★'.repeat(unit.tier)}` : '';
  const itemNames = (unit.items || [])
    .map((it: string) => assets?.items[it]?.name || it.replace(/^TFT\d*_Item_/, ''))
    .join(', ');
  const tooltip = `${name}${stars}${itemNames ? ` — ${itemNames}` : ''}`;

  // Star color: 3★ gets a punchy gold so it pops, 2★ stays white. Both sit
  // inside the icon at the top with a dark backdrop so they stay readable
  // against bright splash art.
  const starColor = unit.tier === 3 ? '#f0c040' : '#ffffff';

  const inner = (
    <>
      <div className={`relative ${sz} rounded border-2 overflow-hidden`} style={{ borderColor: costColor }}>
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
              <img key={i} src={iurl} alt={itemInfo!.name} title={itemInfo!.name} className={`${itemSz} rounded-sm`} />
            ) : (
              <div key={i} className={`${itemSz} rounded-sm bg-[#1e2a3a]`} title={it} />
            );
          })}
        </div>
      )}
    </>
  );

  if (interactive && unit.characterId) {
    return (
      <a
        href={`/tft/units/${encodeURIComponent(unit.characterId)}`}
        title={tooltip}
        // Stop the click from toggling the match-card's expanded view.
        onClick={e => e.stopPropagation()}
        className="flex flex-col items-center gap-0.5 hover:scale-110 transition"
      >
        {inner}
      </a>
    );
  }
  return (
    <div className="flex flex-col items-center gap-0.5" title={tooltip}>
      {inner}
    </div>
  );
}

function prettyCharId(id: string) {
  return id.replace(/^TFT\d+_/, '');
}

function costToColor(cost: number) {
  return cost === 1 ? '#9aa6b2' : cost === 2 ? '#3a8' : cost === 3 ? '#3a8ddc' : cost === 4 ? '#c39bff' : '#e0c75a';
}
function traitStyleColor(style: number) {
  return style === 5 ? '#c39bff' : style === 4 ? '#e0c75a' : style === 3 ? '#cfd6dc' : style === 1 ? '#a07a4d' : '#4a5a70';
}
function prettyTraitName(raw: string) {
  return raw.replace(/^TFT\d+_/, '').replace(/([A-Z])/g, ' $1').trim();
}
function timeAgo(ts: number) {
  if (!ts) return '';
  const ms = Date.now() - ts;
  const m = Math.floor(ms / 60000);
  if (m < 60) return `vor ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `vor ${h}h`;
  const d = Math.floor(h / 24);
  return `vor ${d}d`;
}
