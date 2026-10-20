/**
 * Tier-Skala nach Ø-Platz (User 20.10.2026). Comps + Units S+ ≤ 3,99 · S ≤ 4,25
 * · A ≤ 4,39 · B ≤ 4,79 · C darueber; Items S+ ≤ 3,99 · S ≤ 4,10 · A ≤ 4,24 ·
 * B ≤ 4,49 · C darueber. Gerechnet am angezeigten Wert (toFixed(2)).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { familyTierLetter, itemTakesTier, tierLetterOf, TIER_LETTERS, TIER_MIN_GAMES } from './tft-tier-letter.ts';

const comp = avg => tierLetterOf({ avgPlacement: avg, games: 10_000 }, 'comps');
const unit = avg => tierLetterOf({ avgPlacement: avg, games: 10_000 }, 'units');
const item = avg => tierLetterOf({ avgPlacement: avg, games: 10_000 }, 'items');

test('Comp-Grenzen wie vom User vorgegeben', () => {
  const cases = [
    [3.12, 'S+'], [3.99, 'S+'], [4.0, 'S'], [4.25, 'S'], [4.26, 'A'], [4.39, 'A'],
    [4.4, 'B'], [4.79, 'B'], [4.8, 'C'], [5.85, 'C'],
  ];
  for (const [avg, want] of cases) assert.equal(comp(avg), want, `Ø ${avg}`);
});

test('Units wie Comps', () => {
  for (const avg of [3.55, 3.99, 4.0, 4.25, 4.26, 4.39, 4.4, 4.79, 4.8]) assert.equal(unit(avg), comp(avg), `Ø ${avg}`);
});

test('Items mit eigenen, engeren Grenzen', () => {
  const cases = [
    [3.99, 'S+'], [4.0, 'S'], [4.1, 'S'], [4.11, 'A'], [4.24, 'A'], [4.25, 'B'],
    [4.49, 'B'], [4.5, 'C'],
  ];
  for (const [avg, want] of cases) assert.equal(item(avg), want, `Ø ${avg}`);
});

test('Tier folgt der angezeigten Zahl, nicht dem Rohwert', () => {
  // toFixed(2) zeigt 4,255 als 4,25 und 4,795 als 4,79 (binaere Darstellung).
  assert.equal((4.255).toFixed(2), '4.25');
  assert.equal(comp(4.255), 'S');
  assert.equal(comp(4.795), 'B');
  assert.equal(comp(3.994), 'S+');
  assert.equal(comp(3.996), 'S');
  // Zufallszahlen: gleiches Tier wie der gerundet angezeigte Wert.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 20_000; i++) {
    const avg = 3 + rnd() * 2.5;
    const shown = Number(avg.toFixed(2));
    for (const kind of ['comps', 'units', 'items']) {
      assert.equal(
        tierLetterOf({ avgPlacement: avg, games: 10_000 }, kind),
        tierLetterOf({ avgPlacement: shown, games: 10_000 }, kind),
        `${kind} Ø ${avg}`,
      );
    }
  }
});

test('Unter der Mindest-Spielzahl und ohne Ø kein Buchstabe', () => {
  assert.equal(tierLetterOf({ avgPlacement: 3.0, games: TIER_MIN_GAMES.comps - 1 }, 'comps'), null);
  assert.equal(tierLetterOf({ avgPlacement: 3.0, games: TIER_MIN_GAMES.comps }, 'comps'), 'S+');
  assert.equal(tierLetterOf({ avgPlacement: 3.0, games: 199 }, 'units'), null);
  assert.equal(tierLetterOf({ avgPlacement: 3.0, games: 149 }, 'items'), null);
  assert.equal(tierLetterOf({ avgPlacement: null, games: 10_000 }, 'comps'), null);
  assert.equal(tierLetterOf({ avgPlacement: undefined, games: 10_000 }, 'comps'), null);
  assert.equal(tierLetterOf({ avgPlacement: Number.NaN, games: 10_000 }, 'comps'), null);
  assert.equal(tierLetterOf({ avgPlacement: 3.0, games: null }, 'comps'), null);
});

test('kein D mehr, Reihenfolge beste zuerst', () => {
  assert.deepEqual([...TIER_LETTERS], ['S+', 'S', 'A', 'B', 'C']);
  assert.equal(comp(7.9), 'C');
});

test('Familie: Tier aus den gezeigten Familienwerten', () => {
  assert.equal(familyTierLetter({ weightedAvgPlacement: 3.85, totalGames: 653 }), 'S+');
  assert.equal(familyTierLetter({ weightedAvgPlacement: 4.04, totalGames: 1020 }), 'S');
  assert.equal(familyTierLetter({ weightedAvgPlacement: 4.04, totalGames: 49 }), null);
});

test('Komponenten und Traenke bekommen keinen Buchstaben', () => {
  assert.equal(itemTakesTier('DA_Component_BFSword', ['component']), false);
  assert.equal(itemTakesTier('DA_Component_Spatula', undefined), false);
  assert.equal(itemTakesTier('TFT_Item_BFSword', ['component']), false);
  assert.equal(itemTakesTier('DA_HealthPotion18', []), false);
  assert.equal(itemTakesTier('DA_BlastPotion18_Radiant', []), false);
  assert.equal(itemTakesTier('DA_Item_InfinityEdge', []), true);
  assert.equal(itemTakesTier('DA_Artifact_WitsEnd', null), true);
});
