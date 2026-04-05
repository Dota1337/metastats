/**
 * Fetches working team logo URLs from Leaguepedia MediaWiki API
 * Uses static.wikia.nocookie.net URLs which are publicly accessible
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getWikiImageUrl(filename) {
  try {
    const url = `https://lol.fandom.com/api.php?action=query&titles=File:${encodeURIComponent(filename)}&prop=imageinfo&iiprop=url&format=json`;
    const r = await fetch(url, { headers: { 'User-Agent': 'metastats.gg team-logo-fetcher' } });
    if (!r.ok) return null;
    const d = await r.json();
    const pages = Object.values(d.query?.pages || {});
    for (const p of pages) {
      if (p.imageinfo?.[0]?.url) return p.imageinfo[0].url;
    }
  } catch {}
  return null;
}

async function main() {
  console.log('=== Team Logo Fix via Leaguepedia ===\n');

  const teamsPath = path.join(__dirname, '..', 'public', 'pro-teams.json');
  const data = JSON.parse(fs.readFileSync(teamsPath, 'utf-8'));

  // Step 1: Get all team names from Leaguepedia Cargo
  console.log('[1/3] Lade Team-Bildnamen von Leaguepedia...');
  const teamImages = {};
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

      const res = await fetch(`https://lol.fandom.com/wiki/Special:CargoExport?${params}`, {
        headers: { 'User-Agent': 'metastats.gg team-logo-fetcher' },
      });
      if (!res.ok) break;
      const teams = await res.json();
      if (teams.length === 0) break;

      for (const t of teams) {
        if (t.Image && t.Name) {
          teamImages[t.Name.toLowerCase()] = t.Image;
          if (t.Short) teamImages[t.Short.toLowerCase()] = t.Image;
        }
      }
      offset += 500;
      await sleep(500);
    } catch { break; }
  }
  console.log(`  ${Object.keys(teamImages).length} Team-Bildnamen geladen\n`);

  // Step 2: Resolve actual image URLs via MediaWiki API
  console.log('[2/3] Löse Bild-URLs auf...');
  let resolved = 0;
  let failed = 0;
  const logoCache = {};

  for (let i = 0; i < data.teams.length; i++) {
    const team = data.teams[i];
    const nameLC = (team.name || '').toLowerCase();
    const shortLC = (team.short || '').toLowerCase();

    // Find the image filename from Leaguepedia
    const imgFile = teamImages[nameLC] || teamImages[shortLC];

    if (imgFile) {
      // Try "square" version first, then the original
      const filesToTry = [
        imgFile.replace('logo profile.png', 'logo square.png'),
        imgFile.replace('logo std.png', 'logo square.png'),
        imgFile,
      ];

      let foundUrl = null;
      for (const fn of filesToTry) {
        if (logoCache[fn]) { foundUrl = logoCache[fn]; break; }

        const url = await getWikiImageUrl(fn);
        if (url) {
          logoCache[fn] = url;
          foundUrl = url;
          break;
        }
        await sleep(150);
      }

      if (foundUrl) {
        team.logo = foundUrl;
        resolved++;
      } else {
        failed++;
      }
    } else {
      // No Leaguepedia match — try with team name directly
      const guessFiles = [
        team.name + 'logo square.png',
        team.name + 'logo profile.png',
      ];

      let foundUrl = null;
      for (const fn of guessFiles) {
        const url = await getWikiImageUrl(fn);
        if (url) { foundUrl = url; break; }
        await sleep(150);
      }

      if (foundUrl) {
        team.logo = foundUrl;
        resolved++;
      } else {
        failed++;
      }
    }

    if ((i + 1) % 20 === 0 || i === data.teams.length - 1) {
      console.log(`  ${i + 1}/${data.teams.length} — resolved: ${resolved}, failed: ${failed}`);
    }
  }

  // Step 3: Verify all logos work
  console.log('\n[3/3] Verifiziere URLs...');
  let working = 0;
  let broken = 0;

  for (const team of data.teams) {
    if (!team.logo) continue;
    try {
      const r = await fetch(team.logo, { method: 'HEAD' });
      if (r.status === 200) {
        working++;
      } else {
        console.log(`  BROKEN (${r.status}): ${team.name} -> ${team.logo.substring(0, 60)}`);
        team.logo = ''; // Remove broken logo
        broken++;
      }
    } catch {
      team.logo = '';
      broken++;
    }
    await sleep(50);
  }

  console.log(`  Working: ${working}, Broken: ${broken}`);

  // Save
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(teamsPath, JSON.stringify(data, null, 2));

  const withLogo = data.teams.filter(t => t.logo && t.logo.startsWith('http'));
  console.log(`\nDone! ${withLogo.length}/${data.teams.length} Teams mit funktionierenden Logos`);

  // Check key teams
  const check = ['T1', 'Gen.G', 'G2 Esports', 'Fnatic', 'Cloud9', 'Team Liquid', 'Hanwha Life Esports'];
  console.log('\n=== Key Teams ===');
  for (const name of check) {
    const t = data.teams.find(t => t.name === name);
    if (t) console.log(`  ${t.name}: ${t.logo ? 'OK' : 'MISSING'}`);
  }
}

main().catch(console.error);
