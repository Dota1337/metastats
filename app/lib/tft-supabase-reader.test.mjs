/**
 * Regressionstests fuer `multiplicity` in mergeJsonbCountArrays.
 *
 * Warum ausgerechnet dieses Feld: es ist das einzige in der Unit-Payload, das
 * ein VERHAELTNIS ist (1 + dupGames/gamesWithUnit) und keine Summe. Es wurde
 * beim Merge bis 2026-08-18 still verworfen, weil das Ausgabe-Objekt explizit
 * gebaut wird — Folge war ein totes ×2-Abzeichen und, schwerer, ein zu
 * niedriger Trait-Stack in tft-active-traits.ts. Ein stiller Rueckfall waere
 * genauso unsichtbar wie beim ersten Mal, deshalb Tests statt Vertrauen.
 *
 * Die Formel muss identisch zur SQL-Seite bleiben (Migration 0059,
 * get_tft_comp_stats_list_v2) — beide mergen dieselben Tages-Rows.
 *
 * Lauf: npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeJsonbCountArrays } from './tft-supabase-reader.ts';

const unit = (over = {}) => ({ characterId: 'TFT17_Ornn', count: 10, games: 10, gamesWithUnit: 10, ...over });

test('multiplicity wird ueber die Tage nach gamesWithUnit gewichtet gemittelt', () => {
  // Tag A: 100 Spiele, jedes doppelt (dup 100). Tag B: 10 Spiele, keins.
  // Ungewichtet waere das 1,5 — richtig sind 1 + 100/110.
  const [u] = mergeJsonbCountArrays(
    [[unit({ gamesWithUnit: 100, multiplicity: 2 })], [unit({ gamesWithUnit: 10, multiplicity: 1 })]],
    'characterId', 9,
  );
  assert.equal(u.gamesWithUnit, 110);
  assert.ok(Math.abs(u.multiplicity - (1 + 100 / 110)) < 1e-12, `war ${u.multiplicity}`);
});

test('erneuter Merge ueber eine bereits gemergte Liste aendert nichts (Idempotenz)', () => {
  // Genau dieser Fall tritt live auf: _v2 merged in SQL, die Route merged das
  // Ergebnis in JS ein zweites Mal.
  const once = mergeJsonbCountArrays(
    [[unit({ gamesWithUnit: 100, multiplicity: 2 })], [unit({ gamesWithUnit: 10, multiplicity: 1 })]],
    'characterId', 9,
  );
  const twice = mergeJsonbCountArrays([once], 'characterId', 9);
  assert.equal(twice[0].multiplicity, once[0].multiplicity);
  assert.equal(twice[0].gamesWithUnit, once[0].gamesWithUnit);
});

test('unter der Mindestprobe von 5 gemergten Spielen bleibt das Feld weg', () => {
  const [u] = mergeJsonbCountArrays([[unit({ gamesWithUnit: 4, multiplicity: 2 })]], 'characterId', 9);
  assert.equal(u.multiplicity, undefined);
});

test('ohne Doppel-Units wird das Feld gar nicht erst gesetzt', () => {
  // Sonst traegt jeder Augment- und Item-Eintrag ein konstantes 1 mit.
  const [u] = mergeJsonbCountArrays([[unit({ multiplicity: 1 })], [unit()]], 'characterId', 9);
  assert.equal(u.multiplicity, undefined);
});

test('die Badge-Schwelle 1.5 wird aus echten Tages-Rows heraus erreicht', () => {
  // Werte aus der Live-DB (euw1, diamond+, 7d, TFT17_SpaceGroove@2~TwoTanky):
  // ein Cluster, in dem fast jedes Spiel zwei Ornn enthaelt.
  const [u] = mergeJsonbCountArrays(
    [[unit({ gamesWithUnit: 59, multiplicity: 1.9152542372881356 })]],
    'characterId', 9,
  );
  assert.ok(u.multiplicity >= 1.5);
});
