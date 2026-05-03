'use client';
import { useState, useEffect } from 'react';
import { loadTftChampions, loadTftItems, loadTftTraits, loadTftAugments } from '../../lib/tft-dd-assets';
import type { TftMatchSummary, TftParticipantSummary } from '../../lib/tft-match-processor';

const TFT_LANG = 'en_US';

interface Props {
  match: TftMatchSummary;
  selfPuuid: string;
  ddVersion: string;
}

export default function MatchCard({ match, selfPuuid, ddVersion }: Props) {
  const [open, setOpen] = useState(false);
  const [champs, setChamps] = useState<Record<string, any>>({});
  const [items, setItems] = useState<Record<number, any>>({});
  const [traits, setTraits] = useState<Record<string, any>>({});
  const [augs, setAugs] = useState<Record<string, any>>({});

  useEffect(() => {
    if (!ddVersion) return;
    let cancelled = false;
    Promise.all([
      loadTftChampions(ddVersion, TFT_LANG),
      loadTftItems(ddVersion, TFT_LANG),
      loadTftTraits(ddVersion, TFT_LANG),
      loadTftAugments(ddVersion, TFT_LANG),
    ]).then(([c, i, t, a]) => {
      if (cancelled) return;
      setChamps(c); setItems(i); setTraits(t); setAugs(a);
    });
    return () => { cancelled = true; };
  }, [ddVersion]);

  const me = match.participants.find(p => p.puuid === selfPuuid) || match.participants[0];
  const placement = me.placement;
  const placedTopFour = placement <= 4;
  const minutes = Math.floor(match.gameLength / 60);
  const seconds = Math.floor(match.gameLength % 60).toString().padStart(2, '0');
  const ago = timeAgo(match.gameDatetime);

  return (
    <div className={`rounded border-l-4 overflow-hidden ${placedTopFour ? 'border-green-500 bg-[#0a1f0a]' : 'border-red-500 bg-[#1f0a0a]'}`}>
      <div className="flex items-center gap-3 p-3 cursor-pointer hover:bg-white/5" onClick={() => setOpen(o => !o)}>
        <PlacementBadge placement={placement} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <ActivatedTraits participant={me} traits={traits} ddVersion={ddVersion} />
          </div>
          <div className="text-[#8a9bb0] text-xs mt-1">
            Lvl {me.level} · Round {me.lastRound} · {minutes}:{seconds} · {ago}
          </div>
        </div>
        <BoardPreview participant={me} champs={champs} items={items} ddVersion={ddVersion} />
        <AugmentRow augments={me.augments} augs={augs} />
      </div>

      {open && (
        <div className="border-t border-[#1e2a3a] bg-[#0a0e1a] p-3 space-y-2">
          {match.participants.slice().sort((a, b) => a.placement - b.placement).map(p => (
            <ParticipantRow
              key={p.puuid}
              participant={p}
              isSelf={p.puuid === selfPuuid}
              champs={champs} items={items} traits={traits} augs={augs}
              ddVersion={ddVersion}
            />
          ))}
        </div>
      )}
    </div>
  );
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

function ActivatedTraits({ participant, traits, ddVersion }: { participant: TftParticipantSummary; traits: Record<string, any>; ddVersion: string }) {
  const active = participant.traits.filter(t => t.tierCurrent > 0).slice(0, 6);
  return (
    <div className="flex gap-1 flex-wrap">
      {active.map(t => {
        const info = traits[t.name];
        const styleColor = traitStyleColor(t.style);
        return (
          <div key={t.name} className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]" style={{ backgroundColor: `${styleColor}25`, color: styleColor }}>
            {info?.image?.full && (
              <img src={`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/tft-trait/${info.image.full}`} alt={info.name} className="w-3 h-3" />
            )}
            <span>{t.numUnits} {info?.name || prettyTraitName(t.name)}</span>
          </div>
        );
      })}
    </div>
  );
}

function BoardPreview({ participant, champs, items, ddVersion }: { participant: TftParticipantSummary; champs: Record<string, any>; items: Record<number, any>; ddVersion: string }) {
  return (
    <div className="hidden md:flex gap-1 flex-wrap max-w-[300px] justify-end">
      {participant.units.slice(0, 9).map((u, i) => (
        <UnitTile key={i} unit={u} champs={champs} items={items} ddVersion={ddVersion} small />
      ))}
    </div>
  );
}

function AugmentRow({ augments, augs }: { augments: string[]; augs: Record<string, any> }) {
  if (!augments?.length) return null;
  return (
    <div className="hidden lg:flex gap-1 flex-shrink-0">
      {augments.map((a, i) => {
        const info = augs[a];
        const tierColor = info?.tier === 3 ? '#c39bff' : info?.tier === 2 ? '#e0c75a' : '#9ab0bf';
        return (
          <div key={i} className="w-7 h-7 rounded border-2 flex items-center justify-center bg-[#141c2e]" style={{ borderColor: tierColor }} title={info?.name || a}>
            <span className="text-[8px] text-[#8a9bb0] truncate px-0.5">{(info?.name || a).slice(0, 4)}</span>
          </div>
        );
      })}
    </div>
  );
}

function ParticipantRow({ participant, isSelf, champs, items, traits, augs, ddVersion }: { participant: TftParticipantSummary; isSelf: boolean; champs: Record<string, any>; items: Record<number, any>; traits: Record<string, any>; augs: Record<string, any>; ddVersion: string }) {
  return (
    <div className={`flex flex-col md:flex-row md:items-center gap-2 px-2 py-2 rounded ${isSelf ? 'bg-[#7B61FF]/10 border border-[#7B61FF]/30' : 'hover:bg-white/5'}`}>
      <div className="flex items-center gap-2 md:w-44 flex-shrink-0">
        <PlacementBadge placement={participant.placement} />
        <div className="min-w-0 flex-1">
          <div className="text-white text-xs truncate">{(participant as any).riotIdName?.split('#')[0] || participant.puuid.slice(0, 8)}</div>
          <div className="text-[#4a5a70] text-[10px]">Lvl {participant.level} · R{participant.lastRound}</div>
        </div>
      </div>
      <div className="flex-1 flex flex-wrap items-center gap-1.5">
        <ActivatedTraits participant={participant} traits={traits} ddVersion={ddVersion} />
      </div>
      <div className="flex flex-wrap gap-1">
        {participant.units.map((u, i) => (
          <UnitTile key={i} unit={u} champs={champs} items={items} ddVersion={ddVersion} />
        ))}
      </div>
      <AugmentRow augments={participant.augments} augs={augs} />
    </div>
  );
}

function UnitTile({ unit, champs, items, ddVersion, small }: { unit: any; champs: Record<string, any>; items: Record<number, any>; ddVersion: string; small?: boolean }) {
  const info = champs[unit.characterId];
  const sz = small ? 'w-7 h-7' : 'w-9 h-9';
  const cost = (info?.cost ?? unit.rarity + 1) || 1;
  const costColor = costToColor(cost);
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className={`relative ${sz} rounded border-2`} style={{ borderColor: costColor }}>
        {info?.image?.full ? (
          <img src={`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/tft-champion/${info.image.full}`} alt={info?.name || unit.characterId} className="w-full h-full object-cover rounded-sm" />
        ) : (
          <div className="w-full h-full bg-[#1e2a3a] rounded-sm" />
        )}
        {unit.tier > 1 && (
          <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 text-[9px] leading-none" style={{ color: costColor }}>
            {'★'.repeat(unit.tier)}
          </div>
        )}
      </div>
      {unit.items?.length > 0 && !small && (
        <div className="flex gap-px">
          {unit.items.slice(0, 3).map((it: string, i: number) => (
            <div key={i} className="w-2.5 h-2.5 rounded-sm bg-[#1e2a3a]" title={it} />
          ))}
        </div>
      )}
    </div>
  );
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
