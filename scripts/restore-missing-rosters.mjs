/**
 * One-shot fix: restore rosters for teams that lost them in commit d25b4d6.
 *
 * Strategy:
 *  1. Load current public/pro-teams.json
 *  2. Load the old version (committed as 104f2f0) from /tmp/old-pro-teams.json
 *  3. For each team in current file with empty roster, copy roster from old file
 *     if a match exists (match by name, then by id).
 *  4. Drop league umbrella entries that were never real teams.
 *  5. Write back.
 */

import fs from 'fs';

const CURRENT_PATH = 'public/pro-teams.json';
const OLD_PATH = '.old-pro-teams.json';

// Liga-Dachorganisationen, die fälschlich als Team geführt werden
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

const current = JSON.parse(fs.readFileSync(CURRENT_PATH, 'utf8'));
const old = JSON.parse(fs.readFileSync(OLD_PATH, 'utf8'));

// Build lookup maps over the old file
const oldByName = new Map();
const oldById = new Map();
for (const t of old.teams) {
  if (t.name) oldByName.set(t.name.toLowerCase(), t);
  if (t.id) oldById.set(String(t.id).toLowerCase(), t);
}

let restored = 0;
let notFound = 0;
let droppedUmbrellas = 0;

// Filter out league umbrellas
const keptTeams = [];
for (const team of current.teams) {
  if (LEAGUE_UMBRELLAS.has(team.name)) {
    droppedUmbrellas++;
    continue;
  }
  keptTeams.push(team);
}

// Restore empty rosters
for (const team of keptTeams) {
  const roster = team.roster || [];
  if (roster.length > 0) continue;

  const match =
    oldByName.get((team.name || '').toLowerCase()) ||
    oldById.get(String(team.id || '').toLowerCase());

  if (!match || !(match.roster || []).length) {
    notFound++;
    console.log(`  [SKIP] ${team.name} — no match in old file`);
    continue;
  }

  team.roster = match.roster;
  restored++;
  const mains = match.roster.filter(m => m.status === 'main').map(m => m.name).join(', ');
  console.log(`  [OK]   ${team.name} — restored ${match.roster.length} members (main: ${mains})`);
}

current.teams = keptTeams;
current.updatedAt = new Date().toISOString();

fs.writeFileSync(CURRENT_PATH, JSON.stringify(current, null, 2));

console.log('');
console.log(`=== Summary ===`);
console.log(`Rosters restored: ${restored}`);
console.log(`Rosters still empty (not found in old): ${notFound}`);
console.log(`League umbrellas dropped: ${droppedUmbrellas}`);
console.log(`Total teams after fix: ${current.teams.length}`);
