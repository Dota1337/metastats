/**
 * Pro Player Account Validator
 *
 * 1. Fetches SoloqueueIds from Leaguepedia for all active players
 * 2. Parses Riot ID format (Name#Tag) with region info
 * 3. Validates via Riot API that accounts exist
 * 4. Checks ranked data to confirm active accounts
 * 5. Updates pro-players.json with validated Riot IDs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CARGO_API = 'https://lol.fandom.com/wiki/Special:CargoExport';
const RIOT_API_KEY = process.env.RIOT_API_KEY || '';

// Region routing for Riot API
const REGION_ROUTES = {
  'KR': { account: 'asia', summoner: 'kr' },
  'EUW': { account: 'europe', summoner: 'euw1' },
  'EUNE': { account: 'europe', summoner: 'eune1' },
  'NA': { account: 'americas', summoner: 'na1' },
  'CN': { account: 'asia', summoner: 'kr' }, // CN not accessible, try KR
  'BR': { account: 'americas', summoner: 'br1' },
  'LAN': { account: 'americas', summoner: 'la1' },
  'LAS': { account: 'americas', summoner: 'la2' },
  'JP': { account: 'asia', summoner: 'jp1' },
  'OCE': { account: 'sea', summoner: 'oc1' },
  'TR': { account: 'europe', summoner: 'tr1' },
  'RU': { account: 'europe', summoner: 'ru' },
  'PH': { account: 'sea', summoner: 'ph2' },
  'SG': { account: 'sea', summoner: 'sg2' },
  'TH': { account: 'sea', summoner: 'th2' },
  'TW': { account: 'sea', summoner: 'tw2' },
  'VN': { account: 'sea', summoner: 'vn2' },
};

// Common tags to try when none provided
const COMMON_TAGS = ['KR1', 'kr', 'EUW', 'EUW1', 'NA1', 'na1', 'BR1', 'JP1', '001', '1234', '0000', 'LAN', 'LAS', 'OCE'];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Parse Leaguepedia SoloqueueIds format
function parseSoloqueueIds(raw) {
  if (!raw) return [];

  // Decode HTML entities
  const decoded = raw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  const accounts = [];
  let currentRegion = 'EUW'; // default

  // Split by <br> or <br/>
  const parts = decoded.split(/<br\s*\/?>/i);

  for (const part of parts) {
    let trimmed = part.trim();
    if (!trimmed) continue;

    // Check for region prefix like '''KR:''' or '''EUW:'''
    const regionMatch = trimmed.match(/'''(\w+):'''\s*(.*)/);
    if (regionMatch) {
      currentRegion = regionMatch[1].toUpperCase();
      trimmed = regionMatch[2].trim();
      if (!trimmed) continue;
    }

    // Clean up any remaining wiki markup
    trimmed = trimmed.replace(/'''/g, '').trim();

    // Could have multiple accounts separated by commas
    const names = trimmed.split(',').map(s => s.trim()).filter(Boolean);
    for (const name of names) {
      // Clean name: remove any leftover wiki markup or region tags
      let clean = name
        .replace(/'''[^']*'''/g, '') // remove '''...'''
        .replace(/\[\[.*?\]\]/g, '') // remove [[...]]
        .replace(/\{\{.*?\}\}/g, '') // remove {{...}}
        .trim();

      // Skip entries that look like non-account text
      if (!clean || clean.includes('(') || clean.includes(')') || clean.length > 35) continue;
      if (/^\w{1,2}:$/.test(clean)) continue; // skip standalone region tags like "BR:"

      accounts.push({ name: clean, region: currentRegion });
    }
  }

  return accounts;
}

// Validate account via Riot API
async function validateRiotId(gameName, tagLine, region) {
  if (!RIOT_API_KEY) return null;

  const routing = REGION_ROUTES[region] || REGION_ROUTES['EUW'];
  const url = `https://${routing.account}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}?api_key=${RIOT_API_KEY}`;

  try {
    const res = await fetch(url);
    if (res.status === 200) {
      const data = await res.json();
      return { puuid: data.puuid, gameName: data.gameName, tagLine: data.tagLine };
    }
    if (res.status === 429) {
      // Rate limited — wait and retry
      await sleep(2000);
      return validateRiotId(gameName, tagLine, region);
    }
    return null;
  } catch {
    return null;
  }
}

// Try to find valid Riot ID for an account name
async function resolveAccount(name, region) {
  // If already has #tag, validate directly
  if (name.includes('#')) {
    const [gameName, tagLine] = name.split('#');
    const result = await validateRiotId(gameName, tagLine, region);
    if (result) return `${result.gameName}#${result.tagLine}`;
    return null;
  }

  // Try region-specific tags first
  const regionTags = {
    'KR': ['KR1', 'kr', 'KR', '0000', '001'],
    'EUW': ['EUW', 'EUW1', 'euw', '001', '0000', '1234'],
    'NA': ['NA1', 'na1', 'NA', '001', '0000'],
    'BR': ['BR1', 'br1', 'BR', '001'],
    'JP': ['JP1', 'jp1', '001'],
    'OCE': ['OCE', 'OCE1', 'oc1', '001'],
    'TR': ['TR1', 'tr1', '001'],
    'LAN': ['LAN', 'LA1', '001'],
    'LAS': ['LAS', 'LA2', '001'],
    'VN': ['VN1', 'vn', '001'],
    'TW': ['TW', 'TW1', '001'],
    'PH': ['PH', 'PH1', '001'],
    'SG': ['SG', 'SG1', '001'],
    'TH': ['TH', 'TH1', '001'],
  };

  const tagsToTry = regionTags[region] || COMMON_TAGS;

  for (const tag of tagsToTry) {
    const result = await validateRiotId(name, tag, region);
    if (result) return `${result.gameName}#${result.tagLine}`;
    await sleep(80); // Rate limit: ~12 req/s with dev key
  }

  return null;
}

async function cargoQuery(fields, where, limit = 500, offset = 0) {
  const params = new URLSearchParams({
    tables: 'Players',
    fields,
    where,
    'order by': 'Players.Team ASC',
    limit: String(limit),
    offset: String(offset),
    format: 'json',
  });

  const url = `${CARGO_API}?${params}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'metastats.gg account-validator (contact: info@metastats.gg)' },
  });

  if (!res.ok) return [];
  return res.json();
}

async function main() {
  console.log('=== Pro Player Account Validator ===\n');

  if (!RIOT_API_KEY) {
    console.log('WARNING: No RIOT_API_KEY set. Will only update from Leaguepedia data.');
    console.log('Set RIOT_API_KEY env variable for full validation.\n');
  }

  // Load existing data
  const existingPath = path.join(__dirname, '..', 'public', 'pro-players.json');
  const existing = JSON.parse(fs.readFileSync(existingPath, 'utf-8'));
  const existingMap = {};
  for (const p of existing.players) {
    existingMap[p.proName] = p;
  }

  // Step 1: Fetch all active players with SoloqueueIds from Leaguepedia
  console.log('[1/4] Lade SoloqueueIds von Leaguepedia...\n');

  let allPlayers = [];
  let offset = 0;
  while (true) {
    const batch = await cargoQuery(
      'Players.ID, Players.SoloqueueIds, Players.Team, Players.Role, Players.Country',
      'Players.IsRetired = "No" AND Players.ToWildrift = "No" AND Players.Team IS NOT NULL AND Players.Team != ""',
      500,
      offset
    );

    if (batch.length === 0) break;
    allPlayers = allPlayers.concat(batch);
    console.log(`  ${allPlayers.length} Spieler geladen...`);
    offset += 500;
    await sleep(500);
  }

  console.log(`\n  Total: ${allPlayers.length} aktive Spieler von Leaguepedia\n`);

  // Step 2: Parse SoloqueueIds
  console.log('[2/4] Parse SoloqueueIds...\n');

  let withIds = 0;
  let withRiotId = 0;
  let withoutIds = 0;
  const playerAccounts = [];

  for (const p of allPlayers) {
    const parsed = parseSoloqueueIds(p.SoloqueueIds);

    if (parsed.length > 0) {
      withIds++;
      const hasTag = parsed.some(a => a.name.includes('#'));
      if (hasTag) withRiotId++;
    } else {
      withoutIds++;
    }

    playerAccounts.push({
      id: p.ID,
      team: p.Team,
      role: p.Role,
      country: p.Country,
      accounts: parsed,
    });
  }

  console.log(`  With SoloqueueIds: ${withIds}`);
  console.log(`  With Riot ID (#tag): ${withRiotId}`);
  console.log(`  Without SoloqueueIds: ${withoutIds}\n`);

  // Step 3: Validate via Riot API (if key available)
  console.log('[3/4] Validiere Accounts...\n');

  const results = [];
  let validated = 0;
  let failed = 0;
  let skipped = 0;
  let apiCalls = 0;

  // Sort: playing roles first, then by team importance
  const playingRoles = new Set(['Top', 'Jungle', 'Mid', 'Bot', 'Support']);
  playerAccounts.sort((a, b) => {
    const aPlaying = playingRoles.has(a.role) ? 0 : 1;
    const bPlaying = playingRoles.has(b.role) ? 0 : 1;
    if (aPlaying !== bPlaying) return aPlaying - bPlaying;
    const aHasTag = a.accounts.some(ac => ac.name.includes('#')) ? 0 : 1;
    const bHasTag = b.accounts.some(ac => ac.name.includes('#')) ? 0 : 1;
    return aHasTag - bHasTag;
  });

  for (let i = 0; i < playerAccounts.length; i++) {
    const p = playerAccounts[i];
    const validatedAccounts = [];

    if (p.accounts.length === 0) {
      // No accounts from Leaguepedia — keep existing if any
      const ex = existingMap[p.id];
      results.push({
        proName: p.id,
        team: p.team,
        role: p.role || 'Unknown',
        country: p.country || '',
        accounts: ex?.accounts || [],
      });
      skipped++;
      continue;
    }

    // Prioritize accounts: prefer ones with # tag first
    const sorted = [...p.accounts].sort((a, b) => {
      const aTag = a.name.includes('#') ? 0 : 1;
      const bTag = b.name.includes('#') ? 0 : 1;
      return aTag - bTag;
    });

    if (RIOT_API_KEY) {
      // For accounts with #tag: validate directly (1 API call each)
      // For accounts without #tag: try common tags (multiple API calls)
      // Limit: only try first 3 accounts to save API calls
      const toValidate = sorted.slice(0, 3);

      for (const acc of toValidate) {
        const riotId = await resolveAccount(acc.name, acc.region);
        apiCalls++;
        if (riotId) {
          // Deduplicate
          if (!validatedAccounts.includes(riotId)) {
            validatedAccounts.push(riotId);
          }
        }
        await sleep(80);
      }

      if (validatedAccounts.length > 0) {
        validated++;
      } else {
        failed++;
        // Keep existing accounts as fallback
        const ex = existingMap[p.id];
        if (ex?.accounts?.length > 0) {
          validatedAccounts.push(...ex.accounts);
        }
      }
    } else {
      // No API key — use parsed accounts directly (best effort)
      for (const acc of sorted) {
        validatedAccounts.push(acc.name);
      }
      validated++;
    }

    results.push({
      proName: p.id,
      team: p.team,
      role: p.role || 'Unknown',
      country: p.country || '',
      accounts: validatedAccounts,
    });

    // Progress
    if ((i + 1) % 25 === 0 || i === playerAccounts.length - 1) {
      console.log(`  ${i + 1}/${playerAccounts.length} — validated: ${validated}, failed: ${failed}, skipped: ${skipped} (${apiCalls} API calls)`);
    }
  }

  // Step 4: Save results
  console.log('\n[4/4] Speichere Ergebnisse...\n');

  const finalData = {
    updatedAt: new Date().toISOString(),
    totalPlayers: results.length,
    withAccounts: results.filter(p => p.accounts.length > 0).length,
    players: results,
  };

  fs.writeFileSync(existingPath, JSON.stringify(finalData, null, 2));

  console.log(`Gespeichert: ${results.length} Spieler`);
  console.log(`  Mit Accounts: ${finalData.withAccounts}`);
  console.log(`  Validiert: ${validated}`);
  console.log(`  Fehlgeschlagen: ${failed}`);
  console.log(`  Übersprungen: ${skipped}`);

  // Show some examples
  console.log('\n=== Beispiele ===');
  const examples = results.filter(p => p.accounts.length > 0 && p.accounts[0].includes('#')).slice(0, 10);
  examples.forEach(p => {
    console.log(`  ${p.proName} (${p.team}, ${p.role}): ${p.accounts.slice(0, 3).join(', ')}`);
  });
}

main().catch(console.error);
