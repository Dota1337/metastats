/**
 * Comp-Duelle (tft-comp-matchups.ts) und ihr Zuschnitt fuer die App.
 *
 * Geprueft werden die Schwellen, an denen eine Gegnerliste sonst Zufall als
 * Befund zeigen wuerde, und dass eigene Familien nie als Gegner auftauchen.
 *
 * Lauf: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MATCHUP_MIN_N, duelOf, familyParts, familyRepresentatives, matchupNoise, matchupVerdict, opponentsOf,
  remapMatchupRows, splitOpponents,
} from './tft-comp-matchups.ts';
import { buildCompanionVsFromMatchups } from './companion-api.ts';

test('matchupVerdict: Mindestzahl, klarer Abstand, ausgeglichen, unklar', () => {
  assert.equal(MATCHUP_MIN_N, 100);
  assert.equal(matchupVerdict(99, 0.9), null);
  // n = 100: Unsicherheit 0,098 → 60 % ist klar vorn, 59 % nicht.
  assert.equal(matchupVerdict(100, 0.6), 'ahead');
  assert.equal(matchupVerdict(100, 0.59), 'unclear');
  assert.equal(matchupVerdict(100, 0.4), 'behind');
  // Viele Vergleiche: 52 % liegt sicher im 5-Punkte-Band → ausgeglichen.
  assert.equal(matchupVerdict(10_000, 0.52), 'even');
  // 5 Punkte Mindestabstand gelten auch bei sehr vielen Vergleichen.
  assert.equal(matchupVerdict(10_000, 0.545), 'unclear');
  assert.equal(matchupVerdict(10_000, 0.56), 'ahead');
  // 53 % bei 400: Unsicherheit 0,049 → weder klar noch sicher ausgeglichen.
  assert.equal(matchupVerdict(400, 0.53), 'unclear');
  assert.ok(Math.abs(matchupNoise(400) - 0.049) < 1e-9);
});

test('opponentsOf: summiert ueber eigene Familien, eigene und ausgeschlossene nie als Gegner', () => {
  const rows = [
    ['A__1', 'B__x', 60, 36],
    ['A__2', 'B__x', 40, 20],
    ['A__1', 'A__2', 500, 250],   // gleiche Comp (Zwei-Carry-Familie)
    ['A__1', 'C__y', 120, 30],
    ['B__x', 'A__1', 60, 24],     // Gegenrichtung: gehoert B, nicht A
    ['A__2', 'D__z', 200, 150],
  ];
  const edges = opponentsOf(rows, ['A__1', 'A__2'], ['D__z']);
  const byFam = Object.fromEntries(edges.map(e => [e.fam, e]));
  assert.deepEqual(Object.keys(byFam).sort(), ['B__x', 'C__y']);
  assert.equal(byFam['B__x'].games, 100);
  assert.equal(byFam['B__x'].rate, 0.56);
  assert.equal(byFam['B__x'].verdict, 'unclear');
  assert.equal(byFam['C__y'].verdict, 'behind');
});

test('duelOf: nur Zeilen von A gegen B, Familien in beiden Seiten zaehlen nicht', () => {
  const rows = [
    ['A__1', 'B__x', 300, 200],
    ['A__2', 'B__x', 100, 60],
    ['B__x', 'A__1', 300, 100],
    ['S__s', 'B__x', 50, 50],     // S gehoert zu A und B
    ['A__1', 'S__s', 50, 0],
  ];
  const d = duelOf(rows, ['A__1', 'A__2', 'S__s'], ['B__x', 'S__s']);
  assert.equal(d.games, 400);
  assert.equal(d.aAhead, 260);
  assert.equal(d.rate, 0.65);
  assert.equal(d.verdict, 'ahead');
  assert.equal(duelOf([], ['A__1'], ['B__x']).verdict, null);
});

test('splitOpponents: sichere Befunde zuerst, Grenze je Liste', () => {
  const edges = [
    { fam: 'P__1', games: 100, rate: 0.62, verdict: 'ahead' },    // 0,12 − 0,098
    { fam: 'P__2', games: 2500, rate: 0.58, verdict: 'ahead' },   // 0,08 − 0,0196
    { fam: 'P__3', games: 900, rate: 0.40, verdict: 'behind' },
    { fam: 'P__4', games: 5000, rate: 0.51, verdict: 'even' },
    { fam: 'P__5', games: 8000, rate: 0.49, verdict: 'even' },
    { fam: 'P__6', games: 150, rate: 0.55, verdict: 'unclear' },
  ];
  const s = splitOpponents(edges, 1);
  assert.deepEqual(s.strong.map(e => e.fam), ['P__2']);
  assert.deepEqual(s.weak.map(e => e.fam), ['P__3']);
  assert.deepEqual(s.even.map(e => e.fam), ['P__5']);
  assert.equal(splitOpponents(edges).strong.length, 2);
});

test('familyParts und familyRepresentatives', () => {
  assert.deepEqual(familyParts('TFT18_Star_Mountain__TFT18_Lulu'), { trait: 'TFT18_Star_Mountain', carry: 'TFT18_Lulu' });
  assert.equal(familyParts('kaputt'), null);
  const reps = familyRepresentatives([
    { clusterKey: 'T@6_C', games: 100 },
    { clusterKey: 'T@8_C*3', games: 300 },
    { clusterKey: 'U@4_D', games: 50 },
    { clusterKey: null, games: 999 },
  ]);
  assert.deepEqual(reps.get('T__C'), { key: 'T@8_C*3', games: 300 });
  assert.equal(reps.get('U__D').key, 'U@4_D');
  assert.equal(reps.size, 2);
});

test('buildCompanionVsFromMatchups: Familien auf Comps, beide Richtungen getrennt, nur klare Matchups', () => {
  const comps = [
    { key: 'X__a', members: ['X__a', 'X__b'] },
    { key: 'Y__c', members: ['Y__c'] },
    { key: 'Z__d' },
  ];
  const rows = [
    ['X__a', 'Y__c', 150, 100],
    ['X__b', 'Y__c', 50, 30],
    ['Y__c', 'X__a', 150, 50],
    ['Y__c', 'X__b', 50, 20],
    ['X__a', 'X__b', 400, 200],   // innerhalb derselben Comp
    ['X__a', 'Z__d', 120, 62],    // 52 % bei 120: unklar → fehlt
    ['X__a', 'Q__q', 500, 400],   // Q nicht in der Liste
  ];
  const vs = buildCompanionVsFromMatchups(comps, rows);
  assert.deepEqual(vs, {
    X__a: { Y__c: [200, 0.65] },
    Y__c: { X__a: [200, 0.35] },
  });
});

test('remapMatchupRows: auf Comps umgelegt, summiert, ohne Ziel und innerhalb derselben Comp raus', () => {
  const comp = { A__x: 'C1', B__y: 'C1', D__z: 'C2', E__w: 'C2' };
  const rows = [
    ['A__x', 'D__z', 100, 60],
    ['B__y', 'E__w', 50, 20],
    ['A__x', 'B__y', 80, 40],   // gleiche Comp
    ['A__x', 'H__q', 30, 10],   // Gegner ohne Comp
    ['D__z', 'A__x', 100, 40],
  ];
  const out = remapMatchupRows(rows, f => comp[f]);
  assert.deepEqual(out.sort((a, b) => a[0].localeCompare(b[0])), [['C1', 'C2', 150, 80], ['C2', 'C1', 100, 40]]);
  const opp = opponentsOf(out, ['C1']);
  assert.equal(opp.length, 1);
  assert.equal(opp[0].fam, 'C2');
  assert.equal(opp[0].games, 150);
});
