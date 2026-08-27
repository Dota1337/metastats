/**
 * Cutoffs je Entitaetsklasse. Gemessen am 27.08.2026 (euw1+na1+kr, 7 Tage):
 * mit einem globalen Cutoff-Set trugen 51 % der Items und 53 % der Comps ein
 * S. Die Klassen-Bloecke in public/tft-tier-cutoffs.json korrigieren das —
 * diese Tests halten fest, dass der Resolver sie auch anwendet und dass ein
 * fehlender Block weiterhin auf scoreCutoffs zurueckfaellt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveCutoffs, tierLetterOfSync, tierScore } from './tft-tier-letter.ts';

const BUNDLE = JSON.parse(readFileSync(new URL('../../public/tft-tier-cutoffs.json', import.meta.url), 'utf8'));

test('Set-18-Block wird je Klasse aufgeloest, der Rest kommt aus default', () => {
  const c = resolveCutoffs(BUNDLE, 18);
  assert.equal(c.scoreCutoffsByKind.items.S, 0.65);
  assert.equal(c.scoreCutoffsByKind.units.S, 0.64);
  assert.equal(c.pickratePenalty, BUNDLE.default.pickratePenalty);
  assert.deepEqual(c.minGames, BUNDLE.default.minGames);
});

test('ohne Set-Block bleibt es beim globalen scoreCutoffs', () => {
  const c = resolveCutoffs(BUNDLE, 17);
  assert.equal(c.scoreCutoffsByKind, undefined);
  assert.deepEqual(c.scoreCutoffs, BUNDLE.default.scoreCutoffs);
});

test('derselbe Score wird je Klasse verschieden benotet', () => {
  const c = resolveCutoffs(BUNDLE, 18);
  // Score 0.30: klar ueber dem Units-A (0.06), aber unter dem Items-B (0.36).
  const row = { avgPlacement: 4.5 - 0.30, pickRate: 0.005, games: 100000 };
  assert.equal(tierScore(row.avgPlacement, row.pickRate, c).toFixed(2), '0.30');
  assert.equal(tierLetterOfSync(row, 'units', c), 'A');
  assert.equal(tierLetterOfSync(row, 'items', c), 'C');
});

test('Sample-Gate schlaegt jeden Cutoff-Block', () => {
  const c = resolveCutoffs(BUNDLE, 18);
  assert.equal(tierLetterOfSync({ avgPlacement: 1.0, pickRate: 0.005, games: 10 }, 'items', c), null);
});

test('fehlt der Klassen-Block fuer eine Klasse, gilt fuer sie scoreCutoffs', () => {
  const bundle = {
    default: BUNDLE.default,
    perSet: { 18: { scoreCutoffsByKind: { items: { S: 9, A: 8, B: 7, C: 6 } } } },
  };
  const c = resolveCutoffs(bundle, 18);
  const row = { avgPlacement: 4.5 - 0.55, pickRate: 0.005, games: 100000 };
  assert.equal(tierLetterOfSync(row, 'items', c), 'D');
  assert.equal(tierLetterOfSync(row, 'comps', c), 'S');
});
