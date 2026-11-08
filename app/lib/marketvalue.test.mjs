import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateMarketValue, marketValueGames, MV_FORMULA_REV } from './marketvalue.ts';

const RANKED = { tier: 'GRANDMASTER', rank: 'I', leaguePoints: 400, wins: 100, losses: 100 };

// Typisches Support-Spiel (30 min): wenig Farm, wenig Schaden, viel Sicht.
const supportGame = (over = {}) => ({
  kills: 2, deaths: 5, assists: 14, win: true, gameDuration: 1800, cs: 40, role: 'UTILITY',
  damageDealt: 9000, visionScore: 70, wardsPlaced: 30, firstBloodKill: false, firstBloodAssist: false,
  dragonKills: 0, baronKills: 0, turretKills: 0, gameWonFromBehind: false, surrendered: false,
  teamKills: 25, teamDamage: 80000, totalDamageTaken: 15000, goldEarned: 8000, teamGold: 60000,
  controlWardsPlaced: 6, wardsKilled: 6, totalHealsOnTeammates: 2000, totalDamageShieldedOnTeammates: 1500,
  timeCCingOthers: 30, ...over,
});
const games = (n, over) => Array.from({ length: n }, (_, i) => supportGame({ win: i % 2 === 0, ...over }));
const labels = (r) => r.breakdown.map((b) => b.label);
const impact = (r, label) => r.breakdown.find((b) => b.label === label)?.impact;

test('UTILITY laeuft durch den Support-Zweig, nicht durch den Schuetzen-Zweig', () => {
  const r = calculateMarketValue(RANKED, games(20));
  assert.equal(r.role, 'UTILITY');
  for (const l of ['Assists/Spiel', 'Vision Score', 'Wards/Spiel', 'CC Score', 'Vision/Min', 'Vision Dominanz']) {
    assert.ok(labels(r).includes(l), `fehlt: ${l}`);
  }
  for (const l of ['CS/Min', 'Schaden/Min', 'Kiting Effizienz', 'Damage Share', 'Gold Share']) {
    assert.ok(!labels(r).includes(l), `Schuetzen-Faktor bei Support: ${l}`);
  }
});

test('geeichte Boni (08.11.2026), Grenzen und Strafen unveraendert', () => {
  const mid = calculateMarketValue(RANKED, games(20));
  assert.equal(impact(mid, 'Assists/Spiel'), 0.07);       // 14 > 12
  assert.equal(impact(mid, 'Vision Score'), 0.12);        // 70 > 45
  assert.equal(impact(mid, 'Wards/Spiel'), 0.07);         // 30 > 25
  assert.equal(impact(mid, 'CC Score'), 0.03);            // 30 > 25
  assert.equal(impact(mid, 'Vision/Min'), 0.04);          // 70/30 > 1,5
  assert.equal(impact(mid, 'Vision Dominanz'), 0.04);
  const top = calculateMarketValue(RANKED, games(20, { assists: 20, timeCCingOthers: 45, totalHealsOnTeammates: 14000, totalDamageShieldedOnTeammates: 2000, dragonKills: 1 }));
  assert.equal(impact(top, 'Assists/Spiel'), 0.12);
  assert.equal(impact(top, 'CC Score'), 0.06);
  assert.equal(impact(top, 'Heal/Shield pro Min'), 0.07);  // 16000/30 > 500
  assert.equal(impact(top, 'Dragon+Baron'), 0.07);
  const weak = calculateMarketValue(RANKED, games(20, { assists: 4, visionScore: 8, wardsPlaced: 5 }));
  assert.equal(impact(weak, 'Assists/Spiel'), -0.10);
  assert.equal(impact(weak, 'Vision Score'), -0.10);
  assert.equal(impact(weak, 'Wards/Spiel'), -0.05);
});

test('andere Rollen rechnen unveraendert (Schuetze)', () => {
  const adc = calculateMarketValue(RANKED, games(20, { role: 'BOTTOM', cs: 270, damageDealt: 30000, assists: 6, kills: 8 }));
  assert.equal(adc.role, 'BOTTOM');
  assert.equal(impact(adc, 'CS/Min'), 0.10);              // 9,0 > 8
  assert.equal(impact(adc, 'Schaden/Min'), 0.175);        // 1000 > 950
  assert.ok(!labels(adc).includes('Assists/Spiel'));
});

test('Rechnungsstand 2 fuer alle Rollen', () => {
  assert.equal(MV_FORMULA_REV, 2);
});

test('Remakes und Autofill-Spiele zaehlen nicht, FILL und fehlende Angabe schon', () => {
  const base = games(20);
  const remakes = games(5, { gameEndedInEarlySurrender: true, assists: 0, visionScore: 0, wardsPlaced: 0 });
  const autofill = games(5, { roleAssignment: 'AUTOFILL', role: 'TOP', assists: 0, visionScore: 0 });
  const withNoise = calculateMarketValue(RANKED, [...base, ...remakes, ...autofill]);
  const clean = calculateMarketValue(RANKED, base);
  assert.equal(withNoise.stats.gamesAnalyzed, 20);
  assert.equal(withNoise.value, clean.value);
  assert.equal(withNoise.role, 'UTILITY');

  const fill = calculateMarketValue(RANKED, [...base, ...games(4, { roleAssignment: 'FILL' }), ...games(3, { roleAssignment: null })]);
  assert.equal(fill.stats.gamesAnalyzed, 27);

  assert.deepEqual(marketValueGames([{ gameEndedInEarlySurrender: false, roleAssignment: 'PRIMARY' }]).length, 1);
  assert.equal(marketValueGames([{ gameEndedInEarlySurrender: true }, { roleAssignment: 'AUTOFILL' }]).length, 0);
});

test('nur Remakes/Autofill: kein Wert-Ausfall, aber 0 gezaehlte Spiele', () => {
  const r = calculateMarketValue(RANKED, games(12, { roleAssignment: 'AUTOFILL' }));
  assert.equal(r.stats.gamesAnalyzed, 0);
});
