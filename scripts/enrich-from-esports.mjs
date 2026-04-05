/**
 * Enriches pro-players.json with data from LoL Esports API
 * Cross-references team rosters and resolves Riot IDs via Riot API
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ESPORTS_KEY = '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z';
const RIOT_KEY = process.env.RIOT_API_KEY || '';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const REGION_ROUTES = {
  'KOREA': { route: 'asia', tags: ['KR1', 'kr', 'KR', '0000', '001'] },
  'CHINA': { route: 'asia', tags: ['KR1', 'kr', '001', '0000'] },
  'EMEA': { route: 'europe', tags: ['EUW', 'EUW1', 'euw', '001', '0000', '1234'] },
  'NORTH AMERICA': { route: 'americas', tags: ['NA1', 'na1', 'NA', '001', '0000'] },
  'AMERICAS': { route: 'americas', tags: ['NA1', 'LAN', 'LAS', 'BR1', '001'] },
  'BRAZIL': { route: 'americas', tags: ['BR1', 'br1', 'BR', '001'] },
  'JAPAN': { route: 'asia', tags: ['JP1', 'jp1', '001'] },
  'PACIFIC': { route: 'sea', tags: ['TW', 'TW1', 'PH', 'SG', '001'] },
  'VIETNAM': { route: 'sea', tags: ['VN', 'VN1', '001'] },
  'OCEANIA': { route: 'sea', tags: ['OCE', 'OCE1', '001'] },
  'HONG KONG, MACAU, TAIWAN': { route: 'sea', tags: ['TW', 'TW1', '001'] },
  'LATIN AMERICA NORTH': { route: 'americas', tags: ['LAN', 'LA1', '001'] },
  'LATIN AMERICA SOUTH': { route: 'americas', tags: ['LAS', 'LA2', '001'] },
};

async function esportsFetch(url) {
  const res = await fetch(url, { headers: { 'x-api-key': ESPORTS_KEY } });
  if (!res.ok) return null;
  return res.json();
}

async function main() {
  if (!RIOT_KEY) {
    console.log('ERROR: Set RIOT_API_KEY env variable');
    process.exit(1);
  }

  console.log('=== Esports API Enrichment ===\n');

  // 1. Get all leagues and find active team IDs
  console.log('[1/3] Lade aktive Team-Rosters...');

  const leagueData = await esportsFetch('https://esports-api.lolesports.com/persisted/gw/getLeagues?hl=en-US');
  const leagues = leagueData?.data?.leagues || [];

  const majorSlugs = [
    'lec', 'lck', 'lpl', 'lcs', 'cblol-brazil', 'ljl-japan', 'pcs', 'vcs',
    'lta_n', 'lta_s', 'primeleague', 'nacl', 'emea_masters', 'lfl', 'nlc',
    'lco', 'turkiye-sampiyonluk-ligi', 'lla', 'lck_challengers_league',
    'lit', 'roadoflegends', 'lcp', 'cd',
  ];
  const majorLeagues = leagues.filter(l => majorSlugs.includes(l.slug));

  const allTeamIds = new Set();
  for (const league of majorLeagues) {
    const td = await esportsFetch(
      `https://esports-api.lolesports.com/persisted/gw/getTournamentsForLeague?hl=en-US&leagueId=${league.id}`
    );
    const tournaments = td?.data?.leagues?.[0]?.tournaments || [];
    const sorted = tournaments.sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
    const now = new Date();
    const current = sorted.find(t => new Date(t.startDate) <= now && new Date(t.endDate) >= now) || sorted[0];

    if (current) {
      const sd = await esportsFetch(
        `https://esports-api.lolesports.com/persisted/gw/getStandingsV3?hl=en-US&tournamentId=${current.id}`
      );
      const standings = sd?.data?.standings || [];
      if (standings[0]?.stages) {
        for (const stage of standings[0].stages) {
          for (const section of (stage.sections || [])) {
            for (const ranking of (section.rankings || [])) {
              for (const team of (ranking.teams || [])) {
                if (team.id) allTeamIds.add(team.id);
              }
            }
          }
        }
      }
    }
    await sleep(150);
  }

  console.log(`  ${allTeamIds.size} Teams gefunden`);

  // Fetch team rosters
  const esportsPlayers = [];
  for (const id of allTeamIds) {
    try {
      const d = await esportsFetch(`https://esports-api.lolesports.com/persisted/gw/getTeams?hl=en-US&id=${id}`);
      const team = d?.data?.teams?.[0];
      if (team?.players) {
        for (const p of team.players) {
          esportsPlayers.push({
            summonerName: p.summonerName,
            firstName: p.firstName,
            lastName: p.lastName,
            role: p.role,
            team: team.name,
            teamCode: team.code,
            region: team.homeLeague?.region || '',
          });
        }
      }
    } catch {}
    await sleep(80);
  }
  console.log(`  ${esportsPlayers.length} Spieler von Esports API\n`);

  // 2. Cross-reference
  console.log('[2/3] Cross-Reference...');
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'pro-players.json'), 'utf-8'));

  const needsResolution = [];
  for (const ep of esportsPlayers) {
    const existing = data.players.find(p => {
      const name = String(p.proName || '').toLowerCase();
      const sn = ep.summonerName.toLowerCase();
      return name === sn || name.replace(/\s/g, '') === sn.replace(/\s/g, '');
    });

    if (existing && existing.accounts?.some(a => a.includes('#'))) continue;

    needsResolution.push({
      proName: existing?.proName || ep.summonerName,
      summonerName: ep.summonerName,
      team: ep.team,
      region: ep.region,
      existingIdx: existing ? data.players.indexOf(existing) : -1,
    });
  }
  console.log(`  ${needsResolution.length} Spieler brauchen Riot ID\n`);

  // 3. Resolve via Riot API
  console.log('[3/3] Validiere via Riot API...');
  let resolved = 0;

  for (let i = 0; i < needsResolution.length; i++) {
    const p = needsResolution[i];
    const routeInfo = REGION_ROUTES[p.region] || REGION_ROUTES['EMEA'];
    let found = false;

    for (const tag of routeInfo.tags) {
      try {
        const url = `https://${routeInfo.route}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(p.summonerName)}/${encodeURIComponent(tag)}?api_key=${RIOT_KEY}`;
        const r = await fetch(url);

        if (r.status === 200) {
          const d = await r.json();
          const riotId = `${d.gameName}#${d.tagLine}`;

          if (p.existingIdx >= 0) {
            const accs = data.players[p.existingIdx].accounts || [];
            if (!accs.includes(riotId)) {
              data.players[p.existingIdx].accounts = [riotId, ...accs];
            }
          } else {
            // Map role from esports format
            const roleMap = { top: 'Top', jungle: 'Jungle', mid: 'Mid', bottom: 'Bot', support: 'Support' };
            const ep = esportsPlayers.find(e => e.summonerName === p.summonerName);
            data.players.push({
              proName: p.summonerName,
              team: p.team,
              role: roleMap[ep?.role] || ep?.role || 'Unknown',
              country: '',
              accounts: [riotId],
            });
          }
          resolved++;
          found = true;
          break;
        }
        if (r.status === 429) {
          await sleep(2500);
          // Don't decrement i, just continue with next tag
        }
      } catch {}
      await sleep(80);
    }

    if ((i + 1) % 20 === 0 || i === needsResolution.length - 1) {
      console.log(`  ${i + 1}/${needsResolution.length} — resolved: ${resolved}`);
    }
  }

  // Save
  data.updatedAt = new Date().toISOString();
  data.totalPlayers = data.players.length;
  data.withAccounts = data.players.filter(p => p.accounts?.length > 0).length;
  fs.writeFileSync(path.join(__dirname, '..', 'public', 'pro-players.json'), JSON.stringify(data, null, 2));

  const withHash = data.players.filter(p => p.accounts?.some(a => a.includes('#')));
  console.log(`\nDone! Resolved ${resolved} additional Riot IDs`);
  console.log(`Total players: ${data.players.length}`);
  console.log(`Total with Riot IDs: ${withHash.length}`);

  // Check key players
  const check = ['PowerOfEvil', 'Jankos', 'Upset', 'Vladi', 'Lospa', 'APA', 'Blaber', 'Caps', 'Faker'];
  console.log('\n=== Key Players ===');
  for (const name of check) {
    const p = data.players.find(pp => String(pp.proName || '').toLowerCase() === name.toLowerCase());
    if (p) console.log(`  ${p.proName} (${p.team}): ${p.accounts?.slice(0, 2).join(', ') || 'NONE'}`);
  }
}

main().catch(console.error);
