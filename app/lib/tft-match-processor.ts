// Extracts the relevant fields from a TFT Match-V1 DTO into a flat shape
// that the frontend (and later the build aggregator) can consume directly.
//
// Match-V1 quirks observed in the wild:
// - `augments` may be missing on older matches → fall back to empty array
// - `units[].itemNames` is an array of API names (e.g. "TFT_Item_GiantSlayer")
//   that we keep as-is and resolve to icons via Data Dragon on the client
// - `character_id` carries the set prefix ("TFT17_Vex"), useful for filtering
//   stale matches after a set transition
// - `placement` is 1..8, `tier` (star level) is 1..3, `rarity` is cost - 1

export interface TftTraitSummary {
  name: string;
  numUnits: number;
  tierCurrent: number;   // active activation level (0 = none)
  tierTotal: number;     // max activation level for this trait
  style: number;         // 0 = inactive, 1 = bronze, 3 = silver, 4 = gold, 5 = prismatic (Riot styles)
}

export interface TftUnitSummary {
  characterId: string;     // e.g. "TFT17_Vex"
  name?: string;
  tier: number;            // 1..3 (star level)
  rarity: number;          // cost-1 (0..5)
  items: string[];         // apiNames, max 3
  chosen?: string;
}

export interface TftParticipantSummary {
  puuid: string;
  riotIdName?: string;     // populated by /api/tft/matches if available
  placement: number;       // 1..8
  level: number;
  lastRound: number;
  goldLeft: number;
  playersEliminated: number;
  totalDamageToPlayers: number;
  timeEliminated: number;
  augments: string[];      // 0..3 apiNames
  traits: TftTraitSummary[];
  units: TftUnitSummary[];
  companion?: { contentId?: string; itemId?: number; skinId?: number; species?: string };
  win: boolean;
}

export interface TftMatchSummary {
  matchId: string;
  gameDatetime: number;
  gameLength: number;
  gameVersion: string;
  queueId: number;
  setNumber?: number;       // pulled from any unit's character_id prefix (TFT<N>_…)
  participants: TftParticipantSummary[];
}

const SET_RX = /^TFT(\d+)_/;

function detectSetNumber(participants: any[]): number | undefined {
  for (const p of participants || []) {
    for (const u of p.units || []) {
      const m = SET_RX.exec(u.character_id || '');
      if (m) return Number(m[1]);
    }
  }
  return undefined;
}

export function processTftMatch(raw: any): TftMatchSummary | null {
  if (!raw?.metadata?.match_id || !raw?.info?.participants) return null;
  const info = raw.info;
  const participants: TftParticipantSummary[] = info.participants.map((p: any) => ({
    puuid: p.puuid || '',
    placement: p.placement ?? 9,
    level: p.level ?? 0,
    lastRound: p.last_round ?? 0,
    goldLeft: p.gold_left ?? 0,
    playersEliminated: p.players_eliminated ?? 0,
    totalDamageToPlayers: p.total_damage_to_players ?? 0,
    timeEliminated: p.time_eliminated ?? 0,
    augments: Array.isArray(p.augments) ? p.augments : [],
    traits: (p.traits || []).map((t: any) => ({
      name: t.name || '',
      numUnits: t.num_units ?? 0,
      tierCurrent: t.tier_current ?? 0,
      tierTotal: t.tier_total ?? 0,
      style: t.style ?? 0,
    })),
    units: (p.units || []).map((u: any) => ({
      characterId: u.character_id || '',
      name: u.name || undefined,
      tier: u.tier ?? 1,
      rarity: u.rarity ?? 0,
      items: Array.isArray(u.itemNames) ? u.itemNames : [],
      chosen: u.chosen || undefined,
    })),
    companion: p.companion ? {
      contentId: p.companion.content_ID,
      itemId: p.companion.item_ID,
      skinId: p.companion.skin_ID,
      species: p.companion.species,
    } : undefined,
    win: p.placement === 1,
  }));

  return {
    matchId: raw.metadata.match_id,
    gameDatetime: info.game_datetime ?? 0,
    gameLength: info.game_length ?? 0,
    gameVersion: info.game_version || '',
    queueId: info.queue_id ?? info.queueId ?? 0,
    setNumber: detectSetNumber(info.participants),
    participants,
  };
}

export const RANKED_TFT_QUEUE = 1100;
