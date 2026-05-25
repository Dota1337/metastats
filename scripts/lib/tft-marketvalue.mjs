// MJS port of app/lib/tft-marketvalue/base-value.ts — used by the crawler
// scripts (scripts/collect-tft-marketvalues.mjs, scripts/lib/tft-match-cache-pg.mjs)
// because Node ESM can't import TypeScript directly.
//
// IMPORTANT: keep computeBaseValue in sync with
// app/lib/tft-marketvalue/base-value.ts (the canonical version for the live
// /api/tft/marktwert path). The multiplier — formerly a 6-agent product, now a
// population-relative z-score — lives in scripts/lib/tft-skill-score.mjs ↔
// app/lib/tft-marketvalue/skill-score.ts. The old agent model was deleted
// 2026-05-25 (it was dead on every live path).

// ─────────────────────────────────────────────────────────────────────────────
// base-value
// ─────────────────────────────────────────────────────────────────────────────

const TIER_VAL = {
  IRON: 0, BRONZE: 1, SILVER: 2, GOLD: 3, PLATINUM: 4,
  EMERALD: 5, DIAMOND: 6, MASTER: 7, GRANDMASTER: 8, CHALLENGER: 9,
};

// Roman division → number. Only used to gate Diamond (II+ rated, III/IV not).
const DIV_VAL = { I: 1, II: 2, III: 3, IV: 4 };

export function computeBaseValue(ranked, playerRank) {
  if (!ranked || !ranked.tier) {
    return { rated: false, baseValue: 0, notRatedReason: 'unranked' };
  }
  const tier = ranked.tier.toUpperCase();
  const tierNum = TIER_VAL[tier] ?? -1;
  if (tierNum < TIER_VAL.DIAMOND) {
    return { rated: false, baseValue: 0, notRatedReason: 'below_diamond' };
  }
  const lp = Math.max(0, ranked.leaguePoints || 0);

  // Diamond is rated only from division II up (D3/D4 excluded by decision —
  // keeps the daily crawl scope sane while preserving the climb incentive).
  // The base ramps continuously into Master's 1000 entry:
  //   D2 0LP → 200, D2 100LP → 600, D1 0LP → 600, D1 100LP → 1000 (= Master 0).
  if (tier === 'DIAMOND') {
    const div = DIV_VAL[(ranked.rank || '').toUpperCase()] ?? 0;
    if (div !== 1 && div !== 2) {
      return { rated: false, baseValue: 0, notRatedReason: 'below_diamond2' };
    }
    const cappedLp = Math.min(lp, 100);
    return div === 2
      ? { rated: true, baseValue: 200 + (cappedLp / 100) * 400 }
      : { rated: true, baseValue: 600 + (cappedLp / 100) * 400 };
  }

  // Calibrated relative to LoL — TFT's top pros sit below LoL's top pros.
  // Target final-value range after multiplier:
  //   Chall #1 → ~180k, Chall #30 → ~60k, Master 0 LP → ~1k.
  // Keep this in lockstep with app/lib/tft-marketvalue/base-value.ts.
  if (tier === 'MASTER') {
    const cappedLp = Math.min(lp, 200);
    return { rated: true, baseValue: 1000 + (cappedLp / 200) * 3000 };
  }
  if (tier === 'GRANDMASTER') {
    const cappedLp = Math.min(lp, 400);
    return { rated: true, baseValue: 4000 + (cappedLp / 400) * 8000 };
  }
  if (tier === 'CHALLENGER') {
    if (playerRank && playerRank <= 30) {
      return { rated: true, baseValue: 130000 - ((playerRank - 1) / 29) * 87000 };
    }
    if (playerRank && playerRank <= 150) {
      return { rated: true, baseValue: 43000 - ((playerRank - 30) / 120) * 28000 };
    }
    return { rated: true, baseValue: 5000 + Math.min(1, lp / 1500) * 7000 };
  }
  return { rated: false, baseValue: 0, notRatedReason: 'unknown_tier' };
}

// ─────────────────────────────────────────────────────────────────────────────
// match → snapshot helper
// Mirrors the inline `classify()` from app/api/tft/marktwert/route.ts so the
// crawler builds the exact same input shape the marketvalue pipeline reads.
// Runs on the raw Match-V1 DTO (Riot fields character_id + itemNames).
// ─────────────────────────────────────────────────────────────────────────────

const SET_RX = /^TFT(\d+)_/;

function detectSetNumber(participants) {
  for (const p of participants || []) {
    for (const u of p.units || []) {
      const m = SET_RX.exec(u.character_id || '');
      if (m) return Number(m[1]);
    }
  }
  return undefined;
}

function classifyComp(p) {
  const traits = (p.traits || []).filter(t => (t.style ?? 0) > 0);
  if (traits.length === 0) return undefined;
  traits.sort((a, b) => {
    if ((b.style ?? 0) !== (a.style ?? 0)) return (b.style ?? 0) - (a.style ?? 0);
    if ((b.tier_current ?? 0) !== (a.tier_current ?? 0)) return (b.tier_current ?? 0) - (a.tier_current ?? 0);
    return (a.name || '').localeCompare(b.name || '');
  });
  const primary = traits[0];
  const ranked = [...(p.units || [])].sort((a, b) => {
    const aItems = (a.itemNames || []).length, bItems = (b.itemNames || []).length;
    if (bItems !== aItems) return bItems - aItems;
    if ((b.tier ?? 1) !== (a.tier ?? 1)) return (b.tier ?? 1) - (a.tier ?? 1);
    return (b.rarity ?? 0) - (a.rarity ?? 0);
  });
  const carry = ranked[0];
  if (!carry?.character_id) return undefined;
  return {
    clusterKey: `${primary.name}@${primary.tier_current ?? 0}_${carry.character_id}`,
    primaryTrait: primary.name,
    primaryTraitLevel: primary.tier_current ?? 0,
    carryUnit: carry.character_id,
    carryItems: (carry.itemNames || []).filter(Boolean).sort(),
  };
}

// Convert a raw Match-V1 DTO + puuid into the snapshot shape used by the
// marketvalue lib. Returns null if the player is not in the match or the
// queue isn't ranked TFT (queueId 1100).
export function buildSnapshotForPlayer(rawMatch, puuid) {
  if (!rawMatch?.info?.participants) return null;
  const queueId = rawMatch.info.queue_id ?? rawMatch.info.queueId ?? 0;
  if (queueId !== 1100) return null;
  const me = rawMatch.info.participants.find(p => p.puuid === puuid);
  if (!me) return null;
  return {
    matchId: rawMatch.metadata?.match_id,
    placement: me.placement ?? 9,
    setNumber: detectSetNumber(rawMatch.info.participants),
    augments: Array.isArray(me.augments) ? me.augments : [],
    comp: classifyComp(me),
    units: (me.units || []).map(u => ({
      characterId: u.character_id || '',
      tier: u.tier ?? 1,
      items: Array.isArray(u.itemNames) ? u.itemNames : [],
    })),
    // Extra match metrics for the skill-score signals.
    lastRound: me.last_round ?? 0,
    goldLeft: typeof me.gold_left === 'number' ? me.gold_left : null,
    level: me.level ?? 0,
    totalDamage: me.total_damage_to_players ?? 0,
  };
}
