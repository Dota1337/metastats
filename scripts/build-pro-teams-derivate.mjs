#!/usr/bin/env node
/**
 * Erzeugt aus public/pro-teams.json (SoT, ~2,9 MB) drei zugeschnittene
 * Derivate für die Client-Seiten:
 *
 *   public/pro-teams/listing.json      → /teams        (~190 KB roh)
 *   public/pro-teams/index.json        → /ligen, homepage-stats (~33 KB roh)
 *   public/pro-teams/teams/<id>.json   → /teams/[id]   (median ~3,6 KB roh)
 *
 * NICHT COMMITTEN. Das ist das erste build-generierte Artefakt unter public/
 * (alle anderen 47 Files dort sind getrackt) — bewusst so: zehn Scripts
 * mutieren die SoT, jedes wäre bei committeten Derivaten ein eigener
 * Drift-Vektor, und der Wochen-Workflow müsste 500+ Dateien pro Lauf
 * mitcommitten. Die Derivate stehen deshalb in .gitignore und entstehen im
 * gleichen Deployment wie die SoT, aus der sie stammen (Verdrahtung: das
 * `build`-Script in package.json ruft dieses Script explizit VOR `next build`
 * auf — kein npm-`prebuild`-Hook, damit ein im Vercel-Dashboard überschriebenes
 * Build-Command die Generierung nicht stumm ausfallen lässt).
 *
 * Preis dieser Entscheidung: die pre-push-Frische-Gates (wie bei
 * infra/system-map.json) greifen hier strukturell nicht. Einziges Gate gegen
 * „SoT frisch, Derivat nie gebaut" ist der Laufzeit-Vertrag
 * `pro-teams/derivat-frische` in infra/contracts.json — der prüft das
 * durchgereichte SoT-`updatedAt` am ausgelieferten Endpoint.
 *
 * Harte Abbrüche hier: nur was deterministisch ein Fehler dieses Scripts oder
 * eine kaputte SoT ist (fehlend/leer, Team-Anzahl-Mismatch, Duplikat-ID).
 * Datenform-Prüfungen (unbekannte Felder, Preisgeld-Bilanz) laufen in
 * scripts/build-pro-teams-derivate.test.mjs, damit ein schlechter Crawl-Lauf
 * nicht jeden unbeteiligten Hotfix-Deploy blockiert.
 *
 * Multi-Review 2026-08-17 (metastats-architect + metastats-perf-critic),
 * Memory: reference_pro_teams_derivate_pipeline.md.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
export const SOT_PATH = resolve(ROOT, 'public/pro-teams.json');
export const OUT_DIR = resolve(ROOT, 'public/pro-teams');

/**
 * Top-Level-Felder, die ein Team in der SoT heute hat. Der Test failt, wenn ein
 * neues dazukommt — dann ist zu entscheiden, ob es ins Listing/Detail gehört,
 * statt es stillschweigend zu verlieren.
 */
export const KNOWN_TEAM_KEYS = [
  'id', 'logo', 'name', 'region', 'results', 'roster',
  'rosterSource', 'short', 'totalPrizeMoney', 'trophies',
];

const SAFE_ID = /^[A-Za-z0-9._-]+$/;

/** Jahr aus einem ISO-Datum. Ohne Datum: null — solche Ergebnisse zählen in KEIN Jahr. */
function yearOf(dateStr) {
  return typeof dateStr === 'string' && dateStr.length >= 4 ? dateStr.slice(0, 4) : null;
}

/**
 * Ein Listing-Eintrag. Feldmenge deckt exakt ab, was app/teams/page.tsx heute
 * aus der SoT rechnet: Roster-Splits, Trophäen-Zählung, Gesamt- und
 * Jahres-Preisgeld.
 */
export function toListingEntry(team) {
  const roster = Array.isArray(team.roster) ? team.roster : [];
  const trophies = Array.isArray(team.trophies) ? team.trophies : [];
  const results = Array.isArray(team.results) ? team.results : [];

  const trophyCounts = { gold: 0, silver: 0, bronze: 0 };
  for (const tr of trophies) {
    if (tr.trophy && Object.hasOwn(trophyCounts, tr.trophy)) trophyCounts[tr.trophy] += 1;
  }

  // Nur datierte Ergebnisse. Preisgeld ohne Datum ist heute in keinem
  // Jahres-Filter sichtbar (getSeasonPrize filtert per date.startsWith), steckt
  // aber in totalPrizeMoney — genau so nachbauen, sonst springt eine Zahl.
  const prizeByYear = {};
  for (const r of results) {
    const y = yearOf(r.date);
    if (!y) continue;
    prizeByYear[y] = (prizeByYear[y] || 0) + (r.prizeUSD || 0);
  }

  return {
    id: team.id,
    name: team.name,
    short: team.short,
    region: team.region,
    logo: team.logo ?? null,
    rosterCount: roster.length,
    playerCount: roster.filter(m => m.isPlayer).length,
    staffCount: roster.filter(m => !m.isPlayer).length,
    // Eigenes Feld, NICHT die Summe der drei Farben: eine vierte Trophäen-Art
    // aus Leaguepedia würde die Summe stumm unter trophies.length fallen lassen.
    trophyTotal: trophies.length,
    trophyCounts,
    totalPrizeMoney: team.totalPrizeMoney || 0,
    prizeByYear,
  };
}

/**
 * Alle Jahre, in denen irgendein Team ein datiertes Ergebnis hat — auch Jahre
 * ohne Preisgeld. Entspricht getSeasonYears() in app/teams/page.tsx; würde man
 * hier über prizeByYear gehen, verschwänden Einträge aus dem Dropdown.
 */
export function collectSeasons(teams) {
  const years = new Set();
  for (const team of teams) {
    for (const r of team.results || []) {
      const y = yearOf(r.date);
      if (y) years.add(y);
    }
  }
  return Array.from(years).sort((a, b) => b.localeCompare(a));
}

/**
 * Reine Projektion — schreibt nichts. Wirft bei allem, was ein Bug hier oder
 * eine kaputte SoT ist.
 */
export function buildDerivate(sot) {
  const teams = Array.isArray(sot?.teams) ? sot.teams : [];
  if (teams.length === 0) throw new Error('SoT enthaelt keine Teams');

  const seen = new Map();
  for (const team of teams) {
    const id = team?.id;
    if (typeof id !== 'string' || !SAFE_ID.test(id)) {
      throw new Error(`Unsichere oder fehlende Team-ID: ${JSON.stringify(id)}`);
    }
    // Der eigentliche Risikofall: zwei Teams, deren Name auf dieselbe ID
    // slugifiziert ("Team X" / "Team-X"). Die zweite Detail-Datei würde die
    // erste überschreiben, ohne dass die Anzahl-Prüfung anschlägt.
    const key = id.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`Doppelte Team-ID "${id}" (kollidiert mit "${seen.get(key)}")`);
    }
    seen.set(key, id);
  }

  const updatedAt = sot.updatedAt ?? null;
  const totalTeams = teams.length;

  const listing = {
    updatedAt,
    totalTeams,
    seasons: collectSeasons(teams),
    teams: teams.map(toListingEntry),
  };

  const index = {
    updatedAt,
    totalTeams,
    teams: teams.map(t => ({ id: t.id, name: t.name, short: t.short })),
  };

  const details = new Map(teams.map(t => [t.id, t]));

  if (listing.teams.length !== totalTeams || index.teams.length !== totalTeams || details.size !== totalTeams) {
    throw new Error(
      `Anzahl-Mismatch: SoT ${totalTeams}, Listing ${listing.teams.length}, ` +
      `Index ${index.teams.length}, Detail ${details.size}`
    );
  }

  return { listing, index, details };
}

function main() {
  if (!existsSync(SOT_PATH)) {
    console.error(`[pro-teams-derivate] SoT fehlt: ${SOT_PATH}`);
    process.exit(1);
  }

  const started = Date.now();
  const sot = JSON.parse(readFileSync(SOT_PATH, 'utf8'));
  const { listing, index, details } = buildDerivate(sot);

  // Verzeichnis komplett neu aufbauen, damit Detail-Dateien gelöschter Teams
  // nicht als Geister im Build-Output liegen bleiben.
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(resolve(OUT_DIR, 'teams'), { recursive: true });

  writeFileSync(resolve(OUT_DIR, 'listing.json'), JSON.stringify(listing));
  writeFileSync(resolve(OUT_DIR, 'index.json'), JSON.stringify(index));
  for (const [id, team] of details) {
    writeFileSync(resolve(OUT_DIR, 'teams', `${id}.json`), JSON.stringify(team));
  }

  console.log(
    `[pro-teams-derivate] ${details.size} Teams, ${listing.seasons.length} Saisons, ` +
    `SoT updatedAt=${listing.updatedAt} — ${Date.now() - started} ms`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
