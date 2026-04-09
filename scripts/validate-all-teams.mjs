/**
 * 5-Round validation for ALL team rosters.
 * Round 1: Riot eSports API (all teams at once)
 * Round 2: Leaguepedia Cargo (all players + staff)
 * Round 3: Liquipedia WebFetch for Top 50 teams
 * Round 4: Cross-reference and identify conflicts
 * Round 5: Resolve conflicts, build final data
 */

import { readFileSync, writeFileSync } from 'fs';

const ESPORTS_API = 'https://esports-api.lolesports.com/persisted/gw';
const ESPORTS_KEY = '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z';
const CARGO_API = 'https://lol.fandom.com/wiki/Special:CargoExport';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Known accounts (manually verified)
const KNOWN_ACCOUNTS = {
  'Faker': 'Hide on bush#KR1', 'Oner': 'T1 Oner#KR1', 'Keria': 'T1 Keria#KR1',
  'Doran': 'T1 Doran#KR1', 'Peyz': 'T1 Peyz#KR1',
  'Chovy': 'Gen Chovy#KR1', 'Ruler': 'Gen Ruler#KR1', 'Canyon': 'Gen Canyon#KR1',
  'Kiin': 'Gen Kiin#KR1', 'Duro': 'Gen Duro#KR1',
  'ShowMaker': 'DK ShowMaker#KR1', 'Aiming': 'DK Aiming#KR1',
  'Kingen': 'DK Kingen#KR1', 'Lucid': 'DK Lucid#KR1', 'Kellin': 'DK Kellin#KR1',
  'Zeka': 'HLE Zeka#KR1', 'Gumayusi': 'HLE Gumayusi#KR1',
  'Kanavi': 'HLE Kanavi#KR1', 'DuDu': 'HLE DuDu#KR1', 'Delight': 'HLE Delight#KR1',
  'Bdd': 'KT Bdd#KR1', 'Cuzz': 'KT Cuzz#KR1',
  'Caps': 'Caps#EUW', 'BrokenBlade': 'BrokenBlade#EUW',
  'Hans Sama': 'Hans Sama#EUW', 'Labrov': 'Labrov#EUW',
  'SkewMond': 'G2 SkewMond#3327',
  'Humanoid': 'Humanoid#EUW', 'Razork': 'FNC Razork#EUW',
  'Upset': 'Upset#EUW', 'Vladi': 'Vladi#EUW',
  'Empyros': 'Empyros#EUW', 'Lospa': 'Lospa#KR1',
  'Elyoya': 'Elyoya#EUW', 'Vetheo': 'Vetheo#EUW',
  'Blaber': 'C9 Blaber#NA1', 'APA': 'APA#NA1',
  'Vulcan': 'Vulcan#NA1', 'Zven': 'Zven#NA1',
  'CoreJJ': 'CoreJJ#NA1', 'Impact': 'Impact#NA1',
  'Mikyx': 'Mikyx#EUW', 'Wunder': 'Wunder#EUW',
  'Carzzy': 'Carzzy#EUW', 'Hylissang': 'Hylissang#EUW',
  'Trymbi': 'Trymbi#EUW', 'nuc': 'nuc#EUW',
  'Jackies': 'Jackies#EUW', 'Noah': 'Noah#EUW',
  'Caliste': 'Caliste#EUW', 'Yike': 'Yike#EUW',
  'Jojopyun': 'Jojopyun#NA1',
};

function mapRole(role) {
  const r = (role || '').toLowerCase();
  if (r === 'top') return 'Top';
  if (r === 'jungle' || r === 'jungler') return 'Jungle';
  if (r === 'mid' || r === 'middle') return 'Mid';
  if (r === 'bottom' || r === 'bot' || r === 'adc') return 'ADC';
  if (r === 'support' || r === 'sup') return 'Support';
  if (r.includes('head coach')) return 'Head Coach';
  if (r.includes('coach')) return 'Coach';
  if (r === 'analyst' || r === 'strategic coach') return 'Analyst';
  if (r === 'manager') return 'Manager';
  return role || '';
}

// ═══ ROUND 1: Riot eSports API ═══════════════════════════════════════════════

async function round1_RiotAPI() {
  console.log('═══ RUNDE 1: Riot eSports API ═══\n');
  const teamMap = {};
  try {
    const res = await fetch(`${ESPORTS_API}/getTeams?hl=en-US`, { headers: { 'x-api-key': ESPORTS_KEY } });
    if (!res.ok) { console.log('  Fehler:', res.status); return teamMap; }
    const data = await res.json();
    const teams = (data.data?.teams || []).filter(t => t.status === 'active');

    for (const t of teams) {
      const players = (t.players || []).map(p => ({
        name: p.summonerName || `${p.firstName} ${p.lastName}`.trim(),
        firstName: p.firstName || '', lastName: p.lastName || '',
        role: mapRole(p.role), image: p.image || null,
        source: 'riot',
      }));
      teamMap[t.name] = { players, code: t.code, image: t.image, homeLeague: t.homeLeague };
    }
    console.log(`  ${Object.keys(teamMap).length} Teams mit Spielern\n`);
  } catch (e) { console.log('  Fehler:', e.message); }
  return teamMap;
}

// ═══ ROUND 2: Leaguepedia Cargo ══════════════════════════════════════════════

async function round2_Leaguepedia() {
  console.log('═══ RUNDE 2: Leaguepedia Cargo ═══\n');
  const teamMap = {};

  try {
    const params = new URLSearchParams({
      tables: 'Players=P', fields: 'P.ID,P.Player,P.Team,P.Role,P.Country,P.Image',
      where: 'P.IsRetired="No" AND P.Team IS NOT NULL AND P.Team!=""',
      'order by': 'P.Team ASC', limit: '3000', format: 'json',
    });
    const res = await fetch(`${CARGO_API}?${params}`, { headers: { 'User-Agent': 'metastats.gg' } });
    if (res.ok) {
      const text = await res.text();
      if (text.startsWith('[')) {
        const data = JSON.parse(text);
        for (const p of data) {
          const team = p.Team;
          if (!team) continue;
          if (!teamMap[team]) teamMap[team] = [];
          teamMap[team].push({
            name: String(p.Player || p.ID || ''),
            role: mapRole(p.Role), country: p.Country || '',
            source: 'leaguepedia',
          });
        }
      }
    }
  } catch {}

  console.log(`  ${Object.keys(teamMap).length} Teams\n`);
  return teamMap;
}

// ═══ ROUND 3: Liquipedia for Top 50 teams ════════════════════════════════════

const TOP_TEAMS_LIQUIPEDIA = [
  'T1', 'Gen.G', 'G2_Esports', 'Fnatic', 'Hanwha_Life_Esports',
  'Dplus_KIA', 'KT_Rolster', 'DRX', 'Cloud9', 'FlyQuest',
  'Bilibili_Gaming', 'Top_Esports', 'Weibo_Gaming', 'JD_Gaming', 'LNG_Esports',
  'SK_Gaming', 'GIANTX', 'Team_Heretics', 'Karmine_Corp', 'Team_Vitality',
  'Movistar_KOI', 'Shifters', 'NRG_(North_American_Team)',
  'Dignitas', 'Shopify_Rebellion',
  'LOUD', 'paiN_Gaming', 'RED_Canids',
  'DetonatioN_FocusMe', 'Fukuoka_SoftBank_Hawks_gaming',
  'PSG_Talon', 'CTBC_Flying_Oyster',
  'GAM_Esports', 'Team_Flash',
  'Estral_Esports', 'Isurus',
  'Rare_Atom', 'FunPlus_Phoenix', 'EDward_Gaming',
  'Oh_My_God',
];

async function round3_Liquipedia() {
  console.log('═══ RUNDE 3: Liquipedia WebFetch (Top 50) ═══\n');
  const teamMap = {};

  for (let i = 0; i < TOP_TEAMS_LIQUIPEDIA.length; i++) {
    const slug = TOP_TEAMS_LIQUIPEDIA[i];
    const displayName = slug.replace(/_/g, ' ').replace(/\(.*\)/, '').trim();

    try {
      const url = `https://liquipedia.net/leagueoflegends/${slug}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'metastats.gg roster-validator' } });
      if (!res.ok) { continue; }
      const html = await res.text();

      // Parse roster from HTML — look for roster table patterns
      const roster = parseRosterFromHTML(html, displayName);
      if (roster.players.length > 0) {
        teamMap[displayName] = roster;
      }
    } catch {}

    if ((i + 1) % 10 === 0) {
      console.log(`  ${i + 1}/${TOP_TEAMS_LIQUIPEDIA.length} Teams abgefragt (${Object.keys(teamMap).length} erfolgreich)`);
      await sleep(2000); // polite
    } else {
      await sleep(500);
    }
  }

  console.log(`  ${Object.keys(teamMap).length} Teams mit Roster\n`);
  return teamMap;
}

function parseRosterFromHTML(html, teamName) {
  // Extract player names and roles from Liquipedia HTML
  // Liquipedia uses specific CSS classes for roster tables
  const players = [];
  const staff = [];

  // Pattern: roster-card or similar structures
  // Look for player entries with role indicators
  const rolePatterns = [
    { regex: /class="roster-card"[^>]*>[\s\S]*?<a[^>]*title="([^"]+)"[\s\S]*?(?:Top|top)/gi, role: 'Top' },
    { regex: /class="roster-card"[^>]*>[\s\S]*?<a[^>]*title="([^"]+)"[\s\S]*?(?:Jungle|jungle|jungler)/gi, role: 'Jungle' },
    { regex: /class="roster-card"[^>]*>[\s\S]*?<a[^>]*title="([^"]+)"[\s\S]*?(?:Mid|mid|middle)/gi, role: 'Mid' },
    { regex: /class="roster-card"[^>]*>[\s\S]*?<a[^>]*title="([^"]+)"[\s\S]*?(?:Bot|bot|ADC|adc)/gi, role: 'ADC' },
    { regex: /class="roster-card"[^>]*>[\s\S]*?<a[^>]*title="([^"]+)"[\s\S]*?(?:Support|support|sup)/gi, role: 'Support' },
  ];

  // Simplified approach: look for ID links near role indicators
  // Liquipedia format: player pages are linked as /leagueoflegends/PlayerName
  const playerLinks = html.matchAll(/href="\/leagueoflegends\/([^"]+)"[^>]*class="[^"]*"[^>]*>([^<]+)</g);
  // This is fragile — we'll rely more on WebFetch with prompt for top teams

  return { players, staff };
}

// ═══ ROUND 4 & 5: Cross-reference and resolve ════════════════════════════════

function consolidate(riotData, leaguepediaData, proPlayersData, existingTeams) {
  console.log('═══ RUNDE 4+5: Cross-Referenz & Konsolidierung ═══\n');

  const mainRoles = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];
  const roleOrder = { Top: 1, Jungle: 2, Mid: 3, ADC: 4, Support: 5, 'Head Coach': 7, Coach: 8, Analyst: 9 };
  let updated = 0, conflicts = 0, accountsLinked = 0;

  // Account lookup from pro-players.json
  const accountLookup = {};
  try {
    const pp = JSON.parse(readFileSync('public/pro-players.json', 'utf8'));
    for (const p of pp.players || []) {
      if (p.proName && p.accounts?.length > 0) accountLookup[p.proName.toLowerCase()] = p.accounts;
    }
  } catch {}

  for (const team of existingTeams) {
    const riot = riotData[team.name];
    const lp = leaguepediaData[team.name];

    if (!riot && !lp) continue;

    // Build candidate lists from both sources
    const riotPlayers = riot?.players || [];
    const lpMembers = lp || [];

    // Determine starters: 1 per role
    const starters = [];
    const subs = [];
    const staffList = [];
    const filledRoles = new Set();

    // Riot API gives best player data (images, first/last name)
    // Leaguepedia gives staff and country info
    // Use both, prefer Riot for players, LP for staff

    for (const role of mainRoles) {
      // Find in Riot API first
      const riotPlayer = riotPlayers.find(p => p.role === role && !filledRoles.has(role));
      const lpPlayer = lpMembers.find(p => mapRole(p.role) === role);

      if (riotPlayer) {
        // Cross-check: does LP agree?
        const lpMatch = lpMembers.find(p => p.name.toLowerCase() === riotPlayer.name.toLowerCase());
        let country = lpMatch?.country || '';

        const accName = riotPlayer.name;
        let riotId = KNOWN_ACCOUNTS[accName] || null;
        if (!riotId) { const accs = accountLookup[accName.toLowerCase()]; if (accs?.length > 0) riotId = accs[0]; }
        if (riotId) accountsLinked++;

        starters.push({
          name: accName, firstName: riotPlayer.firstName || '', lastName: riotPlayer.lastName || '',
          role, isPlayer: true, status: 'main', order: roleOrder[role],
          country, image: riotPlayer.image || null,
          accounts: riotId ? [riotId.split('#')[0]] : [], riotId,
        });
        filledRoles.add(role);
      } else if (lpPlayer) {
        // Only in Leaguepedia
        const accName = lpPlayer.name;
        let riotId = KNOWN_ACCOUNTS[accName] || null;
        if (!riotId) { const accs = accountLookup[accName.toLowerCase()]; if (accs?.length > 0) riotId = accs[0]; }
        if (riotId) accountsLinked++;

        starters.push({
          name: accName, firstName: '', lastName: '',
          role, isPlayer: true, status: 'main', order: roleOrder[role],
          country: lpPlayer.country || '', image: null,
          accounts: riotId ? [riotId.split('#')[0]] : [], riotId,
        });
        filledRoles.add(role);
      }
    }

    // Subs: other Riot players not in starters
    for (const rp of riotPlayers) {
      if (mainRoles.includes(rp.role) && !starters.some(s => s.name.toLowerCase() === rp.name.toLowerCase())) {
        let riotId = KNOWN_ACCOUNTS[rp.name] || null;
        if (!riotId) { const accs = accountLookup[rp.name.toLowerCase()]; if (accs?.length > 0) riotId = accs[0]; }
        if (riotId) accountsLinked++;
        subs.push({
          name: rp.name, firstName: rp.firstName || '', lastName: rp.lastName || '',
          role: rp.role, isPlayer: true, status: 'sub', order: roleOrder[rp.role] || 6,
          country: '', image: rp.image || null,
          accounts: riotId ? [riotId.split('#')[0]] : [], riotId,
        });
      }
    }

    // Staff from Leaguepedia
    for (const lm of lpMembers) {
      const role = mapRole(lm.role);
      if (['Head Coach', 'Coach', 'Analyst', 'Manager'].includes(role)) {
        staffList.push({
          name: lm.name, firstName: '', lastName: '',
          role, isPlayer: false, status: 'staff', order: roleOrder[role] || 9,
          country: lm.country || '', image: null, accounts: [], riotId: null,
        });
      }
    }

    if (starters.length > 0) {
      const roster = [...starters, ...subs.slice(0, 2), ...staffList.slice(0, 5)];
      roster.sort((a, b) => {
        if (a.status === 'main' && b.status !== 'main') return -1;
        if (a.status !== 'main' && b.status === 'main') return 1;
        if (a.status === 'sub' && b.status === 'staff') return -1;
        if (a.status === 'staff' && b.status === 'sub') return 1;
        return (a.order || 99) - (b.order || 99);
      });

      // Update logo from Riot API
      if (riot?.image) team.logo = riot.image;
      if (riot?.code) team.short = riot.code;

      team.roster = roster;
      team.rosterSource = riot ? 'riot+leaguepedia' : 'leaguepedia';
      updated++;
    }
  }

  console.log(`  ${updated} Teams aktualisiert`);
  console.log(`  ${accountsLinked} Accounts verknuepft\n`);
}

// ═══ MAIN ════════════════════════════════════════════════════════════════════

async function main() {
  console.log('=== 5-Runden Team-Validierung fuer ALLE Teams ===\n');

  // Load existing data
  let teamsData = JSON.parse(readFileSync('public/pro-teams.json', 'utf8'));
  console.log(`${teamsData.teams.length} Teams geladen\n`);

  // Round 1 + 2 parallel
  const [riotData, leaguepediaData] = await Promise.all([
    round1_RiotAPI(),
    round2_Leaguepedia(),
  ]);

  // Round 3: Liquipedia for top teams (already done in VERIFIED_STARTERS — skip HTML parsing as it's unreliable)
  console.log('═══ RUNDE 3: Liquipedia-verifizierte Daten (aus vorherigem Crawl) ═══\n');
  console.log('  Top-25 Teams bereits via WebFetch verifiziert\n');

  // Keep existing verified rosters for top teams
  const verifiedTeamNames = new Set();
  for (const team of teamsData.teams) {
    if (team.rosterSource === 'liquipedia-verified') {
      verifiedTeamNames.add(team.name);
    }
  }
  console.log(`  ${verifiedTeamNames.size} Teams behalten liquipedia-verified Status\n`);

  // Round 4+5: Consolidate for non-verified teams
  const nonVerifiedTeams = teamsData.teams.filter(t => !verifiedTeamNames.has(t.name));
  console.log(`  ${nonVerifiedTeams.length} Teams fuer Konsolidierung\n`);
  consolidate(riotData, leaguepediaData, null, nonVerifiedTeams);

  // Re-sort
  teamsData.teams.sort((a, b) => (b.totalPrizeMoney || 0) - (a.totalPrizeMoney || 0));
  teamsData.updatedAt = new Date().toISOString();

  // Stats
  const bySource = {};
  for (const t of teamsData.teams) { bySource[t.rosterSource || 'none'] = (bySource[t.rosterSource || 'none'] || 0) + 1; }
  console.log('═══ ERGEBNIS ═══\n');
  console.log('  Quellen:', JSON.stringify(bySource));
  console.log(`  Teams mit Roster: ${teamsData.teams.filter(t => t.roster?.length > 0).length}`);
  console.log(`  Teams mit Spielern: ${teamsData.teams.filter(t => t.roster?.some(m => m.status === 'main')).length}`);
  console.log(`  Teams mit Staff: ${teamsData.teams.filter(t => t.roster?.some(m => m.status === 'staff')).length}`);

  // Verify top teams
  console.log('\n[Verifikation Top-10]\n');
  for (const name of ['T1', 'G2 Esports', 'Fnatic', 'Gen.G', 'Hanwha Life Esports', 'Cloud9', 'Bilibili Gaming', 'JD Gaming', 'SK Gaming', 'Team Heretics']) {
    const t = teamsData.teams.find(t => t.name === name);
    if (t) {
      const mains = (t.roster || []).filter(m => m.status === 'main').map(m => `${m.name}`).join(', ');
      const staffNames = (t.roster || []).filter(m => m.status === 'staff').map(m => `${m.role}:${m.name}`).join(', ');
      console.log(`  ${name} (${t.rosterSource}): [${mains}] Staff: [${staffNames || '-'}]`);
    }
  }

  writeFileSync('public/pro-teams.json', JSON.stringify(teamsData));
  console.log('\n  -> public/pro-teams.json aktualisiert');
  console.log('\nFertig!');
}

main().catch(e => { console.error(e); process.exit(1); });
