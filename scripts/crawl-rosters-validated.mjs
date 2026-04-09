/**
 * Multi-source roster crawler — Riot eSports API as PRIMARY source.
 * 1. Riot eSports API getTeams — official current rosters with images
 * 2. Leaguepedia — account names, staff, country
 * 3. Hardcoded account mappings for known pros
 * Merges all into pro-teams.json with clickable player links.
 */

import { readFileSync, writeFileSync } from 'fs';

const ESPORTS_API = 'https://esports-api.lolesports.com/persisted/gw';
const ESPORTS_KEY = '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z';
const CARGO_API = 'https://lol.fandom.com/wiki/Special:CargoExport';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Verified starters from Liquipedia (scraped 2026-03-29) ───────────────────
const VERIFIED_STARTERS = {
  // LCK 2026
  'T1': ['Doran', 'Oner', 'Faker', 'Peyz', 'Keria'],
  'Gen.G': ['Kiin', 'Canyon', 'Chovy', 'Ruler', 'Duro'],
  'Gen.G Esports': ['Kiin', 'Canyon', 'Chovy', 'Ruler', 'Duro'],
  'Hanwha Life Esports': ['DuDu', 'Kanavi', 'Zeka', 'Gumayusi', 'Delight'],
  'Dplus KIA': ['Kingen', 'Lucid', 'ShowMaker', 'Aiming', 'Kellin'],
  'PENTAGRAM': ['Kingen', 'Lucid', 'ShowMaker', 'Aiming', 'Kellin'],
  'KT Rolster': ['PerfecT', 'Cuzz', 'Bdd', 'Aiming', 'Mia'],
  'Kiwoom DRX': ['Rich', 'Vincenzo', 'ucal', 'Jiwoo', 'Andil'],
  'DRX': ['Rich', 'Vincenzo', 'ucal', 'Jiwoo', 'Andil'],

  // LEC 2026
  'G2 Esports': ['BrokenBlade', 'SkewMond', 'Caps', 'Hans Sama', 'Labrov'],
  'Fnatic': ['Empyros', 'Razork', 'Vladi', 'Upset', 'Lospa'],
  'SK Gaming': ['Wunder', 'Skeanz', 'LIDER', 'Jopa', 'Mikyx'],
  'GIANTX': ['Lot', 'Isma', 'Jackies', 'Noah', 'Jun'],
  'Team Heretics': ['Tracyn', 'Sheo', 'Serin', 'Ice', 'Stend'],
  'Karmine Corp': ['Canna', 'Yike', 'kyeahoo', 'Caliste', 'Busio'],
  'Movistar KOI': ['Myrwn', 'Elyoya', 'Jojopyun', 'Supa', 'Alvaro'],
  'Team Vitality': ['Naak Nako', 'Lyncas', 'Humanoid', 'Carzzy', 'Fleshy'],
  'Shifters': ['Rooster', 'Boukada', 'nuc', 'Paduck', 'Trymbi'],

  // LCS / LTA 2026
  'Cloud9': ['Thanatos', 'Blaber', 'APA', 'Zven', 'Vulcan'],
  'FlyQuest': ['GaKGoS', 'Gryffinn', 'Quad', 'Massu', 'Cryogen'],

  // LPL 2026
  'JD Gaming': ['Xiaoxu', 'JunJia', 'hongQ', 'GALA', 'Vampire'],
  'Bilibili Gaming': ['Bin', 'XUN', 'Knight', 'Viper', 'ON'],
  'Top Esports': ['369', 'Tian', 'Creme', 'JackeyLove', 'Fengyue'],
  'Weibo Gaming': ['Breathe', 'Jiejie', 'Xiaohu', 'Elk', 'Crisp'],
  'LNG Esports': ['sheer', '5t5', 'BuLLDoG', 'fishone', 'MISSING'],
};

// Staff — T1 verified from official website, rest from Liquipedia
const VERIFIED_STAFF = {
  // LCK — T1 from t1.gg (official), rest from Liquipedia
  'T1': [{ name: 'kkOma', role: 'Head Coach' }, { name: 'Dooti', role: 'Coach' }],
  'Gen.G': [{ name: 'Ryu', role: 'Head Coach' }, { name: 'Lyn', role: 'Coach' }, { name: 'Nova', role: 'Coach' }],
  'Gen.G Esports': [{ name: 'Ryu', role: 'Head Coach' }, { name: 'Lyn', role: 'Coach' }],
  'Hanwha Life Esports': [{ name: 'Homme', role: 'Head Coach' }, { name: 'Mowgli', role: 'Coach' }],
  'Dplus KIA': [{ name: 'acorn', role: 'Head Coach' }],
  'PENTAGRAM': [{ name: 'acorn', role: 'Head Coach' }],
  'KT Rolster': [{ name: 'Museong', role: 'Head Coach' }, { name: 'Score', role: 'Coach' }],
  'Kiwoom DRX': [{ name: 'Joker', role: 'Head Coach' }, { name: 'NaeHyun', role: 'Coach' }],
  'DRX': [{ name: 'Joker', role: 'Head Coach' }],
  // LEC
  'G2 Esports': [{ name: 'Dylan Falco', role: 'Head Coach' }, { name: 'Ismind', role: 'Coach' }, { name: 'Memento', role: 'Coach' }],
  'Fnatic': [{ name: 'GrabbZ', role: 'Head Coach' }, { name: 'Gaax', role: 'Coach' }],
  'SK Gaming': [{ name: 'Own3r', role: 'Head Coach' }],
  'GIANTX': [{ name: 'Guilhoto', role: 'Head Coach' }],
  'Team Heretics': [{ name: 'Hidon', role: 'Head Coach' }, { name: 'mithy', role: 'Coach' }],
  'Karmine Corp': [{ name: 'Reapered', role: 'Head Coach' }],
  'Movistar KOI': [{ name: 'Melzhet', role: 'Head Coach' }, { name: 'Alphari', role: 'Coach' }],
  'Team Vitality': [{ name: 'Pad', role: 'Head Coach' }],
  'Shifters': [{ name: 'Striker', role: 'Head Coach' }, { name: 'Cabochard', role: 'Coach' }],
  // LCS/LTA
  'Cloud9': [{ name: 'Inero', role: 'Head Coach' }, { name: 'Veigarv2', role: 'Coach' }],
  'FlyQuest': [{ name: 'Thinkcard', role: 'Head Coach' }],
  // LPL
  'Bilibili Gaming': [{ name: 'Daeny', role: 'Head Coach' }, { name: 'Ben', role: 'Coach' }],
  'Top Esports': [{ name: 'Poppy', role: 'Head Coach' }],
  'Weibo Gaming': [{ name: 'Shine', role: 'Head Coach' }],
  'JD Gaming': [{ name: 'Tabe', role: 'Head Coach' }, { name: 'Zoom', role: 'Coach' }],
  'LNG Esports': [{ name: 'Edgar', role: 'Head Coach' }],
};

// ─── Known account mappings (pro name -> Riot ID) ─────────────────────────────
// These are manually verified solo queue accounts
const KNOWN_ACCOUNTS = {
  // LCK
  'Faker': 'Hide on bush#KR1', 'Oner': 'T1 Oner#KR1', 'Keria': 'T1 Keria#KR1',
  'Doran': 'T1 Doran#KR1', 'Peyz': 'T1 Peyz#KR1',
  'Chovy': 'Gen Chovy#KR1', 'Ruler': 'Gen Ruler#KR1', 'Canyon': 'Gen Canyon#KR1',
  'Kiin': 'Gen Kiin#KR1', 'Duro': 'Gen Duro#KR1',
  'ShowMaker': 'DK ShowMaker#KR1', 'Aiming': 'DK Aiming#KR1',
  'Kingen': 'DK Kingen#KR1', 'Lucid': 'DK Lucid#KR1', 'Kellin': 'DK Kellin#KR1',
  'Zeka': 'HLE Zeka#KR1', 'Gumayusi': 'HLE Gumayusi#KR1',
  'Kanavi': 'HLE Kanavi#KR1', 'DuDu': 'HLE DuDu#KR1', 'Delight': 'HLE Delight#KR1',
  'Zeus': 'HLE Zeus#KR1',
  'Bdd': 'KT Bdd#KR1', 'Cuzz': 'KT Cuzz#KR1', 'PerfecT': 'KT PerfecT#KR1',
  'Rich': 'DRX Rich#KR1', 'ucal': 'DRX ucal#KR1',
  // LEC
  'Caps': 'Caps#EUW', 'BrokenBlade': 'BrokenBlade#EUW',
  'Hans Sama': 'Hans Sama#EUW', 'Mikyx': 'Mikyx#EUW',
  'SkewMond': 'G2 SkewMond#3327',
  'Labrov': 'Labrov#EUW',
  'Humanoid': 'FNC Humanoid#EUW', 'Razork': 'FNC Razork#EUW',
  'Oscarinin': 'FNC Oscarinin#EUW', 'Noah': 'FNC Noah#EUW',
  'Upset': 'Upset#EUW', 'Vladi': 'Vladi#EUW',
  'Empyros': 'Empyros#EUW', 'Lospa': 'Lospa#KR1',
  'Elyoya': 'Elyoya#EUW', 'Vetheo': 'Vetheo#EUW',
  'Larssen': 'Larssen#EUW', 'Comp': 'Comp#EUW', 'Trymbi': 'Trymbi#EUW',
  'Patrik': 'Patrik#EUW', 'Jackies': 'Jackies#EUW',
  'Adam': 'Adam#EUW', 'nuc': 'nuc#EUW', 'Crownie': 'Crownie#EUW',
  'Carzzy': 'Carzzy#EUW', 'Hylissang': 'Hylissang#EUW',
  'Cabochard': 'Cabochard#EUW', 'Targamas': 'Targamas#EUW',
  'Odoamne': 'Odoamne#EUW', 'IgNar': 'IgNar#EUW',
  'Wunder': 'Wunder#EUW', 'Jankos': 'Jankos#EUW',
  'Flakked': 'Flakked#EUW', 'Malrang': 'Malrang#EUW',
  'Szygenda': 'Szygenda#EUW',
  // LCS
  'Blaber': 'C9 Blaber#NA1', 'Berserker': 'C9 Berserker#NA1',
  'Fudge': 'C9 Fudge#NA1', 'Jojopyun': 'Jojopyun#NA1',
  'Vulcan': 'Vulcan#NA1',
  'CoreJJ': 'CoreJJ#NA1', 'APA': 'APA#NA1', 'Impact': 'Impact#NA1',
  'Yeon': 'Yeon#NA1', 'UmTi': 'UmTi#NA1',
  'Bwipo': 'Bwipo#NA1', 'Inspired': 'Inspired#NA1',
  'Massu': 'Massu#NA1', 'Busio': 'Busio#NA1',
  'Jensen': 'Jensen#NA1', 'FBI': 'FBI#NA1',
  // LPL
  'knight': 'knight#cnKR', 'Ruler': 'Ruler#cnKR',
  'Kanavi': 'Kanavi#cnKR', 'Breathe': 'Breathe#cnKR',
  'JackeyLove': 'JackeyLove#cnKR', 'Meiko': 'Meiko#cnKR',
  'TheShy': 'TheShy#cnKR', 'Xiaohu': 'Xiaohu#cnKR',
  'Scout': 'Scout#cnKR', 'GALA': 'GALA#cnKR',
  'Bin': 'Bin#cnKR', 'Elk': 'Elk#cnKR',
  'Yagao': 'Yagao#cnKR', 'XUN': 'XUN#cnKR',
};

// ─── Team name aliases (Riot API name -> our DB name) ─────────────────────────
const TEAM_ALIASES = {
  'Gen.G Esports': 'Gen.G',
  'DRX': 'Kiwoom DRX',
  'PENTAGRAM': 'Dplus KIA',
  'Dplus KIA Challengers': 'Dplus KIA',
  'T1 Esports Academy': 'T1',
  'BNK FearX': 'BNK FEARX',
};

// ─── SOURCE 1: Riot eSports API ───────────────────────────────────────────────

async function fetchRiotTeams() {
  console.log('[1/3] Riot eSports API: Lade alle Teams...');
  try {
    const res = await fetch(`${ESPORTS_API}/getTeams?hl=en-US`, {
      headers: { 'x-api-key': ESPORTS_KEY },
    });
    if (!res.ok) { console.log('  Fehler:', res.status); return []; }
    const data = await res.json();
    const teams = (data.data?.teams || []).filter(t => t.status === 'active' && t.players?.length > 0);
    console.log(`  ${teams.length} aktive Teams mit Spielern`);
    return teams;
  } catch (e) {
    console.log('  Fehler:', e.message);
    return [];
  }
}

// ─── SOURCE 2: Leaguepedia (for accounts + staff) ─────────────────────────────

async function fetchLeaguepediaAccounts() {
  console.log('[2/3] Leaguepedia: Lade Account-Daten...');
  const accountMap = {};
  try {
    const params = new URLSearchParams({
      tables: 'Players=P',
      fields: 'P.ID,P.Player,P.Team,P.Role,P.Country',
      where: 'P.IsRetired="No" AND P.Team IS NOT NULL AND P.Team!=""',
      limit: '3000', format: 'json',
    });
    const res = await fetch(`${CARGO_API}?${params}`, { headers: { 'User-Agent': 'metastats.gg' } });
    if (res.ok) {
      const text = await res.text();
      if (text.startsWith('[')) {
        const data = JSON.parse(text);
        for (const p of data) {
          const name = String(p.Player || p.ID || '');
          if (name) {
            accountMap[name.toLowerCase()] = {
              name, team: p.Team, role: p.Role, country: p.Country || '',
            };
          }
        }
      }
    }
  } catch {}
  console.log(`  ${Object.keys(accountMap).length} Spieler-Eintraege`);
  return accountMap;
}

// ─── SOURCE 3: Pro-players.json (existing account data) ───────────────────────

function loadExistingAccounts() {
  console.log('[3/3] pro-players.json: Lade bestehende Accounts...');
  const accountMap = {};
  try {
    const data = JSON.parse(readFileSync('public/pro-players.json', 'utf8'));
    for (const p of data.players || []) {
      if (p.proName && p.accounts?.length > 0) {
        accountMap[p.proName.toLowerCase()] = p.accounts;
      }
    }
  } catch {}
  console.log(`  ${Object.keys(accountMap).length} Spieler mit Accounts`);
  return accountMap;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

function mapRole(role) {
  const r = (role || '').toLowerCase();
  if (r === 'top') return 'Top';
  if (r === 'jungle') return 'Jungle';
  if (r === 'mid') return 'Mid';
  if (r === 'bottom') return 'ADC';
  if (r === 'support') return 'Support';
  if (r === 'none') return 'Staff';
  return role || 'Staff';
}

async function main() {
  console.log('=== Roster Crawler v3 (Riot eSports API Primary) ===\n');

  // Load existing teams data
  let teamsData;
  try {
    teamsData = JSON.parse(readFileSync('public/pro-teams.json', 'utf8'));
  } catch {
    console.error('pro-teams.json nicht gefunden!');
    process.exit(1);
  }

  // Fetch from all sources
  const [riotTeams, leaguepedia, existingAccounts] = await Promise.all([
    fetchRiotTeams(),
    fetchLeaguepediaAccounts(),
    Promise.resolve(loadExistingAccounts()),
  ]);

  // Build Riot team lookup: name -> team data
  const riotLookup = {};
  for (const t of riotTeams) {
    riotLookup[t.name] = t;
    // Also add aliases
    const alias = TEAM_ALIASES[t.name];
    if (alias) riotLookup[alias] = t;
  }

  console.log(`\n[Konsolidierung] ${teamsData.teams.length} Teams...\n`);

  let riotCount = 0, accountsLinked = 0;

  for (const team of teamsData.teams) {
    const riotTeam = riotLookup[team.name];
    const verifiedNames = VERIFIED_STARTERS[team.name];

    // PRIORITY 1: If we have verified Liquipedia data, use that directly
    if (verifiedNames) {
      const roleGuess = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];
      const roleOrder = { Top: 1, Jungle: 2, Mid: 3, ADC: 4, Support: 5, Staff: 7 };
      const starters = verifiedNames.map((vName, vi) => {
        // Try to find image from Riot API
        const riotPlayer = riotTeam?.players?.find(p => (p.summonerName || '').toLowerCase() === vName.toLowerCase());
        let riotId = KNOWN_ACCOUNTS[vName] || null;
        if (!riotId) { const accs = existingAccounts[vName.toLowerCase()]; if (accs?.length > 0) riotId = accs[0]; }
        if (riotId) accountsLinked++;
        return {
          name: vName, firstName: riotPlayer?.firstName || '', lastName: riotPlayer?.lastName || '',
          role: roleGuess[vi], isPlayer: true, status: 'main', order: roleOrder[roleGuess[vi]] || 99,
          country: leaguepedia[vName.toLowerCase()]?.country || '',
          image: riotPlayer?.image || null,
          accounts: riotId ? [riotId.split('#')[0]] : [], riotId,
        };
      });

      // Subs: other Riot API players not in starters (max 2)
      const subs = [];
      if (riotTeam?.players) {
        for (const p of riotTeam.players) {
          const pName = p.summonerName || `${p.firstName} ${p.lastName}`.trim();
          const role = mapRole(p.role);
          if (['Top', 'Jungle', 'Mid', 'ADC', 'Support'].includes(role) && !verifiedNames.some(v => v.toLowerCase() === pName.toLowerCase())) {
            let rid = KNOWN_ACCOUNTS[pName] || null;
            if (!rid) { const accs = existingAccounts[pName.toLowerCase()]; if (accs?.length > 0) rid = accs[0]; }
            if (rid) accountsLinked++;
            subs.push({
              name: pName, firstName: p.firstName || '', lastName: p.lastName || '',
              role, isPlayer: true, status: 'sub', order: roleOrder[role] || 99,
              country: '', image: p.image || null,
              accounts: rid ? [rid.split('#')[0]] : [], riotId: rid,
            });
          }
        }
      }

      // Staff
      const vStaff = VERIFIED_STAFF[team.name] || [];
      const staffEntries = vStaff.map(s => ({
        name: s.name, firstName: '', lastName: '', role: s.role, isPlayer: false,
        status: 'staff', order: 7, country: '', image: null, accounts: [], riotId: null,
      }));

      const roster = [...starters, ...subs.slice(0, 2), ...staffEntries];
      team.roster = roster;
      team.rosterSource = 'liquipedia-verified';
      if (riotTeam?.image) team.logo = riotTeam.image;
      if (riotTeam?.code) team.short = riotTeam.code;
      riotCount++;
      continue;
    }

    if (riotTeam && riotTeam.players.length > 0) {
      // Use Riot eSports API roster — but limit to 5 starters + max 2 subs
      const roleOrder = { Top: 1, Jungle: 2, Mid: 3, ADC: 4, Support: 5, Staff: 6 };
      const mainRoles = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];

      // Build all players first
      const allPlayers = riotTeam.players.map(p => {
        const role = mapRole(p.role);
        const proName = p.summonerName || `${p.firstName || ''} ${p.lastName || ''}`.trim();
        let riotId = KNOWN_ACCOUNTS[proName] || null;
        if (!riotId) {
          const accs = existingAccounts[proName.toLowerCase()];
          if (accs?.length > 0) riotId = accs[0];
        }
        if (riotId) accountsLinked++;
        return {
          name: proName, firstName: p.firstName || '', lastName: p.lastName || '',
          role, isPlayer: mainRoles.includes(role),
          order: roleOrder[role] || 99,
          country: leaguepedia[proName.toLowerCase()]?.country || '',
          image: p.image || null,
          accounts: riotId ? [riotId.split('#')[0]] : [],
          riotId: riotId || null,
        };
      });

      // Select starters: use verified list if available, otherwise first per role
      const verifiedNames = VERIFIED_STARTERS[team.name] || VERIFIED_STARTERS[riotTeam.name] || null;
      const starters = [];
      const subs = [];
      const filledRoles = new Set();

      if (verifiedNames) {
        // Pick verified starters — from Riot API pool OR create from verified list
        const roleGuess = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];
        for (let vi = 0; vi < verifiedNames.length; vi++) {
          const vName = verifiedNames[vi];
          const match = allPlayers.find(p => p.name.toLowerCase() === vName.toLowerCase());
          if (match) {
            starters.push({ ...match, status: 'main' });
            filledRoles.add(match.role);
          } else {
            // Player not in Riot API — create from verified data + known accounts
            let rid = KNOWN_ACCOUNTS[vName] || null;
            if (!rid) {
              const accs = existingAccounts[vName.toLowerCase()];
              if (accs?.length > 0) rid = accs[0];
            }
            if (rid) accountsLinked++;
            starters.push({
              name: vName, firstName: '', lastName: '',
              role: roleGuess[vi] || 'Mid', isPlayer: true, status: 'main',
              order: roleOrder[roleGuess[vi]] || 99, country: '',
              image: null, accounts: rid ? [rid.split('#')[0]] : [], riotId: rid,
            });
          }
        }
        // Everyone else from Riot API = sub (max 2)
        for (const p of allPlayers) {
          if (p.isPlayer && !starters.some(s => s.name === p.name)) {
            subs.push({ ...p, status: 'sub' });
          }
        }
      } else {
        // No verified data — take first per role
        for (const p of allPlayers) {
          if (mainRoles.includes(p.role) && !filledRoles.has(p.role)) {
            starters.push({ ...p, status: 'main' });
            filledRoles.add(p.role);
          } else if (p.isPlayer) {
            subs.push({ ...p, status: 'sub' });
          }
        }
      }

      // Max 2 subs
      const finalSubs = subs.slice(0, 2);
      // Staff: prefer verified, then from Riot API
      const verifiedStaff = VERIFIED_STAFF[team.name] || VERIFIED_STAFF[riotTeam.name] || null;
      let staff;
      if (verifiedStaff) {
        staff = verifiedStaff.map(s => ({
          name: s.name, role: s.role, isPlayer: false, status: 'staff',
          order: 7, country: '', image: null, accounts: [], riotId: null,
          firstName: '', lastName: '',
        }));
      } else {
        staff = allPlayers.filter(p => !p.isPlayer).map(p => ({ ...p, status: 'staff' }));
      }

      const roster = [...starters, ...finalSubs, ...staff];
      roster.sort((a, b) => {
        if (a.status === 'main' && b.status !== 'main') return -1;
        if (a.status !== 'main' && b.status === 'main') return 1;
        if (a.status === 'sub' && b.status === 'staff') return -1;
        if (a.status === 'staff' && b.status === 'sub') return 1;
        return a.order - b.order;
      });
      team.roster = roster;
      team.rosterSource = 'riot-esports';

      // Update team logo from Riot API
      if (riotTeam.image) team.logo = riotTeam.image;
      if (riotTeam.code) team.short = riotTeam.code;

      riotCount++;
    } else {
      // Keep existing roster but try to link accounts
      for (const m of team.roster || []) {
        if (!m.riotId) {
          const known = KNOWN_ACCOUNTS[m.name];
          if (known) { m.riotId = known; m.accounts = [known.split('#')[0]]; accountsLinked++; }
          else {
            const accs = existingAccounts[m.name.toLowerCase()];
            if (accs?.length > 0) { m.riotId = accs[0]; m.accounts = accs; accountsLinked++; }
          }
        }
      }
    }
  }

  // Add Riot teams not yet in our DB
  let added = 0;
  const existingNames = new Set(teamsData.teams.map(t => t.name.toLowerCase()));
  for (const rt of riotTeams) {
    const resolvedName = TEAM_ALIASES[rt.name] || rt.name;
    if (existingNames.has(resolvedName.toLowerCase())) continue;
    if (rt.players.length < 3) continue;

    const roleOrder = { Top: 1, Jungle: 2, Mid: 3, ADC: 4, Support: 5, Staff: 6 };
    const mainRoles2 = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];
    const allP = rt.players.map(p => {
      const role = mapRole(p.role);
      const proName = p.summonerName || `${p.firstName} ${p.lastName}`.trim();
      const riotId = KNOWN_ACCOUNTS[proName] || null;
      return {
        name: proName, role, isPlayer: mainRoles2.includes(role),
        order: roleOrder[role] || 99, country: '', image: p.image || null,
        accounts: riotId ? [riotId.split('#')[0]] : [], riotId,
        firstName: p.firstName || '', lastName: p.lastName || '',
      };
    });
    const filled2 = new Set();
    const starters2 = [];
    const subs2 = [];
    for (const p of allP) {
      if (mainRoles2.includes(p.role) && !filled2.has(p.role)) {
        starters2.push({ ...p, status: 'main' });
        filled2.add(p.role);
      } else if (p.isPlayer) {
        subs2.push({ ...p, status: 'sub' });
      }
    }
    const roster = [...starters2, ...subs2.slice(0, 2), ...allP.filter(p => !p.isPlayer).map(p => ({ ...p, status: 'staff' }))];
    roster.sort((a, b) => {
      if (a.status === 'main' && b.status !== 'main') return -1;
      if (a.status !== 'main' && b.status === 'main') return 1;
      return a.order - b.order;
    });

    teamsData.teams.push({
      id: resolvedName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      name: resolvedName, short: rt.code || resolvedName.slice(0, 3),
      region: rt.homeLeague?.region || '', logo: rt.image || null,
      roster, results: [], trophies: [], totalPrizeMoney: 0,
      rosterSource: 'riot-esports',
    });
    added++;
  }

  teamsData.teams.sort((a, b) => (b.totalPrizeMoney || 0) - (a.totalPrizeMoney || 0));
  teamsData.updatedAt = new Date().toISOString();

  // Stats
  console.log(`  Riot eSports Roster: ${riotCount} Teams`);
  console.log(`  Accounts verknuepft: ${accountsLinked}`);
  console.log(`  Neue Teams hinzugefuegt: ${added}`);
  console.log(`  Gesamt: ${teamsData.teams.length} Teams`);

  // Verify
  console.log('\n[Verifikation]\n');
  for (const name of ['T1', 'G2 Esports', 'Fnatic', 'Gen.G', 'Cloud9', 'Team Liquid', 'Weibo Gaming', 'JD Gaming']) {
    const t = teamsData.teams.find(t => t.name === name);
    if (t) {
      const mains = (t.roster || []).filter(m => m.status === 'main');
      const linked = mains.filter(m => m.riotId).length;
      console.log(`  ${name} (${t.rosterSource}): ${mains.map(m => `${m.role}:${m.name}${m.riotId ? ' [LINK]' : ''}`).join(', ')}`);
    }
  }

  writeFileSync('public/pro-teams.json', JSON.stringify(teamsData));
  console.log('\n  -> public/pro-teams.json aktualisiert');
  console.log('\nFertig!');
}

main().catch(e => { console.error(e); process.exit(1); });
