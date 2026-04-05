/**
 * Enriches pro-teams.json with team logos from multiple sources:
 * 1. LoL Esports API (official team images)
 * 2. Leaguepedia (team logos from wiki)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ESPORTS_KEY = '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z';
const CARGO_API = 'https://lol.fandom.com/wiki/Special:CargoExport';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('=== Team Logo Enrichment ===\n');

  const teamsPath = path.join(__dirname, '..', 'public', 'pro-teams.json');
  const data = JSON.parse(fs.readFileSync(teamsPath, 'utf-8'));
  let updated = 0;

  // Source 1: LoL Esports API — get all teams from all leagues
  console.log('[1/2] LoL Esports API...');

  const esportsLogos = {};

  // Get all leagues
  const lr = await fetch('https://esports-api.lolesports.com/persisted/gw/getLeagues?hl=en-US', {
    headers: { 'x-api-key': ESPORTS_KEY },
  }).then(r => r.json());
  const leagues = lr?.data?.leagues || [];

  // Get teams from each league's standings
  const teamIds = new Set();
  for (const league of leagues) {
    try {
      const td = await fetch(
        `https://esports-api.lolesports.com/persisted/gw/getTournamentsForLeague?hl=en-US&leagueId=${league.id}`,
        { headers: { 'x-api-key': ESPORTS_KEY } }
      ).then(r => r.json());

      const tournaments = td?.data?.leagues?.[0]?.tournaments || [];
      const sorted = tournaments.sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
      const now = new Date();
      const current = sorted.find(t => new Date(t.startDate) <= now && new Date(t.endDate) >= now) || sorted[0];

      if (current) {
        const sd = await fetch(
          `https://esports-api.lolesports.com/persisted/gw/getStandingsV3?hl=en-US&tournamentId=${current.id}`,
          { headers: { 'x-api-key': ESPORTS_KEY } }
        ).then(r => r.json());

        const standings = sd?.data?.standings || [];
        if (standings[0]?.stages) {
          for (const stage of standings[0].stages) {
            for (const section of (stage.sections || [])) {
              for (const ranking of (section.rankings || [])) {
                for (const team of (ranking.teams || [])) {
                  if (team.id) teamIds.add(team.id);
                  if (team.image && team.code) {
                    esportsLogos[team.code.toLowerCase()] = team.image;
                    esportsLogos[team.name.toLowerCase()] = team.image;
                  }
                }
              }
            }
          }
        }
      }
    } catch {}
    await sleep(100);
  }

  // Also fetch individual team details for higher-res images
  console.log(`  ${teamIds.size} Teams, fetching details...`);
  for (const id of teamIds) {
    try {
      const d = await fetch(
        `https://esports-api.lolesports.com/persisted/gw/getTeams?hl=en-US&id=${id}`,
        { headers: { 'x-api-key': ESPORTS_KEY } }
      ).then(r => r.json());

      const team = d?.data?.teams?.[0];
      if (team?.image) {
        esportsLogos[team.code.toLowerCase()] = team.image;
        esportsLogos[team.name.toLowerCase()] = team.image;
        if (team.slug) esportsLogos[team.slug.toLowerCase()] = team.image;
      }
    } catch {}
    await sleep(60);
  }
  console.log(`  ${Object.keys(esportsLogos).length} Logo-Mappings von Esports API\n`);

  // Source 2: Leaguepedia team logos
  console.log('[2/2] Leaguepedia...');

  const leaguepediaLogos = {};
  let offset = 0;
  while (true) {
    try {
      const params = new URLSearchParams({
        tables: 'Teams',
        fields: 'Teams.Name, Teams.Short, Teams.Image',
        where: 'Teams.Image IS NOT NULL AND Teams.Image != ""',
        'order by': 'Teams.Name ASC',
        limit: '500',
        offset: String(offset),
        format: 'json',
      });

      const res = await fetch(`${CARGO_API}?${params}`, {
        headers: { 'User-Agent': 'metastats.gg team-logo-crawler' },
      });
      if (!res.ok) break;
      const teams = await res.json();
      if (teams.length === 0) break;

      for (const t of teams) {
        if (t.Image && t.Name) {
          // Leaguepedia Image is filename, need to construct URL
          const imgName = t.Image.replace(/ /g, '_');
          const imgUrl = `https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/${imgName}`;
          leaguepediaLogos[t.Name.toLowerCase()] = imgUrl;
          if (t.Short) leaguepediaLogos[t.Short.toLowerCase()] = imgUrl;
        }
      }
      offset += 500;
      await sleep(500);
    } catch { break; }
  }
  console.log(`  ${Object.keys(leaguepediaLogos).length} Logo-Mappings von Leaguepedia\n`);

  // Apply logos to our teams
  console.log('Applying logos...');
  for (const team of data.teams) {
    if (team.logo && team.logo.startsWith('http')) continue; // already has logo

    const nameLC = (team.name || '').toLowerCase();
    const shortLC = (team.short || '').toLowerCase();
    const idLC = (team.id || '').toLowerCase();

    // Try Esports API first (better quality)
    let logo = esportsLogos[shortLC] || esportsLogos[nameLC] || esportsLogos[idLC];

    // Try Leaguepedia as fallback
    if (!logo) {
      logo = leaguepediaLogos[nameLC] || leaguepediaLogos[shortLC];
    }

    // Try fuzzy matching for common name variations
    if (!logo) {
      for (const [key, url] of Object.entries(esportsLogos)) {
        if (nameLC.includes(key) || key.includes(nameLC)) {
          logo = url;
          break;
        }
      }
    }

    if (logo) {
      team.logo = logo;
      updated++;
    }
  }

  // Save
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(teamsPath, JSON.stringify(data, null, 2));

  const withLogo = data.teams.filter(t => t.logo && t.logo.startsWith('http'));
  const withoutLogo = data.teams.filter(t => !t.logo || !t.logo.startsWith('http'));

  console.log(`\nDone! Updated ${updated} team logos`);
  console.log(`Total with logos: ${withLogo.length}/${data.teams.length}`);

  if (withoutLogo.length > 0) {
    console.log(`\nStill missing (${withoutLogo.length}):`);
    withoutLogo.slice(0, 15).forEach(t => console.log(`  ${t.name} (${t.short})`));
  }
}

main().catch(console.error);
