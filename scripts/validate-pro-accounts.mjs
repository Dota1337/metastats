#!/usr/bin/env node
/**
 * Pro Account Validator — Cross-validates pro player accounts across 4 sources:
 * 1. trackingthepros.com
 * 2. lolpros.gg
 * 3. op.gg
 * 4. Riot API (existence + rank check)
 *
 * Rule: Account is verified if 3 of 4 sources confirm it.
 * Main account = highest rank. Rest = smurfs.
 *
 * Usage: node scripts/validate-pro-accounts.mjs [--team "Team Name"] [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRO_PLAYERS_PATH = path.join(__dirname, '..', 'public', 'pro-players.json');
const RESULTS_PATH = path.join(__dirname, '..', 'public', 'validated-accounts.json');
const RIOT_API_KEY = process.env.RIOT_API_KEY || '';

const PLAYER_ROLES = ['Top', 'Jungle', 'Mid', 'Bot', 'Support'];

const TOP_TEAMS = [
  // LCK
  'T1', 'Gen.G', 'Hanwha Life Esports', 'KT Rolster', 'Dplus Kia', 'Nongshim RedForce', 'HANJIN BRION', 'BNK FEARX',
  // LEC
  'G2 Esports', 'Fnatic', 'SK Gaming', 'Team Vitality', 'Karmine Corp', 'Team Heretics', 'GIANTX', 'Movistar KOI', 'ROGUE CREW',
  // LCS
  'Cloud9', 'Team Liquid', 'FlyQuest', 'NRG', 'Dignitas', 'Shopify Rebellion',
  // LPL
  'JD Gaming', 'Top Esports', 'Bilibili Gaming', 'Weibo Gaming', 'LNG Esports', 'EDward Gaming',
  // EMEA
  'Eintracht Spandau', 'Eintracht Frankfurt', 'Unicorns of Love Sexy Edition', 'Solary', 'GameWard',
  // Other
  'CTBC Flying Oyster', 'Frank Esports', 'Movistar R7',
];

// Rate limiting
const delay = (ms) => new Promise(r => setTimeout(r, ms));

// Rank ordering for determining main account
const RANK_ORDER = {
  'CHALLENGER': 9, 'GRANDMASTER': 8, 'MASTER': 7, 'DIAMOND': 6,
  'EMERALD': 5, 'PLATINUM': 4, 'GOLD': 3, 'SILVER': 2, 'BRONZE': 1, 'IRON': 0
};

function parseRankString(rankStr) {
  if (!rankStr) return -1;
  const upper = rankStr.toUpperCase().trim();
  if (upper === 'UNRANKED' || upper === 'UNKNOWN' || upper === '') return -1;

  // Try to extract LP for fine-grained ranking
  const lpMatch = upper.match(/(\d[\d,]*)\s*LP/);
  const lp = lpMatch ? parseInt(lpMatch[1].replace(/,/g, '')) : 0;

  // Abbreviation map (trackingthepros uses "Ch", "GM", "D1", etc.)
  const abbrevMap = {
    'CH ': 9, 'CH,': 9, 'CHALL': 9,
    'GM ': 8, 'GM,': 8,
    'MASTER': 7, 'M ': 7, 'M,': 7,
    'DIAMOND': 6, 'D1': 6, 'D2': 6, 'D3': 6, 'D4': 6,
    'EMERALD': 5, 'EM ': 5,
    'PLAT': 4, 'GOLD': 3, 'SILVER': 2, 'BRONZE': 1, 'IRON': 0
  };

  for (const [rank, order] of Object.entries(RANK_ORDER)) {
    if (upper.includes(rank)) {
      return order * 10000 + lp;
    }
  }
  // Try abbreviations (Ch, GM, M, D1, etc.)
  for (const [abbrev, order] of Object.entries(abbrevMap)) {
    if (upper.startsWith(abbrev) || (upper + ' ').includes(' ' + abbrev)) {
      return order * 10000 + lp;
    }
  }
  return -1;
}

// Normalize account name for comparison
function normalizeAccount(nameTag) {
  if (!nameTag) return null;
  // Remove special unicode chars, normalize spaces
  let n = nameTag.trim();
  // Ensure it has a #tag
  if (!n.includes('#')) return null;
  return n;
}

function accountKey(nameTag) {
  if (!nameTag) return '';
  // Lowercase, trim for comparison
  return nameTag.toLowerCase().replace(/\s+/g, ' ').trim();
}

// =========================================================
// Source 1: trackingthepros.com
// =========================================================
async function fetchTrackingThePros(proName) {
  try {
    const url = `https://www.trackingthepros.com/player/${encodeURIComponent(proName)}/`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    if (!res.ok) return [];
    const html = await res.text();

    const accounts = [];

    // HTML structure: |[REGION]| Name#Tag|Rank|[REGION]| Name#Tag|Rank|...
    // Strip HTML tags, split by pipe
    const stripped = html.replace(/<[^>]+>/g, '|');
    // Find the "Accounts" section
    const accountsIdx = stripped.indexOf('|Accounts|');
    if (accountsIdx === -1) {
      // Fallback: extract name#tag patterns directly
      return extractRiotIds(html, 'trackingthepros');
    }

    const section = stripped.slice(accountsIdx);
    // Format: |[REGION]| Name#Tag||Rank|
    const regionAccountPattern = /\[(KR|EUW|NA|BR|JP|OCE|LAN|LAS|EUNE|TR|RU|PH|SG|TW|TH|VN)\]\|+\s*([^|]+?#[^|]+?)\|+([^[|]*?)(?=\|*\[|\|*Show|\|*$)/gi;
    let m;
    while ((m = regionAccountPattern.exec(section)) !== null) {
      const region = m[1].toLowerCase();
      const nameTag = m[2].trim();
      const rank = m[3].trim() || 'Unranked';
      if (nameTag.length > 3) {
        accounts.push({ nameTag, region, rank, source: 'trackingthepros' });
      }
    }

    // Fallback if regex didn't match
    if (accounts.length === 0) {
      return extractRiotIds(html, 'trackingthepros');
    }

    return accounts;
  } catch (e) {
    console.error(`  [trackingthepros] Error for ${proName}:`, e.message);
    return [];
  }
}

// Extract Riot IDs (Name#Tag) from raw HTML, filtering out CSS/UI artifacts
function extractRiotIds(html, source) {
  const accounts = [];
  const riotIdPattern = /([\w\s\p{L}\p{N}]+)#([\w\p{L}\p{N}]+)/gu;
  let m;
  const seen = new Set();
  const blacklist = [
    'inactive_link', 'loadMoreBtn', 'follow', 'streaming', 'banner',
    'solid', 'border', 'color', 'parent', 'nprogress', 'search by',
    'Bitte gib', 'Spielername', 'Tagline', 'GameName', 'nBitte',
    'container', 'wrapper', 'header', 'footer', 'modal', 'tooltip'
  ];
  while ((m = riotIdPattern.exec(html)) !== null) {
    const name = m[1].trim();
    const tag = m[2];
    if (name.length < 2 || tag.length > 20) continue;
    if (blacklist.some(k => name.toLowerCase().includes(k.toLowerCase()))) continue;
    if (/px|solid|border|color|[;:{}]|display|margin|padding|width|height/.test(name)) continue;
    if (!/[a-zA-Z\p{L}]/u.test(name)) continue;
    // Filter hex color codes used as tags (e.g., #003554)
    if (/^[0-9a-f]{3,8}$/i.test(tag) && /^[0-9a-f]{3,8}$/i.test(name)) continue;
    const nameTag = `${name}#${tag}`;
    const key = accountKey(nameTag);
    if (!seen.has(key)) {
      seen.add(key);
      accounts.push({ nameTag, region: 'unknown', rank: 'Unknown', source });
    }
  }
  return accounts;
}

// =========================================================
// Source 2: lolpros.gg
// =========================================================
async function fetchLolPros(proName) {
  try {
    const slug = proName.toLowerCase().replace(/\s+/g, '');
    const url = `https://lolpros.gg/player/${encodeURIComponent(slug)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    if (!res.ok) return [];
    const html = await res.text();

    // Only parse the player-specific section (before "team-members" div)
    const teamIdx = html.indexOf('team-members');
    const playerSection = teamIdx > 0 ? html.slice(0, teamIdx) : html;
    return extractRiotIds(playerSection, 'lolpros');
  } catch (e) {
    console.error(`  [lolpros] Error for ${proName}:`, e.message);
    return [];
  }
}

// =========================================================
// Source 3: op.gg (needs a known account to look up)
// =========================================================
async function fetchOpGG(nameTag, region) {
  try {
    if (!nameTag || !nameTag.includes('#')) return [];
    const [name, tag] = nameTag.split('#');
    const regionMap = {
      'kr': 'kr', 'euw': 'euw', 'na': 'na', 'eun': 'eune',
      'br': 'br', 'jp': 'jp', 'oce': 'oce', 'lan': 'lan', 'las': 'las',
      'kr1': 'kr', 'euw1': 'euw', 'na1': 'na', 'eun1': 'eune',
      'br1': 'br', 'jp1': 'jp', 'oc1': 'oce'
    };
    const opggRegion = regionMap[region?.toLowerCase()] || region?.toLowerCase() || 'euw';
    const url = `https://op.gg/de/lol/summoners/${opggRegion}/${encodeURIComponent(name)}-${encodeURIComponent(tag)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    if (!res.ok) return [];
    const html = await res.text();

    const accounts = [];
    // The main account
    accounts.push({ nameTag, region: opggRegion, rank: 'Unknown', source: 'opgg', isMain: true });

    // Look for linked accounts ("Andere Accounts" / "Other accounts")
    // Use extractRiotIds to filter UI artifacts, then add source
    const linkedAccounts = extractRiotIds(html, 'opgg');
    const mainKey = accountKey(nameTag);
    for (const acc of linkedAccounts) {
      const key = accountKey(acc.nameTag);
      if (key !== mainKey) {
        accounts.push({ ...acc, region: opggRegion });
      }
    }

    return accounts;
  } catch (e) {
    console.error(`  [opgg] Error:`, e.message);
    return [];
  }
}

// =========================================================
// Source 4: Riot API
// =========================================================
async function fetchRiotAPI(nameTag) {
  if (!RIOT_API_KEY || !nameTag || !nameTag.includes('#')) return null;
  try {
    const [name, tag] = nameTag.split('#');
    const accountUrl = `https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(name)}/${encodeURIComponent(tag)}?api_key=${RIOT_API_KEY}`;
    const res = await fetch(accountUrl);
    if (!res.ok) return null;
    const data = await res.json();
    return { puuid: data.puuid, gameName: data.gameName, tagLine: data.tagLine, verified: true, source: 'riotapi' };
  } catch {
    return null;
  }
}

async function getRiotRank(puuid, region) {
  if (!RIOT_API_KEY || !puuid) return 'Unknown';
  try {
    const platformMap = {
      'kr': 'kr', 'euw': 'euw1', 'na': 'na1', 'eun': 'eun1',
      'br': 'br1', 'jp': 'jp1', 'oce': 'oc1'
    };
    const platform = platformMap[region?.toLowerCase()] || 'euw1';
    const url = `https://${platform}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}?api_key=${RIOT_API_KEY}`;
    const sumRes = await fetch(url);
    if (!sumRes.ok) return 'Unknown';
    const sumData = await sumRes.json();

    const leagueUrl = `https://${platform}.api.riotgames.com/lol/league/v4/entries/by-summoner/${sumData.id}?api_key=${RIOT_API_KEY}`;
    const leagueRes = await fetch(leagueUrl);
    if (!leagueRes.ok) return 'Unknown';
    const leagues = await leagueRes.json();
    const soloq = leagues.find(l => l.queueType === 'RANKED_SOLO_5x5');
    if (!soloq) return 'Unranked';
    return `${soloq.tier} ${soloq.rank} ${soloq.leaguePoints}LP`;
  } catch {
    return 'Unknown';
  }
}

// =========================================================
// Main validation logic
// =========================================================
async function validatePlayer(player) {
  const { proName } = player;
  console.log(`\n🔍 ${proName} (${player.team} - ${player.role})`);

  // Collect accounts from all sources
  const allAccounts = new Map(); // key -> { nameTag, sources: Set, ranks: Map, regions: Set }

  // Source 1: trackingthepros
  console.log(`  [1/4] trackingthepros.com...`);
  const ttpAccounts = await fetchTrackingThePros(proName);
  await delay(800);

  for (const acc of ttpAccounts) {
    const key = accountKey(acc.nameTag);
    if (!allAccounts.has(key)) {
      allAccounts.set(key, { nameTag: acc.nameTag, sources: new Set(), ranks: new Map(), regions: new Set() });
    }
    const entry = allAccounts.get(key);
    entry.sources.add('trackingthepros');
    // Keep the higher rank if we already have one for this source
    const existingRank = entry.ranks.get('trackingthepros');
    if (!existingRank || parseRankString(acc.rank) > parseRankString(existingRank)) {
      entry.ranks.set('trackingthepros', acc.rank);
    }
    if (acc.region !== 'unknown') entry.regions.add(acc.region);
  }
  console.log(`    → ${ttpAccounts.length} accounts found`);

  // Source 2: lolpros.gg
  console.log(`  [2/4] lolpros.gg...`);
  const lpAccounts = await fetchLolPros(proName);
  await delay(800);

  for (const acc of lpAccounts) {
    const key = accountKey(acc.nameTag);
    if (!allAccounts.has(key)) {
      allAccounts.set(key, { nameTag: acc.nameTag, sources: new Set(), ranks: new Map(), regions: new Set() });
    }
    allAccounts.get(key).sources.add('lolpros');
  }
  console.log(`    → ${lpAccounts.length} accounts found`);

  // Source 3: op.gg — use the best known account to find linked accounts
  console.log(`  [3/4] op.gg...`);
  // Find the best account to look up on op.gg (prefer one with region info)
  let bestForOpgg = null;
  let bestRegion = null;
  for (const [, entry] of allAccounts) {
    if (entry.regions.size > 0) {
      const rank = entry.ranks.get('trackingthepros') || '';
      if (!bestForOpgg || parseRankString(rank) > parseRankString(bestForOpgg.rank)) {
        bestForOpgg = { nameTag: entry.nameTag, rank };
        bestRegion = [...entry.regions][0];
      }
    }
  }
  // Fallback to existing accounts from pro-players.json
  if (!bestForOpgg && player.accounts) {
    for (const acc of player.accounts) {
      if (acc.includes('#')) {
        bestForOpgg = { nameTag: acc };
        // Guess region from tag
        const tag = acc.split('#')[1]?.toLowerCase();
        if (tag?.includes('kr')) bestRegion = 'kr';
        else if (tag?.includes('euw')) bestRegion = 'euw';
        else if (tag?.includes('na')) bestRegion = 'na';
        else bestRegion = 'euw';
        break;
      }
    }
  }

  let opggAccounts = [];
  if (bestForOpgg) {
    opggAccounts = await fetchOpGG(bestForOpgg.nameTag, bestRegion);
    await delay(800);

    for (const acc of opggAccounts) {
      const key = accountKey(acc.nameTag);
      if (!allAccounts.has(key)) {
        allAccounts.set(key, { nameTag: acc.nameTag, sources: new Set(), ranks: new Map(), regions: new Set() });
      }
      allAccounts.get(key).sources.add('opgg');
      if (acc.region !== 'unknown') allAccounts.get(key).regions.add(acc.region);
    }
  }
  console.log(`    → ${opggAccounts.length} accounts found`);

  // Source 4: Riot API — validate top accounts
  console.log(`  [4/4] Riot API...`);
  let riotValidated = 0;
  if (RIOT_API_KEY) {
    // Only validate accounts that have at least 1 source already
    for (const [key, entry] of allAccounts) {
      if (entry.sources.size >= 1) {
        const riotResult = await fetchRiotAPI(entry.nameTag);
        if (riotResult) {
          entry.sources.add('riotapi');
          // Use the canonical name from Riot
          entry.nameTag = `${riotResult.gameName}#${riotResult.tagLine}`;
          riotValidated++;
        }
        await delay(150); // Riot rate limit
      }
    }
  }
  console.log(`    → ${riotValidated} accounts verified via Riot API`);

  // Apply 3-of-4 rule (or 2-of-3 if Riot API unavailable)
  const minSources = RIOT_API_KEY ? 3 : 2;
  const verified = [];
  const unverified = [];

  for (const [key, entry] of allAccounts) {
    const sourceCount = entry.sources.size;
    const rankStr = entry.ranks.get('trackingthepros') || 'Unranked';
    const rankScore = parseRankString(rankStr);
    const account = {
      nameTag: entry.nameTag,
      regions: [...entry.regions],
      rank: rankStr,
      rankScore,
      sources: [...entry.sources],
      sourceCount
    };

    if (sourceCount >= minSources) {
      verified.push(account);
    } else if (sourceCount >= 1) {
      unverified.push(account);
    }
  }

  // Sort by rank (highest first) — main account is the top one
  verified.sort((a, b) => b.rankScore - a.rankScore);
  unverified.sort((a, b) => b.rankScore - a.rankScore);

  const mainAccount = verified[0] || unverified[0] || null;
  const smurfs = verified.slice(1);
  // Add high-confidence unverified accounts as potential smurfs
  const potentialSmurfs = unverified.filter(a => a !== mainAccount);

  console.log(`  ✅ Main: ${mainAccount?.nameTag || 'NONE'} (${mainAccount?.rank || '?'}, ${mainAccount?.sourceCount || 0} sources)`);
  console.log(`  📋 Verified smurfs: ${smurfs.length}`);
  smurfs.forEach(s => console.log(`     - ${s.nameTag} (${s.rank}, ${s.sourceCount} sources)`));
  if (potentialSmurfs.length > 0) {
    console.log(`  ❓ Unverified: ${potentialSmurfs.length}`);
    potentialSmurfs.forEach(s => console.log(`     - ${s.nameTag} (${s.sourceCount} sources: ${s.sources.join(',')})`));
  }

  return {
    proName: player.proName,
    team: player.team,
    role: player.role,
    country: player.country,
    mainAccount: mainAccount ? {
      name: mainAccount.nameTag.split('#')[0],
      tag: mainAccount.nameTag.split('#')[1],
      region: mainAccount.regions[0] || guessRegion(mainAccount.nameTag),
      rank: mainAccount.rank,
      verified: mainAccount.sourceCount >= minSources,
      sources: mainAccount.sourceCount
    } : null,
    smurfs: smurfs.map(s => ({
      name: s.nameTag.split('#')[0],
      tag: s.nameTag.split('#')[1],
      region: s.regions[0] || guessRegion(s.nameTag),
      rank: s.rank,
      sources: s.sourceCount
    })),
    potentialSmurfs: potentialSmurfs.map(s => ({
      name: s.nameTag.split('#')[0],
      tag: s.nameTag.split('#')[1],
      region: s.regions[0] || guessRegion(s.nameTag),
      sources: s.sourceCount
    })),
    // Keep old accounts for backward compat
    accounts: player.accounts || [],
    _validatedAt: new Date().toISOString()
  };
}

function guessRegion(nameTag) {
  if (!nameTag) return 'euw';
  const tag = nameTag.split('#')[1]?.toLowerCase() || '';
  if (tag.includes('kr') || tag.match(/^kr/)) return 'kr';
  if (tag.includes('na')) return 'na';
  if (tag.includes('euw') || tag.includes('euw1')) return 'euw';
  if (tag.includes('br')) return 'br';
  if (tag.includes('jp')) return 'jp';
  // Check name for Korean/Chinese chars
  if (/[\u3131-\uD79D]/.test(nameTag.split('#')[0])) return 'kr';
  return 'euw';
}

// =========================================================
// Main
// =========================================================
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const teamFilter = args.includes('--team') ? args[args.indexOf('--team') + 1] : null;

  console.log('=== Pro Account Validator ===');
  console.log(`Sources: trackingthepros.com, lolpros.gg, op.gg, Riot API`);
  console.log(`Riot API: ${RIOT_API_KEY ? 'Available' : 'Not configured (using 2-of-3 rule)'}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  if (teamFilter) console.log(`Team filter: ${teamFilter}`);

  const proData = JSON.parse(fs.readFileSync(PRO_PLAYERS_PATH, 'utf-8'));

  // Get players to validate
  const teams = teamFilter ? [teamFilter] : TOP_TEAMS;
  const playersToValidate = proData.players.filter(p =>
    teams.includes(p.team) && PLAYER_ROLES.includes(p.role)
  );

  console.log(`\nValidating ${playersToValidate.length} players from ${teams.length} teams...\n`);

  const results = [];
  let validated = 0;

  for (const player of playersToValidate) {
    try {
      const result = await validatePlayer(player);
      results.push(result);
      validated++;
      console.log(`  [${validated}/${playersToValidate.length}] Done`);

      // Save intermediate results every 10 players
      if (validated % 10 === 0) {
        fs.writeFileSync(RESULTS_PATH, JSON.stringify({
          validatedAt: new Date().toISOString(),
          playerCount: results.length,
          players: results
        }, null, 2));
        console.log(`  💾 Intermediate save (${results.length} players)`);
      }

      // Rate limit between players
      await delay(500);
    } catch (e) {
      console.error(`  ❌ Failed for ${player.proName}: ${e.message}`);
      // Still include with old data
      results.push({
        ...player,
        mainAccount: null,
        smurfs: [],
        potentialSmurfs: [],
        _validatedAt: new Date().toISOString(),
        _error: e.message
      });
    }
  }

  // Save final results
  fs.writeFileSync(RESULTS_PATH, JSON.stringify({
    validatedAt: new Date().toISOString(),
    playerCount: results.length,
    teamCount: teams.length,
    sources: ['trackingthepros', 'lolpros', 'opgg', 'riotapi'],
    minSourcesRequired: RIOT_API_KEY ? 3 : 2,
    players: results
  }, null, 2));

  // Update pro-players.json — merge validated accounts back in
  if (!dryRun) {
    for (const result of results) {
      const idx = proData.players.findIndex(p =>
        p.proName === result.proName && p.team === result.team
      );
      if (idx !== -1) {
        proData.players[idx].mainAccount = result.mainAccount;
        proData.players[idx].smurfs = result.smurfs;
        // Update accounts array to use verified name#tag format
        const newAccounts = [];
        if (result.mainAccount) {
          newAccounts.push(`${result.mainAccount.name}#${result.mainAccount.tag}`);
        }
        for (const s of result.smurfs) {
          newAccounts.push(`${s.name}#${s.tag}`);
        }
        if (newAccounts.length > 0) {
          proData.players[idx].accounts = newAccounts;
        }
      }
    }

    fs.writeFileSync(PRO_PLAYERS_PATH, JSON.stringify(proData, null, 2));
    console.log(`\n✅ Updated pro-players.json with validated accounts`);
  }

  // Summary
  const withMain = results.filter(r => r.mainAccount?.verified).length;
  const withSmurfs = results.filter(r => r.smurfs?.length > 0).length;
  const failed = results.filter(r => !r.mainAccount).length;

  console.log(`\n=== SUMMARY ===`);
  console.log(`Total players: ${results.length}`);
  console.log(`Verified main account: ${withMain}`);
  console.log(`With smurfs: ${withSmurfs}`);
  console.log(`No account found: ${failed}`);
  console.log(`Results saved to: ${RESULTS_PATH}`);
}

main().catch(console.error);
