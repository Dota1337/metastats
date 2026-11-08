// Baut die Datei lol/champion-stats/euw1.json (Champion-Liste + Startseite EUW)
// aus genau den Zeilen, die scripts/aggregate-lol-builds.mjs fuer die Build-
// Summen ohnehin liest — ein Lesezeiger, eine Filterregel. Rein, ohne DB und
// ohne Netz; Pfad, Pruefregel und Lesart: app/lib/lol-champion-stats-blob.mjs.

import { LOL_CHAMPION_STATS_REGION, LOL_STATS_TIERS } from '../../app/lib/lol-champion-stats-blob.mjs';

const patchNum = (p) => p.split('.').map(Number);
const newerFirst = (a, b) => {
  const [a1, a2] = patchNum(a.patch), [b1, b2] = patchNum(b.patch);
  return b1 - a1 || b2 - a2;
};

/** Sammler fuer einen Patch. */
export function createPatchStats(patch) {
  return { patch, tiers: new Map(), roles: new Map(), newest: 0 };
}

function champOf(tier, key) {
  let c = tier.champions.get(key);
  if (!c) tier.champions.set(key, c = { games: 0, wins: 0, kills: 0, deaths: 0, assists: 0, bans: 0 });
  return c;
}

/**
 * Ein gezaehlter Teilnehmer (schon durch die Filter der Verdichtung).
 * r: champion_id, team_position, seed_tier, win, match_id, kills, deaths,
 * assists (null in Zeilen vor Migration 0121), game_creation.
 */
export function addParticipant(acc, r) {
  let t = acc.tiers.get(r.seed_tier);
  if (!t) acc.tiers.set(r.seed_tier, t = { matchIds: new Set(), participants: 0, banMatches: 0, champions: new Map() });
  t.matchIds.add(r.match_id);
  t.participants++;
  const key = String(r.champion_id);
  const c = champOf(t, key);
  c.games++;
  if (r.win) c.wins++;
  // K/D/A nur zusammen: eine Zeile mit Kills, aber ohne Tode wuerde die KDA verbiegen.
  if (r.kills != null && r.deaths != null && r.assists != null) {
    c.kills += Number(r.kills);
    c.deaths += Number(r.deaths);
    c.assists += Number(r.assists);
  }
  let roles = acc.roles.get(key);
  if (!roles) acc.roles.set(key, roles = {});
  roles[r.team_position] = (roles[r.team_position] || 0) + 1;
  const created = r.game_creation instanceof Date ? r.game_creation.getTime() : Date.parse(r.game_creation);
  if (Number.isFinite(created) && created > acc.newest) acc.newest = created;
}

/**
 * Bans eines Matches (je Match schon entdoppelt, siehe Migration 0121). Zaehlt
 * nur, wenn das Match oben mitgezaehlt wurde — sonst laege es in Zaehler und
 * Nenner verschieden. true = gezaehlt.
 */
export function addMatchBans(acc, matchId, bans) {
  for (const t of acc.tiers.values()) {
    if (!t.matchIds.has(matchId)) continue;
    t.banMatches++;
    for (const id of new Set(Array.isArray(bans) ? bans : [])) {
      if (Number(id) > 0) champOf(t, String(Number(id))).bans++;
    }
    return true;
  }
  return false;
}

/**
 * Fertige Datei. patches: Sammler der (hoechstens zwei) neuesten Patches,
 * Reihenfolge egal. matchesAnalyzed: alle gezaehlten Stichproben-Matches seit
 * Sammelbeginn (Startseite).
 */
export function buildChampionStatsFile({ builtAt, matchesAnalyzed, patches }) {
  const sorted = [...patches].sort(newerFirst).slice(0, 2);
  const roles = {};
  let newest = 0;
  for (const acc of sorted) {
    newest = Math.max(newest, acc.newest);
    for (const [key, r] of acc.roles) {
      const out = roles[key] ||= {};
      for (const [role, n] of Object.entries(r)) out[role] = (out[role] || 0) + n;
    }
  }
  return {
    version: 1,
    source: 'box',
    region: LOL_CHAMPION_STATS_REGION,
    builtAt,
    dataNewest: newest > 0 ? new Date(newest).toISOString() : null,
    matchesAnalyzed,
    patches: sorted.map((acc) => ({
      patch: acc.patch,
      tiers: Object.fromEntries([...acc.tiers]
        .filter(([tier]) => LOL_STATS_TIERS.includes(tier))
        .map(([tier, t]) => [tier, {
          matches: t.matchIds.size,
          participants: t.participants,
          banMatches: t.banMatches,
          champions: Object.fromEntries(t.champions),
        }])),
    })),
    roles,
  };
}

/** Eine Protokollzeile je Patch: Matches, davon mit Ban-/KDA-Daten. */
export function describeChampionStatsFile(file) {
  return (file.patches || []).map((p) => {
    const tiers = Object.values(p.tiers);
    const m = tiers.reduce((s, t) => s + t.matches, 0);
    const b = tiers.reduce((s, t) => s + t.banMatches, 0);
    return `${p.patch}: ${m} Matches, ${b} mit Bans/KDA`;
  }).join(' · ');
}
