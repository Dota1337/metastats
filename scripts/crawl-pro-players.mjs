/**
 * Crawls pro player data from Leaguepedia (lol.fandom.com) Cargo tables.
 * Extracts: Player name, Team, League, Role, and known Solo Queue accounts.
 * Saves validated results to public/pro-players.json
 */

const CARGO_API = 'https://lol.fandom.com/wiki/Special:CargoExport';

// All major leagues
const LEAGUES = [
  // Tier 1
  'LEC', 'LCK', 'LCS', 'LPL',
  // Tier 2 / Regional
  'CBLOL', 'LJL', 'PCS', 'VCS', 'LLA', 'LCO', 'TCL', 'LCL',
  // ERL (European Regional Leagues)
  'LFL', 'Prime League', 'Superliga', 'PG Nationals', 'NLC',
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function cargoQuery(tables, fields, where, orderBy, limit = 500) {
  const params = new URLSearchParams({
    tables,
    fields,
    where,
    'order by': orderBy || '',
    limit: String(limit),
    format: 'json',
  });

  const url = `${CARGO_API}?${params}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'metastats.gg pro-player crawler (contact: info@metastats.gg)' },
  });

  if (!res.ok) {
    console.log(`  Cargo query failed: ${res.status}`);
    return [];
  }

  return res.json();
}

async function fetchActivePlayers() {
  console.log('[1/3] Lade aktive Pro-Spieler von Leaguepedia...\n');

  const allPlayers = [];

  // Query active tournament rosters - current year
  // Using Tournaments and TournamentRosters tables
  try {
    const players = await cargoQuery(
      'Players=P',
      'P.ID, P.Player, P.Team, P.Role, P.Country, P.Residency, P.IsRetired, P.ToWildrift',
      'P.IsRetired = "No" AND P.ToWildrift = "No" AND P.Team IS NOT NULL AND P.Team != ""',
      'P.Team ASC, P.Role ASC',
      2000
    );

    if (players.length > 0) {
      console.log(`  ${players.length} aktive Spieler gefunden`);
      for (const p of players) {
        allPlayers.push({
          id: p.ID || '',
          name: p.Player || p.ID || '',
          team: p.Team || '',
          role: p.Role || '',
          country: p.Country || '',
          residency: p.Residency || '',
        });
      }
    }
  } catch (e) {
    console.log('  Fehler bei Players Query:', e.message);
  }

  return allPlayers;
}

async function fetchSoloQueueAccounts(playerIds) {
  console.log('\n[2/3] Lade Solo-Queue Accounts...\n');

  const accountMap = {};

  // Query in batches of 50 IDs
  for (let i = 0; i < playerIds.length; i += 50) {
    const batch = playerIds.slice(i, i + 50);
    const idList = batch.map(id => `"${String(id).replace(/"/g, '\\"')}"`).join(',');

    try {
      const accounts = await cargoQuery(
        'PlayerRedirects=PR',
        'PR.AllName, PR.OverviewPage',
        `PR.OverviewPage IN (${idList})`,
        '',
        500
      );

      for (const acc of accounts) {
        const playerId = acc.OverviewPage || '';
        const accName = acc.AllName || '';
        if (playerId && accName && accName.includes(' ')) continue; // skip non-account entries
        if (!accountMap[playerId]) accountMap[playerId] = [];
        accountMap[playerId].push(accName);
      }
    } catch (e) {
      // silent
    }

    if ((i + 50) % 200 === 0) {
      console.log(`  ${Math.min(i + 50, playerIds.length)}/${playerIds.length} Spieler abgefragt`);
      await sleep(1000); // Be polite to the wiki
    }
  }

  return accountMap;
}

async function fetchFromAlternativeSource() {
  console.log('\n[2b/3] Versuche alternative Quellen...\n');

  const proAccounts = [];

  // Try a well-known community-maintained list
  const sources = [
    'https://raw.githubusercontent.com/meraki-analytics/lol-pro-players/main/data/players.json',
  ];

  for (const url of sources) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'metastats.gg' } });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          console.log(`  ${data.length} Spieler von ${new URL(url).hostname}`);
          for (const p of data) {
            if (p.riotId || p.summonerName) {
              proAccounts.push({
                name: p.name || p.player || '',
                team: p.team || '',
                league: p.league || '',
                role: p.role || '',
                riotId: p.riotId || p.summonerName || '',
                region: p.region || '',
              });
            }
          }
        }
      }
    } catch {}
  }

  return proAccounts;
}

async function main() {
  console.log('=== Pro-Spieler Crawler: Alle Regionen ===\n');

  // Step 1: Fetch active pro players from Leaguepedia
  const players = await fetchActivePlayers();

  // Step 2: Try to get solo queue accounts
  let accountMap = {};
  if (players.length > 0) {
    const ids = players.map(p => p.id).filter(Boolean);
    accountMap = await fetchSoloQueueAccounts(ids);
    console.log(`  ${Object.keys(accountMap).length} Spieler mit Account-Daten`);
  }

  // Step 2b: Also check alternative sources
  const altAccounts = await fetchFromAlternativeSource();

  // Step 3: Build final pro player database
  console.log('\n[3/3] Erstelle Pro-Spieler Datenbank...\n');

  // Map from Leaguepedia data
  const proDatabase = [];
  const seenNames = new Set();

  for (const p of players) {
    const accounts = accountMap[p.id] || [];
    const entry = {
      proName: p.name,
      team: p.team,
      role: mapRole(p.role),
      country: p.country,
      accounts: accounts.filter(a => a && !a.includes(' ')),
    };

    // Only include if they have known accounts or are from a major team
    if (entry.accounts.length > 0 || isMajorTeam(entry.team)) {
      proDatabase.push(entry);
      seenNames.add(p.name.toLowerCase());
    }
  }

  // Add from alternative sources
  for (const p of altAccounts) {
    if (!seenNames.has(p.name.toLowerCase())) {
      proDatabase.push({
        proName: p.name,
        team: p.team,
        role: mapRole(p.role),
        league: p.league,
        accounts: p.riotId ? [p.riotId] : [],
        region: p.region,
      });
      seenNames.add(p.name.toLowerCase());
    }
  }

  // If we got no data from APIs, use a hardcoded seed of known pros
  if (proDatabase.length < 50) {
    console.log('  Wenig Daten von APIs - fuege bekannte Pros hinzu...');
    addKnownPros(proDatabase, seenNames);
  }

  console.log(`  ${proDatabase.length} Pro-Spieler in Datenbank`);
  console.log(`  ${proDatabase.filter(p => p.accounts.length > 0).length} mit Solo-Queue Accounts`);

  // Save
  const output = {
    updatedAt: new Date().toISOString(),
    totalPlayers: proDatabase.length,
    withAccounts: proDatabase.filter(p => p.accounts.length > 0).length,
    players: proDatabase,
  };

  const fs = await import('fs');
  fs.writeFileSync('public/pro-players.json', JSON.stringify(output, null, 2));
  console.log('\n  -> public/pro-players.json gespeichert');

  // Stats by team
  const teams = {};
  for (const p of proDatabase) {
    teams[p.team] = (teams[p.team] || 0) + 1;
  }
  console.log(`\n  Teams: ${Object.keys(teams).length}`);
  const topTeams = Object.entries(teams).sort((a, b) => b[1] - a[1]).slice(0, 15);
  for (const [team, count] of topTeams) {
    console.log(`    ${team}: ${count} Spieler`);
  }

  console.log('\nFertig!');
}

function mapRole(role) {
  const r = (role || '').toLowerCase();
  if (r.includes('top')) return 'Top';
  if (r.includes('jung')) return 'Jungle';
  if (r.includes('mid')) return 'Mid';
  if (r.includes('bot') || r.includes('adc')) return 'ADC';
  if (r.includes('sup')) return 'Support';
  return role || '';
}

function isMajorTeam(team) {
  const major = [
    'G2 Esports', 'Fnatic', 'T1', 'Gen.Gen', 'Cloud9', 'Team Liquid',
    'MAD Lions', 'Rogue', 'Excel Esports', 'SK Gaming', 'BDS',
    'DRX', 'Dplus KIA', 'KT Rolster', 'Hanwha Life Esports', 'Nongshim RedForce',
    'FlyQuest', '100 Thieves', 'NRG', 'Dignitas',
    'JD Gaming', 'Bilibili Gaming', 'Top Esports', 'Weibo Gaming', 'LNG Esports',
    'Karmine Corp', 'Vitality', 'Astralis', 'Team Heretics',
  ];
  return major.some(m => team?.toLowerCase().includes(m.toLowerCase()));
}

function addKnownPros(db, seen) {
  // Seed data: known pro accounts (LEC + LCK mainly)
  const knownPros = [
    // LEC 2025
    { proName: 'Caps', team: 'G2 Esports', role: 'Mid', accounts: ['Caps#EUW'], league: 'LEC' },
    { proName: 'Yike', team: 'G2 Esports', role: 'Jungle', accounts: ['G2 Yike#EUW'], league: 'LEC' },
    { proName: 'BrokenBlade', team: 'G2 Esports', role: 'Top', accounts: ['G2 BrokenBlade#EUW'], league: 'LEC' },
    { proName: 'Hans Sama', team: 'G2 Esports', role: 'ADC', accounts: ['G2 Hans Sama#EUW'], league: 'LEC' },
    { proName: 'Mikyx', team: 'G2 Esports', role: 'Support', accounts: ['G2 Mikyx#EUW'], league: 'LEC' },
    { proName: 'Humanoid', team: 'Fnatic', role: 'Mid', accounts: ['FNC Humanoid#EUW'], league: 'LEC' },
    { proName: 'Razork', team: 'Fnatic', role: 'Jungle', accounts: ['FNC Razork#EUW'], league: 'LEC' },
    { proName: 'Oscarinin', team: 'Fnatic', role: 'Top', accounts: ['FNC Oscarinin#EUW'], league: 'LEC' },
    { proName: 'Noah', team: 'Fnatic', role: 'ADC', accounts: ['FNC Noah#EUW'], league: 'LEC' },
    { proName: 'Jun', team: 'Fnatic', role: 'Support', accounts: ['FNC Jun#EUW'], league: 'LEC' },
    { proName: 'Vetheo', team: 'MAD Lions KOI', role: 'Mid', accounts: ['MAD Vetheo#EUW'], league: 'LEC' },
    { proName: 'Elyoya', team: 'MAD Lions KOI', role: 'Jungle', accounts: ['MAD Elyoya#EUW'], league: 'LEC' },
    { proName: 'Larssen', team: 'Rogue', role: 'Mid', accounts: ['RGE Larssen#EUW'], league: 'LEC' },
    { proName: 'Comp', team: 'Rogue', role: 'ADC', accounts: ['RGE Comp#EUW'], league: 'LEC' },
    { proName: 'Trymbi', team: 'Rogue', role: 'Support', accounts: ['RGE Trymbi#EUW'], league: 'LEC' },
    { proName: 'Irrelevant', team: 'Excel Esports', role: 'Mid', accounts: ['XL Irrelevant#EUW'], league: 'LEC' },
    { proName: 'Patrik', team: 'Excel Esports', role: 'ADC', accounts: ['XL Patrik#EUW'], league: 'LEC' },
    { proName: 'Labrov', team: 'Team Heretics', role: 'Support', accounts: ['TH Labrov#EUW'], league: 'LEC' },
    { proName: 'Jackies', team: 'Team Heretics', role: 'Mid', accounts: ['TH Jackies#EUW'], league: 'LEC' },
    { proName: 'Carzzy', team: 'SK Gaming', role: 'ADC', accounts: ['SK Carzzy#EUW'], league: 'LEC' },
    { proName: 'nuc', team: 'BDS', role: 'Mid', accounts: ['BDS nuc#EUW'], league: 'LEC' },
    { proName: 'Crownie', team: 'BDS', role: 'ADC', accounts: ['BDS Crownie#EUW'], league: 'LEC' },
    { proName: 'Adam', team: 'BDS', role: 'Top', accounts: ['BDS Adam#EUW'], league: 'LEC' },
    { proName: 'Caliste', team: 'Vitality', role: 'ADC', accounts: ['VIT Caliste#EUW'], league: 'LEC' },
    { proName: 'Photon', team: 'Vitality', role: 'Mid', accounts: ['VIT Photon#EUW'], league: 'LEC' },
    // LCK 2025
    { proName: 'Faker', team: 'T1', role: 'Mid', accounts: ['Hide on bush#KR1'], league: 'LCK' },
    { proName: 'Zeus', team: 'T1', role: 'Top', accounts: ['T1 Zeus#KR1'], league: 'LCK' },
    { proName: 'Oner', team: 'T1', role: 'Jungle', accounts: ['T1 Oner#KR1'], league: 'LCK' },
    { proName: 'Gumayusi', team: 'T1', role: 'ADC', accounts: ['T1 Gumayusi#KR1'], league: 'LCK' },
    { proName: 'Keria', team: 'T1', role: 'Support', accounts: ['T1 Keria#KR1'], league: 'LCK' },
    { proName: 'Chovy', team: 'Gen.G', role: 'Mid', accounts: ['Gen Chovy#KR1'], league: 'LCK' },
    { proName: 'Peyz', team: 'Gen.G', role: 'ADC', accounts: ['Gen Peyz#KR1'], league: 'LCK' },
    { proName: 'Canyon', team: 'Gen.G', role: 'Jungle', accounts: ['Gen Canyon#KR1'], league: 'LCK' },
    { proName: 'Kiin', team: 'Gen.G', role: 'Top', accounts: ['Gen Kiin#KR1'], league: 'LCK' },
    { proName: 'Lehends', team: 'Gen.G', role: 'Support', accounts: ['Gen Lehends#KR1'], league: 'LCK' },
    { proName: 'ShowMaker', team: 'Dplus KIA', role: 'Mid', accounts: ['DK ShowMaker#KR1'], league: 'LCK' },
    { proName: 'Aiming', team: 'Dplus KIA', role: 'ADC', accounts: ['DK Aiming#KR1'], league: 'LCK' },
    { proName: 'Deft', team: 'DRX', role: 'ADC', accounts: ['DRX Deft#KR1'], league: 'LCK' },
    { proName: 'BeryL', team: 'DRX', role: 'Support', accounts: ['DRX BeryL#KR1'], league: 'LCK' },
    { proName: 'Peanut', team: 'Hanwha Life Esports', role: 'Jungle', accounts: ['HLE Peanut#KR1'], league: 'LCK' },
    { proName: 'Zeka', team: 'Hanwha Life Esports', role: 'Mid', accounts: ['HLE Zeka#KR1'], league: 'LCK' },
    { proName: 'Viper', team: 'Hanwha Life Esports', role: 'ADC', accounts: ['HLE Viper#KR1'], league: 'LCK' },
    // LCS 2025
    { proName: 'Jojopyun', team: 'FlyQuest', role: 'Mid', accounts: ['FLY Jojopyun#NA1'], league: 'LCS' },
    { proName: 'Inspired', team: 'FlyQuest', role: 'Jungle', accounts: ['FLY Inspired#NA1'], league: 'LCS' },
    { proName: 'Bwipo', team: 'FlyQuest', role: 'Top', accounts: ['FLY Bwipo#NA1'], league: 'LCS' },
    { proName: 'Massu', team: 'FlyQuest', role: 'ADC', accounts: ['FLY Massu#NA1'], league: 'LCS' },
    { proName: 'CoreJJ', team: 'Team Liquid', role: 'Support', accounts: ['TL CoreJJ#NA1'], league: 'LCS' },
    { proName: 'APA', team: 'Team Liquid', role: 'Mid', accounts: ['TL APA#NA1'], league: 'LCS' },
    { proName: 'Blaber', team: 'Cloud9', role: 'Jungle', accounts: ['C9 Blaber#NA1'], league: 'LCS' },
    { proName: 'Berserker', team: 'Cloud9', role: 'ADC', accounts: ['C9 Berserker#NA1'], league: 'LCS' },
    { proName: 'Fudge', team: 'Cloud9', role: 'Top', accounts: ['C9 Fudge#NA1'], league: 'LCS' },
    { proName: 'Doublelift', team: '100 Thieves', role: 'ADC', accounts: ['100T Doublelift#NA1'], league: 'LCS' },
  ];

  for (const p of knownPros) {
    if (!seen.has(p.proName.toLowerCase())) {
      db.push(p);
      seen.add(p.proName.toLowerCase());
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
