/**
 * Aggregates per-champion-per-role build data from Match-V5 DTOs.
 * Used by collect-highelo.mjs and collect-kr-cn.mjs.
 *
 * Output shape (per champion+role):
 *   { games, wins,
 *     topBuilds:    [{ items: [..6 IDs..], games, wins }, ...top 5],
 *     topBoots:     [{ item, games, wins }, ...top 5],
 *     topItems:     [{ item, games, wins }, ...top 15],   // popularity across all slots
 *     topRunes:     [{ primary, keystone, p1,p2,p3, secondary, s1,s2, off,flex,def, games, wins }, ...top 5],
 *     topKeystones: [{ id, games, wins }, ...top 5],
 *     topSummoners: [{ spells: [a,b], games, wins }, ...top 3],
 *     counters:     { strongAgainst: [{ enemy, gamesAgainst, lossesAgainst }, ...], weakAgainst: [...] }
 *   }
 */

const ROLES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];

export async function loadBootSet(version) {
  // Fetch item.json from Data Dragon and return Set of item IDs tagged "Boots".
  // We accept the URL as-is; caller provides IPv4-safe fetcher if needed.
  const url = `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/item.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`item.json fetch failed: HTTP ${res.status}`);
  const data = await res.json();
  const boots = new Set();
  for (const [id, item] of Object.entries(data.data || {})) {
    if (Array.isArray(item.tags) && item.tags.includes('Boots')) {
      boots.add(Number(id));
    }
  }
  return boots;
}

function emptyEntry() {
  return {
    games: 0,
    wins: 0,
    buildCounts: new Map(),    // sortedKey -> { items, games, wins }
    bootCounts: new Map(),     // itemId -> { games, wins }
    itemCounts: new Map(),     // itemId -> { games, wins }
    runeCounts: new Map(),     // key -> { ...rune, games, wins }
    keystoneCounts: new Map(), // keystoneId -> { games, wins }
    summonerCounts: new Map(), // sortedKey -> { spells, games, wins }
    counterCounts: new Map(),  // enemyChampId -> { gamesAgainst, lossesAgainst }
  };
}

export function ensureRole(builds, championId, role) {
  if (!builds[championId]) builds[championId] = {};
  if (!builds[championId][role]) builds[championId][role] = emptyEntry();
  return builds[championId][role];
}

function bumpMap(map, key, win, fields) {
  let entry = map.get(key);
  if (!entry) {
    entry = { ...fields, games: 0, wins: 0 };
    map.set(key, entry);
  }
  entry.games++;
  if (win) entry.wins++;
  return entry;
}

function extractParticipantBuild(p, bootSet) {
  const items = [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5]
    .map(x => Number(x) || 0);
  const nonZero = items.filter(x => x > 0);

  const boots = items.find(x => bootSet.has(x)) || null;

  // Full rune page
  const styles = p.perks?.styles || [];
  const primary = styles[0]?.style || 0;
  const primarySels = (styles[0]?.selections || []).map(s => Number(s.perk) || 0);
  const secondary = styles[1]?.style || 0;
  const secondarySels = (styles[1]?.selections || []).map(s => Number(s.perk) || 0);
  const stat = p.perks?.statPerks || {};
  const off = Number(stat.offense) || 0;
  const flex = Number(stat.flex) || 0;
  const def = Number(stat.defense) || 0;

  const runeOk = primary > 0 && primarySels.length >= 4 && secondary > 0 && secondarySels.length >= 2;

  return {
    items,
    nonZero,
    boots,
    runeOk,
    rune: runeOk ? {
      primary,
      keystone: primarySels[0],
      p1: primarySels[1], p2: primarySels[2], p3: primarySels[3],
      secondary,
      s1: secondarySels[0], s2: secondarySels[1],
      off, flex, def,
    } : null,
    summoners: [Number(p.summoner1Id) || 0, Number(p.summoner2Id) || 0].sort((a, b) => a - b),
  };
}

/**
 * Update `builds` in-place with one match.
 * `match` is the raw Match-V5 DTO. Returns true if the match was used.
 */
export function aggregateMatch(match, builds, bootSet) {
  if (!match?.info?.participants) return false;
  const ps = match.info.participants;

  // Group by teamPosition for counter analysis (TOP vs TOP, MID vs MID, ...).
  // Skip participants without a known role (autofill / dodged matches).
  const byPosition = { TOP: [], JUNGLE: [], MIDDLE: [], BOTTOM: [], UTILITY: [] };
  const perBuild = new Array(ps.length);

  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    const role = p.teamPosition;
    if (!role || !ROLES.includes(role)) continue;

    const championId = String(p.championId);
    const win = !!p.win;
    const entry = ensureRole(builds, championId, role);
    entry.games++;
    if (win) entry.wins++;

    const b = extractParticipantBuild(p, bootSet);
    perBuild[i] = { championId, role, win, ...b };
    byPosition[role].push({ idx: i, championId, win });

    // Per-item popularity (over all 6 slots, dedup per match-participant).
    const seen = new Set();
    for (const it of b.nonZero) {
      if (seen.has(it)) continue;
      seen.add(it);
      bumpMap(entry.itemCounts, it, win, { item: it });
    }

    // Boots
    if (b.boots) bumpMap(entry.bootCounts, b.boots, win, { item: b.boots });

    // Build set: only count if the player got at least 5 non-zero items.
    if (b.nonZero.length >= 5) {
      const key = [...b.nonZero].sort((a, b) => a - b).join(',');
      const e = bumpMap(entry.buildCounts, key, win, { items: [...b.nonZero].sort((a, b) => a - b) });
      e.items = e.items; // no-op; key insurance
    }

    // Runes
    if (b.runeOk) {
      const r = b.rune;
      const key = [r.primary, r.keystone, r.p1, r.p2, r.p3, r.secondary, r.s1, r.s2, r.off, r.flex, r.def].join(',');
      bumpMap(entry.runeCounts, key, win, { ...r });
      bumpMap(entry.keystoneCounts, r.keystone, win, { id: r.keystone });
    }

    // Summoner spells (sorted pair as key)
    const sumKey = b.summoners.join(',');
    bumpMap(entry.summonerCounts, sumKey, win, { spells: b.summoners });
  }

  // Counters: pair-wise per position, both teams.
  for (const role of ROLES) {
    const slots = byPosition[role];
    if (slots.length !== 2) continue;
    const [a, b] = slots;
    if (a.championId === b.championId) continue;
    const eA = ensureRole(builds, a.championId, role);
    const eB = ensureRole(builds, b.championId, role);
    const cA = eA.counterCounts.get(b.championId) || { enemy: b.championId, gamesAgainst: 0, lossesAgainst: 0 };
    const cB = eB.counterCounts.get(a.championId) || { enemy: a.championId, gamesAgainst: 0, lossesAgainst: 0 };
    cA.gamesAgainst++;
    cB.gamesAgainst++;
    if (!a.win) cA.lossesAgainst++;
    if (!b.win) cB.lossesAgainst++;
    eA.counterCounts.set(b.championId, cA);
    eB.counterCounts.set(a.championId, cB);
  }

  return true;
}

function topN(map, n, sortBy = e => e.games) {
  return [...map.values()]
    .sort((a, b) => sortBy(b) - sortBy(a))
    .slice(0, n);
}

/**
 * Convert in-memory aggregation into the on-disk shape. Strips Maps,
 * keeps only Top-N per section.
 */
export function finalizeBuilds(builds, opts = {}) {
  const minCounterGames = opts.minCounterGames ?? 5;
  const out = {};
  for (const [champId, roles] of Object.entries(builds)) {
    out[champId] = {};
    for (const [role, e] of Object.entries(roles)) {
      if (!e.games) continue;

      // Counters: only enemies with enough games. Strong = high win rate vs them; Weak = low.
      const counters = [...e.counterCounts.values()]
        .filter(c => c.gamesAgainst >= minCounterGames)
        .map(c => ({ ...c, winsAgainst: c.gamesAgainst - c.lossesAgainst, winRate: (c.gamesAgainst - c.lossesAgainst) / c.gamesAgainst }));
      const strongAgainst = [...counters].sort((a, b) => b.winRate - a.winRate).slice(0, 5)
        .map(({ enemy, gamesAgainst, lossesAgainst }) => ({ enemy, gamesAgainst, lossesAgainst }));
      const weakAgainst = [...counters].sort((a, b) => a.winRate - b.winRate).slice(0, 5)
        .map(({ enemy, gamesAgainst, lossesAgainst }) => ({ enemy, gamesAgainst, lossesAgainst }));

      out[champId][role] = {
        games: e.games,
        wins: e.wins,
        topBuilds: topN(e.buildCounts, 5),
        topBoots: topN(e.bootCounts, 5),
        topItems: topN(e.itemCounts, 15),
        topRunes: topN(e.runeCounts, 5),
        topKeystones: topN(e.keystoneCounts, 5),
        topSummoners: topN(e.summonerCounts, 3),
        counters: { strongAgainst, weakAgainst },
      };
    }
  }
  return out;
}

export const ALLOWED_QUEUES = new Set([420, 440]); // Solo + Flex
export const ROLES_LIST = ROLES;
