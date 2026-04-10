/**
 * Crawls pro team data with multi-source validation.
 * Sources: Leaguepedia Players + TournamentRosters + existing pro-players.json
 */

const CARGO_API = 'https://lol.fandom.com/wiki/Special:CargoExport';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function stripHtml(s) { return (s || '').replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }

async function cargoQuery(tables, fields, where, orderBy, limit = 500, offset = 0) {
  const params = new URLSearchParams({
    tables, fields, where: where || '', 'order by': orderBy || '', limit: String(limit), offset: String(offset), format: 'json',
  });
  try {
    const res = await fetch(`${CARGO_API}?${params}`, { headers: { 'User-Agent': 'metastats.gg' } });
    if (!res.ok) return [];
    const text = await res.text();
    if (!text.startsWith('[') && !text.startsWith('{')) return [];
    return JSON.parse(text);
  } catch { return []; }
}

function categorizeRole(role) {
  const r = (role || '').toLowerCase();
  if (r === 'top') return { role: 'Top', isPlayer: true, order: 1 };
  if (r === 'jungle' || r === 'jungler') return { role: 'Jungle', isPlayer: true, order: 2 };
  if (r === 'mid' || r === 'middle') return { role: 'Mid', isPlayer: true, order: 3 };
  if (r === 'bot' || r === 'adc') return { role: 'ADC', isPlayer: true, order: 4 };
  if (r === 'support' || r === 'sup') return { role: 'Support', isPlayer: true, order: 5 };
  if (r === 'sub') return { role: 'Ersatz', isPlayer: true, order: 6 };
  if (r.includes('head coach')) return { role: 'Head Coach', isPlayer: false, order: 7 };
  if (r.includes('coach')) return { role: 'Coach', isPlayer: false, order: 8 };
  if (r === 'analyst' || r === 'strategic coach') return { role: 'Analyst', isPlayer: false, order: 9 };
  if (r === 'manager') return { role: 'Manager', isPlayer: false, order: 10 };
  if (r === 'streamer') return { role: 'Streamer', isPlayer: false, order: 11 };
  return { role: role || 'Staff', isPlayer: false, order: 12 };
}

function getTrophy(place) {
  const p = String(place || '').toLowerCase();
  if (p === '1' || p === '1st') return 'gold';
  if (p === '2' || p === '2nd') return 'silver';
  if (p.startsWith('3') || p === '3rd-4th') return 'bronze';
  return null;
}

async function main() {
  console.log('=== Pro Teams Crawler (Multi-Source Validated) ===\n');

  // Source 1: Leaguepedia Players (active, with team) — paginated to get ALL
  console.log('[1/5] Quelle 1: Leaguepedia Players (paginiert)...');
  const playersSource = [];
  let playersOffset = 0;
  const PLAYERS_PAGE = 500;
  while (true) {
    const batch = await cargoQuery(
      'Players=P', 'P.ID,P.Player,P.Team,P.Role,P.Country,P.Image,P.IsRetired',
      'P.IsRetired="No" AND P.Team IS NOT NULL AND P.Team!=""',
      'P.ID ASC', PLAYERS_PAGE, playersOffset
    );
    if (batch.length === 0) break;
    playersSource.push(...batch);
    playersOffset += PLAYERS_PAGE;
    if (batch.length < PLAYERS_PAGE) break;
    await sleep(800);
  }
  console.log(`  ${playersSource.length} Eintraege`);

  // Source 2: Leaguepedia current tournament rosters (most reliable for ACTIVE players)
  console.log('[2/5] Quelle 2: Leaguepedia TournamentRosters...');
  const rosterSource = await cargoQuery(
    'TournamentRosters=TR',
    'TR.Team,TR.RosterLinks,TR.Roles,TR.Tournament',
    '', 'TR.Tournament DESC', 500
  );
  console.log(`  ${rosterSource.length} Turnier-Roster Eintraege`);

  // Source 3: Our existing pro-players.json (has Riot account names)
  console.log('[3/5] Quelle 3: Bestehende pro-players.json...');
  let proPlayersData = { players: [] };
  try {
    const fs = await import('fs');
    const raw = fs.readFileSync('public/pro-players.json', 'utf8');
    proPlayersData = JSON.parse(raw);
  } catch {}
  console.log(`  ${proPlayersData.players.length} Spieler mit Account-Daten`);

  // Source 3b: Existing pro-teams.json — for roster preservation on empty rebuild
  const existingRosters = {}; // teamName.toLowerCase() -> { roster, logo, short }
  try {
    const fs = await import('fs');
    const raw = fs.readFileSync('public/pro-teams.json', 'utf8');
    const old = JSON.parse(raw);
    for (const t of (old.teams || [])) {
      if (t.name && (t.roster || []).length > 0) {
        existingRosters[t.name.toLowerCase()] = {
          roster: t.roster,
          logo: t.logo || null,
          short: t.short || null,
        };
      }
    }
    console.log(`  ${Object.keys(existingRosters).length} existierende Roster als Fallback geladen`);
  } catch {}

  // Build account lookup: playerName (lowercase) -> accounts[]
  const accountLookup = {};
  for (const p of proPlayersData.players) {
    const key = (p.proName || '').toLowerCase();
    if (key && p.accounts && p.accounts.length > 0) {
      accountLookup[key] = p.accounts;
    }
    // Also index by each account name
    for (const acc of p.accounts || []) {
      accountLookup[acc.toLowerCase()] = p.accounts;
    }
  }

  // Source 4: Tournament results — paginated to get ALL results
  console.log('[4/5] Quelle 4: Turnierergebnisse (vollstaendig)...');
  const resultsData = [];
  let resultsOffset = 0;
  const RESULTS_PAGE_SIZE = 500;
  while (true) {
    const batch = await cargoQuery(
      'TournamentResults=TR', 'TR.Team,TR.Event,TR.Place,TR.Date,TR.Prize,TR.PrizeUnit',
      'TR.Team IS NOT NULL AND TR.Team != ""', 'TR.Date DESC',
      RESULTS_PAGE_SIZE, resultsOffset
    );
    if (batch.length === 0) break;
    resultsData.push(...batch);
    console.log(`  ${resultsData.length} Ergebnisse geladen...`);
    resultsOffset += RESULTS_PAGE_SIZE;
    if (batch.length < RESULTS_PAGE_SIZE) break;
    await sleep(1500); // Rate limit
  }
  console.log(`  ${resultsData.length} Ergebnisse total`);

  // === CROSS-VALIDATION ===
  console.log('\n[5/5] Cross-Validierung und Team-Erstellung...\n');

  // Parse tournament rosters into per-team sets
  const tournamentRosters = {}; // team -> Set of player names
  for (const tr of rosterSource) {
    const team = tr.Team;
    if (!team) continue;
    const links = (tr.RosterLinks || '').split(';;').map(s => s.trim()).filter(Boolean);
    const roles = (tr.Roles || '').split(';;').map(s => s.trim());
    if (!tournamentRosters[team]) tournamentRosters[team] = new Map();
    links.forEach((name, i) => {
      if (name) tournamentRosters[team].set(name.toLowerCase(), roles[i] || '');
    });
  }

  // Build Players table roster: team -> members
  const playersRoster = {};
  for (const p of playersSource) {
    const team = p.Team;
    if (!team) continue;
    if (!playersRoster[team]) playersRoster[team] = [];
    const cat = categorizeRole(p.Role);
    const name = String(p.Player || p.ID || '');
    playersRoster[team].push({
      name,
      role: cat.role,
      isPlayer: cat.isPlayer,
      order: cat.order,
      country: p.Country || '',
      image: p.Image || null,
      // Check if validated by tournament roster
      inTournamentRoster: tournamentRosters[team]?.has(name.toLowerCase()) || false,
    });
  }

  // Leaguepedia uses different team name strings than we do.
  // Map our canonical name -> list of names to try in Leaguepedia's Players.Team column.
  // All candidates are checked in order; first non-empty match wins.
  //
  // IMPORTANT: Only list aliases that truly refer to the SAME team org.
  // Do NOT alias "Nongshim Esports" -> "Nongshim RedForce" (different team), or
  // "OKSavingsBank BRION" -> "HANJIN BRION" (new org, different roster).
  // For those cases, let the preserve-existing fallback handle it.
  const LEAGUEPEDIA_TEAM_NAMES = {
    'Dplus KIA': ['Dplus Kia', 'Dplus KIA'],
    'Kiwoom DRX': ['Kiwoom DRX', 'DRX'],
    'Gen.G': ['Gen.G', 'Gen.G Esports'],
  };

  // League umbrella organisations mislabeled as teams on Leaguepedia — drop them entirely
  const LEAGUE_UMBRELLAS = new Set([
    'Ilha das Lendas',
    'Abstract (Brazilian Team)',
    'Hitpoint',
    'League of Legends Championship Pacific',
    'LoL Pro League',
    'LVP',
    'PG Esports',
    'Polski Hub Esportowy',
  ]);

  // Major teams definition
  const majorTeams = [
    { name: 'T1', short: 'T1', region: 'Korea', logo: 'https://am-a.akamaihd.net/image?resize=120:&f=http%3A%2F%2Fstatic.lolesports.com%2Fteams%2F1631819614066_t1-2021-worlds.png' },
    { name: 'Gen.G', short: 'GEN', region: 'Korea', logo: 'https://am-a.akamaihd.net/image?resize=120:&f=http%3A%2F%2Fstatic.lolesports.com%2Fteams%2F1671038289866_GenG_2023.png' },
    { name: 'G2 Esports', short: 'G2', region: 'Europe', logo: 'https://am-a.akamaihd.net/image?resize=120:&f=http%3A%2F%2Fstatic.lolesports.com%2Fteams%2FG2-FullonDark.png' },
    { name: 'Fnatic', short: 'FNC', region: 'Europe', logo: 'https://am-a.akamaihd.net/image?resize=120:&f=http%3A%2F%2Fstatic.lolesports.com%2Fteams%2F1631819669150_fnc-2021-worlds.png' },
    { name: 'Cloud9', short: 'C9', region: 'North America', logo: 'https://am-a.akamaihd.net/image?resize=120:&f=http%3A%2F%2Fstatic.lolesports.com%2Fteams%2F1631820065189_c9-2021-worlds.png' },
    { name: 'Team Liquid', short: 'TL', region: 'North America' },
    { name: 'FlyQuest', short: 'FLY', region: 'North America' },
    { name: 'Dplus KIA', short: 'DK', region: 'Korea' },
    { name: 'Hanwha Life Esports', short: 'HLE', region: 'Korea' },
    { name: 'KT Rolster', short: 'KT', region: 'Korea' },
    { name: 'Kiwoom DRX', short: 'DRX', region: 'Korea' },
    { name: 'JD Gaming', short: 'JDG', region: 'China' },
    { name: 'Bilibili Gaming', short: 'BLG', region: 'China' },
    { name: 'Top Esports', short: 'TES', region: 'China' },
    { name: 'Weibo Gaming', short: 'WBG', region: 'China' },
    { name: 'LNG Esports', short: 'LNG', region: 'China' },
    { name: 'MAD Lions KOI', short: 'MAD', region: 'Europe' },
    { name: 'Team BDS', short: 'BDS', region: 'Europe' },
    { name: 'Rogue', short: 'RGE', region: 'Europe' },
    { name: 'SK Gaming', short: 'SK', region: 'Europe' },
    { name: 'GIANTX', short: 'GX', region: 'Europe' },
    { name: 'Team Heretics', short: 'TH', region: 'Europe' },
    { name: 'Karmine Corp', short: 'KC', region: 'Europe' },
    { name: 'Team Vitality', short: 'VIT', region: 'Europe' },
    { name: '100 Thieves', short: '100T', region: 'North America' },
    { name: 'NRG', short: 'NRG', region: 'North America' },
    { name: 'Dignitas', short: 'DIG', region: 'North America' },
    { name: 'Nongshim Esports', short: 'NS', region: 'Korea' },
    { name: 'OKSavingsBank BRION', short: 'BRO', region: 'Korea' },
  ];
  const majorTeamMap = {};
  for (const mt of majorTeams) majorTeamMap[mt.name] = mt;

  // Historical team name aliases → current name
  // Maps old org names to their current identity so prize money is aggregated correctly
  const TEAM_ALIASES = {
    'SK Telecom T1': 'T1',
    'SKT T1': 'T1',
    'SK Telecom T1 K': 'T1',
    'SK Telecom T1 S': 'T1', // sister team — separate but often merged in records
    'Samsung Galaxy': 'Gen.G',
    'Samsung White': 'Gen.G', // Worlds 2014 winner
    'Samsung Blue': 'Gen.G',
    'Samsung Ozone': 'Gen.G',
    'KSV eSports': 'Gen.G',
    'DAMWON Gaming': 'Dplus KIA',
    'DWG KIA': 'Dplus KIA',
    'DK': 'Dplus KIA',
    'DragonX': 'DRX',
    'Kingzone DragonX': 'DRX',
    'Longzhu Gaming': 'DRX',
    'KZ': 'DRX',
    'Griffin': 'DRX', // acquired by DRX org
    'Kiwoom DRX': 'DRX',
    'Invictus Gaming': 'Invictus Gaming',
    'EDward Gaming': 'EDward Gaming',
    'Royal Never Give Up': 'Royal Never Give Up',
    'FunPlus Phoenix': 'FunPlus Phoenix',
    'Suning': 'Weibo Gaming',
    'SN': 'Weibo Gaming',
    'Suning Gaming': 'Weibo Gaming',
    'OKSavingsBank BRION': 'Nongshim Esports', // if applicable
  };

  function resolveTeamName(name) {
    return TEAM_ALIASES[name] || name;
  }

  // Convert prize to USD
  function prizeToUSD(amount, currency) {
    if (!amount || isNaN(amount)) return 0;
    const cur = (currency || 'USD').toUpperCase();
    // Approximate exchange rates for historical prize conversions
    const rates = {
      'USD': 1, 'KRW': 0.00073, 'CNY': 0.14, 'EUR': 1.1, 'GBP': 1.27,
      'PLN': 0.25, 'BRL': 0.19, 'TRY': 0.03, 'VND': 0.000041, 'JPY': 0.0067,
      'TWD': 0.031, 'AUD': 0.65, 'CAD': 0.74, 'SEK': 0.095, 'DKK': 0.15,
      'HUF': 0.0027, 'CZK': 0.043, 'RON': 0.22, 'RUB': 0.011, 'PHP': 0.018,
      'THB': 0.029, 'MYR': 0.22, 'SGD': 0.75, 'IDR': 0.000063, 'INR': 0.012,
      'SAR': 0.27, 'ARS': 0.001, 'CLP': 0.0011, 'PEN': 0.27, 'COP': 0.00025,
    };
    return Math.round(amount * (rates[cur] || 1));
  }

  // Results map — aggregate under current team name
  const resultsMap = {};
  for (const r of resultsData) {
    const rawTeam = r.Team;
    if (!rawTeam) continue;
    const team = resolveTeamName(rawTeam);
    if (!resultsMap[team]) resultsMap[team] = [];
    const prize = r.Prize ? parseFloat(String(r.Prize).replace(/[^0-9.]/g, '')) : 0;
    const currency = r.PrizeUnit || 'USD';
    const prizeUSD = prizeToUSD(isNaN(prize) ? 0 : prize, currency);
    resultsMap[team].push({
      event: stripHtml(r.Event || ''),
      place: r.Place || '',
      date: r.Date || '',
      prizeUSD,
      originalPrize: prize > 0 ? `${Math.round(prize)} ${currency}` : '',
      trophy: getTrophy(r.Place),
    });
  }

  // Sort each team's results by date descending
  for (const team of Object.keys(resultsMap)) {
    resultsMap[team].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }

  // Build final teams
  const teamsDB = [];
  const seenTeams = new Set();

  function buildTeam(name, meta) {
    if (seenTeams.has(name.toLowerCase())) return;
    if (LEAGUE_UMBRELLAS.has(name)) return;

    // Try canonical name first, then Leaguepedia aliases
    let roster = playersRoster[name] || [];
    if (roster.length === 0) {
      const aliases = LEAGUEPEDIA_TEAM_NAMES[name] || [];
      for (const alias of aliases) {
        if ((playersRoster[alias] || []).length > 0) {
          roster = playersRoster[alias];
          break;
        }
      }
    }

    // Validated roster: players confirmed by tournament roster = Main
    // Players only in Players table = Sub (unless they fill a missing main role)
    const mainRoles = new Set(['Top', 'Jungle', 'Mid', 'ADC', 'Support']);
    const filledRoles = new Set();
    const validatedPlayers = [];
    const subs = [];
    const staffMembers = [];

    // First pass: tournament-validated players
    for (const m of roster) {
      if (!m.isPlayer) {
        // Staff: include if validated or if role is Coach/Analyst/Manager
        if (m.inTournamentRoster || ['Head Coach', 'Coach', 'Analyst', 'Manager'].includes(m.role)) {
          staffMembers.push(m);
        }
        continue;
      }
      if (m.inTournamentRoster && mainRoles.has(m.role)) {
        validatedPlayers.push({ ...m, status: 'main' });
        filledRoles.add(m.role);
      }
    }

    // Second pass: fill missing main roles from Players table
    for (const m of roster) {
      if (!m.isPlayer) continue;
      if (validatedPlayers.some(v => v.name === m.name)) continue;
      if (mainRoles.has(m.role) && !filledRoles.has(m.role)) {
        validatedPlayers.push({ ...m, status: 'main' });
        filledRoles.add(m.role);
      } else if (m.isPlayer && m.role !== 'Streamer') {
        subs.push({ ...m, status: 'sub' });
      }
    }

    // Limit subs to 3 max
    const finalSubs = subs.slice(0, 3);

    // Attach Riot accounts for clickable links
    const allMembers = [...validatedPlayers, ...finalSubs, ...staffMembers].map(m => {
      const accounts = accountLookup[m.name.toLowerCase()] || [];
      return { ...m, accounts, riotId: accounts[0] || null };
    });

    allMembers.sort((a, b) => a.order - b.order);

    const results = resultsMap[name] || [];
    const totalPrize = results.reduce((s, r) => s + (r.prizeUSD || 0), 0);
    const trophies = results.filter(r => r.trophy).slice(0, 30);

    // Use Liquipedia verified totals for major teams (more accurate than sum of crawled results)
    const VERIFIED_TOTALS = {
      'T1': 9988980, 'Gen.G': 3995098, 'G2 Esports': 4441244, 'Fnatic': 3486400,
      'Cloud9': 2420216, 'Team Liquid': 2045457, 'FlyQuest': 1161850,
      'Hanwha Life Esports': 1367325, 'JD Gaming': 2605435, 'Bilibili Gaming': 2955002,
      'Top Esports': 2812396, 'Weibo Gaming': 867522, 'Dplus KIA': 2104453,
      'KT Rolster': 1861786, 'LNG Esports': 641420, 'DRX': 1167536,
      'Invictus Gaming': 4193765, 'EDward Gaming': 3716382,
      'Royal Never Give Up': 2310000, 'FunPlus Phoenix': 1750000,
    };

    // Use verified total if available; otherwise use calculated sum
    const verifiedTotal = VERIFIED_TOTALS[name];
    const finalPrize = verifiedTotal || Math.round(totalPrize);

    // Roster-selection policy:
    //  1. If existing file has a complete roster (>=5 main players), TRUST it over fresh crawl.
    //     Leaguepedia's Players table contains historical members flagged as non-retired,
    //     which would regress curated rosters (e.g. Dplus KIA: Khan/Smash instead of Kingen/Kellin).
    //  2. Otherwise use the fresh crawl.
    //  3. If fresh crawl is also empty, fall back to existing (any size).
    const existing = existingRosters[name.toLowerCase()];
    const existingMainCount = existing ? existing.roster.filter(m => m.status === 'main').length : 0;

    let finalRoster = allMembers;
    let rosterSource = 'leaguepedia-players';

    if (existing && existingMainCount >= 5) {
      finalRoster = existing.roster;
      rosterSource = 'preserved-curated';
    } else if (finalRoster.length === 0 && existing && existing.roster.length > 0) {
      finalRoster = existing.roster;
      rosterSource = 'preserved-from-existing';
      console.log(`  [PRESERVE] ${name}: kept ${existing.roster.length} existing members (no Leaguepedia data)`);
    }

    // Preserve existing logo/short if current build has nothing better
    const finalLogo = (meta?.logo) || existing?.logo || null;
    const finalShort = (meta?.short) || existing?.short || name.slice(0, 3).toUpperCase();

    teamsDB.push({
      id: name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      name,
      short: finalShort,
      region: meta?.region || '',
      logo: finalLogo,
      roster: finalRoster,
      results: results.slice(0, 50), // Keep up to 50 results for detail view
      trophies,
      totalPrizeMoney: finalPrize,
      rosterSource,
    });
    seenTeams.add(name.toLowerCase());
  }

  // Process major teams first
  for (const mt of majorTeams) {
    buildTeam(mt.name, mt);
  }

  // Then other teams with roster
  for (const [teamName, roster] of Object.entries(playersRoster)) {
    if (seenTeams.has(teamName.toLowerCase())) continue;
    if (roster.length < 3) continue;
    buildTeam(teamName, null);
  }

  teamsDB.sort((a, b) => b.totalPrizeMoney - a.totalPrizeMoney);

  // Stats
  const validated = teamsDB.reduce((s, t) => s + t.roster.filter(m => m.status === 'main').length, 0);
  const withAccounts = teamsDB.reduce((s, t) => s + t.roster.filter(m => m.riotId).length, 0);

  console.log(`  ${teamsDB.length} Teams erstellt`);
  console.log(`  ${validated} validierte Main-Spieler`);
  console.log(`  ${withAccounts} Spieler mit Riot-Account (klickbar)`);
  console.log(`  ${teamsDB.filter(t => t.trophies.length > 0).length} Teams mit Titeln`);

  // Verify a sample
  const g2 = teamsDB.find(t => t.name === 'G2 Esports');
  if (g2) {
    console.log(`\n  G2 Roster (${g2.roster.length}):`);
    g2.roster.forEach(m => {
      console.log(`    ${m.status || 'staff'} | ${m.role} | ${m.name} | Account: ${m.riotId || '-'} | Validated: ${m.inTournamentRoster}`);
    });
  }

  const fs = await import('fs');
  fs.writeFileSync('public/pro-teams.json', JSON.stringify({
    updatedAt: new Date().toISOString(),
    totalTeams: teamsDB.length,
    teams: teamsDB,
  }));
  console.log('\n  -> public/pro-teams.json gespeichert');

  console.log('\n=== Top 10 Teams ===');
  teamsDB.slice(0, 10).forEach((t, i) => {
    const mains = t.roster.filter(m => m.status === 'main').length;
    const subs = t.roster.filter(m => m.status === 'sub').length;
    const staff = t.roster.filter(m => !m.isPlayer).length;
    console.log(`  ${i + 1}. ${t.name} (${t.short}) | ${mains} Main + ${subs} Sub + ${staff} Staff | $${t.totalPrizeMoney.toLocaleString()}`);
  });

  console.log('\nFertig!');
}

main().catch(e => { console.error(e); process.exit(1); });
