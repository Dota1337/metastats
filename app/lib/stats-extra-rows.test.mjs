// Zusatzzeilen der Spielerseite (08.11.2026): Werte, die Riot nur in manchen Spielen
// liefert. Fehlende Felder duerfen nie als 0 zaehlen, unter 10 Spielen mit Wert keine
// Zeile, und die Zusatzzeilen veraendern keinen Punktwert.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processParticipant } from './match-processor.ts';
import { calculateStatsOverview } from './stats-categories.ts';

const ctx = (i) => ({
  matchId: `EUW1_${i}`, gameMode: 'CLASSIC', queueId: 420, gameCreation: 1_760_000_000_000 + i * 3_600_000,
  gameDuration: 1800, teamKills: 25, teamDamage: 90000, teamGold: 60000,
});
const game = (i, pos, challenges) => processParticipant(
  { individualPosition: pos, teamPosition: pos, win: i % 2 === 0, kills: 5, deaths: 4, assists: 7, challenges },
  ctx(i),
);
const detail = (overview, cat, name) =>
  overview.categories.find((c) => c.id === cat)?.details.find((d) => d.name === name);

test('processParticipant: fehlendes Feld bleibt undefined, 0 bleibt 0', () => {
  const m = game(1, 'MIDDLE', { skillshotsHit: 0, enemyChampionImmobilizations: 4 });
  assert.equal(m.extra.skillshotsHit, 0);
  assert.equal(m.extra.enemyChampionImmobilizations, 4);
  assert.equal(m.extra.earliestDragonTakedown, undefined);
  assert.equal(m.extra.junglerKillsEarlyJungle, undefined);
  assert.equal(m.extra.teamBaronKills, undefined);
});

test('Jungle-Zeilen nur aus Spielen, in denen Riot den Jungler fuehrt; Zeit als m:ss', () => {
  const jungle = Array.from({ length: 12 }, (_, i) => game(i, 'JUNGLE', {
    teamBaronKills: i < 6 ? 1 : 0, earliestDragonTakedown: 600 + i * 10, junglerKillsEarlyJungle: i < 3 ? 1 : 0,
    initialCrabCount: 1, skillshotsHit: i < 2 ? 0 : 30, enemyChampionImmobilizations: i < 4 ? 0 : 12,
  }));
  // Jungle laut individualPosition, aber Riot fuehrt eine andere Position: kein junglerKillsEarlyJungle.
  const notRiotJungle = Array.from({ length: 5 }, (_, i) => game(100 + i, 'JUNGLE', {
    teamBaronKills: 0, earliestDragonTakedown: 3000, initialCrabCount: 0,
  }));
  const o = calculateStatsOverview([...jungle, ...notRiotJungle], null);
  assert.deepEqual(detail(o, 'objective_control', 'Zeit bis 1. Drache (JGL)'), {
    name: 'Zeit bis 1. Drache (JGL)', value: '10:55', unit: '',
    description: 'Ø Zeit bis zur ersten eigenen Drachen-Beteiligung, nur Jungle-Spiele',
  });
  assert.equal(detail(o, 'early_game', 'Jungler-Kills vor 10 Min').value, 0.25);
  assert.equal(detail(o, 'early_game', 'Erste Krabben').value, 1);
  // Baron-Quote ueber alle 17 Spiele mit Feld: 6 von 17.
  assert.equal(detail(o, 'objective_control', 'Baron-Quote Team').value, 35);
  // Skillshots: Spiele mit 0 Treffern zaehlen nicht (Champion ohne gezaehlte Skillshots).
  assert.equal(detail(o, 'mechanics', 'Skillshots getroffen').value, 30);
  // CC: 0 ist ein echter Wert, Spiele ohne Feld zaehlen nicht (8×12 / 12).
  assert.equal(detail(o, 'teamplay', 'CC auf Gegner').value, 8);
});

test('unter 10 Spielen mit Wert keine Zeile; Punktwerte unveraendert', () => {
  const few = Array.from({ length: 9 }, (_, i) => game(i, 'JUNGLE', {
    teamBaronKills: 1, earliestDragonTakedown: 700, junglerKillsEarlyJungle: 1, initialCrabCount: 2,
    skillshotsHit: 25, enemyChampionImmobilizations: 9,
  }));
  const without = few.map((m) => ({ ...m, extra: undefined }));
  const a = calculateStatsOverview(few, null);
  const b = calculateStatsOverview(without, null);
  for (const [cat, name] of [
    ['objective_control', 'Baron-Quote Team'], ['objective_control', 'Zeit bis 1. Drache (JGL)'],
    ['early_game', 'Jungler-Kills vor 10 Min'], ['early_game', 'Erste Krabben'],
    ['mechanics', 'Skillshots getroffen'], ['teamplay', 'CC auf Gegner'],
  ]) assert.equal(detail(a, cat, name), undefined, `${cat}/${name}`);
  assert.deepEqual(a.categories.map((c) => c.score), b.categories.map((c) => c.score));
  assert.equal(a.overallScore, b.overallScore);
});
