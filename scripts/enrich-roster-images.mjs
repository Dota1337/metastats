/**
 * Enriches roster member images in public/pro-teams.json.
 *
 * Source A (primary): lolesports.com Esports API — official team-branded portraits
 *   for active Major-League rosters (LCK/LEC/LCS/LPL/LCP/LTA/VCS/CBLOL/LJL/...)
 * Source B (fallback): Leaguepedia Cargo `Players.Image` -> Fandom imageinfo API
 *   for staff, subs, and Tier-2/3 teams.
 *
 * Only fills missing `image` fields; never overwrites existing values.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ESPORTS_KEY = '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z';
const ESPORTS_API = 'https://esports-api.lolesports.com/persisted/gw';
const CARGO_API = 'https://lol.fandom.com/wiki/Special:CargoExport';
const FANDOM_API = 'https://lol.fandom.com/api.php';

const MAJOR_LEAGUE_SLUGS = [
  'lec', 'lck', 'lpl', 'lcs', 'cblol-brazil', 'ljl-japan', 'pcs', 'vcs',
  'lta_n', 'lta_s', 'primeleague', 'nacl', 'emea_masters', 'lfl', 'nlc',
  'lco', 'turkiye-sampiyonluk-ligi', 'lla', 'lck_challengers_league',
  'lit', 'roadoflegends', 'lcp', 'cd',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const normalize = (s) => String(s || '').toLowerCase().replace(/\s+/g, '').replace(/[^\w]/g, '');

async function esportsFetch(url) {
  try {
    const res = await fetch(url, { headers: { 'x-api-key': ESPORTS_KEY } });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function cargoFetch(params) {
  const p = new URLSearchParams({ ...params, format: 'json' });
  try {
    const r = await fetch(`${CARGO_API}?${p}`, { headers: { 'User-Agent': 'metastats.gg' } });
    const t = await r.text();
    return t.startsWith('[') ? JSON.parse(t) : [];
  } catch { return []; }
}

async function getAllEsportsTeamIds() {
  const leagueData = await esportsFetch(`${ESPORTS_API}/getLeagues?hl=en-US`);
  const leagues = (leagueData?.data?.leagues || []).filter((l) => MAJOR_LEAGUE_SLUGS.includes(l.slug));

  const teamIds = new Set();
  for (const league of leagues) {
    const td = await esportsFetch(`${ESPORTS_API}/getTournamentsForLeague?hl=en-US&leagueId=${league.id}`);
    const tournaments = td?.data?.leagues?.[0]?.tournaments || [];
    const sorted = tournaments.sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
    const now = new Date();
    const current = sorted.find((t) => new Date(t.startDate) <= now && new Date(t.endDate) >= now) || sorted[0];
    if (current) {
      const sd = await esportsFetch(`${ESPORTS_API}/getStandingsV3?hl=en-US&tournamentId=${current.id}`);
      for (const s of (sd?.data?.standings || [])) {
        for (const stage of (s.stages || [])) {
          for (const section of (stage.sections || [])) {
            for (const ranking of (section.rankings || [])) {
              for (const team of (ranking.teams || [])) {
                if (team.id) teamIds.add(team.id);
              }
            }
          }
        }
      }
    }
    await sleep(150);
  }
  return [...teamIds];
}

async function buildEsportsTeamMap(teamIds) {
  // Map<normalizedTeamNameOrCode, Map<normalizedPlayerName, imageUrl>>
  const map = new Map();
  for (let i = 0; i < teamIds.length; i++) {
    const d = await esportsFetch(`${ESPORTS_API}/getTeams?hl=en-US&id=${teamIds[i]}`);
    const team = d?.data?.teams?.[0];
    if (team) {
      const playerMap = new Map();
      for (const p of (team.players || [])) {
        if (p.summonerName && p.image) {
          playerMap.set(normalize(p.summonerName), p.image);
        }
      }
      if (team.name) map.set(normalize(team.name), playerMap);
      if (team.code) map.set(normalize(team.code), playerMap);
    }
    if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${teamIds.length} esports teams loaded`);
    await sleep(80);
  }
  return map;
}

async function lpPlayersForTeam(teamName) {
  // Players.Image is null for most active players. PlayerImages stores per-split portraits.
  // We take the most recent IsProfileImage=1 row per Link, with the current team filter.
  const rows = await cargoFetch({
    tables: 'PlayerImages=PI',
    fields: 'PI.Link,PI.FileName,PI.IsProfileImage,PI.Team',
    where: `PI.Team="${teamName.replace(/"/g, '\\"')}" AND PI.IsProfileImage="Yes"`,
    'order by': 'PI._pageID DESC',
    limit: '200',
  });
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (!r.Link || !r.FileName || seen.has(r.Link)) continue;
    seen.add(r.Link);
    out.push({ ID: r.Link, Image: r.FileName });
  }
  return out;
}

async function resolveFandomImageUrls(filenames) {
  const urls = {};
  for (let i = 0; i < filenames.length; i += 50) {
    const batch = filenames.slice(i, i + 50);
    const titles = batch.map((f) => `File:${f}`).join('|');
    const p = new URLSearchParams({
      action: 'query',
      titles,
      prop: 'imageinfo',
      iiprop: 'url',
      format: 'json',
    });
    try {
      const r = await fetch(`${FANDOM_API}?${p}`, { headers: { 'User-Agent': 'metastats.gg' } });
      const d = await r.json();
      const pages = d?.query?.pages || {};
      for (const pageId of Object.keys(pages)) {
        const page = pages[pageId];
        const title = (page.title || '').replace(/^File:/, '');
        const url = page.imageinfo?.[0]?.url;
        if (url) urls[title] = url;
      }
      await sleep(200);
    } catch {}
  }
  return urls;
}

async function main() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const filePath = path.join(__dirname, '..', 'public', 'pro-teams.json');
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  console.log('=== Roster Image Enrichment ===\n');
  const totalRoster = data.teams.reduce((s, t) => s + (t.roster || []).length, 0);
  const startWithImg = data.teams.reduce((s, t) => s + (t.roster || []).filter((m) => m.image).length, 0);
  console.log(`Start: ${startWithImg}/${totalRoster} mit Bild\n`);

  // === Phase 1: Esports API ===
  console.log('[1/2] Lade aktive Team-Rosters von lolesports...');
  const teamIds = await getAllEsportsTeamIds();
  console.log(`  ${teamIds.length} Teams aus Major Leagues`);
  const esportsMap = await buildEsportsTeamMap(teamIds);
  console.log(`  Map mit ${esportsMap.size} Team-Aliasen aufgebaut\n`);

  let filledA = 0;
  for (const team of data.teams) {
    const candidate =
      esportsMap.get(normalize(team.name)) ||
      esportsMap.get(normalize(team.short));
    if (!candidate) continue;
    for (const m of (team.roster || [])) {
      if (m.image) continue;
      const url = candidate.get(normalize(m.name));
      if (url) {
        m.image = url;
        filledA++;
      }
    }
  }
  console.log(`  +${filledA} Bilder von lolesports\n`);

  // === Phase 2: Leaguepedia fallback ===
  console.log('[2/2] Fallback via Leaguepedia für Rest (Staff/Subs/Tier-2)...');
  let filledB = 0;
  let lpQueries = 0;
  for (const team of data.teams) {
    const missing = (team.roster || []).filter((m) => !m.image);
    if (missing.length === 0) continue;

    const players = await lpPlayersForTeam(team.name);
    lpQueries++;
    if (players.length === 0) {
      await sleep(150);
      continue;
    }

    const filenames = [...new Set(players.map((p) => p.Image).filter(Boolean))];
    const urlMap = filenames.length > 0 ? await resolveFandomImageUrls(filenames) : {};

    const lpMap = new Map();
    for (const p of players) {
      const url = urlMap[p.Image];
      if (url && p.ID) lpMap.set(normalize(p.ID), url);
    }

    for (const m of missing) {
      const url = lpMap.get(normalize(m.name));
      if (url) {
        m.image = url;
        filledB++;
      }
    }

    if (lpQueries % 25 === 0) {
      console.log(`  ${lpQueries} Teams via LP verarbeitet, +${filledB} Bilder`);
      await sleep(1000);
    } else {
      await sleep(200);
    }
  }
  console.log(`  +${filledB} Bilder von Leaguepedia\n`);

  // === Save ===
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(data));

  const endWithImg = data.teams.reduce((s, t) => s + (t.roster || []).filter((m) => m.image).length, 0);
  console.log(`Fertig! ${endWithImg}/${totalRoster} mit Bild (+${endWithImg - startWithImg})`);

  console.log('\n=== Top 30 Image Coverage ===');
  for (const t of data.teams.slice(0, 30)) {
    const all = (t.roster || []).length;
    const imgs = (t.roster || []).filter((m) => m.image).length;
    console.log(`  ${t.name.padEnd(32)} ${imgs}/${all}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
