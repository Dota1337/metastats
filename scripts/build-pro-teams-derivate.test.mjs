/**
 * Verhaltens-Test für scripts/build-pro-teams-derivate.mjs.
 *
 * Zweck: die Derivate liefern exakt dieselben Zahlen, die app/teams/page.tsx
 * heute clientseitig aus der SoT rechnet. Der Test rechnet die UI-Formeln
 * unabhängig nach (unten `uiSeasonYears` / `uiSeasonPrize`, gespiegelt von
 * app/teams/page.tsx:49-64) und vergleicht sie gegen die Projektion.
 *
 * Läuft in `npm test` und damit im pre-push-Gate. Datenform-Prüfungen liegen
 * bewusst HIER und nicht im Build-Script: ein schlechter Crawl-Lauf darf nicht
 * jeden unbeteiligten Deploy blockieren.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  KNOWN_TEAM_KEYS,
  SOT_PATH,
  buildDerivate,
  collectSeasons,
  toListingEntry,
} from './build-pro-teams-derivate.mjs';

const sot = existsSync(SOT_PATH) ? JSON.parse(readFileSync(SOT_PATH, 'utf8')) : null;
const hasSot = sot !== null;

// --- Spiegel der heutigen UI-Formeln (app/teams/page.tsx:49-64) -------------
function uiSeasonYears(teams) {
  const years = new Set();
  for (const t of teams) {
    for (const r of t.results || []) {
      if (r.date) years.add(r.date.slice(0, 4));
    }
  }
  return Array.from(years).sort((a, b) => b.localeCompare(a));
}

function uiSeasonPrize(team, season) {
  return (team.results || [])
    .filter(r => r.date?.startsWith(season))
    .reduce((s, r) => s + (r.prizeUSD || 0), 0);
}

// --- Fixtures --------------------------------------------------------------
function fixtureTeam(over = {}) {
  return {
    id: 'team-a', name: 'Team A', short: 'TA', region: 'Europe', logo: null,
    roster: [], results: [], trophies: [], totalPrizeMoney: 0,
    rosterSource: 'test',
    ...over,
  };
}

test('Duplikat-IDs brechen den Build', () => {
  const sotFixture = {
    updatedAt: '2026-01-01T00:00:00.000Z',
    teams: [fixtureTeam({ id: 'team-x' }), fixtureTeam({ id: 'Team-X', name: 'Team X' })],
  };
  assert.throws(() => buildDerivate(sotFixture), /Doppelte Team-ID/);
});

test('unsichere Team-ID bricht den Build', () => {
  for (const id of ['../etc/passwd', 'a/b', '', null]) {
    assert.throws(() => buildDerivate({ teams: [fixtureTeam({ id })] }), /Unsichere oder fehlende Team-ID/);
  }
});

test('leere SoT bricht den Build', () => {
  assert.throws(() => buildDerivate({ teams: [] }), /keine Teams/);
});

test('Preisgeld ohne Datum landet in keinem Jahr, bleibt aber in der Gesamtsumme', () => {
  const team = fixtureTeam({
    results: [
      { event: 'A', place: 1, date: '2025-03-01', prizeUSD: 1000, trophy: 'gold' },
      { event: 'B', place: 2, date: '', prizeUSD: 500, trophy: null },
    ],
    trophies: [{ event: 'A', place: '1', trophy: 'gold', date: '2025-03-01' }],
    totalPrizeMoney: 1500,
  });
  const entry = toListingEntry(team);
  assert.deepEqual(entry.prizeByYear, { 2025: 1000 });
  assert.equal(entry.totalPrizeMoney, 1500);
  assert.equal(entry.prizeByYear['2025'], uiSeasonPrize(team, '2025'));
  assert.equal(collectSeasons([team]).length, 1);
});

test('trophyTotal folgt trophies.length, nicht der Farbsumme', () => {
  const entry = toListingEntry(fixtureTeam({
    trophies: [
      { trophy: 'gold' }, { trophy: 'silver' }, { trophy: 'bronze' },
      { trophy: 'platinum' }, // hypothetische vierte Art
      { trophy: null },
    ],
  }));
  assert.equal(entry.trophyTotal, 5);
  assert.equal(entry.trophyCounts.gold + entry.trophyCounts.silver + entry.trophyCounts.bronze, 3);
});

// --- Gegen die echte SoT ---------------------------------------------------
test('SoT liegt vor', { skip: hasSot ? false : 'public/pro-teams.json fehlt' }, () => {
  assert.ok(sot.teams.length > 0);
});

test('keine unbekannten Top-Level-Felder in der SoT', { skip: hasSot ? false : 'SoT fehlt' }, () => {
  const unknown = new Set();
  for (const team of sot.teams) {
    for (const key of Object.keys(team)) {
      if (!KNOWN_TEAM_KEYS.includes(key)) unknown.add(key);
    }
  }
  assert.deepEqual(
    [...unknown], [],
    'Neues SoT-Feld: bewusst entscheiden, ob es ins Listing/Detail gehoert, dann KNOWN_TEAM_KEYS erweitern.'
  );
});

test('Derivat-Zahlen sind identisch zur heutigen UI-Rechnung', { skip: hasSot ? false : 'SoT fehlt' }, () => {
  const { listing, index, details } = buildDerivate(sot);

  assert.equal(listing.teams.length, sot.teams.length);
  assert.equal(index.teams.length, sot.teams.length);
  assert.equal(details.size, sot.teams.length);
  assert.equal(listing.updatedAt, sot.updatedAt, 'updatedAt muss durchgereicht werden (Vertrags-Semantik)');
  assert.deepEqual(listing.seasons, uiSeasonYears(sot.teams));

  const byId = new Map(sot.teams.map(t => [t.id, t]));
  for (const entry of listing.teams) {
    const team = byId.get(entry.id);
    for (const [key, value] of Object.entries(entry)) {
      assert.notEqual(value, undefined, `${entry.id}.${key} ist undefined`);
    }
    assert.equal(entry.trophyTotal, (team.trophies || []).length);
    assert.equal(entry.rosterCount, (team.roster || []).length);
    assert.equal(entry.playerCount + entry.staffCount, entry.rosterCount);
    assert.equal(entry.totalPrizeMoney, team.totalPrizeMoney || 0);

    // Bilanz: Jahres-Summen + undatierte Preise == Gesamtsumme.
    const undated = (team.results || [])
      .filter(r => !r.date)
      .reduce((s, r) => s + (r.prizeUSD || 0), 0);
    const byYear = Object.values(entry.prizeByYear).reduce((s, v) => s + v, 0);
    assert.equal(byYear + undated, (team.results || []).reduce((s, r) => s + (r.prizeUSD || 0), 0));

    for (const season of Object.keys(entry.prizeByYear)) {
      assert.equal(entry.prizeByYear[season], uiSeasonPrize(team, season));
    }
  }
});

test('aggregierte Kennzahlen der Listing-Seite stimmen', { skip: hasSot ? false : 'SoT fehlt' }, () => {
  const { listing } = buildDerivate(sot);
  const sotWithRoster = sot.teams.filter(t => (t.roster || []).length > 0).length;
  const sotWithTitles = sot.teams.filter(t => (t.trophies || []).length > 0).length;
  const sotPrize = sot.teams.reduce((s, t) => s + (t.totalPrizeMoney || 0), 0);

  assert.equal(listing.teams.filter(t => t.rosterCount > 0).length, sotWithRoster);
  assert.equal(listing.teams.filter(t => t.trophyTotal > 0).length, sotWithTitles);
  assert.equal(listing.teams.reduce((s, t) => s + t.totalPrizeMoney, 0), sotPrize);
});
