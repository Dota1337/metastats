/**
 * Link team roster entries to their verified accounts from pro-players.json.
 *
 * pro-players.json is the single source of truth for accounts (4-source validation
 * via validate-pro-accounts.mjs: trackingthepros + lolpros + op.gg + Riot API).
 * This script idempotently writes riotId/region/accounts/smurfs fields into
 * pro-teams.json roster entries based on the verified mainAccount.
 *
 * Precedence (per roster entry):
 *   1. If proName matches a player in pro-players.json AND they have a verified
 *      mainAccount → use it. riotId = "name#tag", region = mainAccount.region
 *   2. Otherwise if the player has a legacy accounts[] array → use accounts[0]
 *      as a best-effort fallback, region inferred from tag or team region.
 *   3. Otherwise leave riotId/region null (no link > wrong link).
 *
 * Usage: node scripts/link-team-rosters.mjs
 */

import fs from 'fs';

const TEAMS_PATH = 'public/pro-teams.json';
const PLAYERS_PATH = 'public/pro-players.json';

const teams = JSON.parse(fs.readFileSync(TEAMS_PATH, 'utf8'));
const players = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf8'));

// Build lookups: proName (lc) -> player entries[]
// We keep a list because some pro names collide (e.g. "Ruler", "Bin" — different teams)
const byName = new Map();
for (const p of (players.players || [])) {
  const key = (p.proName || p.ID || '').toLowerCase();
  if (!key) continue;
  if (!byName.has(key)) byName.set(key, []);
  byName.get(key).push(p);
}

// Parse team-region from team.region (e.g. "Korea" -> "kr", "Europe" -> "euw1")
const TEAM_REGION_MAP = {
  'Korea': 'kr', 'China': 'kr',
  'Europe': 'euw1', 'North America': 'na1', 'Brazil': 'br1',
  'Japan': 'jp1', 'Turkey': 'tr1', 'Oceania': 'oc1',
  'Latin America North': 'la1', 'Latin America South': 'la2',
  'Southeast Asia': 'sg2', 'Taiwan': 'tw2', 'Vietnam': 'vn2',
  'Philippines': 'ph2', 'Thailand': 'th2', 'Russia': 'ru',
};

// Normalise mainAccount.region strings that came from validate-pro-accounts.mjs
// ('kr', 'euw', 'na', 'cn') to Riot platform IDs expected by /api/summoner.
const REGION_NORMALIZE = {
  'kr': 'kr', 'cn': 'kr', // CN accounts queried as KR
  'euw': 'euw1', 'eune': 'eun1',
  'na': 'na1', 'br': 'br1',
  'jp': 'jp1', 'tr': 'tr1', 'oce': 'oc1', 'oc': 'oc1',
  'lan': 'la1', 'las': 'la2', 'la1': 'la1', 'la2': 'la2',
  'sea': 'sg2', 'sg': 'sg2', 'tw': 'tw2', 'vn': 'vn2',
  'ph': 'ph2', 'th': 'th2', 'ru': 'ru',
};

function normaliseRegion(r, fallback) {
  if (!r) return fallback || null;
  const k = String(r).toLowerCase();
  return REGION_NORMALIZE[k] || k || fallback || null;
}

let stats = {
  teamsProcessed: 0,
  rosterSlotsProcessed: 0,
  linkedVerified: 0,
  linkedFallback: 0,
  unlinked: 0,
  overwritten: 0,
  smurfsAttached: 0,
};

function cleanName(n) {
  // Leaguepedia sometimes appends real name in parens: "APA (Eain Stearns)"
  return String(n || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function pickPlayer(proName, teamName) {
  const key = cleanName(proName).toLowerCase();
  const candidates = byName.get(key) || [];
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  // Disambiguate by team
  const byTeam = candidates.find(c => (c.team || '').toLowerCase() === (teamName || '').toLowerCase());
  if (byTeam) return byTeam;
  // Prefer ones with a verified mainAccount
  const verified = candidates.find(c => c.mainAccount?.verified);
  if (verified) return verified;
  // Fallback: first
  return candidates[0];
}

for (const team of (teams.teams || [])) {
  stats.teamsProcessed++;
  const teamFallbackRegion = TEAM_REGION_MAP[team.region] || 'euw1';

  for (const member of (team.roster || [])) {
    if (!member.isPlayer) continue; // skip staff
    stats.rosterSlotsProcessed++;

    const existingRiotId = member.riotId;
    const player = pickPlayer(member.name, team.name);

    let newRiotId = null;
    let newRegion = null;
    let newAccounts = null;
    let newSmurfs = null;
    let linkSource = null;

    if (player?.mainAccount?.verified && player.mainAccount.name && player.mainAccount.tag) {
      newRiotId = `${player.mainAccount.name}#${player.mainAccount.tag}`;
      newRegion = normaliseRegion(player.mainAccount.region, teamFallbackRegion);
      newAccounts = [player.mainAccount.name, ...(player.smurfs || []).map(s => s.name)];
      newSmurfs = (player.smurfs || []).map(s => ({
        name: s.name, tag: s.tag,
        region: normaliseRegion(s.region, teamFallbackRegion),
        rank: s.rank,
      }));
      linkSource = 'verified';
      stats.linkedVerified++;
    } else if (player?.accounts?.length > 0) {
      // Fallback to legacy accounts[]
      const raw = player.accounts[0];
      if (String(raw).includes('#')) {
        newRiotId = raw;
      } else {
        // Legacy name-only entry → assume team fallback tag
        newRiotId = raw;
      }
      newAccounts = player.accounts.slice();
      newRegion = normaliseRegion(player.mainAccount?.region, teamFallbackRegion);
      linkSource = 'fallback';
      stats.linkedFallback++;
    } else {
      stats.unlinked++;
    }

    if (existingRiotId && newRiotId && existingRiotId !== newRiotId) {
      stats.overwritten++;
    }

    // Write fields. Only overwrite if we have something to say.
    if (newRiotId) {
      member.riotId = newRiotId;
      member.accounts = newAccounts || [];
      if (newRegion) member.region = newRegion;
      if (newSmurfs) { member.smurfs = newSmurfs; stats.smurfsAttached += newSmurfs.length; }
      member.linkSource = linkSource;
    }
    // If newRiotId is null but player existed with no verified data, leave existing
    // values alone — we don't want to regress curated hardcoded accounts.
  }
}

teams.updatedAt = new Date().toISOString();
teams.linkedAt = teams.updatedAt;
fs.writeFileSync(TEAMS_PATH, JSON.stringify(teams, null, 2));

console.log('=== Link Team Rosters ===');
console.log(JSON.stringify(stats, null, 2));

// Verify Top teams
console.log('\n[Verification]');
for (const name of ['T1', 'Gen.G', 'G2 Esports', 'Fnatic', 'Dplus KIA', 'Team Liquid', 'Cloud9', 'Weibo Gaming']) {
  const t = (teams.teams || []).find(x => x.name === name);
  if (!t) continue;
  const mains = (t.roster || []).filter(m => m.status === 'main');
  const linked = mains.filter(m => m.riotId);
  const verified = mains.filter(m => m.linkSource === 'verified');
  console.log(`  ${name.padEnd(20)} linked:${linked.length}/${mains.length} verified:${verified.length}`);
  for (const m of mains) {
    const flag = m.linkSource === 'verified' ? '✓' : m.linkSource === 'fallback' ? '~' : '·';
    console.log(`    ${flag} ${m.role.padEnd(8)} ${m.name.padEnd(20)} ${m.riotId || '(no link)'} [${m.region || '-'}]`);
  }
}
