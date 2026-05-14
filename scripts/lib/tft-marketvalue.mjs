// MJS port of app/lib/tft-marketvalue/* — used by scripts/collect-tft-marketvalues.mjs
// because Node ESM scripts can't import TypeScript directly and tsx is not in deps.
//
// IMPORTANT: keep in sync with app/lib/tft-marketvalue/. If you change agent
// thresholds or scaling, change both. The TS source is the canonical version
// for the runtime API path (/api/tft/marktwert live-calc fallback) and this
// MJS port is for the daily snapshot crawler.

// ─────────────────────────────────────────────────────────────────────────────
// base-value
// ─────────────────────────────────────────────────────────────────────────────

const TIER_VAL = {
  IRON: 0, BRONZE: 1, SILVER: 2, GOLD: 3, PLATINUM: 4,
  EMERALD: 5, DIAMOND: 6, MASTER: 7, GRANDMASTER: 8, CHALLENGER: 9,
};

export function computeBaseValue(ranked, playerRank) {
  if (!ranked || !ranked.tier) {
    return { rated: false, baseValue: 0, notRatedReason: 'unranked' };
  }
  const tier = ranked.tier.toUpperCase();
  const tierNum = TIER_VAL[tier] ?? -1;
  if (tierNum < TIER_VAL.MASTER) {
    return { rated: false, baseValue: 0, notRatedReason: 'below_master' };
  }
  const lp = Math.max(0, ranked.leaguePoints || 0);

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
// agents
// ─────────────────────────────────────────────────────────────────────────────

function performanceAgent(matches) {
  const notes = [];
  let multiplier = 1;
  if (matches.length === 0) {
    return { agent: 'performance', multiplier: 1, delta: 0, notes: [{ label: 'no matches', impact: 0 }] };
  }
  const placements = matches.map(m => m.placement).filter(p => p > 0);
  const avgPlace = placements.reduce((a, b) => a + b, 0) / placements.length;
  const top4 = placements.filter(p => p <= 4).length / placements.length;
  const top1 = placements.filter(p => p === 1).length / placements.length;

  if (avgPlace < 3.5)      { multiplier += 0.20; notes.push({ label: 'avg-placement', impact: +0.20, detail: avgPlace.toFixed(2) }); }
  else if (avgPlace < 4.0) { multiplier += 0.10; notes.push({ label: 'avg-placement', impact: +0.10, detail: avgPlace.toFixed(2) }); }
  else if (avgPlace > 4.8) { multiplier -= 0.15; notes.push({ label: 'avg-placement', impact: -0.15, detail: avgPlace.toFixed(2) }); }
  else if (avgPlace > 4.5) { multiplier -= 0.07; notes.push({ label: 'avg-placement', impact: -0.07, detail: avgPlace.toFixed(2) }); }

  if (top4 > 0.60)      { multiplier += 0.10; notes.push({ label: 'top-4 rate', impact: +0.10, detail: `${(top4*100).toFixed(0)}%` }); }
  else if (top4 < 0.40) { multiplier -= 0.10; notes.push({ label: 'top-4 rate', impact: -0.10, detail: `${(top4*100).toFixed(0)}%` }); }

  if (top1 > 0.18)      { multiplier += 0.08; notes.push({ label: 'top-1 rate', impact: +0.08, detail: `${(top1*100).toFixed(0)}%` }); }
  else if (top1 > 0.13) { multiplier += 0.04; notes.push({ label: 'top-1 rate', impact: +0.04, detail: `${(top1*100).toFixed(0)}%` }); }

  multiplier = Math.max(0.45, Math.min(1.40, multiplier));
  return { agent: 'performance', multiplier, delta: multiplier - 1, notes };
}

export function buildMetaKgSlice(kg, topN = 10) {
  if (!kg?.edges?.compToUnit) return null;
  const compsSeen = new Set(kg.edges.compToUnit.map(e => e.comp));
  const compCounts = {};
  for (const e of kg.edges.compToUnit) {
    compCounts[e.comp] = (compCounts[e.comp] || 0) + (e.count || 0);
  }
  const hotKeys = Object.entries(compCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([k]) => k);
  return { hotCompKeys: new Set(hotKeys), knownCompKeys: compsSeen };
}

function metaAdaptationAgent(matches, kg) {
  const notes = [];
  let multiplier = 1;
  if (matches.length === 0) {
    return { agent: 'metaAdaptation', multiplier: 1, delta: 0, notes: [{ label: 'no matches', impact: 0 }] };
  }
  const compKeys = matches.map(m => m.comp?.clusterKey).filter(Boolean);
  const uniqueComps = new Set(compKeys);
  const dominantCount = compKeys.length > 0
    ? Math.max(...[...uniqueComps].map(k => compKeys.filter(c => c === k).length))
    : 0;
  const dominantShare = compKeys.length > 0 ? dominantCount / compKeys.length : 0;

  if (uniqueComps.size >= 4)      { multiplier += 0.06; notes.push({ label: 'comp diversity', impact: +0.06, detail: `${uniqueComps.size} comps` }); }
  else if (uniqueComps.size >= 3) { multiplier += 0.03; notes.push({ label: 'comp diversity', impact: +0.03, detail: `${uniqueComps.size} comps` }); }
  if (dominantShare > 0.85 && compKeys.length >= 10) {
    multiplier -= 0.10;
    notes.push({ label: 'one-trick penalty', impact: -0.10, detail: `${(dominantShare*100).toFixed(0)}% one comp` });
  }

  if (kg && kg.hotCompKeys.size > 0 && compKeys.length > 0) {
    const hotPicks = compKeys.filter(k => kg.hotCompKeys.has(k)).length;
    const hotShare = hotPicks / compKeys.length;
    if (hotShare >= 0.60)      { multiplier += 0.07; notes.push({ label: 'meta picks', impact: +0.07, detail: `${(hotShare*100).toFixed(0)}% in top-10` }); }
    else if (hotShare >= 0.40) { multiplier += 0.03; notes.push({ label: 'meta picks', impact: +0.03, detail: `${(hotShare*100).toFixed(0)}% in top-10` }); }
    else if (hotShare < 0.10 && compKeys.length >= 10) {
      multiplier -= 0.05;
      notes.push({ label: 'off-meta', impact: -0.05, detail: `${(hotShare*100).toFixed(0)}%` });
    }
  }

  multiplier = Math.max(0.85, Math.min(1.18, multiplier));
  return { agent: 'metaAdaptation', multiplier, delta: multiplier - 1, notes };
}

export function buildHighRollKgSlice(kg, topPerUnit = 5) {
  if (!kg?.edges?.unitToItem) return null;
  const grouped = {};
  for (const e of kg.edges.unitToItem) {
    if (!grouped[e.unit]) grouped[e.unit] = [];
    grouped[e.unit].push({ item: e.item, games: e.games });
  }
  const out = {};
  for (const [unit, list] of Object.entries(grouped)) {
    list.sort((a, b) => b.games - a.games);
    out[unit] = new Set(list.slice(0, topPerUnit).map(x => x.item));
  }
  return { recommendedItems: out };
}

function highRollAgent(matches, kg, augTierMap) {
  const notes = [];
  let multiplier = 1;
  if (matches.length === 0) {
    return { agent: 'highRoll', multiplier: 1, delta: 0, notes: [{ label: 'no matches', impact: 0 }] };
  }

  if (kg) {
    let scored = 0, scoreSum = 0;
    for (const m of matches) {
      const carry = m.comp?.carryUnit;
      const carryItems = m.comp?.carryItems || [];
      if (!carry || carryItems.length === 0) continue;
      const rec = kg.recommendedItems[carry];
      if (!rec || rec.size === 0) continue;
      const hits = carryItems.filter(i => rec.has(i)).length;
      scoreSum += hits / Math.max(1, carryItems.length);
      scored++;
    }
    if (scored >= 5) {
      const avgHit = scoreSum / scored;
      if (avgHit > 0.80)      { multiplier += 0.05; notes.push({ label: 'item slam', impact: +0.05, detail: `${(avgHit*100).toFixed(0)}% recommended` }); }
      else if (avgHit > 0.60) { multiplier += 0.02; notes.push({ label: 'item slam', impact: +0.02, detail: `${(avgHit*100).toFixed(0)}% recommended` }); }
      else if (avgHit < 0.30) { multiplier -= 0.04; notes.push({ label: 'item slam', impact: -0.04, detail: `${(avgHit*100).toFixed(0)}% recommended` }); }
    }
  }

  if (augTierMap) {
    let totalAugs = 0, prismatics = 0;
    for (const m of matches) {
      for (const a of m.augments || []) {
        totalAugs++;
        if (augTierMap[a] === 3) prismatics++;
      }
    }
    if (totalAugs >= 15) {
      const prismaticShare = prismatics / totalAugs;
      if (prismaticShare > 0.30)      { multiplier += 0.04; notes.push({ label: 'prismatic share', impact: +0.04, detail: `${(prismaticShare*100).toFixed(0)}%` }); }
      else if (prismaticShare > 0.20) { multiplier += 0.02; notes.push({ label: 'prismatic share', impact: +0.02, detail: `${(prismaticShare*100).toFixed(0)}%` }); }
    }
  }

  multiplier = Math.max(0.90, Math.min(1.12, multiplier));
  return { agent: 'highRoll', multiplier, delta: multiplier - 1, notes };
}

// FlexMasteryAgent — rewards players who can pilot multiple comps at a high
// level (the opposite of one-trick spam). Pure one-tricks still get a small
// bonus if their average placement on that single comp is exceptional.
function flexMasteryAgent(matches) {
  const notes = [];
  let multiplier = 1;
  if (matches.length < 10) {
    return { agent: 'flexMastery', multiplier: 1, delta: 0, notes: [{ label: 'sample too small', impact: 0 }] };
  }

  // Per-comp placement averages (min 5 games per comp counted)
  const byComp = new Map();
  for (const m of matches) {
    const k = m.comp?.clusterKey;
    if (!k) continue;
    if (!byComp.has(k)) byComp.set(k, []);
    byComp.get(k).push(m.placement);
  }
  const compAvgs = [...byComp.entries()]
    .filter(([, plcs]) => plcs.length >= 5)
    .map(([k, plcs]) => ({ key: k, avg: plcs.reduce((a, b) => a + b, 0) / plcs.length, games: plcs.length }));
  const masteredComps = compAvgs.filter(c => c.avg <= 3.5);
  const dominant = compAvgs.sort((a, b) => b.games - a.games)[0];

  if (masteredComps.length >= 3) {
    multiplier += 0.06;
    notes.push({ label: 'flex mastery', impact: +0.06, detail: `${masteredComps.length} comps avg ≤3.5` });
  } else if (masteredComps.length >= 2) {
    multiplier += 0.03;
    notes.push({ label: 'flex mastery', impact: +0.03, detail: `${masteredComps.length} comps avg ≤3.5` });
  } else if (dominant && dominant.games >= 15 && dominant.avg <= 2.8) {
    // Pure one-trick but exceptional → small bonus (less than flex would get)
    multiplier += 0.03;
    notes.push({ label: 'one-trick mastery', impact: +0.03, detail: `avg ${dominant.avg.toFixed(2)}` });
  } else if (compAvgs.length >= 3 && compAvgs.every(c => c.avg > 4.5)) {
    multiplier -= 0.04;
    notes.push({ label: 'flex without substance', impact: -0.04, detail: `${compAvgs.length} comps all avg >4.5` });
  }

  // Carry-unit diversity — a separate axis from comp variety. Same comp
  // family can have different carries (Aphelios vs Jinx Sentinels, etc.)
  const carryUnits = new Set(matches.map(m => m.comp?.carryUnit).filter(Boolean));
  if (carryUnits.size >= 6) {
    multiplier += 0.03;
    notes.push({ label: 'carry diversity', impact: +0.03, detail: `${carryUnits.size} carries` });
  } else if (carryUnits.size <= 2 && matches.length >= 30) {
    multiplier -= 0.04;
    notes.push({ label: 'narrow carry pool', impact: -0.04, detail: `${carryUnits.size} carries` });
  }

  multiplier = Math.max(0.90, Math.min(1.12, multiplier));
  return { agent: 'flexMastery', multiplier, delta: multiplier - 1, notes };
}

// GameSenseAgent — late-game decision making.
// Survival skill: how late did the player exit when they didn't make Top-4?
// Eco mastery: how much gold was left on the bench when they Top-4'd?
function gameSenseAgent(matches) {
  const notes = [];
  let multiplier = 1;
  if (matches.length < 10) {
    return { agent: 'gameSense', multiplier: 1, delta: 0, notes: [{ label: 'sample too small', impact: 0 }] };
  }

  // Survival: avg last_round when finishing 5–8
  const bottoms = matches.filter(m => m.placement >= 5 && typeof m.lastRound === 'number' && m.lastRound > 0);
  if (bottoms.length >= 5) {
    const avgLate = bottoms.reduce((a, b) => a + b.lastRound, 0) / bottoms.length;
    if (avgLate > 6.0) {
      multiplier += 0.05;
      notes.push({ label: 'late exit', impact: +0.05, detail: `Ø Stage ${avgLate.toFixed(1)}` });
    } else if (avgLate > 5.5) {
      multiplier += 0.02;
      notes.push({ label: 'late exit', impact: +0.02, detail: `Ø Stage ${avgLate.toFixed(1)}` });
    }
  }

  // Eco: avg gold_left when finishing Top-4 (lower = more efficiently spent)
  // Skip null gold_left (matches cached before migration 0012)
  const tops = matches.filter(m => m.placement <= 4 && typeof m.goldLeft === 'number');
  if (tops.length >= 5) {
    const avgGold = tops.reduce((a, b) => a + b.goldLeft, 0) / tops.length;
    if (avgGold < 15) {
      multiplier += 0.03;
      notes.push({ label: 'eco mastery', impact: +0.03, detail: `Ø ${avgGold.toFixed(0)}g leftover` });
    } else if (avgGold > 40) {
      multiplier -= 0.02;
      notes.push({ label: 'unspent gold', impact: -0.02, detail: `Ø ${avgGold.toFixed(0)}g leftover` });
    }
  }

  multiplier = Math.max(0.94, Math.min(1.10, multiplier));
  return { agent: 'gameSense', multiplier, delta: multiplier - 1, notes };
}

function consistencyAgent(matches) {
  const notes = [];
  let multiplier = 1;
  if (matches.length < 5) {
    return { agent: 'consistency', multiplier: 1, delta: 0, notes: [{ label: 'sample too small', impact: 0 }] };
  }
  const placements = matches.map(m => m.placement).filter(p => p > 0);
  const mean = placements.reduce((a, b) => a + b, 0) / placements.length;
  const variance = placements.reduce((s, p) => s + (p - mean) ** 2, 0) / placements.length;
  const stddev = Math.sqrt(variance);

  if (stddev < 1.8)      { multiplier += 0.06; notes.push({ label: 'placement stddev', impact: +0.06, detail: stddev.toFixed(2) }); }
  else if (stddev < 2.1) { multiplier += 0.03; notes.push({ label: 'placement stddev', impact: +0.03, detail: stddev.toFixed(2) }); }
  else if (stddev > 2.6) { multiplier -= 0.04; notes.push({ label: 'placement stddev', impact: -0.04, detail: stddev.toFixed(2) }); }

  let bestStreak = 0, current = 0;
  for (const p of placements) {
    if (p <= 4) { current++; bestStreak = Math.max(bestStreak, current); }
    else current = 0;
  }
  if (bestStreak >= 5 && placements.length >= 20) {
    multiplier += 0.03;
    notes.push({ label: 'top-4 streak', impact: +0.03, detail: `${bestStreak} in a row` });
  }

  const bottom4Rate = placements.filter(p => p >= 5).length / placements.length;
  if (bottom4Rate > 0.55) {
    multiplier -= 0.06;
    notes.push({ label: 'bottom-4 share', impact: -0.06, detail: `${(bottom4Rate*100).toFixed(0)}%` });
  }

  multiplier = Math.max(0.88, Math.min(1.10, multiplier));
  return { agent: 'consistency', multiplier, delta: multiplier - 1, notes };
}

// ─────────────────────────────────────────────────────────────────────────────
// orchestration
// ─────────────────────────────────────────────────────────────────────────────

// Sample-size damping pulls the multiplier toward 1.0 when we don't have
// enough matches to trust the agent signals. With set-wide aggregation we
// expect 100+ matches for active players, so 100 is the new "full trust"
// threshold; the old 40-match plateau is replaced with a softer 0.95 ramp.
function dampFor(sampleSize) {
  if (sampleSize < 20) return 0.5;
  if (sampleSize < 40) return 0.8;
  if (sampleSize < 100) return 0.95;
  return 1.0;
}

export function calculateTftMarketValue(input) {
  const base = computeBaseValue(input.ranked, input.playerRank);
  if (!base.rated) {
    return {
      baseValue: 0, multiplier: 1, finalValue: 0, rated: false,
      notRatedReason: base.notRatedReason || 'unrated',
      agents: [], sampleSize: input.matches.length, damping: 1,
    };
  }

  const metaKg = buildMetaKgSlice(input.patchKnowledgeGraph);
  const highRollKg = buildHighRollKgSlice(input.patchKnowledgeGraph);
  const augTier = input.augmentTierMap || null;

  const perf = performanceAgent(input.matches);
  const meta = metaAdaptationAgent(input.matches, metaKg);
  const high = highRollAgent(input.matches, highRollKg, augTier);
  const cons = consistencyAgent(input.matches);
  const flex = flexMasteryAgent(input.matches);
  const sense = gameSenseAgent(input.matches);

  const productMultiplier =
    perf.multiplier * meta.multiplier * high.multiplier *
    cons.multiplier * flex.multiplier * sense.multiplier;
  const damping = dampFor(input.matches.length);
  const damped = 1 + (productMultiplier - 1) * damping;
  const clamped = Math.max(0.45, Math.min(1.65, damped));

  return {
    baseValue: Math.round(base.baseValue),
    multiplier: Number(clamped.toFixed(3)),
    finalValue: Math.round(base.baseValue * clamped),
    rated: true,
    agents: [perf, meta, high, cons, flex, sense],
    sampleSize: input.matches.length,
    damping,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// match → snapshot helper
// Mirrors the inline `classify()` from app/api/tft/marktwert/route.ts so the
// crawler builds the exact same input shape calculateTftMarketValue() expects.
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
    // Extra match metrics for the flexMastery / gameSense agents
    lastRound: me.last_round ?? 0,
    goldLeft: typeof me.gold_left === 'number' ? me.gold_left : null,
    level: me.level ?? 0,
    totalDamage: me.total_damage_to_players ?? 0,
  };
}
