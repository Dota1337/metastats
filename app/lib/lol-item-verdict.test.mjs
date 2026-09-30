import test from 'node:test';
import assert from 'node:assert/strict';
import { itemVerdict } from './lol-item-verdict.ts';

// Hilfen: eine Schicht mit n Spielen und Winrate p.
const s = (stratum, games, p) => ({ stratum, games, wins: Math.round(games * p) });

test('zu wenig Spiele -> kein Urteil', () => {
  const r = itemVerdict([s(6, 150, 0.5)], [s(6, 50, 0.6)]);
  assert.equal(r.verdict, null);
});

test('klarer Vorteil in jeder Schicht -> wichtig', () => {
  const totals = [s(6, 2000, 0.5), s(9, 2000, 0.5), s(12, 2000, 0.5)];
  const withIt = [s(6, 400, 0.58), s(9, 400, 0.58), s(12, 400, 0.58)];
  const r = itemVerdict(totals, withIt);
  assert.equal(r.verdict, 'important');
  assert.ok(r.delta > 0.08 && r.delta < 0.12, `delta ${r.delta}`);
  assert.ok(r.low > 0);
});

test('klarer Nachteil -> schwach', () => {
  const totals = [s(6, 3000, 0.5), s(9, 3000, 0.5)];
  const withIt = [s(6, 500, 0.44), s(9, 500, 0.44)];
  assert.equal(itemVerdict(totals, withIt).verdict, 'weak');
});

test('Effekt signifikant, aber unter 1,5 Punkten -> optional', () => {
  const totals = [s(6, 400000, 0.5)];
  const withIt = [s(6, 100000, 0.508)];
  const r = itemVerdict(totals, withIt);
  assert.ok(r.low > 0, 'Intervall schliesst 0 aus');
  assert.equal(r.verdict, 'optional');
});

test('Schichtung entfernt den Spiellaengen-Effekt', () => {
  // Item wird nur in langen Spielen (viele Items) gekauft, die haeufiger
  // gewonnen werden. Innerhalb jeder Schicht ist die Winrate gleich.
  const totals = [s(3, 3000, 0.45), s(15, 3000, 0.6)];
  const withIt = [s(3, 100, 0.45), s(15, 1500, 0.6)];
  const r = itemVerdict(totals, withIt);
  assert.equal(r.verdict, 'optional');
  assert.ok(Math.abs(r.delta) < 0.01, `delta ${r.delta}`);
});

test('Kaufrate >= 60 % bei >= 3 fertigen Items -> Kern', () => {
  const totals = [s(6, 1000, 0.5), s(9, 1000, 0.5), s(0, 500, 0.4)];
  const withIt = [s(6, 700, 0.5), s(9, 800, 0.5)];
  const r = itemVerdict(totals, withIt);
  assert.equal(r.verdict, 'core');
  assert.ok(r.buyRate3 >= 0.6);
});

test('Schicht ohne fertige Items (-1) zaehlt nicht mit', () => {
  const r = itemVerdict([s(-1, 5000, 0.3), s(6, 50, 0.5)], [s(6, 10, 0.5)]);
  assert.equal(r.withoutGames, 40);
  assert.equal(r.verdict, null);
});
